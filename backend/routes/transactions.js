const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /api/transactions — my transaction history ───────────────────────────
router.get('/', authMiddleware(), async (req, res) => {
  try {
    const { role = 'both', status } = req.query; // role: buyer | seller | both
    const userId = req.user._id;

    let filter = {};
    if (role === 'buyer') filter.buyer = userId;
    else if (role === 'seller') filter.seller = userId;
    else filter.$or = [{ buyer: userId }, { seller: userId }];

    if (status) filter.status = status;

    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .populate('listing', 'title photos category condition listingType price rentalRate')
      .populate('buyer', 'firstName lastName branch year profilePhoto rating')
      .populate('seller', 'firstName lastName branch year profilePhoto rating')
      .lean();

    res.json({ transactions });
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ─── GET /api/transactions/:id — get single transaction ──────────────────────
router.get('/:id', authMiddleware(), async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id)
      .populate('listing', 'title photos category condition listingType price rentalRate seller')
      .populate('buyer', 'firstName lastName branch year profilePhoto rating isVerified')
      .populate('seller', 'firstName lastName branch year profilePhoto rating isVerified');

    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    // Only buyer or seller can view
    const userId = req.user._id.toString();
    if (txn.buyer._id.toString() !== userId && txn.seller._id.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ transaction: txn });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

// ─── POST /api/transactions/:id/rate — rate the other party ──────────────────
router.post('/:id/rate', authMiddleware(), async (req, res) => {
  try {
    const { rating, review } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.status !== 'completed') {
      return res.status(400).json({ error: 'Can only rate a completed transaction' });
    }

    const userId = req.user._id.toString();
    const isBuyer = txn.buyer.toString() === userId;
    const isSeller = txn.seller.toString() === userId;

    if (!isBuyer && !isSeller) return res.status(403).json({ error: 'Forbidden' });

    if (isBuyer) {
      if (txn.buyerRated) return res.status(409).json({ error: 'You have already rated this transaction' });
      txn.buyerRating = Number(rating);
      txn.buyerReview = review?.trim() || '';
      txn.buyerRated = true;

      // Update seller's aggregate rating
      await updateUserRating(txn.seller, Number(rating));
    } else {
      if (txn.sellerRated) return res.status(409).json({ error: 'You have already rated this transaction' });
      txn.sellerRating = Number(rating);
      txn.sellerReview = review?.trim() || '';
      txn.sellerRated = true;

      // Update buyer's aggregate rating
      await updateUserRating(txn.buyer, Number(rating));
    }

    await txn.save();
    res.json({ message: 'Rating submitted. Thank you!' });
  } catch (err) {
    console.error('Rate error:', err);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// ─── POST /api/transactions/:id/dispute — raise a dispute ────────────────────
router.post('/:id/dispute', authMiddleware(), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason is required' });

    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    const userId = req.user._id.toString();
    if (txn.buyer.toString() !== userId && txn.seller.toString() !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    txn.status = 'disputed';
    txn.disputeReason = reason;
    await txn.save();

    res.json({ message: 'Dispute raised. Admin will review and contact you.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to raise dispute' });
  }
});

// ─── Helper: update a user's average rating ───────────────────────────────────
async function updateUserRating(userId, newRating) {
  const user = await User.findById(userId);
  if (!user) return;
  const total = user.rating * user.ratingCount + newRating;
  user.ratingCount += 1;
  user.rating = Math.round((total / user.ratingCount) * 10) / 10; // 1 decimal
  await user.save();
}

module.exports = router;
