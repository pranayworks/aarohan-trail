// Ads for the rider app and the driver app, managed from the admin panel.
const prisma = require('../lib/prisma');
const adMedia = require('./adMedia');

class AdError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const AUDIENCES = ['RIDER', 'DRIVER'];
// Which screen of each app can show an ad (the admin panel shows these descriptions)
const PLACEMENTS = {
  RIDER: { HOME: 'Home screen, under the "Where to?" box', SEARCHING: 'While the rider waits for a captain', COMPLETED: 'After a ride, on the thank-you screen' },
  DRIVER: { HOME: 'Home screen, under the Go online button', EARNINGS: 'The Earnings tab' }
};
const MALAWI = { minLat: -17.5, maxLat: -9.0, minLng: 32.5, maxLng: 36.0 };
const distanceKm = (aLat, aLng, bLat, bLng) => { const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r, x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
const LINK_RE = /^https:\/\/[^\s<>"']{3,480}$/i;

const isLive = (ad, now = new Date()) => !!ad.active && (!ad.startsAt || new Date(ad.startsAt) <= now) && (!ad.endsAt || new Date(ad.endsAt) >= now);
const statusOf = (ad, now = new Date()) => !ad.active ? 'OFF' : (ad.startsAt && new Date(ad.startsAt) > now ? 'SCHEDULED' : (ad.endsAt && new Date(ad.endsAt) < now ? 'ENDED' : 'LIVE'));

function clean(input, { partial = false, audience } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  if (!partial || has('audience')) { if (!AUDIENCES.includes(input.audience)) throw new AdError('Choose the Rider app or the Driver app.'); out.audience = input.audience; }
  if (!partial || has('title')) { const t = String(input.title || '').trim(); if (t.length < 2 || t.length > 80) throw new AdError('The title must be 2 to 80 characters.'); out.title = t; }
  const aud = out.audience || audience || input.audience;
  if (!partial || has('placement')) {
    const pl = String(input.placement || 'HOME').toUpperCase();
    if (!aud || !PLACEMENTS[aud] || !PLACEMENTS[aud][pl]) throw new AdError('Choose where the ad appears: ' + Object.keys(PLACEMENTS[aud] || PLACEMENTS.RIDER).join(', ').toLowerCase() + '.');
    out.placement = pl;
  }
  if (['geoLat', 'geoLng', 'geoRadiusKm'].some(has)) {
    const blank = (v) => v === null || v === '' || v === undefined;
    if (['geoLat', 'geoLng', 'geoRadiusKm'].every((k) => blank(input[k]))) { out.geoLat = null; out.geoLng = null; out.geoRadiusKm = null; out.geoLabel = null; }
    else {
      const la = Number(input.geoLat), ln = Number(input.geoLng), rk = Number(input.geoRadiusKm);
      if (![la, ln, rk].every(Number.isFinite) || blank(input.geoLat) || blank(input.geoLng) || blank(input.geoRadiusKm)) throw new AdError('To show an ad only near a place, give the latitude, the longitude and the radius.');
      if (la < MALAWI.minLat || la > MALAWI.maxLat || ln < MALAWI.minLng || ln > MALAWI.maxLng) throw new AdError('That place is outside Malawi.');
      if (rk < 0.5 || rk > 500) throw new AdError('The radius must be between 0.5 and 500 km.');
      out.geoLat = la; out.geoLng = ln; out.geoRadiusKm = rk; out.geoLabel = String(input.geoLabel || '').trim().slice(0, 80) || null;
    }
  }
  if (has('caption')) { const c = String(input.caption || '').trim(); if (c.length > 200) throw new AdError('The caption can be at most 200 characters.'); out.caption = c || null; }
  if (has('linkUrl')) { const l = String(input.linkUrl || '').trim(); if (l && !LINK_RE.test(l)) throw new AdError('The link must start with https://'); out.linkUrl = l || null; }
  if (has('priority')) { const p = parseInt(input.priority, 10); if (!Number.isInteger(p) || p < -100 || p > 100) throw new AdError('Priority must be a whole number from -100 to 100.'); out.priority = p; }
  if (has('active')) out.active = input.active === true || input.active === 'true';
  for (const k of ['startsAt', 'endsAt']) if (has(k)) { if (input[k] === null || input[k] === '') out[k] = null; else { const d = new Date(input[k]); if (isNaN(d)) throw new AdError('That date is not valid.'); out[k] = d; } }
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) throw new AdError('The end must be after the start.');
  return out;
}

const forApp = (ad) => ({ id: ad.id, title: ad.title, caption: ad.caption, mediaType: ad.mediaType, mediaUrl: ad.mediaUrl, linkUrl: ad.linkUrl });

// opts: { placement, lat, lng }. An ad with a place is shown only to a phone that says it is inside the radius.
// The phone's location is used for this check and is never stored.
async function listForApp(audience, opts = {}, now = new Date()) {
  if (!AUDIENCES.includes(audience)) throw new AdError('Unknown audience.');
  const placement = String(opts.placement || 'HOME').toUpperCase();
  const lat = Number(opts.lat), lng = Number(opts.lng), known = Number.isFinite(lat) && Number.isFinite(lng);
  const rows = await prisma.ad.findMany({ where: { audience, active: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 60 });
  return rows.filter((a) => (a.placement || 'HOME') === placement && isLive(a, now) && (a.geoLat == null || (known && distanceKm(a.geoLat, a.geoLng, lat, lng) <= a.geoRadiusKm))).slice(0, 5).map(forApp);
}

async function track(id, type) {
  const field = type === 'click' ? 'clicks' : (type === 'impression' ? 'impressions' : null);
  if (!field) throw new AdError('Unknown event.');
  try { await prisma.ad.update({ where: { id }, data: { [field]: { increment: 1 } } }); } catch (_) { /* the ad was deleted */ }
}

async function adminList(audience) {
  const rows = await prisma.ad.findMany({ where: AUDIENCES.includes(audience) ? { audience } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map((a) => ({ ...a, status: statusOf(a), ctr: a.impressions ? Math.round((a.clicks / a.impressions) * 1000) / 10 : 0 }));
}

async function audit(adminId, action, ad, ip) {
  try { await prisma.auditLog.create({ data: { userId: adminId, action, entityType: 'AD', entityId: ad.id, details: { audience: ad.audience, title: ad.title }, ipAddress: ip || null } }); } catch (_) {}
}

async function create(fields, file, adminId, ip) {
  const data = clean(fields);
  if (!file || !file.buffer) throw new AdError('Choose a picture or a video.');
  const kind = adMedia.sniff(file.buffer);
  if (!kind) throw new AdError('Only JPG, PNG, WEBP pictures and MP4 or WEBM videos are allowed.');
  if (file.buffer.length > kind.max) throw new AdError(kind.type === 'IMAGE' ? 'Pictures can be at most 5 MB.' : 'Videos can be at most 25 MB.');
  const stored = await adMedia.store({ buffer: file.buffer, ext: kind.ext, mime: kind.mime });
  const ad = await prisma.ad.create({ data: { ...data, active: data.active !== false, mediaType: kind.type, mediaPath: stored.path, mediaUrl: stored.url, createdBy: adminId } });
  await audit(adminId, 'AD_CREATED', ad, ip);
  return ad;
}

async function update(id, fields, adminId, ip) {
  const ad = await prisma.ad.findUnique({ where: { id } }); if (!ad) throw new AdError('Ad not found.', 404);
  const data = clean(fields, { partial: true, audience: ad.audience });
  const next = await prisma.ad.update({ where: { id }, data });
  await audit(adminId, 'AD_UPDATED', next, ip);
  return next;
}

async function remove(id, adminId, ip) {
  const ad = await prisma.ad.findUnique({ where: { id } }); if (!ad) throw new AdError('Ad not found.', 404);
  await prisma.ad.delete({ where: { id } });
  await adMedia.remove(ad.mediaPath);
  await audit(adminId, 'AD_DELETED', ad, ip);
}

module.exports = { AdError, AUDIENCES, PLACEMENTS, distanceKm, isLive, statusOf, clean, listForApp, track, adminList, create, update, remove, LINK_RE };
