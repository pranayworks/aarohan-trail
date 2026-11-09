// ============================================================================
// Aarohan Captain: Home (map, go online, incoming offers).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  function km(a, b) { var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r, x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2); return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
  AR.D.km = km;

  // How long the driver was online today (kept on the phone, resets each day).
  var dayKey = function () { return 'aarohan_drv_online_' + new Date().toISOString().slice(0, 10); };
  AR.D.markOnline = function (on) {
    try { var base = parseInt(localStorage.getItem(dayKey()) || '0', 10); if (on) { AR.D._since = AR.D._since || Date.now(); } else if (AR.D._since) { localStorage.setItem(dayKey(), String(base + Date.now() - AR.D._since)); AR.D._since = 0; } } catch (_) {}
  };
  AR.D.onlineMs = function () { var base = 0; try { base = parseInt(localStorage.getItem(dayKey()) || '0', 10); } catch (_) {} return base + (AR.D.online && AR.D._since ? Date.now() - AR.D._since : 0); };
  AR.D.setOnline = function (on) {
    return new Promise(function (resolve) {
      var s = AR.store() && AR.store().socket;
      if (!s || !(AR.store().isRealtimeConnected)) return resolve({ success: false, error: 'Connecting to Aarohan. Try again in a moment.' });
      s.timeout(8000).emit('driver:set_status', { status: on ? 'ONLINE' : 'OFFLINE' }, function (err, res) {
        if (err || !res) return resolve({ success: false, error: 'No answer from Aarohan. Check your signal.' });
        if (res.success) { AR.D.online = on; if (on) { AR.D.startGps(); AR.D.markOnline(true); } else { AR.D.stopGps(); AR.D.markOnline(false); } }
        resolve(res);
      });
    });
  };

  AR.register('home', {
    mount: function (el) {
      el.innerHTML = '<div class="map-wrap" id="wrap"><div class="map" id="dmap"></div></div>' +
        '<button class="near-chip hide" id="busy" style="position:absolute;left:16px;top:calc(78px + var(--safe-top));z-index:450;background:var(--glass)"><i></i><span>Busy areas</span></button>' +
        '<div class="home-top"><div class="pickup-card" style="cursor:default"><span class="state-dot" id="dot"></span><span class="grow"><div class="p-k" id="sk">Status</div><div class="p-v" id="sv">Offline</div></span></div><button class="icon-btn" id="bell" aria-label="Notifications" style="width:50px;height:50px;background:var(--glass)">' + AR.icon('bell', 22) + '</button></div>' +
        '<div class="home-sheet"><button class="icon-btn" id="loc" aria-label="My location" style="position:absolute;right:16px;top:-64px;width:48px;height:48px;background:var(--glass)">' + AR.icon('locate', 22) + '</button><div class="sheet-handle" style="margin-bottom:14px"></div><div class="hstack" style="justify-content:space-between;margin:0 2px 10px;gap:8px"><div class="dim small" id="greet"></div><div class="near-chip" id="ontime"><i></i><span>Online 0 min today</span></div></div><button class="nudge hide" id="cmeter" style="margin:0 0 12px">' + AR.icon('wallet', 22) + '<span class="grow"><b id="cm-t"></b><div class="progress" style="margin-top:8px"><i id="cm-b" style="width:0"></i></div></span>' + AR.icon('chevronRight', 18) + '</button><button class="nudge hide" id="expiry" style="margin:0 0 12px">' + AR.icon('warning', 22) + '<span class="grow"><b id="exp-t"></b><span id="exp-s"></span></span>' + AR.icon('chevronRight', 18) + '</button><div class="stats" style="margin:0 0 12px"><div class="stat"><b id="s-trips">0</b><span>Trips today</span></div><div class="stat"><b id="s-earn">MK 0</b><span>Earned today</span></div><div class="stat"><b id="s-rate">5.0</b><span>Rating</span></div></div>' +
        '<button class="go-btn off" id="go">' + AR.icon('route', 24) + '<span id="golabel">Go online</span></button><div class="center small dim mt12" id="hint">You will not get trips while you are offline.</div><button class="btn btn-ghost btn-sm hide" id="brk" style="width:100%">Take a break</button><button class="btn btn-ghost btn-sm hide" id="why" style="width:100%;margin-top:4px">Not getting trips? Check my setup</button>' +
        '<button class="nudge" id="inc" style="margin-top:14px">' + AR.icon('star', 22) + '<span class="grow"><b id="inc-t">Daily goals</b><span id="inc-s">See today\'s trip goals and bonuses</span></span>' + AR.icon('chevronRight', 18) + '</button><div class="hide" id="ad-slot" style="margin-top:12px"></div><div class="made-in center">Made in India</div></div>';
      var map = AR.map.create(AR.$('#dmap', el), { center: AR.D.coords || AR.map.LILONGWE, zoom: 15 }), me = null;
      function paint() {
        var on = AR.D.online, left = AR.D.breakUntil ? AR.D.breakUntil - Date.now() : 0; AR.$('#dot', el).classList.toggle('on', on); AR.$('#sv', el).textContent = on ? 'You are online' : (left > 0 ? 'On a break · ' + Math.floor(left / 60000) + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0') : 'Offline'); AR.$('#sk', el).textContent = on ? 'Waiting for trips' : (left > 0 ? 'Back online when it ends' : 'Status'); AR.$('#brk', el).classList.toggle('hide', !on);
        var go = AR.$('#go', el); go.className = 'go-btn ' + (on ? 'on' : 'off'); AR.$('#golabel', el).textContent = on ? 'Go offline' : 'Go online'; AR.$('#hint', el).textContent = on ? 'Stay on this screen. New trips appear here.' : 'You will not get trips while you are offline.'; AR.$('#why', el).classList.toggle('hide', !on);
      }
      AR.D.onMove = function (c) { if (!me) me = AR.map.marker(map, c, 'me'); else me.setLatLng([c.lat, c.lng]); if (!AR.D._centered) { AR.D._centered = true; map.setView([c.lat, c.lng], 16); } };
      AR.D.onGpsError = function () { AR.toast('Turn on location so riders can find you.', 'gold'); };
      AR.map.locate().then(function (g) { AR.map.offerTest(g); AR.map.guardMalawi(g); if (g.ok) { AR.D.coords = g; AR.D.onMove(g); } });
      AR.$('#loc', el).addEventListener('click', async function () { var g = await AR.map.locate(); if (g.ok) { map.setView([g.lat, g.lng], 16); AR.D.coords = g; AR.D.onMove(g); } else AR.toast('Could not find your location.', 'gold'); });
      AR.$('#bell', el).addEventListener('click', function () { AR.nav.go('notifications'); });
      AR.$('#inc', el).addEventListener('click', function () { AR.nav.go('incentives'); });
      AR.$('#why', el).addEventListener('click', async function () {
        var ctl = AR.sheet.open({ html: '<h2>Checking your setup</h2><div class="skeleton sk-row mt16"></div><div class="skeleton sk-row"></div>' });
        try {
          var r = await AR.api('/driver/readiness');
          ctl.el.innerHTML = '<h2>' + (r.allOk ? 'Your setup looks good' : 'Something needs fixing') + '</h2><div class="list mt16">' + r.checks.map(function (c) { return '<div class="row" style="min-height:56px"><span class="r-ic ' + (c.ok ? '' : 'gold') + '">' + AR.icon(c.ok ? 'check' : 'warning', 20) + '</span><span class="grow"><div class="r-title" style="font-size:15px;font-weight:600">' + AR.esc(c.text) + '</div></span></div>'; }).join('') + '</div>' + (r.tip ? '<div class="suggest mt16">' + AR.icon('info', 20) + '<span>' + AR.esc(r.tip) + (r.allOk ? ' Also make sure the rider is near you.' : '') + '</span></div>' : '') + '<button class="btn btn-gold mt16" id="ok">OK</button>';
          AR.$('#ok', ctl.el).addEventListener('click', function () { ctl.close(); });
        } catch (e) { ctl.el.innerHTML = '<h2>Could not check</h2><p class="dim">' + AR.esc(e.message) + '</p>'; }
      });
      var go = AR.$('#go', el);
      go.addEventListener('click', async function () {
        if (go.classList.contains('is-loading')) return;
        go.classList.add('is-loading');
        AR.$('#golabel', el).textContent = AR.D.online ? 'Going offline...' : 'Going online...';
        if (!AR.D.online) { var g = await Promise.race([AR.map.locate(), new Promise(function (ok) { setTimeout(function () { ok({ ok: true, slow: true }); }, 2500); })]); if (!g.ok) { go.classList.remove('is-loading'); paint(); return AR.toast('Turn on location to go online.', 'gold'); } }
        var r = await AR.D.setOnline(!AR.D.online); go.classList.remove('is-loading'); AR.haptic(15);
        if (!r.success) { AR.sheet.open({ html: '<h2>You cannot go online yet</h2><p class="dim">' + AR.esc(r.error || 'Something went wrong.') + '</p>' + (/commission/i.test(r.error || '') ? '<button class="btn btn-gold mt24" id="pay">Pay commission</button>' : '<button class="btn btn-line mt24" id="ok">OK</button>'), onOpen: function (c) { var p = AR.$('#pay', c.el); if (p) p.addEventListener('click', function () { c.close(); AR.nav.tab('earnings'); }); var o = AR.$('#ok', c.el); if (o) o.addEventListener('click', function () { c.close(); }); } }); }
        paint();
      });

      function stats() {
        AR.loadTrips(false).then(function (list) {
          var t0 = AR.D.dayStart(), today = list.filter(function (t) { return t.done && new Date(t.when) >= t0; });
          AR.$('#s-trips', el).textContent = today.length; AR.$('#s-earn', el).textContent = AR.fmt.money(today.reduce(function (a, t) { return a + (t.fare || 0); }, 0));
        }).catch(function () {});
        if (AR.D.app) AR.$('#s-rate', el).textContent = Number(AR.D.app.rating || 5).toFixed(1);
        AR.api('/driver/incentives').then(function (d) {
          if (!d.enabled) { AR.$('#inc', el).classList.add('hide'); return; }
          var n = d.next; AR.$('#inc-t', el).textContent = n ? d.today + ' of ' + n.trips + ' trips today' : 'All of today\'s goals reached';
          AR.$('#inc-s', el).textContent = n ? (n.remaining + ' more for ' + (n.bonusMWK ? AR.fmt.money(n.bonusMWK) + ' bonus' : 'the next goal')) : 'Great work today.';
        }).catch(function () {});
      }
      // ---- busy areas: where riders asked for rides in the last hour
      var hotLayers = [], hotBounds = null;
      async function loadHot() {
        try {
          var r = await AR.api('/driver/hotspots'), chip = AR.$('#busy', el); if (!chip) return;
          hotLayers.forEach(function (l) { try { map.removeLayer(l); } catch (_) {} }); hotLayers = [];
          if (!r.areas.length) { chip.classList.add('hide'); return; }
          var max = Math.max.apply(null, r.areas.map(function (a) { return a.count; }));
          r.areas.forEach(function (a) { hotLayers.push(L.circle([a.lat, a.lng], { radius: 650, color: AR.css('--route'), weight: 1, fillColor: AR.css('--route'), fillOpacity: 0.08 + 0.22 * (a.count / max), interactive: false }).addTo(map)); });
          hotBounds = L.latLngBounds(r.areas.map(function (a) { return [a.lat, a.lng]; }));
          AR.$('span', chip).textContent = 'Busy now: ' + r.areas.length + (r.areas.length === 1 ? ' area' : ' areas'); chip.classList.remove('hide');
        } catch (_) { var c = AR.$('#busy', el); if (c) c.classList.add('hide'); }
      }
      AR.$('#busy', el).addEventListener('click', function () { if (hotBounds) map.fitBounds(hotBounds, { padding: [60, 60], maxZoom: 15 }); });
      // ---- a reminder when a document is about to expire
      function checkExpiry() {
        var k = AR.D.app && AR.D.app.kyc, box = AR.$('#expiry', el); if (!k) return box.classList.add('hide');
        var list = [['Driving licence', k.licenseExpiry], ['Vehicle registration', k.registrationExpiry], ['Insurance', k.insuranceExpiry], ['Certificate of fitness', k.fitnessExpiry]].filter(function (x) { return x[1]; }).map(function (x) { return { n: x[0], d: Math.ceil((new Date(x[1]) - Date.now()) / 86400000) }; }).filter(function (x) { return x.d <= 30; }).sort(function (a, b) { return a.d - b.d; });
        if (!list.length) return box.classList.add('hide');
        AR.$('#exp-t', el).textContent = list[0].n + (list[0].d < 0 ? ' has expired' : ' expires in ' + list[0].d + (list[0].d === 1 ? ' day' : ' days'));
        AR.$('#exp-s', el).textContent = 'Renew it so you can keep driving. Tap to see your documents.'; box.classList.remove('hide');
      }
      AR.$('#expiry', el).addEventListener('click', function () { AR.nav.go('d-docs'); });
      // ---- take a break
      AR.$('#brk', el).addEventListener('click', function () {
        AR.sheet.open({ html: '<h2>Take a break</h2><p class="dim small">You go offline now and we remind you when the time is up.</p><div class="stack gap12 mt16">' + [15, 30, 60].map(function (m) { return '<button class="btn btn-line" data-m="' + m + '">' + m + ' minutes</button>'; }).join('') + '</div>', onOpen: function (c) { AR.$$('[data-m]', c.el).forEach(function (b) { b.addEventListener('click', function () { c.close(); AR.D.startBreak(+b.dataset.m); }); }); } });
      });
      AR.D.onBreakTick = function () { if (AR.nav.activeTab === 'home' && !AR.D.online) paint(); };
      var hotTimer = setInterval(loadHot, 60000);
      var first = (AR.state.profile && AR.state.profile.name || '').split(' ')[0] || 'Captain';
      function greet() { var h = new Date().getHours(); AR.$('#greet', el).textContent = (h >= 5 && h < 12 ? 'Good morning' : (h < 17 && h >= 12 ? 'Good afternoon' : (h >= 17 && h < 21 ? 'Good evening' : 'Hello'))) + ', ' + first; var m = Math.floor(AR.D.onlineMs() / 60000); AR.$('#ontime span', el).textContent = 'Online ' + (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min') + ' today'; AR.$('#ontime', el).classList.toggle('none', !AR.D.online); }
      AR.ads.mount(AR.$('#ad-slot', el), 'DRIVER');
      var gTimer = setInterval(greet, 30000);
      AR.$('#cmeter', el).addEventListener('click', function () { AR.nav.go('commission'); });
      async function loadMeter() {
        try {
          var c = await AR.api('/driver/commission'), box = AR.$('#cmeter', el), pct = Math.min(100, Math.round(c.debtMWK / c.limitMWK * 100));
          if (c.debtMWK <= 0) { box.classList.add('hide'); return; }
          AR.$('#cm-t', el).textContent = 'Commission owed: ' + AR.fmt.money(c.debtMWK) + ' of ' + AR.fmt.money(c.limitMWK) + (c.level === 'OK' ? '' : (c.level === 'BLOCKED' ? ' · pay to get orders' : ' · pay soon'));
          AR.$('#cm-b', el).style.width = pct + '%'; box.classList.remove('hide');
        } catch (_) { AR.$('#cmeter', el).classList.add('hide'); }
      }
      paint(); stats(); loadHot(); checkExpiry(); greet(); loadMeter();
      return { show: function () { map.invalidateSize(); paint(); stats(); loadHot(); checkExpiry(); greet(); loadMeter(); }, destroy: function () { clearInterval(gTimer); clearInterval(hotTimer); AR.D.onBreakTick = null; try { map.remove(); } catch (_) {} } };
    }
  });
  AR.D.dayStart = function () { var n = new Date(Date.now() + 2 * 3600000); n.setUTCHours(0, 0, 0, 0); return new Date(n.getTime() - 2 * 3600000); };

  // ------------------------------------------------------- incoming offers
  var current = null;
  AR.D.showOffer = function (payload) {
    var t = payload && payload.trip, o = payload && payload.offer; if (!t || !o) return;
    if (current) current.remove();
    var parcel = t.serviceType === 'PARCEL', expires = new Date(o.expiresAt).getTime(), total = Math.max(5000, expires - Date.now());
    var away = AR.D.coords && t.pickupLat != null ? km(AR.D.coords, { lat: t.pickupLat, lng: t.pickupLng }) : null;
    var box = AR.el('<div class="offer" role="alertdialog"><div class="hstack" style="justify-content:space-between"><div><div class="small dim" style="font-weight:600">' + (parcel ? 'Parcel delivery' : 'New ride') + '</div><div class="fare">' + AR.fmt.money(t.driverShareMWK != null ? t.driverShareMWK : t.fareMWK) + '</div><div class="tiny dim">your earnings · paid in cash</div></div>' +
      '<div class="timer-ring"><svg width="54" height="54" viewBox="0 0 54 54"><circle cx="27" cy="27" r="23" fill="none" stroke="var(--surface-3)" stroke-width="5"/><circle id="ring" cx="27" cy="27" r="23" fill="none" stroke="var(--gold-400)" stroke-width="5" stroke-linecap="round" stroke-dasharray="144.5" stroke-dashoffset="0"/></svg><b id="sec">15</b></div></div>' +
      '<div class="tc-route mt16"><div class="mini-rail"><i></i><b></b><em></em></div><div class="grow" style="min-width:0"><div class="ellipsis" style="font-weight:600">' + AR.esc(t.pickupAddress) + '</div><div class="small dim">' + (away != null ? AR.fmt.km(away) + ' from you' : 'Pickup') + '</div><div class="ellipsis" style="margin-top:8px;font-weight:600">' + AR.esc(t.dropoffAddress) + '</div><div class="small dim">' + (t.distanceKm ? AR.fmt.km(t.distanceKm) + ' trip' : '') + (t.stopCount ? ' · ' + t.stopCount + (t.stopCount > 1 ? ' stops' : ' stop') : '') + '</div></div></div>' +
      (t.pickupNote ? '<div class="suggest mt12" style="padding:10px 12px">' + AR.icon('pin', 18) + '<span>' + AR.esc(t.pickupNote) + '</span></div>' : '') +
      '<div class="hstack gap12 mt16"><button class="btn btn-line" id="no" style="flex:1">Decline</button><button class="btn btn-gold" id="yes" style="flex:2">Accept</button></div></div>');
    AR.$('#app').appendChild(box); current = box; AR.haptic([40, 60, 40, 60, 40]);
    var ring = AR.$('#ring', box), sec = AR.$('#sec', box);
    function close() { clearInterval(tick); box.remove(); if (current === box) current = null; }
    var tick = setInterval(function () { var left = expires - Date.now(); if (left <= 0) { close(); return AR.toast('That offer expired.'); } sec.textContent = Math.ceil(left / 1000); ring.style.strokeDashoffset = String(144.5 * (1 - left / total)); }, 250);
    AR.$('#no', box).addEventListener('click', function () { AR.store().declineTrip(t.id); close(); });
    AR.$('#yes', box).addEventListener('click', function () {
      var b = this; b.classList.add('is-loading');
      AR.store().acceptTrip(t.id, function (res) {
        b.classList.remove('is-loading');
        if (res && res.success) { close(); AR.D.trip = Object.assign({}, t, res.trip || {}); AR.haptic(30); AR.nav.go('drive', {}, { anim: 'fade' }); }
        else { close(); AR.toast((res && res.error) || 'Could not accept this trip.', 'gold'); }
      });
    });
  };
})();
