const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Content
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    category: {
      type: String,
      required: true,
      enum: ['Lab Equipment', 'Formal Wear', 'Shoes', 'Books', 'Electronics', 'Furniture', 'Sports', 'Other'],
    },
    subcategory: { type: String, trim: true, default: '' },
    condition: {
      type: String,
      required: true,
      enum: ['New', 'Like New', 'Good', 'Fair'],
    },

    // Listing type
    listingType: {
      type: String,
      required: true,
      enum: ['sell', 'rent', 'both'],
    },
    price: { type: Number, default: null },             // sale price (₹)
    rentalRate: { type: Number, default: null },        // rental rate (₹)
    rentalDuration: {
      type: String,
      enum: ['per day', 'per week', 'per month', 'per semester', null],
      default: null,
    },
    quantity: { type: Number, default: 1, min: 1 },

    // Photos — stored as relative paths (e.g. /uploads/uuid.jpg)
    photos: [{ type: String }],

    // Status lifecycle: draft → pending → live → reserved/sold/returned/rejected
    status: {
      type: String,
      enum: ['draft', 'pending', 'live', 'reserved', 'sold', 'returned', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String, default: '' },

    // Reserved for a specific buyer
    reservedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Tags for books (e.g. "CSE 3rd Sem")
    tags: [{ type: String, trim: true }],

    // Views counter (lightweight analytics)
    views: { type: Number, default: 0 },
  },
  { timestamps: true, autoIndex: false }
);

// Filter indexes
listingSchema.index({ category: 1, status: 1 });
listingSchema.index({ seller: 1 });
listingSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Listing', listingSchema);
