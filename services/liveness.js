// ============================================================================
// LIVE FACE CHECK for driver applications.
//
// How it works:
//  1. The server picks a RANDOM order of four head turns (right, left, up, down) and remembers it.
//  2. The phone's camera shows the face, asks for each turn, and takes a frame at each one (plus a straight frame).
//  3. The phone sends exactly 5 frames with the challenge id. The server refuses it unless:
//       - the challenge is this driver's own, unused and not expired,
//       - the frames are real JPEG images of a sensible size,
//       - no two frames are identical, and none was ever used before (no re-using old photos),
//       - it took long enough for a real person to do four turns, and each turn was logged in order.
//  4. Frames are saved to private storage and recorded in the database for a human reviewer, who must
//     confirm they match the ID photo. The head-turn detection runs on the phone, so it can be bypassed by a
//     determined cheat. THAT is why a person always reviews the frames: the software is a first filter only.
// ============================================================================
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const storage = require('./supabaseStorage');

const MOVES = ['RIGHT', 'LEFT', 'UP', 'DOWN'];
const FRAME_ORDER = ['STRAIGHT'];
const MIN_SECONDS = 8;          // four turns cannot be done faster than this
const MAX_MINUTES = 5;
const MAX_STARTS_PER_HOUR = 6;
const MIN_BYTES = 12 * 1024, MAX_BYTES = 2 * 1024 * 1024;

