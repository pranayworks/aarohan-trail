// ============================================================================
// Driver application: strict identity, vehicle and document rules. Nobody is approved without them.
// ============================================================================
const { z } = require('zod');
const prisma = require('../lib/prisma');
const crypto2 = require('./fieldCrypto');
const authService = require('./auth');
const emailAuth = require('./emailAuth');

// In this exact order (the app unlocks them one after another). The two photos are taken live with the camera.
const REQUIRED_DOCS = ['NATIONAL_ID', 'DRIVING_LICENSE', 'VEHICLE_REGISTRATION', 'NUMBER_PLATE_PHOTO', 'VEHICLE_PHOTO', 'CERTIFICATE_OF_FITNESS', 'INSURANCE_CERTIFICATE'];

// What the reviewer must confirm before an approval is allowed.
const CHECKLIST = [
  ['livenessVerified', 'The live face check shows a real person turning right, left, up and down, and the face matches the National ID photo'],
  ['namesConsistent', 'The name is the same on the ID, licence, registration and insurance'],
  ['dobConsistent', 'The date of birth matches across the documents and the application'],
  ['licenceVerified', 'The driving licence was verified with the issuing authority (RTSS) or in person'],
  ['licenceClassMatches', 'The licence class allows the vehicle type'],
  ['registrationMatches', 'The registration book matches the plate number, make and colour entered'],
  ['plateMatches', 'The number plate photo is sharp and real, and the plate in it matches the one entered, the registration book and the insurance'],
  ['vehiclePhotoMatches', 'The photo of the vehicle matches the type, make and colour entered, and the plate on it matches'],
  ['insuranceValid', 'The insurance certificate is genuine and not expired'],
  ['fitnessValid', 'The certificate of fitness is genuine and not expired'],
  ['noDuplicateIdentity', 'No other account uses this person or this vehicle'],
  ['payoutOwnedByDriver', 'The payout mobile money number belongs to the driver'],
  ['contactVerified', 'The driver and next of kin were reached on the phone numbers given']
];

const PHONE = z.string().trim().min(9).max(20);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');
const inDays = (days, label) => dateStr.refine((d) => new Date(d + 'T00:00:00.000Z').getTime() >= Date.now() + days * 86400000, { message: `${label} must be valid for at least ${days} more day${days === 1 ? '' : 's'}` });

const kycSchema = z.object({
  legalName: z.string().trim().min(3, 'Enter your full legal name').max(80),
  nationalId: z.string().trim().regex(/^[A-Za-z0-9]{6,20}$/, 'Enter your National ID number (letters and numbers only)'),
  licenseNumber: z.string().trim().regex(/^[A-Za-z0-9/-]{4,25}$/, 'Enter your driving licence number'),
  licenseClass: z.string().trim().min(1).max(10),
  licenseExpiry: inDays(30, 'Your driving licence'),
  address: z.string().trim().min(5, 'Enter your home address').max(150),
  district: z.string().trim().min(2).max(40),
  nextOfKinName: z.string().trim().min(3).max(60),
  nextOfKinPhone: PHONE,
  nextOfKinRelation: z.string().trim().max(30).optional(),
  payoutNetwork: z.enum(['AIRTEL_MONEY', 'TNM_MPAMBA']),
  payoutPhone: PHONE,
  registrationExpiry: inDays(1, 'Your vehicle registration'),
  insurancePolicyNo: z.string().trim().min(4).max(30),
  insuranceExpiry: inDays(7, 'Your insurance'),
  fitnessExpiry: inDays(1, 'Your certificate of fitness')
});

const toDate = (s) => new Date(s + 'T00:00:00.000Z');
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ageOn = (dob) => { const n = new Date(); let a = n.getFullYear() - dob.getFullYear(); const m = n.getMonth() - dob.getMonth(); if (m < 0 || (m === 0 && n.getDate() < dob.getDate())) a--; return a; };

class ApplyError extends Error { constructor(m, status = 400, extra = {}) { super(m); this.status = status; Object.assign(this, extra); } }

