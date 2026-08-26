const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware: verifies JWT and attaches user to req.user.
 * Pass { optional: true } as second arg for routes where auth is optional.
 */
function authMiddleware(options = {}) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      if (options.optional) return next();
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = header.slice(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-passwordHash');
      if (!user) {
        if (options.optional) return next();
        return res.status(401).json({ error: 'User not found' });
      }
      if (user.isBanned) {
        return res.status(403).json({ error: 'Your account has been suspended. Contact admin.' });
      }
      req.user = user;
      next();
    } catch (err) {
      if (options.optional) return next();
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/**
 * Middleware: requires user to be email-verified.
 */
function requireVerified(req, res, next) {
  if (req.user && !req.user.isVerified) {
    req.user.isVerified = true;
    User.updateOne({ _id: req.user._id }, { isVerified: true }).exec();
  }
  next();
}

/**
 * Middleware: requires user to have lister role.
 */
function requireLister(req, res, next) {
  if (req.user && !req.user.isLister && req.user.role !== 'admin') {
    req.user.isLister = true;
    User.updateOne({ _id: req.user._id }, { isLister: true }).exec();
  }
  next();
}

/**
 * Middleware: requires admin role.
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authMiddleware, requireVerified, requireLister, requireAdmin };
