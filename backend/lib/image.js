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
 * Embed a tiny inline thumbnail for each listing so the browse page doesn't
 * need to fire N separate HTTP requests to /api/listings/thumb/…
 * width=200, quality=55 => ~4-8 KB per image — fast to send & render.
 */
async function slimListingsWithThumbs(listings) {
  const INLINE_WIDTH = 200;
  const INLINE_QUALITY = 55;

  await Promise.all(listings.map(async (l) => {
    const count = Array.isArray(l.photos) ? l.photos.length : 0;
    l.photoCount = count;
    if (count === 0) {
      l.thumbUrl = null;
      l.photos = [];
      return;
    }
    // Build inline thumb from the first photo
    try {
      const firstPhoto = l.photos[0];
      let input;
      if (firstPhoto && firstPhoto.startsWith('data:')) {
        const m = /^data:[^;,]+;base64,(.*)$/.exec(firstPhoto);
        input = m ? Buffer.from(m[1], 'base64') : null;
      } else if (firstPhoto && firstPhoto.startsWith('/uploads/')) {
        const fs = require('fs');
        const path = require('path');
        input = await fs.promises.readFile(path.join(__dirname, '..', firstPhoto)).catch(() => null);
      }
      if (input && input.length > 0) {
        const buf = await sharp(input)
          .rotate()
          .resize({ width: INLINE_WIDTH, height: INLINE_WIDTH, fit: 'cover', withoutEnlargement: true })
          .jpeg({ quality: INLINE_QUALITY })
          .toBuffer();
        l.thumbUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      } else {
        l.thumbUrl = null;
      }
    } catch {
      l.thumbUrl = null;
    }
    // Replace photos array with lightweight thumb-path URLs (for detail page)
    l.photos = l.photos.map((_, i) => thumbnailUrl(l._id, i));
  }));
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
