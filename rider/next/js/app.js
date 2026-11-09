// ============================================================================
// Aarohan rider: boot and session.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;

  AR.VERSION = '1.0.0'; // bump this with every Play Store release
  AR.store = function () { return window.mwendoStore; };

  // Is there a newer version? (Play Store build, or a new web deployment.)
  var firstBuild = null, shown = false;
  async function checkUpdate() {
    try {
      var r = await fetch('/api/app-version?app=rider&version=' + encodeURIComponent(AR.VERSION), { cache: 'no-store' }).then(function (x) { return x.json(); });
      var webNew = r.build && firstBuild && r.build !== firstBuild;
      if (!firstBuild) firstBuild = r.build;
      if (shown || !(r.forced || r.updateAvailable || webNew)) return;
      var dismissed = ''; try { dismissed = localStorage.getItem('aarohan_update_seen') || ''; } catch (_) {}
      if (!r.forced && !webNew && dismissed === r.latest) return;
      shown = true;
      AR.sheet.open({
        dismissable: !r.forced,
        onClose: function () { shown = false; try { localStorage.setItem('aarohan_update_seen', r.latest); } catch (_) {} },
        html: '<h2>' + (r.forced ? 'Please update Aarohan' : 'A new version is ready') + '</h2><p class="dim">' + AR.esc(r.forced ? 'This version is too old to keep working. Update to continue.' : r.message) + '</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="upd">' + (r.storeUrl && !webNew ? 'Update on Google Play' : 'Refresh now') + '</button>' + (r.forced ? '' : '<button class="btn btn-ghost" style="width:100%" id="later">Not now</button>') + '</div>',
        onOpen: function (c) {
          AR.$('#upd', c.el).addEventListener('click', function () { if (r.storeUrl && !webNew) window.open(r.storeUrl, '_blank'); else location.reload(); });
          var l = AR.$('#later', c.el); if (l) l.addEventListener('click', function () { c.close(); });
        }
      });
    } catch (_) { /* offline: try again later */ }
  }
  AR.checkUpdate = checkUpdate;

  // Run a handler for a live-server event, even if the socket is not connected yet.
  AR.onSocket = function (event, fn) {
    var tries = 0;
    (function attach() {
      var s = AR.store() && AR.store().socket;
      if (s) { s.off(event, fn); s.on(event, fn); return; }
      if (tries++ < 50) setTimeout(attach, 300);
    })();
  };

  AR.session = {
    async refresh() {
      try {
        var d = await AR.api('/me');
        AR.state.profile = d.profile;
        AR.state.degraded = false;
        return d.profile;
      } catch (e) {
        // A real sign-out must still sign out; anything else (server updating, bad network) falls back
        // to what we already know, so the app opens instead of getting stuck.
        if (e.status === 401 || e.status === 403) throw e;
        var u = (window.aarohanAuth && window.aarohanAuth.getUser()) || {};
        AR.state.profile = Object.assign({ name: u.name, phone: u.phone, email: u.email, savedPlaces: [], emergencyContacts: [], rating: { score: 5, average: 5, ratingsCount: 0 }, memberSince: null, completedTrips: 0 }, AR.state.profile || {});
        AR.state.degraded = true;
        return AR.state.profile;
      }
    },
    async start() {
      await AR.session.refresh();
      var app = document.getElementById('app');
      AR.nav.stack.forEach(function (e) { try { e.el.remove(); } catch (_) {} });
      app.innerHTML = '';
      AR.nav.stack = []; AR.nav.tabs = {}; AR.nav.activeTab = null;
      AR.nav.mountTabbar();
      AR.nav.tab('home', true);
      // Warm the screens people open next, so tabs feel instant.
      setTimeout(function () { if (AR.loadTrips) AR.loadTrips(false).catch(function () {}); AR.api('/me/rewards').catch(function () {}); }, 1500);
      var p = AR.state.profile;
      if (!p.dateOfBirth || !p.gender || /^Passenger \d{4}$/.test(p.name || '')) setTimeout(function () { AR.nav.go('complete-profile'); }, 700);
      if (AR.ride && AR.ride.resume) AR.ride.resume();
    },
    async signOut() {
      var ok = await AR.confirm({ title: 'Log out?', body: 'You will need to sign in again with a new code.', yes: 'Log out', no: 'Stay signed in' });
      if (!ok) return;
      try { var rt = localStorage.getItem('aarohan_refresh_token'); if (rt) await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }); } catch (_) {}
      window.aarohanAuth.clearSession();
      try { localStorage.removeItem('aarohan_trip_state'); } catch (_) {}
      location.href = '/rider/next/';
    }
  };

  function showIntro() {
    document.getElementById('app').innerHTML = '';
    AR.nav.stack = [];
    var seen = false; try { seen = localStorage.getItem('aarohan_intro_seen') === '1'; } catch (_) {}
    // The "why Aarohan" slides are for the very first visit only.
    if (!AR.lang.chosen()) AR.nav.go('language', { first: true }, { anim: 'fade' });
    else AR.nav.go(seen ? 'auth' : 'intro', {}, { anim: 'fade' });
  }

  async function boot() {
    var mk = document.getElementById('splash-mark'); if (mk) mk.innerHTML = AR.mark(84);
    window.showToast = AR.toast;
    // icons for the shared chat screen
    var cc = document.getElementById('chat-close-btn'); if (cc) cc.innerHTML = AR.icon('close', 20);
    var cs = document.getElementById('chat-send-btn'); if (cs) cs.innerHTML = AR.icon('send', 20);

    var off = document.createElement('div'); off.id = 'offline'; off.className = 'hide'; off.textContent = 'You are offline. Some things will not work until you reconnect.'; document.body.appendChild(off);
    var sync = function () { off.classList.toggle('hide', navigator.onLine !== false); };
    window.addEventListener('online', sync); window.addEventListener('offline', sync); sync();
    var cfg = {};
    try { cfg = await fetch('/api/app-config').then(function (r) { return r.json(); }); } catch (_) {}
    AR.state.cfg = cfg; AR.state.authMode = cfg.authMode === 'email' ? 'email' : 'phone';

    var started = false;
    // The shared auth helper holds every request until the app says the session is ready.
    if (window.aarohanAuth) window.aarohanAuth.setReady(window.aarohanAuth.getUser());
    if (window.aarohanAuth && window.aarohanAuth.isAuthenticated()) {
      try { await AR.session.start(); started = true; }
      catch (e) { if (e.status === 401 || e.status === 403) window.aarohanAuth.clearSession(); else AR.toast('Could not reach Aarohan. Check your internet.', 'gold'); }
    }
    if (!started) showIntro();
    await AR.sleep(500);
    document.getElementById('splash').classList.add('gone');
    checkUpdate(); setInterval(checkUpdate, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkUpdate(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
// Installable: lets the phone offer "Add to home screen" (the worker caches nothing).
if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {}); });
