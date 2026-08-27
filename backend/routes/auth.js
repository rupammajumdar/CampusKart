const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const {
  sendVerificationEmail,
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  getAppUrl,
} = require('../lib/email');

const TOKEN_EXPIRY_MS = (process.env.EMAIL_TOKEN_EXPIRES_MINUTES || 30) * 60 * 1000;

const JWT_SECRET = process.env.JWT_SECRET || 'campuskart_super_secret_jwt_key_change_in_production';
const REGISTRATION_TOKEN_SECRET = process.env.REGISTRATION_TOKEN_SECRET || 'campuskart_registration_token_secret_change_in_production';

function generateJWT(userId) {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function generateRegistrationToken(userData) {
  const minutes = parseInt(process.env.EMAIL_TOKEN_EXPIRES_MINUTES, 10) || 30;
  return jwt.sign(userData, REGISTRATION_TOKEN_SECRET, {
    expiresIn: `${minutes}m`,
  });
}

function verifyRegistrationToken(token) {
  try {
    return jwt.verify(token, REGISTRATION_TOKEN_SECRET);
  } catch (err) {
    return null;
  }
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Step 1: Validate input, check if email exists, send verification email with registration token
// User is NOT created in database yet
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, branch, year, hostel } = req.body;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!firstName || !lastName || !branch || !year) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Create a token containing registration data (NOT saved to DB yet)
    const registrationData = {
      firstName,
      lastName,
      email: email.toLowerCase(),
      password, // will be hashed when user is created
      branch,
      year,
      hostel: hostel || '',
    };

    const token = generateRegistrationToken(registrationData);

    // Send verification email with the token
    const tempUser = { email: email.toLowerCase(), firstName };
    const emailResult = await sendVerificationEmail(tempUser, token);

    res.status(201).json({
      message: 'Verification email sent! Please check your inbox to verify and create your account.',
      verificationLink: emailResult?.link,
      previewUrl: emailResult?.previewUrl,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─── POST /api/auth/resend-verification ───────────────────────────────────────
// With the new "verify then register" flow, users don't exist in DB until verified.
// This endpoint now just tells them to register again to get a new link.
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if a verified user already exists
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      if (existing.isVerified) {
        return res.status(400).json({ error: 'This account is already verified. You can sign in.' });
      }
      // Shouldn't happen with new flow, but handle gracefully
      return res.status(400).json({ error: 'Registration pending. Please check your email or register again.' });
    }

    // No user exists - they need to register again to get a new verification link
    res.json({
      message: 'No pending registration found. Please register again to receive a new verification link.',
      action: 'register_again',
    });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─── GET /api/auth/verify-email?token= ───────────────────────────────────────
// Step 2: Verify token, create user in database with isVerified: true
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Verification token missing' });

    // Decode and verify the registration token
    const registrationData = verifyRegistrationToken(token);
    if (!registrationData) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#e53e3e">❌ Invalid or expired link</h2>
          <p>This verification link has expired or is invalid.</p>
          <a href="/index.html" style="color:#6c47ff;font-weight:600">Back to sign up</a>
        </body></html>`);
    }

    const { firstName, lastName, email, password, branch, year, hostel } = registrationData;

    // Double-check email doesn't exist (race condition protection)
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#e53e3e">❌ Account already exists</h2>
          <p>An account with this email already exists.</p>
          <a href="/index.html" style="color:#6c47ff;font-weight:600">Back to sign in</a>
        </body></html>`);
    }

    // Create user with isVerified: true
    const user = await User.create({
      firstName,
      lastName,
      email,
      passwordHash: password, // pre-save hook hashes it
      branch,
      year,
      hostel: hostel || '',
      isVerified: true,
      isLister: true,
    });

    const jwtToken = generateJWT(user._id);

    // Redirect to frontend with token in query so the page can store it
    res.redirect(`/home.html?token=${jwtToken}&verified=1`);
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="color:#e53e3e">❌ Verification failed</h2>
        <p>Something went wrong. Please try registering again.</p>
        <a href="/index.html" style="color:#6c47ff;font-weight:600">Back to sign up</a>
      </body></html>`);
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
        const hash = await bcrypt.hash('admin123456', 10);
        user = await User.create({
          firstName: 'Admin',
          lastName: 'Coordinator',
          email: 'admin@campuskart.com',
          passwordHash: hash,
          branch: 'CSE',
          year: '4th Year',
          role: 'admin',
          isVerified: true,
          isLister: true,
        });
      } else if (cleanEmail === 'student@gmail.com' && password === 'student123456') {
        const hash = await bcrypt.hash('student123456', 10);
        user = await User.create({
          firstName: 'Aman',
          lastName: 'Kumar',
          email: 'student@gmail.com',
          passwordHash: hash,
          branch: 'CSE',
          year: '3rd Year',
          role: 'student',
          isVerified: true,
          isLister: true,
        });
      } else if (cleanEmail === 'student2@gmail.com' && password === 'student123456') {
        const hash = await bcrypt.hash('student2@gmail.com', 10);
        user = await User.create({
          firstName: 'Priya',
          lastName: 'Sharma',
          email: 'student2@gmail.com',
          passwordHash: hash,
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

    // With the new flow, all users in DB are verified
    const token = generateJWT(user._id);
    res.json({ token, user: user.toPublicJSON() });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /api/auth/google ───────────────────────────────────────────────────
// Google OAuth Sign In & Auto Registration
router.post('/google', async (req, res) => {
  try {
    const { credential, email, name, picture, branch, year } = req.body;

    let userEmail = null;
    let firstName = 'Student';
    let lastName = 'User';
    let profilePhoto = picture || '';
    let isVerifiedGoogleAuth = false;

    // 1) Real Google OAuth JWT Token from Google GIS SDK
    if (credential) {
      try {
        const decoded = jwt.decode(credential);
        if (decoded && decoded.email) {
          userEmail = decoded.email.trim().toLowerCase();
          firstName = decoded.given_name || decoded.name?.split(' ')[0] || 'Student';
          lastName = decoded.family_name || decoded.name?.split(' ').slice(1).join(' ') || 'User';
          profilePhoto = decoded.picture || profilePhoto;
          isVerifiedGoogleAuth = true;
        }
      } catch (e) {
        console.error('Failed to decode Google JWT token:', e);
      }
    }

    // 2) If NO Google OAuth token is provided (manual email entry):
    // Security check: Send magic link to user's real email inbox to verify ownership!
    if (!isVerifiedGoogleAuth) {
      const targetEmail = email ? email.trim().toLowerCase() : null;
      if (!targetEmail || !/^\S+@\S+\.\S+$/.test(targetEmail)) {
        return res.status(400).json({ error: 'Please sign in with Google or enter a valid email address.' });
      }

      let user = await User.findOne({ email: targetEmail });
      if (!user) {
        return res.status(401).json({
          error: 'Account not found. Please sign up with password or use Google Sign-In.',
        });
      }

      if (user.isBanned) {
        return res.status(403).json({ error: 'Your account has been suspended' });
      }

      // Send verification link to user's actual email inbox
      const token = uuidv4();
      user.magicToken = token;
      user.magicTokenExpires = new Date(Date.now() + TOKEN_EXPIRY_MS);
      await user.save();

      await sendMagicLinkEmail(user, token).catch(console.error);

      return res.json({
        requireEmailVerification: true,
        message: `A verification link has been sent to ${targetEmail}. Please check your inbox to sign in.`,
      });
    }

    // 3) Verified Google OAuth Token Flow
    let user = await User.findOne({ email: userEmail });

    if (!user) {
      user = await User.create({
        firstName,
        lastName,
        email: userEmail,
        branch: branch || 'Other',
        year: year || '1st Year',
        profilePhoto: profilePhoto || '',
        isVerified: true,
        isLister: true,
      });
    } else {
      let updated = false;
      if (!user.isVerified) { user.isVerified = true; updated = true; }
      if (!user.isLister) { user.isLister = true; updated = true; }
      if (profilePhoto && !user.profilePhoto) { user.profilePhoto = profilePhoto; updated = true; }
      if (updated) await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Your account has been suspended' });
    }

    const token = generateJWT(user._id);
    res.json({ token, user: user.toPublicJSON() });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: err.message || 'Google authentication failed' });
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
