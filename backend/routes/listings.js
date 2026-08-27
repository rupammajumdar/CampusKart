const express = require('express');
const router = express.Router();
const Listing = require('../models/Listing');
const Message = require('../models/Message');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');
const User = require('../models/User');
const { authMiddleware, requireVerified, requireLister } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const {
  sendInterestNotificationEmail,
  sendItemReservedEmail,
} = require('../lib/email');
const {
  fileToCompressedDataUrl,
  makeThumbnail,
  slimListings,
  slimListingsWithThumbs,
  DEFAULT_THUMB,
} = require('../lib/image');

// ─── GET /api/listings/stats — public realtime marketplace statistics ──────────
router.get('/stats', async (req, res) => {
  try {
    const [verifiedCount, totalUsersCount, activeListingsCount, ratingsAgg] = await Promise.all([
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isBanned: false }),
      Listing.countDocuments({ status: { $in: ['live', 'reserved'] } }),
      User.aggregate([
        { $match: { ratingCount: { $gt: 0 } } },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, totalRatings: { $sum: '$ratingCount' } } }
      ])
    ]);

    const verifiedStudents = Math.max(verifiedCount, totalUsersCount);
    let positiveRatingPct = 98;
    if (ratingsAgg && ratingsAgg.length > 0 && ratingsAgg[0].avgRating > 0) {
      positiveRatingPct = Math.min(100, Math.round((ratingsAgg[0].avgRating / 5) * 100));
    }

    res.json({
      ok: true,
      verifiedStudents,
      totalUsers: totalUsersCount,
      activeListings: activeListingsCount,
      positiveRatings: positiveRatingPct,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/listings — browse/search/filter ─────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      q,           // text search
      category,
      type,        // sell | rent | both
      condition,
      minPrice,
      maxPrice,
      tags,
      status = 'live',
      sort = 'newest',
      page = 1,
      limit = 20,
    } = req.query;

    const filter = { status };

    if (q) {
      filter.$text = { $search: q };
    }
    if (category) filter.category = category;
    if (condition) filter.condition = condition;
    if (type) {
      filter.listingType = type === 'both' ? { $in: ['both', 'sell', 'rent'] } : { $in: [type, 'both'] };
    }
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    if (tags) {
      const tagArr = tags.split(',').map((t) => t.trim());
      filter.tags = { $in: tagArr };
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popular: { views: -1 },
    };
    const sortOpt = q ? { score: { $meta: 'textScore' }, ...sortMap[sort] } : sortMap[sort] || { createdAt: -1 };

    const skip = (Number(page) - 1) * Number(limit);
    const [listings, total] = await Promise.all([
      Listing.find(filter)
        .sort(sortOpt)
        .skip(skip)
        .limit(Number(limit))
        // Only fetch the fields the browse grid needs — skip heavy fields
        .select('title category condition listingType price rentalRate rentalDuration photos seller status createdAt views tags')
        .populate('seller', 'firstName lastName branch year isVerified rating')
        .lean(),
      Listing.countDocuments(filter),
    ]);

    // Generate inline thumbnails in parallel (no extra HTTP round-trips for browser)
    const slimmed = await slimListingsWithThumbs(listings);

    res.json({
      listings: slimmed,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('Browse listings error:', err);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// ─── POST /api/listings — create listing ──────────────────────────────────────
router.post(
  '/',
  authMiddleware(),
  requireVerified,
  requireLister,
  upload.array('photos', 5),
  async (req, res) => {
    try {
      const {
        title, description, category, subcategory,
        condition, listingType, price, rentalRate,
        rentalDuration, quantity, tags, status,
      } = req.body;

      if (!title || !description || !category || !condition || !listingType) {
        return res.status(400).json({ error: 'Missing required listing fields' });
      }

      const photos = [];
      for (const f of req.files || []) {
        const compressed = await fileToCompressedDataUrl(f);
        if (compressed) photos.push(compressed.url);
      }

      const listing = await Listing.create({
        seller: req.user._id,
        title: title.trim(),
        description: description.trim(),
        category,
        subcategory: subcategory || '',
        condition,
        listingType,
        price: price ? Number(price) : null,
        rentalRate: rentalRate ? Number(rentalRate) : null,
        rentalDuration: rentalDuration || null,
        quantity: quantity ? Number(quantity) : 1,
        photos,
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        status: status === 'draft' ? 'draft' : 'pending',
      });

      res.status(201).json({
        message: status === 'draft' ? 'Draft saved.' : 'Listing submitted! Pending Admin approval.',
        listing,
      });
    } catch (err) {
      console.error('Create listing error:', err);
      res.status(500).json({ error: 'Failed to create listing' });
    }
  }
);

// ─── GET /api/listings/my — seller's own listings ────────────────────────────
router.get('/seller/my', authMiddleware(), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { seller: req.user._id };
    if (status) filter.status = status;

    const listings = await Listing.find(filter)
      .sort({ createdAt: -1 })
      .populate('reservedFor', 'firstName lastName branch year')
      .lean();

    res.json({ listings: slimListings(listings) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch your listings' });
  }
});

// ─── GET /api/listings/thumb/:id/:index — lightweight photo thumbnail ──────────
// Serves a small JPEG resized on the fly from the stored photo. Responses are
// cached aggressively by the CDN so list pages stay fast once warmed.
router.get('/thumb/:id/:index', async (req, res) => {
  const index = Number(req.params.index) || 0;
  const width = Number(req.query.w) || DEFAULT_THUMB;
  try {
    const listing = await Listing.findById(req.params.id).select('photos').lean();
    if (!listing || !Array.isArray(listing.photos) || !listing.photos[index]) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const thumb = await makeThumbnail(listing.photos[index], width);
    if (!thumb) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(thumb);
  } catch (err) {
    console.error('Thumbnail error:', err);
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});

// ─── GET /api/listings/:id — get listing detail ───────────────────────────────
router.get('/:id', authMiddleware({ optional: true }), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('seller', 'firstName lastName branch year isVerified rating profilePhoto createdAt')
      .populate('reservedFor', 'firstName lastName branch year')
      .lean();

    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Increment view counter (fire and forget)
    Listing.updateOne({ _id: listing._id }, { $inc: { views: 1 } }).exec();

    // If requester is the owner, show all statuses; otherwise hide draft/pending
    if (req.user && listing.seller._id.toString() === req.user._id.toString()) {
      return res.json({ listing });
    }
    if (['draft', 'pending'].includes(listing.status)) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Check if current user has wishlisted this item
    let wishlisted = false;
    if (req.user) {
      const u = await User.findById(req.user._id).select('wishlist');
      wishlisted = u.wishlist.some((id) => id.toString() === listing._id.toString());
    }

    res.json({ listing, wishlisted });
  } catch (err) {
    console.error('Get listing error:', err);
    res.status(500).json({ error: 'Failed to fetch listing' });
  }
});

// ─── PUT /api/listings/:id — edit listing ────────────────────────────────────
router.put('/:id', authMiddleware(), requireVerified, upload.array('photos', 5), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const isOwner = listing.seller.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const {
      title, description, category, subcategory,
      condition, listingType, price, rentalRate,
      rentalDuration, quantity, tags,
    } = req.body;

    if (title) listing.title = title.trim();
    if (description) listing.description = description.trim();
    if (category) listing.category = category;
    if (subcategory !== undefined) listing.subcategory = subcategory;
    if (condition) listing.condition = condition;
    if (listingType) listing.listingType = listingType;
    if (price !== undefined) listing.price = price ? Number(price) : null;
    if (rentalRate !== undefined) listing.rentalRate = rentalRate ? Number(rentalRate) : null;
    if (rentalDuration !== undefined) listing.rentalDuration = rentalDuration || null;
    if (quantity) listing.quantity = Number(quantity);
    if (tags !== undefined) listing.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);

    // New photos
    if (req.files && req.files.length > 0) {
      for (const f of req.files || []) {
        const compressed = await fileToCompressedDataUrl(f);
        if (compressed) listing.photos.push(compressed.url);
      }
      if (listing.photos.length > 5) listing.photos = listing.photos.slice(0, 5);
    }

    // Owner editing a rejected listing — re-submit for review
    if (isOwner && listing.status === 'rejected') {
      listing.status = 'pending';
      listing.rejectionReason = '';
    }

    await listing.save();
    res.json({ message: 'Listing updated', listing });
  } catch (err) {
    console.error('Edit listing error:', err);
    res.status(500).json({ error: 'Failed to update listing' });
  }
});

