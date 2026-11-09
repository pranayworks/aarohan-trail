// ============================================================================
// Downloads the face-detection files (about 13 MB, once) into vendor/mediapipe so the driver face check is served from
// YOUR server and never depends on an outside website. Run it on your computer, then commit the files:
//   npm run setup:face
// ============================================================================
const fs = require('fs');
const path = require('path');

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const OUT = path.join(__dirname, '..', 'vendor', 'mediapipe');
const FILES = [
  [VISION + '/vision_bundle.mjs', 'vision_bundle.mjs'],
  [VISION + '/wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.js'],
  [VISION + '/wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.wasm'],
  [VISION + '/wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.js'],
  [VISION + '/wasm/vision_wasm_nosimd_internal.wasm', 'wasm/vision_wasm_nosimd_internal.wasm'],
  [MODEL, 'face_landmarker.task']
];

(async () => {
  let ok = 0;
  for (const [url, rel] of FILES) {
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { console.log('already have ' + rel); ok++; continue; }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error('file too small');
      fs.writeFileSync(dest, buf);
      console.log('downloaded ' + rel + ' (' + Math.round(buf.length / 1024) + ' KB)');
      ok++;
    } catch (e) { console.error('FAILED ' + rel + ': ' + e.message); }
  }
  console.log(ok === FILES.length ? '\nAll face files are ready in vendor/mediapipe. Commit them with git so the live server has them.' : '\nSome files failed. Check your internet and run it again.');
  process.exit(ok === FILES.length ? 0 : 1);
})();
