const sharp = require('sharp');

// Max dimensions / quality for stored photos and on-the-fly thumbnails.
// Keeping stored photos small (instead of raw 5MB base64) is what prevents
// the JSON API payloads and page loads from getting gigantic/slow.
const STORE_MAX = 1400;        // longest edge for a photo saved to the DB
const STORE_QUALITY = 78;      // JPEG/webp quality for stored photos
const DEFAULT_THUMB = 400;     // default longest edge for list-card images

/**
 * Convert a Multer file (memory storage -> f.buffer / disk -> f.path) into a
 * compressed data URL. Returns { url, mime, bytes } or null.
 */
async function fileToCompressedDataUrl(file) {
  let buf = Buffer.isBuffer(file.buffer) ? file.buffer : null;
  if (!buf && file.path) {
    const fs = require('fs');
    buf = await fs.promises.readFile(file.path);
  }
  if (!buf) return null;
  return compressBufferToDataUrl(buf, file.mimetype || 'image/jpeg');
}

/**
 * Compress a raw image buffer into a compact JPEG data URL.
 * Returns { url, mime, bytes }. Falls back to a raw data URL if sharp fails.
 */
async function compressBufferToDataUrl(buf, mime = 'image/jpeg') {
  try {
    const info = await sharp(buf)
      .rotate()                                   // honour EXIF orientation
      .resize({ width: STORE_MAX, height: STORE_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: STORE_QUALITY, chromaSubsampling: '4:4:4' })
      .toBuffer({ resolveWithObject: true });
    return {
      url: `data:image/jpeg;base64,${info.data.toString('base64')}`,
      mime: 'image/jpeg',
      bytes: info.data.length,
    };
  } catch (e) {
    // Unreadable / corrupt image — keep original bytes, just base64 them.
    return {
      url: `data:${mime};base64,${buf.toString('base64')}`,
      mime,
      bytes: buf.length,
    };
  }
}

/**
 * Compress an existing data URL (e.g. base64 strings already saved in the DB)
 * down to a compact size. Returns a slim data URL string. Leaves non-data URLs
 * (e.g. /uploads/uuid.jpg) untouched because they are already lightweight.
 */
async function compressDataUrl(dataUrl, options = {}) {
  const max = options.max || STORE_MAX;
  const quality = options.quality || STORE_QUALITY;
  try {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return dataUrl; // not a base64 data URL — leave as-is
    const input = Buffer.from(m[2], 'base64');
    const out = await sharp(input)
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, chromaSubsampling: '4:4:4' })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (e) {
    return dataUrl; // leave unchanged if it can't be processed
  }
}

/**
 * Build a small JPEG thumbnail buffer from a stored photo (data URL or path).
 * Used by the on-the-fly thumbnail endpoint. Returns a Buffer or null.
 */
async function makeThumbnail(photo, width = DEFAULT_THUMB) {
  let input;
  try {
    if (photo && photo.startsWith('data:')) {
      const m = /^data:([^;,]+);base64,(.*)$/.exec(photo);
      if (!m) return null;
      input = Buffer.from(m[2], 'base64');
    } else if (photo && photo.startsWith('/uploads/')) {
      const fs = require('fs');
      input = await fs.promises.readFile(require('path').join(__dirname, '..', photo));
    } else {
      input = Buffer.from(photo || '', 'base64');
    }
  } catch (e) {
    return null;
  }

  if (!input || input.length === 0) return null;

  try {
    return await sharp(input)
      .rotate()
      .resize({ width, height: width, fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 72, chromaSubsampling: '4:4:4' })
      .toBuffer();
  } catch (e) {
    return null;
  }
}

/**
 * Return the API path that serves a lightweight thumbnail for a listing photo.
 * List APIs use these paths in place of the heavy base64 data URLs so the
 * JSON responses stay tiny and pages render fast.
 */
function thumbnailUrl(listingId, index = 0, width = DEFAULT_THUMB) {
  return `/api/listings/thumb/${listingId}/${index}?w=${width}`;
}

/**
 * Replace the heavy photo bytes on a list of listing documents with lightweight
 * thumbnail paths. The original photo count is preserved on the document via
 * `photoCount` so clients know how many images exist.
 */
/**
 * Embed inline thumbnail for each listing instantly so browse cards render
 * with 0 additional server roundtrips and 0 CPU overhead.
 */
function slimListingsWithThumbs(listings) {
  for (const l of listings) {
    const hasPhoto = Array.isArray(l.photos) && l.photos.length > 0 && l.photos[0];
    if (hasPhoto) {
      l.thumbUrl = l.photos[0];
    } else {
      l.thumbUrl = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200' viewBox='0 0 300 200'%3E%3Crect width='100%25' height='100%25' fill='%23f1f3f4'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%235f6368' font-family='sans-serif' font-size='14'%3ECampusKart Item%3C/text%3E%3C/svg%3E`;
    }
    l.photos = [];
  }
  return listings;
}

/**
 * Synchronous slim — just replaces photo arrays with thumb URL paths.
 * Used when thumbnail generation is done separately.
 */
function slimListings(listings) {
  for (const l of listings) {
    const count = Array.isArray(l.photos) ? l.photos.length : 0;
    l.photoCount = count;
    l.photos = count > 0
      ? l.photos.map((_, i) => thumbnailUrl(l._id, i))
      : [];
  }
  return listings;
}

module.exports = {
  STORE_MAX,
  STORE_QUALITY,
  DEFAULT_THUMB,
  fileToCompressedDataUrl,
  compressBufferToDataUrl,
  compressDataUrl,
  makeThumbnail,
  thumbnailUrl,
  slimListings,
  slimListingsWithThumbs,
};
