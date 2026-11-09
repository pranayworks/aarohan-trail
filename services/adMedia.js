// Stores ad pictures and videos. Production: the PUBLIC Supabase bucket "ad-media". Development: the uploads/ads folder.
// What a file really is gets decided by looking at its first bytes, never by its name or the type the browser claims.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./supabaseStorage');

const BUCKET = 'ad-media';
const LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'ads');
const MAX_IMAGE = 5 * 1024 * 1024, MAX_VIDEO = 25 * 1024 * 1024;

function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'IMAGE', mime: 'image/jpeg', ext: 'jpg', max: MAX_IMAGE };
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return { type: 'IMAGE', mime: 'image/png', ext: 'png', max: MAX_IMAGE };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { type: 'IMAGE', mime: 'image/webp', ext: 'webp', max: MAX_IMAGE };
  if (b.toString('latin1', 4, 8) === 'ftyp') return { type: 'VIDEO', mime: 'video/mp4', ext: 'mp4', max: MAX_VIDEO };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'VIDEO', mime: 'video/webm', ext: 'webm', max: MAX_VIDEO };
  return null;
}

async function store({ buffer, ext, mime }) {
  const name = crypto.randomUUID() + '.' + ext;
  const client = storage.getSupabaseClient && storage.getSupabaseClient();
  if (client) {
    const { error } = await client.storage.from(BUCKET).upload(name, buffer, { contentType: mime, upsert: false, cacheControl: '31536000' });
    if (error) throw new Error('Could not save the file: ' + error.message);
    return { path: name, url: client.storage.from(BUCKET).getPublicUrl(name).data.publicUrl };
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Media storage is not set up. Create the public bucket "ad-media" in Supabase and set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, name), buffer);
  return { path: name, url: '/media/ads/' + name };
}

async function remove(name) {
  try {
    const client = storage.getSupabaseClient && storage.getSupabaseClient();
    if (client) await client.storage.from(BUCKET).remove([name]);
    else fs.unlinkSync(path.join(LOCAL_DIR, path.basename(name)));
  } catch (_) { /* the database row is what matters */ }
}

module.exports = { sniff, store, remove, LOCAL_DIR, BUCKET, MAX_IMAGE, MAX_VIDEO };
