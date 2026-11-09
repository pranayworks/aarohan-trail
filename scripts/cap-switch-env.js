// ============================================================================
// AAROHAN CAPACITOR ENVIRONMENT SWITCHER (Lilongwe, Malawi)
// Writes the settings for BOTH Android apps:
//   Rider app   (com.aarohan.rider)  opens  <server>/rider/next/
//   Captain app (com.aarohan.driver) opens  <server>/driver/next/
//   npm run cap:dev    -> your computer, seen from the Android emulator: http://10.0.2.2:3000
//   npm run cap:prod   -> DEPLOYED_SERVER_URL (your live https address, for example https://aarohan.up.railway.app)
// Then run: npm run cap:sync
// ============================================================================
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rootConfig = path.join(root, 'capacitor.config.json');
const targetEnv = (process.argv[2] || 'local').toLowerCase();

const APPS = {
  driver: { appId: 'com.aarohan.driver', appName: 'Aarohan Captain', path: '/driver/next/' },
  rider: { appId: 'com.aarohan.rider', appName: 'Aarohan', path: '/rider/next/' }
};

if (!fs.existsSync(rootConfig)) { console.error('capacitor.config.json not found!'); process.exit(1); }
const base = JSON.parse(fs.readFileSync(rootConfig, 'utf8'));
const local = targetEnv === 'local' || targetEnv === 'dev';

let origin, host = null;
if (local) {
  origin = (process.env.LOCAL_DEV_URL || 'http://10.0.2.2:3000').replace(/\/+$/, '');
} else {
  origin = (process.env.DEPLOYED_SERVER_URL || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(origin)) {
    console.error('Set DEPLOYED_SERVER_URL to your live https address first, for example (PowerShell):\n  $env:DEPLOYED_SERVER_URL="https://your-app.up.railway.app"; npm run cap:prod');
    process.exit(1);
  }
  host = new URL(origin).host;
}

for (const [flavor, app] of Object.entries(APPS)) {
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.appId = app.appId;
  cfg.appName = app.appName;
  cfg.server = cfg.server || {};
  cfg.server.url = origin + app.path;
  cfg.server.cleartext = local; // plain http only for local testing, the live apps use https only
  if (!local) {
    const keep = (cfg.server.allowNavigation || []).filter((h) => !/localhost|127\.0\.0\.1|10\.0\.2\.2/.test(h));
    cfg.server.allowNavigation = Array.from(new Set([host, '*.' + host.split('.').slice(-2).join('.'), 'accounts.google.com'].concat(keep)));
  }
  const dir = path.join(root, 'android', 'app', 'src', flavor, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'capacitor.config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  console.log('[Capacitor] ' + app.appName + ' (' + app.appId + ') opens ' + cfg.server.url);
  if (flavor === 'driver') fs.writeFileSync(rootConfig, JSON.stringify(cfg, null, 2) + '\n', 'utf8'); // the main file follows the Captain app
}
