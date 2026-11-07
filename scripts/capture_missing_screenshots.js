require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { server } = require('../server');
const prisma = require('../lib/prisma');

async function captureMissingScreenshots() {
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
    // Shared Mobile Context (360x640) for Rider
    const riderContext = await browser.newContext({
      viewport: { width: 360, height: 640 },
      geolocation: { latitude: -13.9722, longitude: 33.7667 },
      permissions: ['geolocation']
    });

    const pageRider = await riderContext.newPage();
    const testRider = await prisma.user.findFirst({ where: { role: 'RIDER' } });

    // =========================================================================
    // Screenshot 1: Rider Home Screen (Map, "Where to?", Bottom Nav)
    // =========================================================================
    console.log('[Capture 1/4] Capturing 05-rider-home.png...');
    await pageRider.goto('http://127.0.0.1:3000/rider/', { waitUntil: 'domcontentloaded' });
    await pageRider.evaluate((user) => {
      localStorage.setItem('aarohan_access_token', 'mock_token');
      localStorage.setItem('aarohan_user', JSON.stringify(user || { name: 'Chisomo Banda', phone: '+265991234567', role: 'RIDER' }));
      const m = document.getElementById('aarohan-auth-modal');
      if (m) m.remove();
    }, testRider);

    await pageRider.reload({ waitUntil: 'domcontentloaded' });
    await pageRider.waitForTimeout(1500);

    // Ensure planner modal is closed so default Home screen is visible
    await pageRider.evaluate(() => {
      const searchModal = document.getElementById('search-modal');
      if (searchModal) searchModal.classList.add('hidden');
      if (typeof window.switchView === 'function') window.switchView('booking');
    });
    await pageRider.waitForTimeout(600);

    await pageRider.screenshot({
      path: path.join(screenshotsDir, '05-rider-home.png'),
      fullPage: true
    });
    console.log('✅ Captured docs/screenshots/05-rider-home.png');

    // =========================================================================
    // Screenshot 2: Trip Tracking with Driver Assigned & PIN Visible
    // =========================================================================
    console.log('[Capture 2/4] Capturing 06-trip-tracking-pin.png...');
    await pageRider.evaluate(() => {
      if (typeof window.switchView === 'function') {
        window.switchView('tracking');
      }

      // Populate tracking view with driver details and safety PIN
      const pinEl = document.getElementById('tracking-pin-display');
      if (pinEl) pinEl.innerText = '7916';

      const statusEl = document.getElementById('tracking-status-title');
      if (statusEl) statusEl.innerText = 'Captain On The Way';

      const etaEl = document.getElementById('tracking-eta-time');
      if (etaEl) etaEl.innerText = 'Arriving in 3 mins';

      const dName = document.getElementById('tracking-driver-name');
      if (dName) dName.innerText = 'Chikondi Phiri';

      const dCar = document.getElementById('tracking-driver-car');
      if (dCar) dCar.innerText = 'Red Boxer 150';

      const dPlate = document.getElementById('tracking-driver-plate');
      if (dPlate) dPlate.innerText = 'BW 4920';

      const dRating = document.getElementById('tracking-driver-rating');
      if (dRating) dRating.innerText = '4.95';

      const dRides = document.getElementById('tracking-driver-rides');
      if (dRides) dRides.innerText = '1,840 rides';
    });
    await pageRider.waitForTimeout(800);

    await pageRider.screenshot({
      path: path.join(screenshotsDir, '06-trip-tracking-pin.png'),
      fullPage: true
    });
    console.log('✅ Captured docs/screenshots/06-trip-tracking-pin.png');

    // =========================================================================
    // Screenshot 3: Parcel Courier Form
    // =========================================================================
    console.log('[Capture 3/4] Capturing 07-parcel-form.png...');
    await pageRider.evaluate(() => {
      if (typeof window.openSearchModal === 'function') window.openSearchModal();
      if (typeof window.switchPlannerTab === 'function') window.switchPlannerTab('parcel');

      // Fill in sample parcel details
      const nameInp = document.getElementById('modal-parcel-recipient-name');
      if (nameInp) nameInp.value = 'Peter Banda (EPTL)';

      const phoneInp = document.getElementById('modal-parcel-recipient-phone');
      if (phoneInp) phoneInp.value = '+265 99 223 3445';

      const notesInp = document.getElementById('modal-parcel-notes');
      if (notesInp) notesInp.value = 'Chitipi Road office, 2nd floor';

      const check = document.getElementById('modal-parcel-prohibited-check');
      if (check) check.checked = true;
    });
    await pageRider.waitForTimeout(800);

    await pageRider.screenshot({
      path: path.join(screenshotsDir, '07-parcel-form.png'),
      fullPage: true
    });
    console.log('✅ Captured docs/screenshots/07-parcel-form.png');

    // =========================================================================
    // Screenshot 4: Driver Commission Card
    // =========================================================================
    console.log('[Capture 4/4] Capturing 08-driver-commission-card.png...');
    const driverContext = await browser.newContext({
      viewport: { width: 360, height: 720 },
      geolocation: { latitude: -13.9650, longitude: 33.7820 },
      permissions: ['geolocation']
    });

    const pageDriver = await driverContext.newPage();
    const testDriver = await prisma.user.findFirst({
      where: { role: 'DRIVER' },
      include: { driverProfile: true }
    });

    await pageDriver.goto('http://127.0.0.1:3000/driver/', { waitUntil: 'domcontentloaded' });
    await pageDriver.evaluate((user) => {
      localStorage.setItem('aarohan_access_token', 'mock_token');
      localStorage.setItem('aarohan_user', JSON.stringify(user || { name: 'Chikondi Phiri', phone: '+265995541122', role: 'DRIVER' }));
      const m = document.getElementById('aarohan-auth-modal');
      if (m) m.remove();
    }, testDriver);

    await pageDriver.reload({ waitUntil: 'domcontentloaded' });
    await pageDriver.waitForTimeout(1200);

    // Scroll to Commission Status & Settlement section
    await pageDriver.evaluate(() => {
      const debtEl = document.getElementById('driver-commission-owed');
      if (debtEl) debtEl.innerText = 'MWK 4,500';

      const badgeEl = document.getElementById('commission-status-badge');
      if (badgeEl) badgeEl.innerText = 'Good Standing';

      const payCard = document.getElementById('form-pay-commission');
      if (payCard) {
        payCard.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });
    await pageDriver.waitForTimeout(800);

    await pageDriver.screenshot({
      path: path.join(screenshotsDir, '08-driver-commission-card.png'),
      fullPage: false
    });
    console.log('✅ Captured docs/screenshots/08-driver-commission-card.png');

  } finally {
    await browser.close();
    if (serverStarted) {
      server.close();
    }
  }
}

if (require.main === module) {
  captureMissingScreenshots()
    .then(() => {
      console.log('All 4 missing screenshots captured successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Screenshot capture failed:', err);
      process.exit(1);
    });
}

module.exports = { captureMissingScreenshots };

