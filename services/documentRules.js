// Rules for driver document photos: camera JPEGs only, no repeats, and no changes after approval or during review.
const crypto = require('crypto');

const isJpeg = (b) => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const fingerprint = (b) => crypto.createHash('sha256').update(b).digest('hex');

// May this driver upload or replace a document right now?
function canUpload(driver, kyc) {
  if (!driver) return { ok: false, status: 400, error: 'Driver profile does not exist. Please register vehicle and profile first.' };
  if (driver.approvalStatus === 'SUSPENDED') return { ok: false, status: 403, error: 'Your account is suspended.' };
  if (driver.approvalStatus === 'APPROVED') return { ok: false, status: 409, error: 'You are already approved. To renew a document, please contact Aarohan support.' };
  if (kyc && kyc.submittedAt && driver.approvalStatus === 'PENDING') return { ok: false, status: 409, error: 'Your application is being reviewed, so it cannot be changed. We will tell you if anything is needed.' };
  return { ok: true };
}

module.exports = { isJpeg, fingerprint, canUpload };
