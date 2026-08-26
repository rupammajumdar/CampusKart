const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => /^\S+@\S+\.\S+$/.test(v),
        message: 'Please provide a valid email address',
      },
    },
    passwordHash: { type: String, default: null },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    branch: {
      type: String,
      enum: ['CSE', 'ECE', 'EE', 'ME', 'CE', 'CH', 'IT', 'BioMedical', 'Other'],
      required: true,
    },
    year: {
      type: String,
      enum: ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year / M.Tech'],
      required: true,
    },
    hostel: { type: String, default: '' },
    profilePhoto: { type: String, default: '' },

    // Verification
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String, default: null },
    verificationTokenExpires: { type: Date, default: null },

    // Magic link
    magicToken: { type: String, default: null },
    magicTokenExpires: { type: Date, default: null },

    // Password reset
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },

    // Role
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    isLister: { type: Boolean, default: false },
    listerAcceptedAt: { type: Date, default: null },

    // Status
    isBanned: { type: Boolean, default: false },
    bannedReason: { type: String, default: '' },

    // Rating (aggregated)
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    // Wishlist
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }],
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash') || !this.passwordHash) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// Compare password helper
userSchema.methods.comparePassword = async function (plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

// Safe public profile (no sensitive fields)
userSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    branch: this.branch,
    year: this.year,
    hostel: this.hostel,
    profilePhoto: this.profilePhoto,
    isVerified: this.isVerified,
    isLister: this.isLister,
    role: this.role,
    rating: this.rating,
    ratingCount: this.ratingCount,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