// ─── DELETE /api/listings/:id — delist ───────────────────────────────────────
router.delete('/:id', authMiddleware(), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const isOwner = listing.seller.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    await listing.deleteOne();
    res.json({ message: 'Listing removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete listing' });
  }
});

// ─── POST /api/listings/:id/interest — express interest ──────────────────────
router.post('/:id/interest', authMiddleware(), requireVerified, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'live') return res.status(400).json({ error: 'This listing is no longer available' });
    if (listing.seller._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot express interest in your own listing' });
    }

    // Check if a message thread already exists
    const existing = await Message.findOne({
      listing: listing._id,
      sender: req.user._id,
      receiver: listing.seller._id,
    });

    if (!existing) {
      // Create an opening message
      const { message: initialMsg } = req.body;
      await Message.create({
        listing: listing._id,
        sender: req.user._id,
        receiver: listing.seller._id,
        text: initialMsg || `Hi! I'm interested in "${listing.title}". Is it still available?`,
      });

      // Email the seller (don't block response)
      sendInterestNotificationEmail(listing.seller, req.user, listing).catch(console.error);
    }

    res.json({ message: 'Interest expressed! Check messages.', threadCreated: !existing });
  } catch (err) {
    console.error('Interest error:', err);
    res.status(500).json({ error: 'Failed to express interest' });
  }
});

