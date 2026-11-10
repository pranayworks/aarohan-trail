// ============================================================================
// Android app helpers (shared by the rider app and the Captain app).
// The Android widget and the app-icon shortcuts open the app with one short word in window.__aarohanGo:
//   rider:  ride, parcel        driver: online, earnings
// This opens the matching screen once the person is signed in and on the Home screen. In a normal browser nothing happens.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, lastStamp = null, tries = 0;

  function ready() { return AR.nav && AR.nav.activeTab && AR.state && AR.state.profile && !(AR.nav.stack && AR.nav.stack.length); }

  function act(go) {
    var isDriver = !!(AR.D && AR.D.app !== undefined);
    if (go === 'ride' && !isDriver) { AR.newTrip('RIDE'); AR.nav.go('search', { field: 'dest' }); return true; }
    if (go === 'parcel' && !isDriver) { AR.newTrip('PARCEL'); AR.nav.go('parcel'); return true; }
    if (go === 'earnings' && isDriver) { AR.nav.resetTo('earnings'); return true; }
    if (go === 'online' && isDriver) { AR.nav.resetTo('home'); AR.toast('Tap "Go online" when you are ready.'); return true; } // never goes online by itself
    return true; // an unknown word is simply ignored
  }


  // ---- Push notifications in the RIDER app (the Captain app has its own code in driver/capacitor-bridge.js)
  // Android 13 and newer asks the person for permission. We explain why first, and never ask twice if they say "Not now".
  async function setupPush() {
    var C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform() || (AR.D && AR.D.app !== undefined)) return;
    // Push needs the Firebase files inside the app. Without them Android closes the app, so it stays off until PUSH_ENABLED=true.
    if (!(AR.state && AR.state.cfg && AR.state.cfg.pushEnabled)) return;
    var P = C.Plugins && C.Plugins.PushNotifications; if (!P) return;
    var asked = ''; try { asked = localStorage.getItem('aarohan_push_asked') || ''; } catch (_) {}
    async function register() {
      try {
        P.addListener('registration', function (t) { AR.api('/me/device-token', { method: 'POST', body: { token: t.value, platform: 'ANDROID' } }).catch(function () {}); });
        P.addListener('pushNotificationActionPerformed', function () { try { AR.nav.resetTo('home'); } catch (_) {} });
        await P.register();
      } catch (_) { /* notifications are optional */ }
    }
    try {
      var perm = await P.checkPermissions();
      if (perm.receive === 'granted') return register();
      if (perm.receive === 'denied' || asked === 'no') return;
      AR.sheet.open({ html: '<h2>Know when your captain arrives</h2><p class="dim">Allow notifications so we can tell you when a captain accepts your ride and when they arrive. We will never spam you.</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="pn-yes">Allow notifications</button><button class="btn btn-ghost" style="width:100%" id="pn-no">Not now</button></div>',
        onOpen: function (c) {
          AR.$('#pn-yes', c.el).addEventListener('click', async function () { c.close(); try { localStorage.setItem('aarohan_push_asked', 'yes'); } catch (_) {} var r = await P.requestPermissions(); if (r.receive === 'granted') register(); });
          AR.$('#pn-no', c.el).addEventListener('click', function () { c.close(); try { localStorage.setItem('aarohan_push_asked', 'no'); } catch (_) {} });
        } });
    } catch (_) { /* not available */ }
  }
  var pushTimer = setInterval(function () { if (ready()) { clearInterval(pushTimer); setupPush(); } }, 3000);

  setInterval(function () {
    var go = window.__aarohanGo, stamp = window.__aarohanGoStamp;
    if (!go || stamp === lastStamp) return;
    if (!ready()) { if (++tries > 40) { lastStamp = stamp; tries = 0; } return; } // wait for sign-in and the Home screen, then give up after about 40 seconds
    lastStamp = stamp; tries = 0;
    try { act(go); } catch (_) { /* never break the app */ }
  }, 1000);
})();
