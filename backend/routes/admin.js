const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { sendListingApprovedEmail, sendListingRejectedEmail } = require('../lib/email');
const { slimListings } = require('../lib/image');

// All admin routes require auth + admin role
router.use(authMiddleware(), requireAdmin);

// ─── GET /api/admin/queue — pending listings ──────────────────────────────────
router.get('/queue', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [listings, total] = await Promise.all([
      Listing.find({ status: 'pending' })
        .sort({ createdAt: 1 }) // oldest first
        .skip(skip)
        .limit(Number(limit))
        .populate('seller', 'firstName lastName email branch year isVerified rating ratingCount'),
      Listing.countDocuments({ status: 'pending' }),
    ]);

    slimListings(listings);
    res.json({ listings, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch moderation queue' });
  }
});

// ─── POST /api/admin/listings/:id/approve ────────────────────────────────────
router.post('/listings/:id/approve', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid listing ID' });
    }

    const listing = await Listing.findById(req.params.id).populate('seller');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'pending') {
      return res.status(400).json({ error: `Listing is already ${listing.status}` });
    }

    listing.status = 'live';
    listing.rejectionReason = '';
    await listing.save();

    sendListingApprovedEmail(listing.seller, listing).catch(console.error);

    res.json({ message: 'Listing approved and is now live', listing });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Failed to approve listing' });
  }
});

// ─── POST /api/admin/listings/:id/reject ─────────────────────────────────────
router.post('/listings/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid listing ID' });
    }

    const listing = await Listing.findById(req.params.id).populate('seller');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    listing.status = 'rejected';
    listing.rejectionReason = reason;
    await listing.save();

    sendListingRejectedEmail(listing.seller, listing, reason).catch(console.error);

    res.json({ message: 'Listing rejected', listing });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject listing' });
  }
});

// ─── GET /api/admin/users — all users ────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { search, role, isBanned, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (search) filter.$or = [
      { email: { $regex: search, $options: 'i' } },
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
    ];
    if (role) filter.role = role;
    if (isBanned !== undefined) filter.isBanned = isBanned === 'true';

    const skip = (Number(page) - 1) * Number(limit);
    const [rawUsers, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash -verificationToken -magicToken -resetToken')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    const users = await Promise.all(rawUsers.map(async (u) => {
      const userObj = u.toObject();
      const [listingsCount, reportsCount] = await Promise.all([
        Listing.countDocuments({ seller: u._id }),
        Report.countDocuments({ targetUser: u._id }),
      ]);
      userObj.listingsCount = listingsCount;
      userObj.reportsCount = reportsCount;
      return userObj;
    }));

    res.json({ users, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── GET /api/admin/users/:id/listings ─────────────────────────────────────
router.get('/users/:id/listings', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const listings = await Listing.find({ seller: req.params.id }).sort({ createdAt: -1 });
    slimListings(listings);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user listings' });
  }
});

// ─── PUT /api/admin/listings/:id ─────────────────────────────────────────────
router.put('/listings/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid listing ID' });
    }
    const { title, description, price, rentalRate, category, condition, status } = req.body;
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    if (title !== undefined) listing.title = title.trim();
    if (description !== undefined) listing.description = description.trim();
    if (price !== undefined) listing.price = price ? Number(price) : null;
    if (rentalRate !== undefined) listing.rentalRate = rentalRate ? Number(rentalRate) : null;
    if (category) listing.category = category;
    if (condition) listing.condition = condition;
    if (status) listing.status = status;

    await listing.save();
    res.json({ message: 'Listing updated by admin', listing });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update listing' });
  }
});

// ─── DELETE /api/admin/listings/:id ──────────────────────────────────────────
router.delete('/listings/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid listing ID' });
    }
    const listing = await Listing.findByIdAndDelete(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json({ message: 'Listing deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete listing' });
  }
});

