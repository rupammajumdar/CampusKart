require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');

// Fix for Windows DNS resolution issue with mongodb+srv:// (querySrv ECONNREFUSED)
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {
  // Ignore if custom DNS fails
}

let isConnected = false;

const User = require('../models/User');

async function seedDemoAccounts() {
  try {
    const adminExists = await User.findOne({ email: 'admin@campuskart.com' });
    if (!adminExists) {
      await User.create({
        firstName: 'Admin',
        lastName: 'Coordinator',
        email: 'admin@campuskart.com',
        password: 'admin123456',
        branch: 'CSE',
        year: '4th Year',
        role: 'admin',
        isVerified: true,
        isLister: true,
      });
      console.log('👑 Admin account auto-created: admin@campuskart.com');
    }

    const student1Exists = await User.findOne({ email: 'student@gmail.com' });
    if (!student1Exists) {
      await User.create({
        firstName: 'Aman',
        lastName: 'Kumar',
        email: 'student@gmail.com',
        password: 'student123456',
        branch: 'CSE',
        year: '3rd Year',
        role: 'student',
        isVerified: true,
        isLister: true,
      });
      console.log('👤 Student #1 account auto-created: student@gmail.com');
    }

    const student2Exists = await User.findOne({ email: 'student2@gmail.com' });
    if (!student2Exists) {
      await User.create({
        firstName: 'Priya',
        lastName: 'Sharma',
        email: 'student2@gmail.com',
        password: 'student123456',
        branch: 'ECE',
        year: '2nd Year',
        role: 'student',
        isVerified: true,
        isLister: true,
      });
      console.log('👤 Student #2 account auto-created: student2@gmail.com');
    }
  } catch (err) {
    console.error('Demo account seeding error:', err.message);
  }
}

async function connectDB() {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not defined in backend/.env');
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
    });
    isConnected = true;
    console.log(`✅ MongoDB Atlas connected: ${mongoose.connection.host}`);
    await seedDemoAccounts();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    console.warn('📌 Make sure your IP address is whitelisted (0.0.0.0/0) in MongoDB Atlas Network Access.');
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
