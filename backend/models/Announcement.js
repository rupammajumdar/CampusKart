const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  duration: { type: String, default: 'Show until dismissed' },
  expiresAt: { type: Date, default: null },
  publishedBy: { type: String, default: 'admin' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