// ─── POST /api/listings/:id/reserve/:userId — reserve for buyer ───────────────
router.post('/:id/reserve/:userId', authMiddleware(), requireVerified, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the seller can reserve a listing' });
    }
    if (listing.status !== 'live') {
      return res.status(400).json({ error: 'Listing is not currently live' });
    }

    const buyer = await User.findById(req.params.userId);
    if (!buyer) return res.status(404).json({ error: 'Buyer not found' });

    listing.status = 'reserved';
    listing.reservedFor = buyer._id;
    await listing.save();

    // Create a pending transaction
    const { type } = req.body; // buy | rent
    const txn = await Transaction.create({
      listing: listing._id,
      buyer: buyer._id,
      seller: req.user._id,
      type: type || 'buy',
      status: 'confirmed',
      rentalStartDate: type === 'rent' ? new Date() : null,
      rentalEndDate: type === 'rent' && req.body.rentalEndDate ? new Date(req.body.rentalEndDate) : null,
    });

    sendItemReservedEmail(buyer, listing).catch(console.error);

    res.json({ message: 'Item reserved for buyer', transaction: txn });
  } catch (err) {
    console.error('Reserve error:', err);
    res.status(500).json({ error: 'Failed to reserve listing' });
  }
});

// ─── POST /api/listings/:id/complete — mark as sold / returned ────────────────
router.post('/:id/complete', authMiddleware(), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'reserved') {
      return res.status(400).json({ error: 'Listing is not reserved' });
    }

    const isSeller = listing.seller.toString() === req.user._id.toString();
    const isBuyer = listing.reservedFor && listing.reservedFor.toString() === req.user._id.toString();
    if (!isSeller && !isBuyer) return res.status(403).json({ error: 'Forbidden' });

    // Determine new status
    const txn = await Transaction.findOne({ listing: listing._id, status: 'confirmed' });
    const newStatus = txn?.type === 'rent' ? 'returned' : 'sold';
    listing.status = newStatus;
    listing.reservedFor = null;
    await listing.save();

    if (txn) {
      txn.status = 'completed';
      await txn.save();
    }

    res.json({ message: `Transaction marked as ${newStatus}` });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Failed to mark complete' });
  }
});

// ─── POST /api/listings/:id/report ───────────────────────────────────────────
router.post('/:id/report', authMiddleware(), requireVerified, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason is required' });

    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Prevent duplicate reports from same user
    const existing = await Report.findOne({ reporter: req.user._id, targetListing: listing._id, status: 'open' });
    if (existing) return res.status(409).json({ error: 'You have already reported this listing' });

    await Report.create({
      reporter: req.user._id,
      targetListing: listing._id,
      reason,
    });

    res.json({ message: 'Report submitted. Our admin team will review it.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

module.exports = router;