class LiveError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const shuffled = () => { const a = MOVES.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isJpeg = (b) => Buffer.isBuffer(b) && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

async function start(driverId, ip, userAgent) {
  const hourAgo = new Date(Date.now() - 3600000);
  const recent = await prisma.driverLiveness.count({ where: { driverId, createdAt: { gte: hourAgo } } });
  if (recent >= MAX_STARTS_PER_HOUR) throw new LiveError('Too many attempts. Please try again in an hour.', 429);
  const steps = shuffled();
  const row = await prisma.driverLiveness.create({
    data: { driverId, challengeId: crypto.randomBytes(16).toString('hex'), steps, expiresAt: new Date(Date.now() + MAX_MINUTES * 60000), status: 'ISSUED', userAgent: (userAgent || '').slice(0, 200), ipAddress: ip || null }
  });
  return { challengeId: row.challengeId, steps, expiresAt: row.expiresAt, minSeconds: MIN_SECONDS };
}

// frames: [{ buffer, mimetype, size }], in the order: straight, then the steps as asked.
async function submit(driverId, { challengeId, frames, metrics }, ip) {
  const row = await prisma.driverLiveness.findFirst({ where: { challengeId } });
  if (!row || row.driverId !== driverId) throw new LiveError('This face check is not valid. Please start again.', 400);
  if (row.status !== 'ISSUED') throw new LiveError('This face check was already used. Please start again.', 409);
  const now = Date.now();
  if (new Date(row.expiresAt).getTime() < now) { await prisma.driverLiveness.update({ where: { id: row.id }, data: { status: 'EXPIRED' } }); throw new LiveError('This face check ran out of time. Please start again.', 410); }
  if (now - new Date(row.issuedAt).getTime() < MIN_SECONDS * 1000) throw new LiveError('That was too fast to be a real face check. Please start again.', 400);

  const steps = row.steps;
  if (!Array.isArray(frames) || frames.length !== steps.length + 1) throw new LiveError(`Exactly ${steps.length + 1} camera frames are needed.`, 400);
  const hashes = [];
  for (const f of frames) {
    if (!f || !isJpeg(f.buffer)) throw new LiveError('The frames must be real camera photos (JPEG).', 400);
    if (f.buffer.length < MIN_BYTES || f.buffer.length > MAX_BYTES) throw new LiveError('One of the frames is the wrong size. Please try again in good light.', 400);
    hashes.push(sha(f.buffer));
  }
  if (new Set(hashes).size !== hashes.length) throw new LiveError('The frames must all be different. Please turn your head for each step.', 400);
  for (const h of hashes) {
    const used = await prisma.driverLiveness.findFirst({ where: { frameHashes: { array_contains: [h] } }, select: { id: true } });
    if (used) throw new LiveError('One of these photos was used before. Please take new ones with your camera.', 400);
  }

  // The phone logs when each turn was seen. These are claims by the phone (kept for the reviewer), but they must be consistent.
  const m = Array.isArray(metrics) ? metrics : [];
  if (m.length !== steps.length || m.some((x, i) => !x || x.step !== steps[i])) throw new LiveError('The head turns were not in the order that was asked. Please start again.', 400);
  for (let i = 1; i < m.length; i++) if (!(Number(m[i].at) - Number(m[i - 1].at) >= 700)) throw new LiveError('The head turns were too quick. Please turn slowly and clearly.', 400);

  const labels = ['straight'].concat(steps.map((s) => s.toLowerCase()));
  const paths = [];
  for (let i = 0; i < frames.length; i++) {
    const up = await storage.uploadDriverDocument({ driverId, documentType: 'liveness_' + i + '_' + labels[i], file: { buffer: frames[i].buffer, mimetype: 'image/jpeg', size: frames[i].buffer.length, originalname: labels[i] + '.jpg' } });
    paths.push(up.storagePath);
  }
  const drv = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  await prisma.$transaction([
    prisma.driverLiveness.updateMany({ where: { driverId, status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED'] } }, data: { status: 'REJECTED', rejectionReason: 'Replaced by a newer face check' } }),
    prisma.driverLiveness.update({ where: { id: row.id }, data: { status: 'PENDING_REVIEW', framePaths: paths, frameHashes: hashes, metrics: m, submittedAt: new Date(), ipAddress: ip || row.ipAddress } }),
    prisma.user.update({ where: { id: drv.userId }, data: { avatarUrl: paths[0] } }),
    prisma.auditLog.create({ data: { user: { connect: { id: drv.userId } }, action: 'PROFILE_UPDATED', entityType: 'DRIVER', entityId: driverId, details: { event: 'LIVENESS_SUBMITTED', frames: paths.length }, ipAddress: ip || null } })
  ]);
  return { status: 'PENDING_REVIEW', frames: paths.length };
}

// The driver cannot use a camera (broken, none, or the permission keeps failing). They are never stuck: the case goes to the
// team, who verify by a short video call BEFORE ticking the face-check item. Approval still needs that tick, by an admin.
async function requestAlternative(driverId, reason, ip) {
  const r = String(reason || '').trim().slice(0, 200);
  if (r.length < 3) throw new LiveError('Please tell us what is wrong with your camera.', 400);
  const recent = await prisma.driverLiveness.count({ where: { driverId, status: 'ALTERNATIVE_REQUESTED', createdAt: { gte: new Date(Date.now() - 3600000) } } });
  if (recent >= 3) throw new LiveError('We already have your request. Our team will call you.', 429);
  const now = new Date();
  await prisma.driverLiveness.updateMany({ where: { driverId, status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED'] } }, data: { status: 'REJECTED', rejectionReason: 'Replaced by a newer request' } });
  const row = await prisma.driverLiveness.create({ data: { driverId, challengeId: crypto.randomBytes(16).toString('hex'), steps: [], issuedAt: now, expiresAt: now, status: 'ALTERNATIVE_REQUESTED', metrics: { reason: r }, submittedAt: now, ipAddress: ip || null } });
  try { const drv = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } }); await prisma.auditLog.create({ data: { user: { connect: { id: drv.userId } }, action: 'PROFILE_UPDATED', entityType: 'DRIVER', entityId: driverId, details: { event: 'LIVENESS_ALTERNATIVE_REQUESTED', reason: r }, ipAddress: ip || null } }); } catch (_) { /* the request itself is what matters */ }
  return { status: row.status };
}

// The most recent face check that was actually submitted.
async function latest(driverId) {
  const rows = await prisma.driverLiveness.findMany({ where: { driverId, status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED', 'APPROVED', 'REJECTED'] } }, orderBy: { submittedAt: 'desc' }, take: 1 });
  return rows[0] || null;
}
const isOk = (row) => !!row && (row.status === 'PENDING_REVIEW' || row.status === 'ALTERNATIVE_REQUESTED' || row.status === 'APPROVED');

module.exports = { start, submit, requestAlternative, latest, isOk, LiveError, MOVES, MIN_SECONDS };
