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

const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedDemoAccounts() {
  try {
    const adminHash = await bcrypt.hash('admin123456', 10);
    const studentHash = await bcrypt.hash('student123456', 10);

    const admin = await User.findOne({ email: 'admin@campuskart.com' });
    if (!admin) {
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
    } else if (!admin.passwordHash) {
      admin.passwordHash = adminHash;
      await admin.save();
      console.log('👑 Admin password repaired');
    }

    const s1 = await User.findOne({ email: 'student@gmail.com' });
    if (!s1) {
      await User.create({
        firstName: 'Aman',
        lastName: 'Kumar',
        email: 'student@gmail.com',
        passwordHash: studentHash,
        branch: 'CSE',
        year: '3rd Year',
        role: 'student',
        isVerified: true,
        isLister: true,
      });
      console.log('👤 Student #1 account auto-created: student@gmail.com');
    } else if (!s1.passwordHash) {
      s1.passwordHash = studentHash;
      await s1.save();
    }

    const s2 = await User.findOne({ email: 'student2@gmail.com' });
    if (!s2) {
      await User.create({
        firstName: 'Priya',
        lastName: 'Sharma',
        email: 'student2@gmail.com',
        passwordHash: studentHash,
        branch: 'ECE',
        year: '2nd Year',
        role: 'student',
        isVerified: true,
        isLister: true,
      });
      console.log('👤 Student #2 account auto-created: student2@gmail.com');
    } else if (!s2.passwordHash) {
      s2.passwordHash = studentHash;
      await s2.save();
    }
  } catch (err) {
    console.error('Demo account seeding error:', err.message);
  }
}

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || 'mongodb+srv://utpalmajumdar6_db_user:rQTbZeNjpOAptfO0@cluster0.zee69ax.mongodb.net/campuskart';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    isConnected = true;
    console.log(`✅ MongoDB Atlas connected: ${mongoose.connection.host}`);
    await seedDemoAccounts();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
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
