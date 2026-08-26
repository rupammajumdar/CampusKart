require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { connectDB } = require('./lib/db');

// ─── Create uploads directory if it doesn't exist (local only) ────────────────
const uploadsDir = path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  // Ignore filesystem write errors in serverless environments (Vercel)
}

// ─── Import routes ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const listingRoutes = require('./routes/listings');
const messageRoutes = require('./routes/messages');
const transactionRoutes = require('./routes/transactions');
const adminRoutes = require('./routes/admin');

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
}));

// Enable ETag for conditional requests (304 responses)
app.set('etag', 'strong');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Serve static frontend files ──────────────────────────────────────────────
// Serve everything from the parent campuskart/ directory
const frontendDir = path.join(__dirname, '..');
app.use(express.static(frontendDir));

// Serve uploaded images
app.use('/uploads', express.static(uploadsDir));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/users', userRoutes);
app.use('/users', userRoutes);

app.use('/api/listings', listingRoutes);
app.use('/listings', listingRoutes);

app.use('/api/messages', messageRoutes);
app.use('/messages', messageRoutes);

app.use('/api/transactions', transactionRoutes);
app.use('/transactions', transactionRoutes);

app.use('/api/admin', adminRoutes);
app.use('/admin', adminRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get(['/api/health', '/health'], (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// ─── Rental return reminder cron ──────────────────────────────────────────────
// Runs every hour to check for rentals due in the next 48 hours
function startRentalReminders() {
  const { sendRentalReminderEmail } = require('./lib/email');
  const Transaction = require('./models/Transaction');
  const Listing = require('./models/Listing');
  const User = require('./models/User');

  async function checkRentalsDue() {
    try {
      const now = new Date();
      const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const dueSoon = await Transaction.find({
        type: 'rent',
        status: 'confirmed',
        rentalEndDate: { $gte: now, $lte: in48h },
        returnReminderSent: false,
      })
        .populate('listing', 'title category')
        .populate('buyer', 'firstName email');

      for (const txn of dueSoon) {
        if (txn.buyer && txn.listing) {
          await sendRentalReminderEmail(txn.buyer, txn.listing, txn.rentalEndDate);
          txn.returnReminderSent = true;
          await txn.save();
          console.log(`📅 Rental reminder sent to ${txn.buyer.email} for "${txn.listing.title}"`);
        }
      }
    } catch (err) {
      console.error('Rental reminder check error:', err.message);
    }
  }

  // Run once on startup, then every hour
  checkRentalsDue();
  setInterval(checkRentalsDue, 60 * 60 * 1000);
}

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 5MB per image.' });
  }
  if (err.message && err.message.includes('Only JPG')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`\n🚀 CampusKart API running at http://localhost:${PORT}`);
    console.log(`📦 Frontend served at  http://localhost:${PORT}/index.html`);
    console.log(`🩺 Health check at     http://localhost:${PORT}/api/health`);
    console.log('');
  });
  startRentalReminders();
}

module.exports = app;

if (require.main === module || process.env.NODE_ENV !== 'production') {
  start();
}


