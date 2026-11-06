require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { server } = require('../server');
const prisma = require('../lib/prisma');

async function captureBrandScreenshots() {
  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  let serverStarted = false;
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3000, '0.0.0.0', () => {
        serverStarted = true;
        resolve();
      });
    });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. Mobile context (360x640) for Rider
    const mobileContext = await browser.newContext({
      viewport: { width: 360, height: 640 },
      geolocation: { latitude: -13.9722, longitude: 33.7667 },
      permissions: ['geolocation']
    });

    const pageMobile = await mobileContext.newPage();

    // Screenshot 1: Login Modal with Chichewa Tagline
    console.log('[Capture 1] Navigating to /rider/ to capture Login Modal with Chichewa Tagline...');
    await pageMobile.goto('http://127.0.0.1:3000/rider/', { waitUntil: 'domcontentloaded' });
    await pageMobile.waitForSelector('#aarohan-auth-modal', { timeout: 10000 });

    // Switch language to Chichewa (NY)
    const langBtn = await pageMobile.waitForSelector('#auth-lang-btn', { timeout: 5000 });
    await langBtn.click();
    await pageMobile.waitForTimeout(600);

    await pageMobile.screenshot({
      path: path.join(screenshotsDir, '01-login-chichewa.png'),
      fullPage: true
    });
    console.log('✅ Captured 01-login-chichewa.png');

    // Screenshot 2: Rider Home / Planner Screen with Dark Card
    console.log('[Capture 2] Authenticating and capturing Rider Home Planner Screen...');
    // Log in via localStorage session injection
    const testRider = await prisma.user.findFirst({ where: { role: 'RIDER' } });
    await pageMobile.evaluate((user) => {
      localStorage.setItem('aarohan_access_token', 'mock_token');
      localStorage.setItem('aarohan_user', JSON.stringify(user || { name: 'Aarohan Rider', phone: '+265991234567', role: 'RIDER' }));
      const m = document.getElementById('aarohan-auth-modal');
      if (m) m.remove();
    }, testRider);

    await pageMobile.reload({ waitUntil: 'domcontentloaded' });
    await pageMobile.waitForTimeout(1000);

    // Open planner
    await pageMobile.evaluate(() => {
      if (typeof window.openSearchModal === 'function') window.openSearchModal();
    });
    await pageMobile.waitForTimeout(800);

    await pageMobile.screenshot({
      path: path.join(screenshotsDir, '02-rider-home-planner.png'),
      fullPage: true
    });
    console.log('✅ Captured 02-rider-home-planner.png');

    // Screenshot 3: Driver Home Screen with Brand Header
    console.log('[Capture 3] Navigating to /driver/ to capture Driver Home with brand header...');
    const driverContext = await browser.newContext({
      viewport: { width: 360, height: 640 },
      geolocation: { latitude: -13.9650, longitude: 33.7820 },
      permissions: ['geolocation']
    });
    const pageDriver = await driverContext.newPage();
    const testDriver = await prisma.user.findFirst({ where: { role: 'DRIVER' } });

    await pageDriver.goto('http://127.0.0.1:3000/driver/', { waitUntil: 'domcontentloaded' });
    await pageDriver.evaluate((user) => {
      localStorage.setItem('aarohan_access_token', 'mock_token');
      localStorage.setItem('aarohan_user', JSON.stringify(user || { name: 'Aarohan Driver', phone: '+265881234567', role: 'DRIVER' }));
      const m = document.getElementById('aarohan-auth-modal');
      if (m) m.remove();
    }, testDriver);

    await pageDriver.reload({ waitUntil: 'domcontentloaded' });
    await pageDriver.waitForTimeout(1200);

    await pageDriver.screenshot({
      path: path.join(screenshotsDir, '03-driver-home.png'),
      fullPage: true
    });
    console.log('✅ Captured 03-driver-home.png');

    // Screenshot 4: Admin Portal with Updated Brand
    console.log('[Capture 4] Navigating to /admin/ (Desktop 1280x800) to capture Admin Portal...');
    const adminContext = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const pageAdmin = await adminContext.newPage();
    const testAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

    await pageAdmin.goto('http://127.0.0.1:3000/admin/', { waitUntil: 'domcontentloaded' });
    await pageAdmin.evaluate((user) => {
      localStorage.setItem('aarohan_access_token', 'mock_token');
      localStorage.setItem('aarohan_user', JSON.stringify(user || { name: 'Admin Operations', phone: '+265990000001', role: 'ADMIN' }));
      const m = document.getElementById('aarohan-auth-modal');
      if (m) m.remove();
    }, testAdmin);

    await pageAdmin.reload({ waitUntil: 'domcontentloaded' });
    await pageAdmin.waitForTimeout(1500);

    await pageAdmin.screenshot({
      path: path.join(screenshotsDir, '04-admin-portal.png'),
      fullPage: false
    });
    console.log('✅ Captured 04-admin-portal.png');

  } finally {
    await browser.close();
    if (serverStarted && server.listening) {
      await new Promise(r => server.close(r));
    }
  }
  console.log('All brand screenshots captured successfully.');
}

if (require.main === module) {
  captureBrandScreenshots().then(() => process.exit(0)).catch(e => {
    console.error('Screenshot capture failed:', e);
    process.exit(1);
  });
}

module.exports = { captureBrandScreenshots };
