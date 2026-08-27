const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const { sendNewMessageEmail } = require('../lib/email');
const { slimListings } = require('../lib/image');

// ─── GET /api/messages — all threads for current user ────────────────────────
router.get('/', authMiddleware(), async (req, res) => {
  try {
    const userId = req.user._id;

    // Aggregation pipeline: get unique threads with last message + unread count
    const threads = await Message.aggregate([
      { $match: { $or: [{ sender: userId }, { receiver: userId }] } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { listing: '$listing', partner: {
            $cond: [{ $eq: ['$sender', userId] }, '$receiver', '$sender']
          }},
          lastMessage: { $first: '$text' },
          lastMessageAt: { $first: '$createdAt' },
          lastMessageId: { $first: '$_id' },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$receiver', userId] }, { $eq: ['$isRead', false] }] }, 1, 0]
            }
          },
        }
      },
      { $sort: { lastMessageAt: -1 } },
      { $limit: 50 },
    ]);

    if (threads.length === 0) return res.json({ threads: [] });

    // Bulk fetch all referenced listings and partners in 2 queries
    const listingIds = threads.map(t => t._id.listing);
    const partnerIds = threads.map(t => t._id.partner);

    const [listings, partners] = await Promise.all([
      Listing.find({ _id: { $in: listingIds } }).select('title photos status category').lean(),
      User.find({ _id: { $in: partnerIds } }).select('firstName lastName profilePhoto branch year').lean(),
    ]);

    slimListings(listings);

    const listingMap = new Map(listings.map(l => [l._id.toString(), l]));
    const partnerMap = new Map(partners.map(p => [p._id.toString(), p]));

    const result = threads.map(t => ({
      listingId: t._id.listing.toString(),
      listing: listingMap.get(t._id.listing.toString()) || null,
      partner: partnerMap.get(t._id.partner.toString()) || null,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt,
      unreadCount: t.unreadCount,
    })).filter(t => t.listing && t.partner);

    res.json({ threads: result });
  } catch (err) {
    console.error('Get threads error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── GET /api/messages/me/unread — unread count (MUST be before :id routes) ──
router.get('/me/unread', authMiddleware(), async (req, res) => {
  try {
    const count = await Message.countDocuments({ receiver: req.user._id, isRead: false });
    res.json({ unreadCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ─── GET /api/messages/:listingId/:otherId — get a specific thread ─────────────
router.get('/:listingId/:otherId', authMiddleware(), async (req, res) => {
  try {
    const { listingId, otherId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(listingId) || !mongoose.Types.ObjectId.isValid(otherId)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    // Fetch messages + mark read in parallel with listing/other user
    const [messages, listingDoc, userDoc] = await Promise.all([
      Message.find({
        listing: listingId,
        $or: [
          { sender: userId, receiver: otherId },
          { sender: otherId, receiver: userId },
        ],
      })
        .sort({ createdAt: 1 })
        .populate('sender', 'firstName lastName profilePhoto')
        .lean(),
      Message.updateMany(
        { listing: listingId, sender: otherId, receiver: userId, isRead: false },
        { $set: { isRead: true } }
      ).then(() => Listing.findById(listingId).select('title photos status category listingType price rentalRate seller reservedFor').lean()),
      User.findById(otherId).select('firstName lastName profilePhoto branch year isVerified rating').lean(),
    ]);

    const listing = listingDoc ? slimListings([listingDoc])[0] : null;

    res.json({ messages, listing, other: userDoc });
  } catch (err) {
    console.error('Get thread error:', err);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// ─── POST /api/messages/:listingId/:receiverId — send message ─────────────────
router.post('/:listingId/:receiverId', authMiddleware(), async (req, res) => {
  try {
    const { listingId, receiverId } = req.params;
    const { text } = req.body;

    if (!mongoose.Types.ObjectId.isValid(listingId) || !mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    if (req.user._id.toString() === receiverId) {
      return res.status(400).json({ error: 'Cannot send a message to yourself' });
    }

    // 1 query to check listing + receiver existence
    const [listing, receiver] = await Promise.all([
      Listing.findById(listingId).select('title').lean(),
      User.findById(receiverId).select('firstName email').lean(),
    ]);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (!receiver) return res.status(404).json({ error: 'Recipient not found' });

    const message = await Message.create({
      listing: listingId,
      sender: req.user._id,
      receiver: receiverId,
      text: text.trim(),
    });

    await message.populate('sender', 'firstName lastName profilePhoto');

    // Rate-limit emails: 1 per thread per hour (combined into single count query)
    const msgCount = await Message.countDocuments({
      listing: listingId,
      sender: req.user._id,
      receiver: receiverId,
      createdAt: { $gt: new Date(Date.now() - 3600000) },
    });
    if (msgCount <= 1) {
      sendNewMessageEmail(receiver, req.user, listing).catch(console.error);
    }

    res.status(201).json({ message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