async function driverOf(userId) {
  const d = await prisma.driver.findFirst({ where: { userId }, include: { vehicle: true, kyc: true, documents: true, user: true, liveness: { where: { status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED', 'APPROVED', 'REJECTED'] } }, orderBy: { submittedAt: 'desc' }, take: 1 } } });
  if (!d) throw new ApplyError('Start your driver application first.', 404);
  return d;
}

function maskedKyc(k) {
  if (!k) return null;
  return {
    legalName: k.legalName, nationalIdLast4: k.nationalIdLast4, licenseLast4: k.licenseLast4, licenseClass: k.licenseClass, licenseExpiry: isoDay(k.licenseExpiry),
    address: k.address, district: k.district, nextOfKinName: k.nextOfKinName, nextOfKinPhone: k.nextOfKinPhone, nextOfKinRelation: k.nextOfKinRelation,
    payoutNetwork: k.payoutNetwork, payoutPhone: k.payoutPhone, registrationExpiry: isoDay(k.registrationExpiry), insurancePolicyNo: k.insurancePolicyNo,
    insuranceExpiry: isoDay(k.insuranceExpiry), fitnessExpiry: isoDay(k.fitnessExpiry), submittedAt: k.submittedAt
  };
}

// What is still missing before the application can be sent.
function missingFor(d) {
  const missing = [];
  if (!d.vehicle) missing.push('Vehicle details');
  if (!d.user.name || d.user.name.length < 2) missing.push('Your name');
  if (!d.user.dateOfBirth) missing.push('Date of birth');
  else if (ageOn(d.user.dateOfBirth) < 18) missing.push('You must be 18 or older');
  if (!d.kyc) missing.push('Identity and licence details');
  const byType = {}; (d.documents || []).forEach((x) => { byType[x.type] = x; });
  REQUIRED_DOCS.forEach((t) => { const x = byType[t]; if (!x) missing.push('Document: ' + t); else if (x.status === 'REJECTED') missing.push('Replace rejected document: ' + t); });
  const lv = (d.liveness || [])[0];
  if (!lv) missing.push('Live face check'); else if (lv.status === 'REJECTED') missing.push('Redo the live face check');
  return missing;
}

async function getApplication(userId) {
  const d = await driverOf(userId);
  const byType = {}; (d.documents || []).forEach((x) => { byType[x.type] = { status: x.status, rejectionReason: x.rejectionReason || null, uploadedAt: x.updatedAt }; });
  const missing = missingFor(d);
  return {
    driverId: d.id, approvalStatus: d.approvalStatus, availability: d.availability, rejectionReason: d.rejectionReason || null, rating: d.rating, ratingCount: d.ratingCount, tripsCompleted: d.tripsCompleted,
    submitted: !!(d.kyc && d.kyc.submittedAt), submittedAt: d.kyc ? d.kyc.submittedAt : null,
    locked: !!(d.kyc && d.kyc.submittedAt) && d.approvalStatus === 'PENDING',
    vehicle: d.vehicle ? { type: d.vehicle.type, makeModel: d.vehicle.makeModel, color: d.vehicle.color, plateNumber: d.vehicle.plateNumber, year: d.vehicle.year } : null,
    personal: { name: d.user.name, phone: d.user.phone, email: d.user.email, gender: d.user.gender || null, dateOfBirth: d.user.dateOfBirth ? isoDay(d.user.dateOfBirth) : null },
    kyc: maskedKyc(d.kyc), documents: byType, photo: !!(d.liveness && d.liveness[0] && d.liveness[0].status !== 'REJECTED'), liveness: d.liveness && d.liveness[0] ? { status: d.liveness[0].status, submittedAt: d.liveness[0].submittedAt, rejectionReason: d.liveness[0].rejectionReason || null } : null, requiredDocuments: REQUIRED_DOCS,
    missing, canSubmit: missing.length === 0
  };
}

async function saveKyc(userId, input, ip) {
  const d = await driverOf(userId);
  if (d.approvalStatus === 'APPROVED') throw new ApplyError('Your account is approved. To change identity details, contact Aarohan support.', 409);
  if (d.approvalStatus === 'SUSPENDED') throw new ApplyError('Your account is suspended.', 403);
  if (d.kyc && d.kyc.submittedAt && d.approvalStatus === 'PENDING') throw new ApplyError('Your application is under review, so it cannot be edited right now.', 423);
  const p = kycSchema.safeParse(input);
  if (!p.success) throw new ApplyError(p.error.issues[0].message, 400, { field: p.error.issues[0].path[0] });
  const v = p.data;
  const kinPhone = emailAuth.normalizeMalawiPhone(v.nextOfKinPhone), payPhone = emailAuth.normalizeMalawiPhone(v.payoutPhone);
  if (!authService.validateMalawianPhone(kinPhone)) throw new ApplyError('The next of kin phone number is not a valid Malawian mobile number.', 400, { field: 'nextOfKinPhone' });
  if (!authService.validateMalawianPhone(payPhone)) throw new ApplyError('The payout mobile money number is not valid.', 400, { field: 'payoutPhone' });
  if (kinPhone === d.user.phone) throw new ApplyError('Your next of kin must be someone else: use a different phone number.', 400, { field: 'nextOfKinPhone' });

  const data = {
    legalName: v.legalName, nationalIdEnc: crypto2.encrypt(v.nationalId), nationalIdHash: crypto2.fingerprint(v.nationalId), nationalIdLast4: crypto2.last4(v.nationalId),
    licenseNumberEnc: crypto2.encrypt(v.licenseNumber), licenseHash: crypto2.fingerprint(v.licenseNumber), licenseLast4: crypto2.last4(v.licenseNumber),
    licenseClass: v.licenseClass.toUpperCase(), licenseExpiry: toDate(v.licenseExpiry), address: v.address, district: v.district,
    nextOfKinName: v.nextOfKinName, nextOfKinPhone: kinPhone, nextOfKinRelation: v.nextOfKinRelation || null, payoutNetwork: v.payoutNetwork, payoutPhone: payPhone,
    registrationExpiry: toDate(v.registrationExpiry), insurancePolicyNo: v.insurancePolicyNo, insuranceExpiry: toDate(v.insuranceExpiry), fitnessExpiry: toDate(v.fitnessExpiry)
  };
  try {
    if (d.kyc) await prisma.driverKyc.update({ where: { driverId: d.id }, data });
    else await prisma.driverKyc.create({ data: { driverId: d.id, ...data } });
  } catch (err) {
    if (err && err.code === 'P2002') throw new ApplyError('This National ID or driving licence is already registered with another driver account. If this is a mistake, contact Aarohan support.', 409);
    throw err;
  }
  await prisma.auditLog.create({ data: { userId, action: 'PROFILE_UPDATED', entityType: 'DRIVER', entityId: d.id, details: { kyc: 'saved' }, ipAddress: ip } }).catch(() => {});
  return getApplication(userId);
}

async function submit(userId, declaration, ip) {
  const d = await driverOf(userId);
  if (d.approvalStatus === 'APPROVED') throw new ApplyError('You are already approved.', 409);
  if (d.approvalStatus === 'SUSPENDED') throw new ApplyError('Your account is suspended.', 403);
  if (declaration !== true) throw new ApplyError('You must confirm the declaration that everything you gave is true.', 400);
  const missing = missingFor(d);
  if (missing.length) throw new ApplyError('Your application is not complete yet.', 400, { missing });
  const now = new Date();
  await prisma.$transaction([
    prisma.driverKyc.update({ where: { driverId: d.id }, data: { declarationAcceptedAt: now, submittedAt: now, checklist: null, checklistBy: null, checklistAt: null } }),
    prisma.driver.update({ where: { id: d.id }, data: { approvalStatus: 'PENDING', rejectionReason: null } }),
    prisma.auditLog.create({ data: { userId, action: 'DRIVER_REGISTERED', entityType: 'DRIVER', entityId: d.id, details: { event: 'APPLICATION_SUBMITTED' }, ipAddress: ip } })
  ]);
  try { await require('./supportMail').onDriverSubmitted({ driver: d, user: d.user }); } catch (_) { /* email is best effort */ }
  return getApplication(userId);
}

// ---- admin side
// Only ADMIN sees full ID and licence numbers. Support staff see the last four digits (least privilege).
async function adminKyc(driverId, { full = false } = {}) {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true, vehicle: true, kyc: true, documents: true, liveness: { where: { status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED', 'APPROVED', 'REJECTED'] } }, orderBy: { submittedAt: 'desc' }, take: 1 } } });
  if (!d) return null;
  const k = d.kyc;
  return {
    driverId: d.id, approvalStatus: d.approvalStatus, selfiePath: d.user.avatarUrl || null, liveness: d.liveness && d.liveness[0] ? { status: d.liveness[0].status, steps: d.liveness[0].steps, framePaths: d.liveness[0].framePaths, metrics: d.liveness[0].metrics, guided: !!(Array.isArray(d.liveness[0].metrics) && d.liveness[0].metrics.some((m) => m && m.guided)), alternativeReason: d.liveness[0].status === 'ALTERNATIVE_REQUESTED' && d.liveness[0].metrics ? d.liveness[0].metrics.reason || null : null, submittedAt: d.liveness[0].submittedAt } : null, user: { name: d.user.name, phone: d.user.phone, email: d.user.email, gender: d.user.gender, dateOfBirth: isoDay(d.user.dateOfBirth) },
    vehicle: d.vehicle, documents: d.documents.map((x) => ({ type: x.type, status: x.status, rejectionReason: x.rejectionReason })),
    kyc: k ? { ...maskedKyc(k), nationalId: full ? crypto2.decrypt(k.nationalIdEnc) : '********' + k.nationalIdLast4, licenseNumber: full ? crypto2.decrypt(k.licenseNumberEnc) : '********' + k.licenseLast4, numbersMasked: !full, declarationAcceptedAt: k.declarationAcceptedAt, checklist: k.checklist || {}, checklistBy: k.checklistBy, checklistAt: k.checklistAt } : null,
    checklistItems: CHECKLIST.map(([key, label]) => ({ key, label }))
  };
}

async function saveChecklist(driverId, adminId, items) {
  const k = await prisma.driverKyc.findUnique({ where: { driverId } });
  if (!k || !k.submittedAt) throw new ApplyError('This driver has not submitted an application.', 409);
  const clean = {}; CHECKLIST.forEach(([key]) => { clean[key] = items && items[key] === true; });
  await prisma.driverKyc.update({ where: { driverId }, data: { checklist: clean, checklistBy: adminId, checklistAt: new Date() } });
  return clean;
}

// Approval is refused unless the application is complete and the reviewer ticked everything.
async function approvalGate(driverId, approverId = null) {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true, vehicle: true, kyc: true, documents: true, liveness: { where: { status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED', 'APPROVED', 'REJECTED'] } }, orderBy: { submittedAt: 'desc' }, take: 1 } } });
  if (!d) return { ok: false, reason: 'Driver not found', missing: [] };
  const missing = missingFor(d);
  if (!d.kyc || !d.kyc.submittedAt) missing.push('The driver has not submitted the application');
  const cl = (d.kyc && d.kyc.checklist) || {};
  CHECKLIST.forEach(([key, label]) => { if (cl[key] !== true) missing.push('Not confirmed: ' + label); });
  // Optional two-person rule: the admin who ticked the checklist cannot also approve (set REQUIRE_TWO_PERSON_APPROVAL=true).
  if (process.env.REQUIRE_TWO_PERSON_APPROVAL === 'true' && approverId && d.kyc && d.kyc.checklistBy && d.kyc.checklistBy === approverId) missing.push('A second admin must approve (you completed the checklist)');
  return missing.length ? { ok: false, reason: 'This driver cannot be approved yet.', missing } : { ok: true };
}
// Strict EVERYWHERE by default: nobody is approved without a complete application and a fully ticked checklist.
// Only the explicit value STRICT_DRIVER_APPROVAL=false turns it off (never do that in production).
const strictApproval = () => process.env.STRICT_DRIVER_APPROVAL !== 'false';

// ---- daily incentives (display and progress only: bonuses are paid by Aarohan staff)
// Sustainable defaults: on an average MK 1,800 Moto ride Aarohan keeps MK 540 (30%). These bonuses cost about 7%, 10% and 11%
// of the commission Aarohan earns on that many trips, and only the HIGHEST goal reached each day is paid (not all of them).
const DEFAULT_TIERS = [{ trips: 8, bonusMWK: 300 }, { trips: 15, bonusMWK: 800 }, { trips: 25, bonusMWK: 1500 }];
function incentivesEnabled() { const e = process.env.INCENTIVES_ENABLED; return e ? e === 'true' : process.env.NODE_ENV !== 'production'; }
function tiers() { try { const t = JSON.parse(process.env.DRIVER_INCENTIVES_JSON || ''); if (Array.isArray(t) && t.length) return t.filter((x) => x.trips > 0).sort((a, b) => a.trips - b.trips); } catch (_) {} return DEFAULT_TIERS; }
const startOfBlantyreDay = (now = new Date()) => { const t = new Date(now.getTime() + 2 * 3600000); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - 2 * 3600000); };

async function incentives(driverId) {
  const since = startOfBlantyreDay();
  const weekSince = new Date(since.getTime() - 6 * 86400000);
  const [today, week] = await Promise.all([
    prisma.trip.count({ where: { driverId, status: 'COMPLETED', completedAt: { gte: since } } }),
    prisma.trip.count({ where: { driverId, status: 'COMPLETED', completedAt: { gte: weekSince } } })
  ]);
  const list = tiers().map((t) => ({ trips: t.trips, bonusMWK: t.bonusMWK, reached: today >= t.trips, remaining: Math.max(0, t.trips - today) }));
  const next = list.find((t) => !t.reached) || null;
  return { enabled: incentivesEnabled(), today, week, tiers: list, next, note: 'You get the bonus for the highest goal you reach each day, not all of them. Aarohan applies it as a credit against the commission you owe, after checking your trips. Only completed trips count.' };
}

// ---- a document that has expired means no orders (checked when going online and when accepting a trip)
const DOC_EXPIRY_FIELDS = [['licenseExpiry', 'driving licence'], ['registrationExpiry', 'vehicle registration'], ['insuranceExpiry', 'insurance'], ['fitnessExpiry', 'certificate of fitness']];
async function expiredDocuments(driverId, now = new Date()) {
  if (!prisma.driverKyc || !prisma.driverKyc.findUnique) return [];
  const k = await prisma.driverKyc.findUnique({ where: { driverId } });
  if (!k) return []; // older accounts without an identity record are handled by the approval rules
  const today = startOfBlantyreDay(now);
  return DOC_EXPIRY_FIELDS.filter(([f]) => k[f] && new Date(k[f]).getTime() < today.getTime()).map(([, label]) => label);
}

// ---- commission: what the driver owes Aarohan from cash trips, the limit, and the payment history
const maxDebt = () => require('./commissionLimit').limitMWK();
async function commissionSummary(driverId) {
  const [d, pending, rems] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId }, select: { commissionDebtMWK: true } }),
    prisma.commissionRemittance.aggregate({ where: { driverId, status: 'PENDING_VERIFICATION' }, _sum: { amountMWK: true } }),
    prisma.commissionRemittance.findMany({ where: { driverId }, orderBy: { submittedAt: 'desc' }, take: 20, select: { id: true, amountMWK: true, status: true, submittedAt: true, reviewNotes: true } })
  ]);
  const debt = (d && d.commissionDebtMWK) || 0, limit = maxDebt();
  return { debtMWK: debt, limitMWK: limit, pendingMWK: (pending._sum && pending._sum.amountMWK) || 0, level: debt >= limit ? 'BLOCKED' : (debt >= limit * 0.8 ? 'HIGH' : 'OK'), remittances: rems };
}

// ---- performance over the last 30 days, from real offers and trips
async function performance(driverId) {
  const since = new Date(Date.now() - 30 * 86400000);
  const offer = (status) => prisma.tripOffer.count({ where: { driverId, createdAt: { gte: since }, ...(status ? { status } : {}) } });
  const trips = (status) => prisma.trip.count({ where: { driverId, createdAt: { gte: since }, status } });
  const [offers, accepted, rejected, expired, completed, cancelled, d] = await Promise.all([offer(), offer('ACCEPTED'), offer('REJECTED'), offer('EXPIRED'), trips('COMPLETED'), trips('CANCELLED_BY_DRIVER'), prisma.driver.findUnique({ where: { id: driverId }, select: { rating: true, ratingCount: true, tripsCompleted: true } })]);
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  const taken = accepted;
  return {
    days: 30, offers, accepted, declined: rejected, missed: expired, acceptanceRate: pct(accepted, offers), completed, cancelledByYou: cancelled,
    cancellationRate: pct(cancelled, taken || completed + cancelled), rating: d ? d.rating : null, ratingCount: d ? d.ratingCount : 0, tripsCompleted: d ? d.tripsCompleted : 0
  };
}

// ---- busy areas: where riders asked for rides in the last hour (grid of about 1 km squares, counts only)
async function hotspots() {
  const since = new Date(Date.now() - 60 * 60000);
  const trips = await prisma.trip.findMany({ where: { createdAt: { gte: since } }, select: { pickupLat: true, pickupLng: true }, take: 500 });
  const cells = {};
  trips.forEach((t) => { if (t.pickupLat == null) return; const la = Math.round(t.pickupLat / 0.01) * 0.01, lo = Math.round(t.pickupLng / 0.01) * 0.01, k = la.toFixed(2) + ',' + lo.toFixed(2); (cells[k] = cells[k] || { lat: la, lng: lo, count: 0 }).count++; });
  return Object.values(cells).sort((a, b) => b.count - a.count).slice(0, 8);
}

module.exports = { expiredDocuments, commissionSummary, performance, hotspots, maxDebt, REQUIRED_DOCS, CHECKLIST, kycSchema, ApplyError, getApplication, saveKyc, submit, adminKyc, saveChecklist, approvalGate, strictApproval, incentives, missingFor, startOfBlantyreDay };
