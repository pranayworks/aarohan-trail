// ============================================================================
// AAROHAN CAPACITOR ENVIRONMENT SWITCHER • LILONGWE, MALAWI
// Easily toggles capacitor.config.json between local development and production.
// ============================================================================

const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, '../capacitor.config.json');
const targetEnv = (process.argv[2] || 'local').toLowerCase();

if (!fs.existsSync(configPath)) {
  console.error('capacitor.config.json not found!');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (targetEnv === 'local' || targetEnv === 'dev') {
  // 10.0.2.2 connects from Android Emulator to host machine localhost:3000
  const localUrl = process.env.LOCAL_DEV_URL || 'http://10.0.2.2:3000';
  config.server.url = localUrl;
  console.log(`[Capacitor] Switched server.url to LOCAL DEV: ${localUrl}`);
} else {
  const prodUrl = process.env.DEPLOYED_SERVER_URL || 'https://aarohan.app';
  config.server.url = prodUrl;
  console.log(`[Capacitor] Switched server.url to PRODUCTION: ${prodUrl}`);
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log('Updated capacitor.config.json successfully.');
