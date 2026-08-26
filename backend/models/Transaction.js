const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['buy', 'rent'], required: true },

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'disputed'],
      default: 'pending',
    },

    // For rentals
    rentalStartDate: { type: Date, default: null },
    rentalEndDate: { type: Date, default: null },
    returnReminderSent: { type: Boolean, default: false },

    // Ratings — both parties rate after completion
    buyerRated: { type: Boolean, default: false },
    sellerRated: { type: Boolean, default: false },
    buyerRating: { type: Number, min: 1, max: 5, default: null },
    sellerRating: { type: Number, min: 1, max: 5, default: null },
    buyerReview: { type: String, maxlength: 500, default: '' },
    sellerReview: { type: String, maxlength: 500, default: '' },

    // Dispute
    disputeReason: { type: String, default: '' },
    disputeResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

transactionSchema.index({ buyer: 1 });
transactionSchema.index({ seller: 1 });
transactionSchema.index({ listing: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
