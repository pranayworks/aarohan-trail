'use strict';
// Checks the launch package without a phone or a server: the two Android apps, the cloud build, push hooks,
// the admin page cleanliness, and what both apps load.
const fs = require('fs'), path = require('path');
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const has = (f) => fs.existsSync(path.join(root, f));
const keys = (xml) => [...xml.matchAll(/<string name="([^"]+)"/g)].map((m) => m[1]).sort();
const wellFormed = (xml) => { const o = (xml.match(/<(?!\/|\?|!)[^>]*[^\/]>/g) || []).length, c = (xml.match(/<\/[^>]+>/g) || []).length, sc = (xml.match(/<[^>]*\/>/g) || []).length; return o === c && sc >= 0; };

console.log('--- Two Android apps');
const gradle = rd('android/app/build.gradle'), driverS = rd('android/app/src/driver/res/values/strings.xml'), riderS = rd('android/app/src/rider/res/values/strings.xml');
report('One project builds two apps: Aarohan (com.aarohan.rider) and Aarohan Captain (com.aarohan.driver)', /productFlavors/.test(gradle) && /applicationId "com\.aarohan\.driver"/.test(gradle) && /applicationId "com\.aarohan\.rider"/.test(gradle) && />Aarohan Captain</.test(driverS) && /name="app_name">Aarohan</.test(riderS));
report('Both apps define exactly the same text keys (name, widget, shortcuts), so neither build can miss one', JSON.stringify(keys(driverS)) === JSON.stringify(keys(riderS)) && keys(driverS).length >= 14);
const used = new Set([...rd('android/app/src/main/AndroidManifest.xml').matchAll(/@string\/(\w+)/g)].map((m) => m[1]).concat([...rd('android/app/src/main/res/layout/aarohan_widget.xml').matchAll(/@string\/(\w+)/g)].map((m) => m[1]), [...rd('android/app/src/main/res/xml/aarohan_widget_info.xml').matchAll(/@string\/(\w+)/g)].map((m) => m[1]), [...rd('android/app/src/rider/res/xml/shortcuts.xml').matchAll(/@string\/(\w+)/g)].map((m) => m[1])));
report('Every text the manifest, widget and shortcuts use is defined for both apps', [...used].every((k) => keys(driverS).includes(k) && keys(riderS).includes(k)), [...used].filter((k) => !keys(riderS).includes(k)).join());
report('The old single-app text file no longer clashes with the two sets', !/app_name/.test(rd('android/app/src/main/res/values/strings.xml')));
const mMain = rd('android/app/src/main/AndroidManifest.xml'), mDrv = rd('android/app/src/driver/AndroidManifest.xml'), mRid = rd('android/app/src/rider/AndroidManifest.xml');
report('Both apps ask for internet, location and notifications; the live app is https only and backups are off', /ACCESS_FINE_LOCATION/.test(mMain) && /POST_NOTIFICATIONS/.test(mMain) && /usesCleartextTraffic="\$\{usesCleartext\}"/.test(mMain) && /usesCleartext: "false"/.test(gradle) && /allowBackup="false"/.test(mMain));
report('Only the Captain app gets the camera, background location and the tracking service', /permission\.CAMERA/.test(mDrv) && /ACCESS_BACKGROUND_LOCATION/.test(mDrv) && /BackgroundGeolocationService/.test(mDrv) && !/permission\.CAMERA/.test(mMain) && !/BACKGROUND_LOCATION/.test(mMain) && /ACCESS_BACKGROUND_LOCATION" tools:node="remove"/.test(mRid));
report('The rider app has no microphone or camera right (nothing there uses them)', !/RECORD_AUDIO|CAMERA/.test(mMain + mRid));
report('The widget is registered so it shows in the phone\'s widget list, and the app icon has shortcuts', /AarohanWidgetProvider/.test(mMain) && /android\.appwidget\.provider/.test(mMain) && /android\.app\.shortcuts/.test(mMain) && has('android/app/src/main/java/com/aarohan/driver/AarohanWidgetProvider.java'));
const sd = rd('android/app/src/driver/res/xml/shortcuts.xml'), sr = rd('android/app/src/rider/res/xml/shortcuts.xml');
report('Shortcuts open the right app: rider (ride, parcel) and captain (online, earnings)', /targetPackage="com\.aarohan\.rider"/.test(sr) && /value="ride"/.test(sr) && /value="parcel"/.test(sr) && /targetPackage="com\.aarohan\.driver"/.test(sd) && /value="online"/.test(sd) && /value="earnings"/.test(sd));
const mainJava = rd('android/app/src/main/java/com/aarohan/driver/MainActivity.java');
report('Only four known words ever pass from a widget or shortcut into the web page', /"ride"\.equals\(go\) \|\| "parcel"\.equals\(go\) \|\| "online"\.equals\(go\) \|\| "earnings"\.equals\(go\)/.test(mainJava));
report('The widget buttons send the words in the texts, and the web app reads them once', /widget_go_a/.test(rd('android/app/src/main/java/com/aarohan/driver/AarohanWidgetProvider.java')) && /__aarohanGoStamp/.test(rd('rider/next/js/native.js')) && /never goes online by itself/.test(rd('rider/next/js/native.js')));
report('Version numbers and signing come from the build, never from files in Git', /VERSION_CODE/.test(gradle) && /KEYSTORE_FILE/.test(gradle) && /\*\.keystore/.test(rd('.gitignore')) && /google-services\.json/.test(rd('.gitignore')));
report('Apps without Firebase files still build (push is simply off)', /exists\(\)/.test(gradle) && /push notifications are off/.test(gradle));
const cap = rd('scripts/cap-switch-env.js');
report('One command points BOTH apps at the live server, https only, and the Captain config follows the live address', /driver\/next\//.test(cap) && /rider\/next\//.test(cap) && /cfg\.server\.cleartext = local/.test(cap) && /\^https:/.test(cap) && has('android/app/src/rider/assets/capacitor.config.json') && has('android/app/src/driver/assets/capacitor.config.json'));
const wf = rd('.github/workflows/android.yml');
report('The cloud build makes both APK files (and Play Store files when a key is set), with no Android Studio', /assembleDriverDebug assembleRiderDebug/.test(wf) && /bundleDriverRelease bundleRiderRelease/.test(wf) && /DEPLOYED_SERVER_URL/.test(wf) && /upload-artifact@v4/.test(wf) && !/\t/.test(wf));

console.log('\n--- Push notifications');
report('Any signed-in phone can register for notifications', /router\.post\('\/me\/device-token', requireAuth/.test(rd('routes/me.js')));
const th = rd('sockets/tripHandlers.js');
report('Riders are notified when a captain accepts and arrives, drivers when approved or rejected, and a failure never blocks the trip', /TRIP_ACCEPTED/.test(th) && /TRIP_ARRIVED/.test(th) && /DRIVER_APPROVED/.test(rd('routes/admin.js')) && /DRIVER_REJECTED/.test(rd('routes/admin.js')) && (th.match(/\.catch\(\(\) => \{\}\)/g) || []).length >= 2);
report('Every email and push is recorded in the messages log (masked)', /messageLog/.test(rd('services/email.js')) && /messageLog/.test(rd('services/pushNotification.js')) && /toMasked/.test(rd('services/messageLog.js')));

console.log('\n--- What the apps load');
const rIdx = rd('rider/next/index.html'), dIdx = rd('driver/next/index.html');
report('Both apps load the ads and the Android helper code', /js\/ads\.js/.test(rIdx) && /js\/native\.js/.test(rIdx) && /js\/ads\.js/.test(dIdx) && /js\/native\.js/.test(dIdx));
report('The Captain app loads the background location and push code, and both apps are installable', /capacitor-bridge\.js/.test(dIdx) && /manifest\.webmanifest/.test(rIdx) && /manifest\.webmanifest/.test(dIdx));
report('New website versions reach installed apps by themselves (a new deploy triggers an update prompt)', /webNew/.test(rd('rider/next/js/app.js')) && /BUILD_ID/.test(rd('server.js')));

console.log('\n--- The admin panel');
const adm = rd('admin/index.html'), ash = rd('admin/ash.css');
report('No test simulator link, and the sidebar opens the NEW apps', !/Master Simulator/.test(adm) && /href="\.\.\/rider\/next\/"/.test(adm) && /href="\.\.\/driver\/next\/"/.test(adm));
report('Rider ads, driver ads, earnings, messages, audit trail, users and overview all exist', ['ads-rider', 'ads-driver', 'earnings', 'messages', 'audit', 'users', 'overview'].every((t) => new RegExp(`id="tab-${t}"`).test(adm) && new RegExp(`id="tab-btn-${t}"`).test(adm)));
report('Names typed by people cannot run code in the admin page (no raw names inside click handlers)', !/onclick="[a-zA-Z]+\('\$\{d\.id\}', '\$\{d\.name\}'\)"/.test(adm) && /data-name="\$\{escapeHtml\(d\.name/.test(adm));
report('Menu numbers refresh by themselves every 20 seconds', /setInterval\(refreshBadges, 20000\)/.test(adm) && /id="badge-drivers"/.test(adm));
report('Dark buttons have white text in the ash theme', /button\[class\*="bg-primary"\]:not/.test(ash));
report('Test-only routes are blocked in production, and the seed script refuses to run there', /Reset endpoint disabled in production/.test(rd('routes/dev.js')) && /Refusing to run seed/.test(rd('prisma/seed.js')));

console.log(`\n   LAUNCH PACKAGE RESULTS: ${passed}/${total} TESTS PASSED`);
process.exit(passed === total ? 0 : 1);
