const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const { sendNewMessageEmail } = require('../lib/email');

// ─── GET /api/messages — all threads for current user ────────────────────────
router.get('/', authMiddleware(), async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all unique listing+partner combos the user is involved in
    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }],
    })
      .sort({ createdAt: -1 })
      .populate('listing', 'title photos status category')
      .populate('sender', 'firstName lastName profilePhoto branch year')
      .populate('receiver', 'firstName lastName profilePhoto branch year');

    // Deduplicate into threads
    const threadMap = new Map();
    for (const msg of messages) {
      if (!msg.listing || !msg.sender || !msg.receiver) continue;

      const partnerId =
        msg.sender._id.toString() === userId.toString()
          ? msg.receiver._id.toString()
          : msg.sender._id.toString();
      const key = `${msg.listing._id}_${partnerId}`;

      if (!threadMap.has(key)) {
        const partner =
          msg.sender._id.toString() === userId.toString() ? msg.receiver : msg.sender;

        threadMap.set(key, {
          listingId: msg.listing._id,
          listing: msg.listing,
          partner,
          lastMessage: msg.text,
          lastMessageAt: msg.createdAt,
          unreadCount: 0,
        });
      }

      // Count unread for this thread
      if (msg.receiver._id.toString() === userId.toString() && !msg.isRead) {
        threadMap.get(key).unreadCount += 1;
      }
    }

    const threads = Array.from(threadMap.values()).sort(
      (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
    );

    res.json({ threads });
  } catch (err) {
    console.error('Get threads error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
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

    const messages = await Message.find({
      listing: listingId,
      $or: [
        { sender: userId, receiver: otherId },
        { sender: otherId, receiver: userId },
      ],
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'firstName lastName profilePhoto')
      .populate('receiver', 'firstName lastName profilePhoto');

    // Mark messages as read
    await Message.updateMany(
      { listing: listingId, sender: otherId, receiver: userId, isRead: false },
      { isRead: true }
    );

    const listing = await Listing.findById(listingId).select('title photos status category listingType price rentalRate seller reservedFor');
    const other = await User.findById(otherId).select('firstName lastName profilePhoto branch year isVerified rating');

    res.json({ messages, listing, other });
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

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const receiver = await User.findById(receiverId);
    if (!receiver) return res.status(404).json({ error: 'Recipient not found' });

    if (req.user._id.toString() === receiverId) {
      return res.status(400).json({ error: 'Cannot send a message to yourself' });
    }

    const message = await Message.create({
      listing: listingId,
      sender: req.user._id,
      receiver: receiverId,
      text: text.trim(),
    });

    await message.populate('sender', 'firstName lastName profilePhoto');

    // Send email notification (non-blocking, rate-limited to first message per hour per thread)
    const recentMsg = await Message.findOne({
      listing: listingId,
      sender: req.user._id,
      receiver: receiverId,
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },
    }).sort({ createdAt: -1 });

    // Only send if this is the first message in the last hour
    const msgCount = await Message.countDocuments({
      listing: listingId,
      sender: req.user._id,
      receiver: receiverId,
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },
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

// ─── GET /api/messages/unread-count ──────────────────────────────────────────
router.get('/me/unread', authMiddleware(), async (req, res) => {
  try {
    const count = await Message.countDocuments({ receiver: req.user._id, isRead: false });
    res.json({ unreadCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

module.exports = router;
