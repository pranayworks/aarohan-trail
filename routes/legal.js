// ============================================================================
// AAROHAN LEGAL & CONSENT ROUTER • LILONGWE, MALAWI
// Serves /legal/terms and /legal/privacy with visible DRAFT banner.
// Records consent via /api/consent into ConsentRecord table.
// ============================================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

function renderLegalHtml(title, version, markdownContent) {
  // Simple markdown to HTML converter for paragraphs, headings and lists
  const escaped = markdownContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const formatted = escaped
    .replace(/^### (.*$)/gim, '<h3 class="text-base font-extrabold text-[#1B1B1B] mt-5 mb-2">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-lg font-extrabold text-[#1B1B1B] mt-6 mb-2 border-b pb-1">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-black text-[#1B1B1B] mb-2 tracking-tight">$1</h1>')
    .replace(/^\> ⚠️ (.*$)/gim, '<div class="p-3 my-3 bg-amber-50 border-l-4 border-amber-500 text-amber-950 font-bold text-xs rounded-r">$1</div>')
    .replace(/^\- (.*$)/gim, '<li class="ml-5 list-disc text-sm text-slate-700 my-1">$1</li>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-extrabold text-slate-900">$1</strong>')
    .replace(/\n\n/gim, '</p><p class="text-sm text-slate-700 my-2.5 leading-relaxed">');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
  <title>${title} • AArohan Lilongwe</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/shared/theme.css"/>
  <link rel="stylesheet" href="/shared/tailwind.built.css"/>
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #faf8ff; color: #1B1B1B; }
  </style>
</head>
<body class="min-h-screen flex flex-col justify-between antialiased">
  <header class="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <a href="/rider/" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 hover:bg-slate-200 text-sm font-bold">←</a>
      <span class="font-extrabold text-sm text-slate-900">AArohan Mobility</span>
    </div>
    <span class="text-[11px] font-black uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-900">${version}</span>
  </header>

  <!-- Sticky Draft Banner -->
  <div class="bg-amber-500 text-white px-4 py-2 text-center text-xs font-black uppercase tracking-wider sticky top-[53px] z-30 shadow-sm">
    ⚠️ DRAFT, not legal advice • Version ${version}
  </div>

  <main class="max-w-2xl mx-auto w-full px-4 py-6 bg-white shadow-xs rounded-2xl my-4 border border-slate-200/70">
    <p class="text-sm text-slate-700 my-2.5 leading-relaxed">
      ${formatted}
    </p>
  </main>

  <footer class="text-center py-4 text-xs text-slate-500">
    AArohan Smart Urban Mobility Platform • Lilongwe, Malawi
  </footer>
</body>
</html>`;
}

// 1. Serve Terms of Service HTML
router.get('/legal/terms', (req, res) => {
  try {
    const mdPath = path.join(__dirname, '..', 'legal', 'terms.md');
    const content = fs.readFileSync(mdPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderLegalHtml('Terms of Service', 'DRAFT v0.1', content));
  } catch (err) {
    res.status(500).send('Terms of Service document could not be loaded.');
  }
});

// 2. Serve Privacy Policy HTML
router.get('/legal/privacy', (req, res) => {
  try {
    const mdPath = path.join(__dirname, '..', 'legal', 'privacy.md');
    const content = fs.readFileSync(mdPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderLegalHtml('Privacy Policy', 'DRAFT v0.1', content));
  } catch (err) {
    res.status(500).send('Privacy Policy document could not be loaded.');
  }
});

// 3. Record Consent API
// Accepts either { documentType } or the rider app's { type: 'TERMS_AND_PRIVACY' } (records both
// documents). Each user + document + version is recorded ONCE.
router.post('/api/consent', requireAuth, async (req, res) => {
  try {
    const { documentType, type, version = 'v0.1' } = req.body || {};
    const validDocs = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'DRIVER_AGREEMENT'];

    let docs;
    if (!documentType && type === 'TERMS_AND_PRIVACY') {
      docs = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];
    } else if (validDocs.includes(documentType)) {
      docs = [documentType];
    } else {
      return res.status(400).json({ error: `documentType must be one of [${validDocs.join(', ')}]` });
    }

    const ver = String(version).slice(0, 20);
    // Keyed hash (not a plain hash: IPv4 addresses are easy to reverse), using the trusted client IP.
    const ip = req.ip || req.socket.remoteAddress || '';
    const secret = process.env.CONSENT_HASH_SECRET || process.env.JWT_SECRET || 'aarohan-consent';
    const ipHash = crypto.createHmac('sha256', secret).update(String(ip)).digest('hex');

    const records = [];
    for (const doc of docs) {
      const existing = await prisma.consentRecord.findFirst({
        where: { userId: req.user.id, documentType: doc, version: ver }
      });
      if (existing) {
        records.push(existing);
        continue;
      }
      const record = await prisma.consentRecord.create({
        data: { userId: req.user.id, documentType: doc, version: ver, ipHash }
      });
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CONSENT_RECORDED',
          entityType: 'CONSENT_RECORD',
          entityId: record.id,
          details: { documentType: doc, version: ver }
        }
      });
      records.push(record);
    }

    res.status(201).json({ success: true, records, record: records[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

