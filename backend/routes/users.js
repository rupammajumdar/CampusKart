const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Listing = require('../models/Listing');
const { authMiddleware } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const path = require('path');

// ─── GET /api/users/me ────────────────────────────────────────────────────────
router.get('/me', authMiddleware(), async (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

// ─── PUT /api/users/me ────────────────────────────────────────────────────────
router.put('/me', authMiddleware(), (req, res, next) => {
  upload.single('profilePhoto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'File upload error' });
    next();
  });
}, async (req, res) => {
  try {
    const { firstName, lastName, hostel, year, branch } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (hostel !== undefined) user.hostel = hostel.trim();
    if (year) user.year = year;
    if (branch) user.branch = branch;

    if (req.file) {
      user.profilePhoto = `/uploads/${req.file.filename}`;
    }

    await user.save();
    res.json({ message: 'Profile updated successfully', user: user.toPublicJSON() });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: err.message || 'Profile update failed' });
  }
});

// ─── POST /api/users/become-lister ────────────────────────────────────────────
router.post('/become-lister', authMiddleware(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.isVerified = true;
    user.isLister = true;
    user.listerAcceptedAt = new Date();
    await user.save();

    res.json({ message: 'You are now a lister! You can start listing items.', user: user.toPublicJSON() });
  } catch (err) {
    console.error('Become lister error:', err);
    res.status(500).json({ error: 'Failed to upgrade to lister' });
  }
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
// Public profile — no sensitive fields
router.get('/:id', authMiddleware({ optional: true }), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      'firstName lastName email branch year hostel profilePhoto isVerified isLister rating ratingCount createdAt role'
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Count their active listings
    const activeListings = await Listing.countDocuments({ seller: user._id, status: 'live' });

    res.json({ user: { ...user.toObject(), activeListings } });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ─── POST /api/users/wishlist/:listingId ──────────────────────────────────────
router.post('/wishlist/:listingId', authMiddleware(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const listingId = req.params.listingId;
    const idx = user.wishlist.indexOf(listingId);

    if (idx > -1) {
      user.wishlist.splice(idx, 1); // remove
      await user.save();
      return res.json({ message: 'Removed from wishlist', wishlisted: false });
    } else {
      user.wishlist.push(listingId);
      await user.save();
      return res.json({ message: 'Added to wishlist', wishlisted: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Wishlist update failed' });
  }
});

// ─── GET /api/users/wishlist ──────────────────────────────────────────────────
router.get('/me/wishlist', authMiddleware(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'wishlist',
      match: { status: { $in: ['live', 'reserved'] } },
      select: 'title category photos price rentalRate listingType status condition',
    });
    res.json({ wishlist: user.wishlist });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
});

module.exports = router;
