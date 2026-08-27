require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');

// Fix for Windows DNS resolution issue with mongodb+srv:// (querySrv ECONNREFUSED)
if (process.platform === 'win32') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  } catch (e) {
    // Ignore if custom DNS fails
  }
}

let isConnected = false;
let seeded = false;

const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedDemoAccounts() {
  if (seeded) return;
  
  try {
    const admin = await User.findOne({ email: 'admin@campuskart.com' }).select('_id').lean();
    if (admin) {
      seeded = true;
      return;
    }
    
    const adminHash = await bcrypt.hash('admin123456', 10);
    const studentHash = await bcrypt.hash('student123456', 10);

    await User.create({
      firstName: 'Admin',
      lastName: 'Coordinator',
      email: 'admin@campuskart.com',
      passwordHash: adminHash,
      branch: 'CSE',
      year: '4th Year',
      role: 'admin',
      isVerified: true,
      isLister: true,
    });
    console.log('👑 Admin account auto-created: admin@campuskart.com');

    await User.create([
      {
        firstName: 'Aman',
        lastName: 'Kumar',
        email: 'student@gmail.com',
        passwordHash: studentHash,
        branch: 'CSE',
        year: '3rd Year',
        role: 'student',
        isVerified: true,
        isLister: true,
      },
      {
        firstName: 'Priya',
        lastName: 'Sharma',
        email: 'student2@gmail.com',
        passwordHash: studentHash,
        branch: 'ECE',
        year: '2nd Year',
        role: 'student',
        isVerified: true,
        isLister: true,
      },
    ]);
    console.log('👤 Student accounts auto-created');
    seeded = true;
  } catch (err) {
    console.error('Demo account seeding error:', err.message);
  }
}

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || 'mongodb+srv://utpalmajumdar6_db_user:rQTbZeNjpOAptfO0@cluster0.zee69ax.mongodb.net/campuskart';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,   // fail fast instead of hanging 15s
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,                   // allow up to 10 parallel operations
      minPoolSize: 2,                    // keep warm connections ready
      family: 4,                         // IPv4 — avoids Windows DNS delay
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
    });
    isConnected = true;
    console.log(`✅ MongoDB Atlas connected: ${mongoose.connection.host}`);
    await seedDemoAccounts();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
}

mongoose.connection.on('connected', () => {
  isConnected = true;
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

module.exports = { connectDB };
