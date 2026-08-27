/**
 * One-off migration: shrink oversized base64 photos already stored in MongoDB.
 *
 * Before this fix, listing photos were saved as raw base64 data URLs (up to 5MB
 * per image) directly in the DB, which made every list API response megabytes
 * large and caused pages to load very slowly / time out. This script re-compresses
 * every stored photo down to `STORE_MAX` at `STORE_QUALITY` using sharp.
 *
 * It is idempotent: already-compressed data URLs (small enough) are left alone.
 *
 * Usage:  node backend/scripts/compress-photos.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const { compressDataUrl, STORE_MAX } = require('../lib/image');

// A data URL is considered already-slim if its decoded bytes are under this size.
const MAX_SLIM_BYTES = 400 * 1024; // 400 KB

function uri() {
  return (
    process.env.MONGODB_URI ||
    'mongodb+srv://utpalmajumdar6_db_user:rQTbZeNjpOAptfO0@cluster0.zee69ax.mongodb.net/campuskart'
  );
}

async function run() {
  await mongoose.connect(uri(), { serverSelectionTimeoutMS: 20000 });
  console.log('✅ Connected to MongoDB');

  const cursor = Listing.find({}).cursor();
  let scanned = 0;
  let modified = 0;
  let savedBytes = 0;

  for (let listing = await cursor.next(); listing != null; listing = await cursor.next()) {
    scanned++;
    if (!Array.isArray(listing.photos) || listing.photos.length === 0) continue;

    let dirty = false;
    const newPhotos = [];
    for (const photo of listing.photos) {
      if (!photo || !photo.startsWith('data:')) {
        newPhotos.push(photo); // already a lightweight path
        continue;
      }
      // Estimate decoded size
      const m = /^data:[^;,]*;base64,(.*)$/.exec(photo);
      const bytes = m ? Math.floor(m[1].length * 0.75) : photo.length;
      if (bytes <= MAX_SLIM_BYTES) {
        newPhotos.push(photo); // already small enough
        continue;
      }
      const slim = await compressDataUrl(photo, { max: STORE_MAX });
      savedBytes += bytes - (m ? Math.floor((/^data:[^;,]*;base64,(.*)$/.exec(slim) || ['', ''])[1].length * 0.75) : 0);
      newPhotos.push(slim);
      dirty = true;
    }

    if (dirty) {
      listing.photos = newPhotos;
      await listing.save();
      modified++;
      if (modified % 10 === 0) console.log(`  ...${modified} listings compressed (${(savedBytes / 1048576).toFixed(1)} MB saved so far)`);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Done. Scanned ${scanned} listings.`);
  console.log(`   Compressed ${modified} listings.`);
  console.log(`   Estimated space freed: ${(savedBytes / 1048576).toFixed(1)} MB`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
