// ============================================================================
// AAROHAN SUPABASE STORAGE SERVICE • DRIVER DOCUMENTS (PRIVATE BUCKET)
// ============================================================================
// Manages encrypted document uploads and short-lived signed URLs for:
//   - DRIVING_LICENSE
//   - NATIONAL_ID
//   - VEHICLE_REGISTRATION
//   - DRIVER_PHOTO
// Bucket: "driver-documents" (Strictly Private; Accessible only via Service Role Key)
// ============================================================================

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const BUCKET_NAME = 'driver-documents';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/pdf'
];

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (supabaseUrl && serviceKey) {
    try {
      const options = {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      };
      // Older Node versions have no built-in WebSocket, which the Supabase library insists on. Use the "ws" package then.
      if (typeof WebSocket === 'undefined') {
        try { options.realtime = { transport: require('ws') }; } catch (_) { /* ws not installed */ }
      }
      supabaseClient = createClient(supabaseUrl, serviceKey, options);
      return supabaseClient;
    } catch (err) {
      console.warn('[SupabaseStorage] Initialization warning:', err.message);
    }
  }
  return null;
}

// Local filesystem fallback directory for testing & offline local dev
const LOCAL_STORAGE_DIR = path.join(__dirname, '../uploads/driver-documents');

// Identity documents must NEVER be written to the server disk in production.
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

if (!isProduction() && !fs.existsSync(LOCAL_STORAGE_DIR)) {
  try {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  } catch (e) {}
}

function storageUnavailableError() {
  return new Error('Document storage is temporarily unavailable. Please try again later.');
}

/**
 * Validates file buffer, MIME type, and size
 */
function validateFile(file) {
  if (!file || !file.buffer) {
    throw new Error('No file provided or file buffer empty');
  }

  if (file.size > MAX_FILE_SIZE_BYTES || file.buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size exceeds 5 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB uploaded)`);
  }

  const mime = (file.mimetype || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    throw new Error(`Invalid file type "${mime}". Allowed types: JPEG, PNG, PDF`);
  }

  return true;
}

/**
 * Uploads a file buffer to private Supabase Storage bucket "driver-documents"
 */
async function uploadDriverDocument({ driverId, documentType, file }) {
  validateFile(file);

  const ext = path.extname(file.originalname || '') || (file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
  const safeFilename = `${documentType.toLowerCase()}_${Date.now()}${ext}`;
  const storagePath = `${driverId}/${safeFilename}`;

  const client = getSupabaseClient();

  if (client) {
    try {
      const { data, error } = await client.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true
        });

      if (error) {
        if (isProduction()) {
          console.error('[SupabaseStorage] Remote upload error (no local fallback in production):', error.message);
          throw storageUnavailableError();
        }
        console.warn('[SupabaseStorage] Remote upload error, falling back to local:', error.message);
      } else {
        return {
          bucket: BUCKET_NAME,
          storagePath: data.path || storagePath,
          sizeBytes: file.size,
          mimeType: file.mimetype
        };
      }
    } catch (err) {
      if (isProduction()) {
        if (err && err.message === storageUnavailableError().message) throw err;
        console.error('[SupabaseStorage] Remote client exception (no local fallback in production):', err.message);
        throw storageUnavailableError();
      }
      console.warn('[SupabaseStorage] Remote client exception, using fallback:', err.message);
    }
  } else if (isProduction()) {
    console.error('[SupabaseStorage] Supabase client is not configured; refusing to store documents locally in production.');
    throw storageUnavailableError();
  }

  // Local disk storage: development and test suite ONLY
  const targetDir = path.join(LOCAL_STORAGE_DIR, driverId);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const localFilePath = path.join(targetDir, safeFilename);
  fs.writeFileSync(localFilePath, file.buffer);

  return {
    bucket: BUCKET_NAME,
    storagePath,
    sizeBytes: file.size,
    mimeType: file.mimetype,
    isLocal: true
  };
}

/**
 * Generates short-lived signed URL (default 15 minutes / 900 seconds)
 */
async function getSignedUrl(storagePath, expiresIn = 900) {
  if (!storagePath) return null;

  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storagePath, expiresIn);

      if (!error && data && data.signedUrl) {
        return data.signedUrl;
      }
    } catch (err) {
      console.warn('[SupabaseStorage] Signed URL error:', err.message);
    }
  }

  // Local files are served only outside production (development / test suite)
  if (isProduction()) return null;
  return `/api/driver/documents/raw?path=${encodeURIComponent(storagePath)}`;
}

module.exports = {
  getSupabaseClient,
  BUCKET_NAME,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  validateFile,
  uploadDriverDocument,
  getSignedUrl,
  LOCAL_STORAGE_DIR,
  isProduction
};
