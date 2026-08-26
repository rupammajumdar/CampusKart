const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Target: either a listing or a user (at least one required)
    targetListing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', default: null },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    reason: { type: String, required: true, trim: true, maxlength: 1000 },

    status: {
      type: String,
      enum: ['open', 'in_review', 'resolved', 'dismissed'],
      default: 'open',
    },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    adminNote: { type: String, default: '' },

    // Linked transaction for context
    relatedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1 });
reportSchema.index({ reporter: 1 });

module.exports = mongoose.model('Report', reportSchema);
