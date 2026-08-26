const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const {
  sendVerificationEmail,
  sendMagicLinkEmail,
  sendPasswordResetEmail,
} = require('../lib/email');

const TOKEN_EXPIRY_MS = (process.env.EMAIL_TOKEN_EXPIRES_MINUTES || 30) * 60 * 1000;

const JWT_SECRET = process.env.JWT_SECRET || 'campuskart_super_secret_jwt_key_change_in_production';

function generateJWT(userId) {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, branch, year, hostel } = req.body;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const token = uuidv4();
    const expires = new Date(Date.now() + TOKEN_EXPIRY_MS);

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash: password, // pre-save hook hashes it
      branch,
      year,
      hostel: hostel || '',
      isVerified: true, // Auto-verified for seamless access
      isLister: true,   // Auto-enabled lister access
      verificationToken: token,
      verificationTokenExpires: expires,
    });

    await sendVerificationEmail(user, token);

    res.status(201).json({
      message: 'Account created! Please check your email to verify your account.',
      userId: user._id,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─── GET /api/auth/verify-email?token= ───────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Verification token missing' });

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>❌ Invalid or expired link</h2>
          <p>This verification link has expired or already been used.</p>
          <a href="/index.html">Back to sign in</a>
        </body></html>`);
    }

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await user.save();

    const jwtToken = generateJWT(user._id);

    // Redirect to frontend with token in query so the page can store it
    res.redirect(`/home.html?token=${jwtToken}&verified=1`);
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: cleanEmail });

    // On-demand creation of demo accounts if missing in database
    if (!user) {
      if (cleanEmail === 'admin@campuskart.com' && password === 'admin123456') {
        user = await User.create({
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
      } else if (cleanEmail === 'student@gmail.com' && password === 'student123456') {
        user = await User.create({
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
      } else if (cleanEmail === 'student2@gmail.com' && password === 'student123456') {
        user = await User.create({
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
      }
    }

    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.isBanned) return res.status(403).json({ error: 'Your account has been suspended' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    const token = generateJWT(user._id);
    res.json({ token, user: user.toPublicJSON() });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /api/auth/magic-link ────────────────────────────────────────────────
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal whether account exists
      return res.json({ message: 'If this email is registered, a magic link has been sent.' });
    }

    if (user.isBanned) return res.status(403).json({ error: 'Your account has been suspended' });

    const token = uuidv4();
    user.magicToken = token;
    user.magicTokenExpires = new Date(Date.now() + TOKEN_EXPIRY_MS);
    await user.save();

    await sendMagicLinkEmail(user, token);
    res.json({ message: 'If this email is registered, a magic link has been sent.' });
  } catch (err) {
    console.error('Magic link error:', err);
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// ─── GET /api/auth/magic-verify?token= ───────────────────────────────────────
router.get('/magic-verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token missing' });

    const user = await User.findOne({
      magicToken: token,
      magicTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>❌ Invalid or expired link</h2>
          <p>This magic link has expired. Please request a new one.</p>
          <a href="/index.html">Back to sign in</a>
        </body></html>`);
    }

    user.isVerified = true; // magic link also counts as email verification
    user.magicToken = null;
    user.magicTokenExpires = null;
    await user.save();

    const jwtToken = generateJWT(user._id);
    res.redirect(`/home.html?token=${jwtToken}`);
  } catch (err) {
    console.error('Magic verify error:', err);
    res.status(500).json({ error: 'Magic link verification failed' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: 'If this email is registered, a reset link has been sent.' });
    }

    const token = uuidv4();
    user.resetToken = token;
    user.resetTokenExpires = new Date(Date.now() + TOKEN_EXPIRY_MS);
    await user.save();

    await sendPasswordResetEmail(user, token);
    res.json({ message: 'If this email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Token and a password of at least 8 characters are required' });
    }

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    user.passwordHash = newPassword; // pre-save hook will hash it
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Quick token validation — returns user if JWT is valid
const { authMiddleware } = require('../middleware/auth');
router.get('/me', authMiddleware(), async (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

module.exports = router;
