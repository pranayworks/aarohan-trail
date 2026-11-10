// ============================================================================
// Aarohan Captain: session, routing after sign-in, live-event helpers, trip history helpers.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  AR.VERSION = '1.0.0'; // bump with every Play Store release
  AR.state.hideReferral = true;
  AR.D = { app: null, driverId: null, online: false, coords: null };
  // The moment an admin approves this driver, the server tells the app. (Also re-checked every 5 seconds.)
  function onStatus(p) { if (p && p.approvalStatus === 'APPROVED' && !(AR.D.app && AR.D.app.approvalStatus === 'APPROVED' && AR.nav.tabs.home)) AR.D.approved(); }
  AR.D.wireApproval = function () { AR.onSocket('driver:status_changed', onStatus); };

  AR.store = function () { return window.mwendoStore; };
  AR.onSocket = function (event, fn) {
    var tries = 0;
    (function attach() {
      var s = AR.store() && AR.store().socket;
      if (s) { s.off(event, fn); s.on(event, fn); return; }
      if (tries++ < 50) setTimeout(attach, 300);
    })();
  };

  // ---------------------------------------------------------------- updates
  var firstBuild = null, shown = false;
  AR.checkUpdate = async function () {
    try {
      var r = await fetch('/api/app-version?app=driver&version=' + encodeURIComponent(AR.VERSION), { cache: 'no-store' }).then(function (x) { return x.json(); });
      var webNew = r.build && firstBuild && r.build !== firstBuild; if (!firstBuild) firstBuild = r.build;
      if (shown || !(r.forced || r.updateAvailable || webNew)) return;
      var seen = ''; try { seen = localStorage.getItem('aarohan_drv_update_seen') || ''; } catch (_) {}
      if (!r.forced && !webNew && seen === r.latest) return;
      shown = true;
      AR.sheet.open({
        dismissable: !r.forced, onClose: function () { shown = false; try { localStorage.setItem('aarohan_drv_update_seen', r.latest); } catch (_) {} },
        html: '<h2>' + (r.forced ? 'Please update Aarohan Captain' : 'A new version is ready') + '</h2><p class="dim">' + AR.esc(r.forced ? 'This version is too old to keep working. Update to continue.' : r.message) + '</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="upd">' + (r.storeUrl && !webNew ? 'Update on Google Play' : 'Refresh now') + '</button>' + (r.forced ? '' : '<button class="btn btn-ghost" style="width:100%" id="later">Not now</button>') + '</div>',
        onOpen: function (c) { AR.$('#upd', c.el).addEventListener('click', function () { if (r.storeUrl && !webNew) window.open(r.storeUrl, '_blank'); else location.reload(); }); var l = AR.$('#later', c.el); if (l) l.addEventListener('click', function () { c.close(); }); }
      });
    } catch (_) {}
  };

  // ---------------------------------------------------------------- session
  AR.session = {
    async refresh() {
      try { var d = await AR.api('/me'); AR.state.profile = d.profile; AR.state.degraded = false; return d.profile; }
      catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        var u = (window.aarohanAuth && window.aarohanAuth.getUser()) || {};
        AR.state.profile = Object.assign({ name: u.name, phone: u.phone, email: u.email, savedPlaces: [], emergencyContacts: [] }, AR.state.profile || {}); AR.state.degraded = true; return AR.state.profile;
      }
    },
    // After sign-in, or on app open: decide which screen this person should see.
    async start() {
      await AR.session.refresh();
      var app = document.getElementById('app');
      AR.nav.stack.forEach(function (e) { try { if (e.inst && e.inst.destroy) e.inst.destroy(); } catch (_) {} try { e.el.remove(); } catch (_) {} }); // stop each screen's timers, or an old poll resets the app again
      app.innerHTML = ''; AR.nav.stack = []; AR.nav.tabs = {}; AR.nav.activeTab = null; if (AR.nav.tabbar) { AR.nav.tabbar.remove(); AR.nav.tabbar = null; }
      var a = null;
      try { a = (await AR.api('/driver/application')).application; }
      catch (e) {
        // Only a real "you have not applied" answer means start from the beginning. Anything else (server
        // not updated, no signal) must not wipe the person's progress or send them back to step 1.
        if (e.status === 404 && e.data && e.data.error) a = null;
        else return AR.nav.go('retry', { message: e.message }, { anim: 'fade' });
      }
      AR.D.app = a; AR.D.driverId = a ? a.driverId : null;
      // Reopening the app must show the truth: if the server still has this driver online, show online.
      if (a && a.approvalStatus === 'APPROVED') { AR.D.online = a.availability === 'ONLINE' || a.availability === 'BUSY'; if (AR.D.online) AR.D.startGps(); }
      if (!a) return AR.nav.go('apply', {}, { anim: 'fade' });
      if (a.approvalStatus === 'SUSPENDED') return AR.nav.go('suspended', {}, { anim: 'fade' });
      if (a.approvalStatus === 'APPROVED') return AR.session.enterApp();
      AR.D.wireApproval();
      if (a.submitted && a.approvalStatus === 'PENDING') return AR.nav.go('pending', {}, { anim: 'fade' });
      return AR.nav.go('apply', {}, { anim: 'fade' });
    },
    enterApp() {
      AR.nav.mountTabbar([['home', 'home', 'Home'], ['earnings', 'wallet', 'Earnings'], ['trips', 'activity', 'Trips'], ['account', 'user', 'Account']]);
      AR.nav.tab('home', true);
      setTimeout(function () { if (AR.loadTrips) AR.loadTrips(false).catch(function () {}); }, 1500);
      if (AR.D.resume) AR.D.resume();
    },
    async signOut() {
      var ok = await AR.confirm({ title: 'Log out?', body: AR.D.online ? 'You are online. Logging out will take you offline.' : 'You will need to sign in again with a new code.', yes: 'Log out', no: 'Stay signed in' });
      if (!ok) return;
      try { var s = AR.store() && AR.store().socket; if (s && AR.D.online) s.emit('driver:set_status', { status: 'OFFLINE' }); } catch (_) {}
      try { var rt = localStorage.getItem('aarohan_refresh_token'); if (rt) await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }); } catch (_) {}
      window.aarohanAuth.clearSession(); try { localStorage.removeItem('aarohan_trip_state'); } catch (_) {}
      location.href = '/driver/next/';
    }
  };

  // ------------------------------------------------------- trips (driver's view)
  var cache = { at: 0, list: null };
  AR.tripsCached = function () { return cache.list; };
  function view(t) {
    var done = t.status === 'COMPLETED';
    return {
      raw: t, id: t.id, isParcel: t.serviceType === 'PARCEL', tier: AR.fmt.cap(t.tier), status: t.status, done: done, cancelled: !done,
      statusLabel: done ? 'Completed' : (t.status === 'CANCELLED_BY_DRIVER' ? 'You cancelled' : (t.status === 'CANCELLED_BY_RIDER' ? 'Rider cancelled' : 'Ended')),
      from: t.pickupAddress, to: t.dropoffAddress, stops: t.stops || [], when: done ? (t.completedAt || t.createdAt) : (t.cancelledAt || t.createdAt),
      fare: t.driverShareMWK != null ? t.driverShareMWK : t.fareMWK, gross: t.fareMWK, tip: t.driverTipMWK || 0, reason: t.cancelReason || '', parcel: t.parcelDetail || null,
      given: (t.ratings && t.ratings[0] && t.ratings[0].stars) || null, tickets: t.supportTickets || []
    };
  }
  AR.driverTripView = view;
  AR.loadTrips = async function (force) {
    if (!force && cache.list && Date.now() - cache.at < 20000) return cache.list;
    var d = await AR.api('/trips/history'); cache = { at: Date.now(), list: (d.trips || []).map(view) }; return cache.list;
  };
  AR.tripCardHtml = function (tv, i) {
    return '<button class="trip-card" data-id="' + AR.esc(tv.id) + '" style="animation-delay:' + Math.min(i, 8) * 40 + 'ms"><div class="tc-top"><div class="hstack gap8"><span class="r-ic" style="width:34px;height:34px;border-radius:11px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:' + (tv.done ? 'var(--gold-300)' : 'var(--silver-500)') + '">' + AR.icon(tv.isParcel ? 'parcel' : AR.vehicleIcon(String(tv.tier).toLowerCase()), 20) + '</span><div><div style="font-weight:700">' + (tv.isParcel ? 'Parcel' : AR.esc(tv.tier)) + '</div><div class="tiny dim">' + AR.esc(AR.fmt.dateTime(tv.when)) + '</div></div></div>' +
      '<div style="text-align:right"><div class="num" style="font-weight:700;font-size:17px">' + (tv.done ? AR.fmt.money(tv.fare) : '') + '</div><span class="badge ' + (tv.done ? 'steel' : '') + '">' + AR.esc(tv.statusLabel) + '</span></div></div>' +
      '<div class="tc-route"><div class="mini-rail"><i></i><b></b><em></em></div><div class="grow" style="min-width:0"><div class="ellipsis">' + AR.esc(tv.from) + '</div><div class="ellipsis" style="margin-top:6px;font-weight:600">' + AR.esc(tv.to) + '</div></div></div></button>';
  };

  // Live location while online: only sent from a real device, every few seconds.
  var watchId = null, lastSent = 0;
  // Inside the Android app the phone keeps tracking even when the screen is off (a foreground service), and push
  // notifications wake the phone for ride offers. In a normal browser this part is skipped.
  var native = function () { return window.driverCapacitorBridge && window.driverCapacitorBridge.isNative; };
  AR.D.startGps = function () {
    if (native() && !AR.map.testOn()) {
      var st = AR.store(); window.mwendoSocket = st && st.socket;
      window.updateDriverMarkerPosition = function (lat, lng, heading) { AR.D.coords = { lat: lat, lng: lng, heading: heading || 0 }; if (AR.D.onMove) AR.D.onMove(AR.D.coords); };
      window.driverCapacitorBridge.startBackgroundGeolocation(); return;
    }
    if (AR.map.testOn()) {
      // Developer test location: report a fixed spot in Lilongwe, with a tiny drift so it looks alive.
      if (watchId != null) return;
      var tp = { lat: AR.map.TEST_POINT.lat - 0.0015, lng: AR.map.TEST_POINT.lng + 0.0012 };
      var tick = function () { AR.D.coords = { lat: tp.lat + (Math.random() - 0.5) * 0.0002, lng: tp.lng + (Math.random() - 0.5) * 0.0002, heading: 0 }; if (AR.D.onMove) AR.D.onMove(AR.D.coords); if (AR.store()) AR.store().sendDriverLocation(AR.D.coords); };
      tick(); watchId = setInterval(tick, 4000); AR.D._testTimer = true; return;
    }
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(function (p) {
      AR.D.coords = { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading || 0 };
      if (AR.D.onMove) AR.D.onMove(AR.D.coords);
      if (Date.now() - lastSent > 4000 && AR.store()) { lastSent = Date.now(); AR.store().sendDriverLocation(AR.D.coords); }
    }, function () { if (AR.D.onGpsError) AR.D.onGpsError(); }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 });
  };
  AR.D.stopGps = function () { if (native()) { try { window.driverCapacitorBridge.stopBackgroundGeolocation(); } catch (_) {} } if (watchId != null) { if (AR.D._testTimer) { clearInterval(watchId); AR.D._testTimer = false; } else if (navigator.geolocation) navigator.geolocation.clearWatch(watchId); } watchId = null; };
})();
