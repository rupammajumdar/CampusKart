require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { connectDB } = require('../backend/lib/db');
const authRoutes = require('../backend/routes/auth');
const userRoutes = require('../backend/routes/users');
const listingRoutes = require('../backend/routes/listings');
const messageRoutes = require('../backend/routes/messages');
const transactionRoutes = require('../backend/routes/transactions');
const adminRoutes = require('../backend/routes/admin');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

app.get(['/api/health', '/health'], (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'production',
  });
});

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('DB connection error:', err);
  }
  return app(req, res);
};
