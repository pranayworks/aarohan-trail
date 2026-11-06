const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = path.join(__dirname, '..', 'assets', 'brand');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// SVG 1: logo-full-color.svg
const logoFullColorSvg = `<!-- [PLACEHOLDER] Aarohan Brand Kit SVG - Generated pending official vector asset release -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 80" width="360" height="80" fill="none">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF6A00" />
      <stop offset="100%" stop-color="#FFA247" />
    </linearGradient>
  </defs>
  <!-- Brand Mark (Ascending A chevron) -->
  <g transform="translate(10, 8)">
    <path d="M28 4 L56 60 L42 60 L28 28 L14 60 L0 60 Z" fill="url(#brandGrad)" />
    <path d="M18 42 L38 42 L33 52 L23 52 Z" fill="#0B0B0B" />
    <circle cx="28" cy="18" r="4" fill="#FFA247" />
  </g>
  <!-- Wordmark -->
  <text x="80" y="52" font-family="'Poppins', sans-serif" font-size="40" font-weight="700" fill="#FFFFFF" letter-spacing="-0.5">Aarohan</text>
  <circle cx="260" cy="48" r="5" fill="#FF6A00" />
</svg>`;

// SVG 2: logo-white.svg
const logoWhiteSvg = `<!-- [PLACEHOLDER] Aarohan Brand Kit SVG (Monochrome White) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 80" width="360" height="80" fill="none">
  <g transform="translate(10, 8)">
    <path d="M28 4 L56 60 L42 60 L28 28 L14 60 L0 60 Z" fill="#FFFFFF" />
    <path d="M18 42 L38 42 L33 52 L23 52 Z" fill="#0B0B0B" />
    <circle cx="28" cy="18" r="4" fill="#FFFFFF" />
  </g>
  <text x="80" y="52" font-family="'Poppins', sans-serif" font-size="40" font-weight="700" fill="#FFFFFF" letter-spacing="-0.5">Aarohan</text>
  <circle cx="260" cy="48" r="5" fill="#FFFFFF" />
</svg>`;

// SVG 3: logo-black.svg
const logoBlackSvg = `<!-- [PLACEHOLDER] Aarohan Brand Kit SVG (Monochrome Black) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 80" width="360" height="80" fill="none">
  <g transform="translate(10, 8)">
    <path d="M28 4 L56 60 L42 60 L28 28 L14 60 L0 60 Z" fill="#0B0B0B" />
    <path d="M18 42 L38 42 L33 52 L23 52 Z" fill="#FFFFFF" />
    <circle cx="28" cy="18" r="4" fill="#0B0B0B" />
  </g>
  <text x="80" y="52" font-family="'Poppins', sans-serif" font-size="40" font-weight="700" fill="#0B0B0B" letter-spacing="-0.5">Aarohan</text>
  <circle cx="260" cy="48" r="5" fill="#0B0B0B" />
</svg>`;

// SVG 4: icon-foreground.svg
const iconForegroundSvg = `<!-- [PLACEHOLDER] Aarohan Adaptive Icon Foreground -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <linearGradient id="iconFgGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF6A00" />
      <stop offset="100%" stop-color="#FFA247" />
    </linearGradient>
  </defs>
  <g transform="translate(96, 96) scale(0.625)">
    <path d="M256 36 L500 476 L380 476 L256 220 L132 476 L12 476 Z" fill="url(#iconFgGrad)" />
    <polygon points="160,340 352,340 310,410 202,410" fill="#0B0B0B" />
    <circle cx="256" cy="140" r="32" fill="#FFA247" />
  </g>
</svg>`;

// SVG 5: icon-512.svg
const icon512Svg = `<!-- [PLACEHOLDER] Aarohan Icon 512x512 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="iconGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF6A00" />
      <stop offset="100%" stop-color="#FFA247" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0B0B0B" />
  <rect width="504" height="504" x="4" y="4" rx="108" fill="none" stroke="#292929" stroke-width="4" />
  <g transform="translate(106, 96) scale(0.58)">
    <path d="M256 36 L500 476 L380 476 L256 220 L132 476 L12 476 Z" fill="url(#iconGrad)" />
    <polygon points="160,340 352,340 310,410 202,410" fill="#0B0B0B" />
    <circle cx="256" cy="140" r="32" fill="#FFA247" />
  </g>
</svg>`;

// SVG 6: icon-192.svg
const icon192Svg = `<!-- [PLACEHOLDER] Aarohan Icon 192x192 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <defs>
    <linearGradient id="iconGrad192" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF6A00" />
      <stop offset="100%" stop-color="#FFA247" />
    </linearGradient>
  </defs>
  <rect width="192" height="192" rx="42" fill="#0B0B0B" />
  <rect width="188" height="188" x="2" y="2" rx="40" fill="none" stroke="#292929" stroke-width="2" />
  <g transform="translate(38, 34) scale(0.23)">
    <path d="M256 36 L500 476 L380 476 L256 220 L132 476 L12 476 Z" fill="url(#iconGrad192)" />
    <polygon points="160,340 352,340 310,410 202,410" fill="#0B0B0B" />
    <circle cx="256" cy="140" r="32" fill="#FFA247" />
  </g>
</svg>`;

fs.writeFileSync(path.join(dir, 'logo-full-color.svg'), logoFullColorSvg);
fs.writeFileSync(path.join(dir, 'logo-white.svg'), logoWhiteSvg);
fs.writeFileSync(path.join(dir, 'logo-black.svg'), logoBlackSvg);
fs.writeFileSync(path.join(dir, 'icon-foreground.svg'), iconForegroundSvg);
fs.writeFileSync(path.join(dir, 'icon-512.svg'), icon512Svg);
fs.writeFileSync(path.join(dir, 'icon-192.svg'), icon192Svg);
fs.writeFileSync(path.join(dir, 'favicon.svg'), icon192Svg);

function createMinimalPng(width, height, r, g, b) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  }
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = 1 + width * 3;
  const rawData = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLen;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      const dx = Math.abs(x - width / 2);
      const dy = Math.abs(y - height / 2);
      if (dx + dy < width * 0.3) {
        rawData[px] = 0xFF;     // #FF6A00 (Orange)
        rawData[px + 1] = 0x6A;
        rawData[px + 2] = 0x00;
      } else {
        rawData[px] = r;        // #0B0B0B (Dark)
        rawData[px + 1] = g;
        rawData[px + 2] = b;
      }
    }
  }
  const compressed = zlib.deflateSync(rawData);
  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const png512 = createMinimalPng(512, 512, 0x0B, 0x0B, 0x0B);
const png192 = createMinimalPng(192, 192, 0x0B, 0x0B, 0x0B);
fs.writeFileSync(path.join(dir, 'icon-512.png'), png512);
fs.writeFileSync(path.join(dir, 'icon-192.png'), png192);

console.log('Brand assets generated successfully.');
