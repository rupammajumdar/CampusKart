require('dotenv').config();
const dns = require('dns');

// Fix Node 17+ / Node 24 Windows IPv6 preference issue with MongoDB Atlas
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const mongoose = require('mongoose');
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

  const uri = process.env.MONGODB_URI || 'mongodb://utpalmajumdar6_db_user:rQTbZeNjpOAptfO0@ac-54gggn9-shard-00-00.zee69ax.mongodb.net:27017,ac-54gggn9-shard-00-01.zee69ax.mongodb.net:27017,ac-54gggn9-shard-00-02.zee69ax.mongodb.net:27017/campuskart?ssl=true&replicaSet=atlas-wulgso-shard-0&authSource=admin&retryWrites=true&w=majority';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
      autoIndex: false,
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