// ─── POST /api/admin/users/:id/suspend ───────────────────────────────────────
router.post('/users/:id/suspend', async (req, res) => {
  try {
    const { ban, reason } = req.body; // ban: true to ban, false to unban
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot suspend an admin account' });

    user.isBanned = ban !== false;
    user.bannedReason = reason || '';
    await user.save();

    res.json({ message: user.isBanned ? 'User suspended' : 'User unsuspended', user: user.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// ─── POST /api/admin/users/:id/make-admin ────────────────────────────────────
router.post('/users/:id/make-admin', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.role = 'admin';
    await user.save();
    res.json({ message: 'User promoted to admin' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to promote user' });
  }
});

// ─── GET /api/admin/reports — all reports ────────────────────────────────────
router.get('/reports', async (req, res) => {
  try {
    const { status = 'open', page = 1, limit = 20 } = req.query;
    const filter = status !== 'all' ? { status } : {};
    const skip = (Number(page) - 1) * Number(limit);

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('reporter', 'firstName lastName email branch year')
        .populate('targetUser', 'firstName lastName email branch year')
        .populate('targetListing', 'title category status photos')
        .populate('relatedTransaction'),
      Report.countDocuments(filter),
    ]);

    for (const r of reports) {
      if (r.targetListing) slimListings([r.targetListing]);
    }

    res.json({ reports, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ─── POST /api/admin/reports/:id/resolve ─────────────────────────────────────
router.post('/reports/:id/resolve', async (req, res) => {
  try {
    const { action, note } = req.body; // action: dismiss | warn | remove_listing | suspend_user
    const report = await Report.findById(req.params.id)
      .populate('targetUser')
      .populate('targetListing');

    if (!report) return res.status(404).json({ error: 'Report not found' });

    report.status = action === 'dismiss' ? 'dismissed' : 'resolved';
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();
    report.adminNote = note || '';
    await report.save();

    // Take action
    if (action === 'remove_listing' && report.targetListing) {
      await Listing.findByIdAndDelete(report.targetListing._id);
    }
    if (action === 'suspend_user' && report.targetUser) {
      await User.findByIdAndUpdate(report.targetUser._id, { isBanned: true, bannedReason: note || 'Reported by users' });
    }

    res.json({ message: `Report ${report.status}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve report' });
  }
});

// ─── GET /api/admin/analytics ────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const [
      totalUsers,
      verifiedUsers,
      listers,
      totalListings,
      liveListings,
      pendingListings,
      soldListings,
      totalTransactions,
      completedTransactions,
      openReports,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isLister: true }),
      Listing.countDocuments(),
      Listing.countDocuments({ status: 'live' }),
      Listing.countDocuments({ status: 'pending' }),
      Listing.countDocuments({ status: 'sold' }),
      Transaction.countDocuments(),
      Transaction.countDocuments({ status: 'completed' }),
      Report.countDocuments({ status: 'open' }),
    ]);

    // Category breakdown
    const categoryStats = await Listing.aggregate([
      { $match: { status: { $in: ['live', 'sold', 'returned'] } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Weekly signups (last 4 weeks)
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const weeklySignups = await User.aggregate([
      { $match: { createdAt: { $gte: fourWeeksAgo } } },
      {
        $group: {
          _id: { $week: '$createdAt' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id': 1 } },
    ]);

    // Top listers
    const topListers = await Listing.aggregate([
      { $match: { status: { $in: ['live', 'sold', 'returned', 'reserved'] } } },
      { $group: { _id: '$seller', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'seller',
        },
      },
      { $unwind: '$seller' },
      {
        $project: {
          count: 1,
          'seller.firstName': 1,
          'seller.lastName': 1,
          'seller.branch': 1,
          'seller.year': 1,
          'seller.profilePhoto': 1,
          'seller.rating': 1,
        },
      },
    ]);

    res.json({
      users: { total: totalUsers, verified: verifiedUsers, listers },
      listings: { total: totalListings, live: liveListings, pending: pendingListings, sold: soldListings },
      transactions: { total: totalTransactions, completed: completedTransactions },
      reports: { open: openReports },
      categoryStats,
      weeklySignups,
      topListers,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ─── POST /api/admin/listings — admin create listing (no moderation needed) ──
router.post('/listings', async (req, res) => {
  try {
    const { upload } = require('../middleware/upload');
    // This is handled via server-level multer; just create the listing as live
    const {
      title, description, category, subcategory,
      condition, listingType, price, rentalRate,
      rentalDuration, quantity, tags,
    } = req.body;

    const listing = await Listing.create({
      seller: req.user._id,
      title, description, category,
      subcategory: subcategory || '',
      condition, listingType,
      price: price ? Number(price) : null,
      rentalRate: rentalRate ? Number(rentalRate) : null,
      rentalDuration: rentalDuration || null,
      quantity: quantity ? Number(quantity) : 1,
      photos: [],
      tags: tags ? tags.split(',').map((t) => t.trim()) : [],
      status: 'live', // admin listings skip moderation
    });

    res.status(201).json({ message: 'Admin listing created and is live', listing });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create admin listing' });
  }
});

module.exports = router;
