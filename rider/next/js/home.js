// ============================================================================
// Aarohan rider: home, destination search, and "set on map".
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;

  // The trip being planned (shared by rides and parcels).
  AR.trip = AR.trip || { pickup: null, dest: null, stops: [], quote: null, tierId: 'moto', serviceType: 'RIDE', parcel: null };
  AR.newTrip = function (serviceType) {
    var keep = AR.trip.pickup;
    var last = 'moto'; try { last = localStorage.getItem('aarohan_tier') || 'moto'; } catch (_) {}
    AR.trip = { pickup: keep, dest: null, stops: [], quote: null, tierId: serviceType === 'PARCEL' ? 'moto' : last, serviceType: serviceType || 'RIDE', parcel: null };
    return AR.trip;
  };

  // Make sure the trip has a pickup point: use where the person is, or the middle of Lilongwe if location is off.
  AR.ensurePickup = async function () {
    if (AR.trip.pickup && AR.trip.pickup.lat != null) return AR.trip.pickup;
    var g = await AR.map.locate();
    var r = await AR.map.reverse(g.lat, g.lng);
    AR.trip.pickup = { lat: g.lat, lng: g.lng, name: r.name, address: r.address };
    return AR.trip.pickup;
  };

  // Greeting that follows the real time of day.
  AR.greeting = function () {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return AR.t('morning');
    if (h >= 12 && h < 17) return AR.t('afternoon');
    if (h >= 17 && h < 21) return AR.t('evening');
    return AR.t('hello');
  };

  var placeIcon = function (p) { var l = String(p.label || p.category || '').toLowerCase(); return l === 'home' ? 'home' : (l === 'work' ? 'building' : 'pin'); };

  // ------------------------------------------------------------------- home
  AR.register('home', {
    mount: function (el) {
      var P = AR.state.profile || {};
      var first = (P.name || '').split(' ')[0] || 'there';
      el.innerHTML =
        '<div class="map-wrap" id="wrap"><div class="map" id="hmap"></div></div>' +
        '<div class="home-top"><button class="pickup-card" id="pcard" aria-label="Change pickup"><span class="p-dot"></span><span class="grow"><div class="p-k">Pickup</div><div class="p-v ellipsis" id="pname">Finding you...</div></span>' + AR.icon('chevronRight', 18, 'dim') + '</button>' +
        '<button class="icon-btn" id="bell" aria-label="Notifications" style="width:50px;height:50px;background:var(--glass)">' + AR.icon('bell', 22) + '<i class="bell-dot hide" id="bdot"></i></button></div>' +
        '<div class="home-sheet"><button class="icon-btn" id="loc" aria-label="My location" style="position:absolute;right:16px;top:-64px;width:48px;height:48px;background:var(--glass)">' + AR.icon('locate', 22) + '</button><div class="sheet-handle" style="margin-bottom:12px"></div>' +
        '<div class="hstack" style="justify-content:space-between;margin:0 2px 10px;gap:8px"><div class="dim small" id="greet"></div><div class="near-chip" id="near"><i></i><span>Checking captains...</span></div></div>' +
        '<button class="search-bar" id="where">' + AR.icon('search', 22) + '<span>' + AR.t('where_to') + '</span></button>' +
        '<div class="shortcuts" id="shortcuts"></div>' +
        '<button class="nudge hide" id="nudge">' + AR.icon('shieldCheck', 22) + '<span class="grow"><b>Add an emergency contact</b><span>Takes 20 seconds. We tell them if you press SOS.</span></span>' + AR.icon('chevronRight', 18) + '</button>' +
        '<div class="svc-row"><button class="svc" id="svc-ride"><span class="s-ic">' + AR.icon('moto', 24) + '</span><span><strong>' + AR.t('ride') + '</strong><span>Moto, Auto or Cab</span></span></button>' +
        '<button class="svc" id="svc-parcel"><span class="s-ic">' + AR.icon('parcel', 24) + '</span><span><strong>' + AR.t('parcel') + '</strong><span>Send anything</span></span></button></div>' +
        '<div class="hide" id="ad-slot"></div><div class="month-strip hide" id="month"></div><div class="made-in center">Made in India</div></div>';

      var map = AR.map.create(AR.$('#hmap', el), { center: AR.trip.pickup || AR.map.LILONGWE, zoom: 16 });
      var pin = AR.map.centerPin(AR.$('#wrap', el));
      var me = null, quiet = true, geoToken = 0;

      function paintGreeting() { AR.$('#greet', el).textContent = AR.greeting() + ', ' + first; }
      var nearToken = 0;
      async function loadNear() {
        var p = AR.trip.pickup; if (!p) return; var t = ++nearToken, chip = AR.$('#near', el); if (!chip) return;
        try {
          var d = await fetch('/api/drivers/nearby?lat=' + p.lat + '&lng=' + p.lng + '&radius=5').then(function (r) { return r.json(); });
          if (t !== nearToken) return;
          var n = d.count || 0, eta = (d.drivers || []).reduce(function (m, x) { return x.etaMinutes != null && x.etaMinutes < m ? x.etaMinutes : m; }, 99);
          chip.classList.toggle('none', n === 0);
          AR.$('span', chip).textContent = n === 0 ? 'No captains nearby right now' : n + (n === 1 ? ' captain' : ' captains') + ' nearby' + (eta < 99 ? ' · ' + Math.max(1, Math.round(eta)) + ' min' : '');
        } catch (_) { chip.classList.add('none'); AR.$('span', chip).textContent = 'Captains unavailable'; }
      }
      function paintNudge() { var pr = AR.state.profile || {}; AR.$('#nudge', el).classList.toggle('hide', AR.state.degraded || (pr.emergencyContacts || []).length > 0); }
      AR.$('#nudge', el).addEventListener('click', function () { AR.nav.go('safety'); });
      function paintPickup() { AR.$('#pname', el).textContent = (AR.trip.pickup && AR.trip.pickup.name) || 'Move the map to set pickup'; }
      var reverse = AR.debounce(async function () {
        var c = map.getCenter(); var token = ++geoToken;
        var r = await AR.map.reverse(c.lat, c.lng);
        if (token !== geoToken) return;
        AR.trip.pickup = { lat: c.lat, lng: c.lng, name: r.name, address: r.address };
        paintPickup(); loadNear(); paintShortcuts();
      }, 500);
      map.on('movestart', function () { pin.classList.add('moving'); });
      map.on('moveend', function () { pin.classList.remove('moving'); reverse(); });

      AR.ads.mount(AR.$('#ad-slot', el), 'RIDER');
      async function locate(initial) {
        var g = await AR.map.locate();
        AR.map.offerTest(g); AR.map.guardMalawi(g);
        if (g.ok) {
          if (me) map.removeLayer(me);
          me = AR.map.marker(map, g, 'me');
          map.setView([g.lat, g.lng], 16, { animate: !initial });
        } else if (initial) {
          AR.toast('Location is off. Move the map to set your pickup.');
          reverse();
        }
      }
      locate(true);
      AR.$('#loc', el).addEventListener('click', function () { locate(false); });
      AR.$('#pcard', el).addEventListener('click', function () { AR.nav.go('search', { field: 'pickup' }); });
      AR.$('#bell', el).addEventListener('click', function () { AR.nav.go('notifications'); });
      AR.$('#where', el).addEventListener('click', function () { AR.newTrip('RIDE'); AR.nav.go('search', { field: 'dest' }); });
      AR.$('#svc-ride', el).addEventListener('click', function () { AR.newTrip('RIDE'); AR.nav.go('search', { field: 'dest' }); });
      AR.$('#svc-parcel', el).addEventListener('click', function () { AR.newTrip('PARCEL'); AR.nav.go('parcel'); });

      var fareCache = {};
      async function fillFare(place, node) {
        var pk = AR.trip.pickup; if (!pk || !node) return;
        var key = [pk.lat.toFixed(3), pk.lng.toFixed(3), place.id].join('|'), hit = fareCache[key];
        if (hit && Date.now() - hit.at < 120000) { node.textContent = hit.txt; return; }
        try {
          var q = await AR.api('/rides/quote', { method: 'POST', body: { pickup: { lat: pk.lat, lng: pk.lng, name: pk.name }, destination: { lat: place.lat, lng: place.lng, name: place.name }, stops: [], serviceType: 'RIDE' } });
          var tiers = Object.keys(q.tiers || {}).map(function (k) { return q.tiers[k]; }); if (!tiers.length) return;
          var cheapest = tiers.reduce(function (m, t) { return t.finalFare < m.finalFare ? t : m; }, tiers[0]);
          var txt = 'from ' + AR.fmt.money(cheapest.finalFare) + ' · ' + Math.round(q.route.durationMins) + ' min';
          fareCache[key] = { at: Date.now(), txt: txt }; node.textContent = txt;
        } catch (_) { /* no preview, the chip still works */ }
      }
      async function paintBell() {
        try { var d = await AR.api('/me/notifications'); var seen = Number(localStorage.getItem('aarohan_notif_seen') || 0);
          var fresh = (d.notifications || []).some(function (n) { return n.id !== 'welcome' && new Date(n.at).getTime() > seen; });
          AR.$('#bdot', el).classList.toggle('hide', !fresh); } catch (_) {}
      }
      function paintMonth() {
        if (!AR.loadTrips) return;
        AR.loadTrips(false).then(function (list) {
          var now = AR.fmt.month(new Date()), m = list.filter(function (t) { return t.done && AR.fmt.month(t.when) === now; }), box = AR.$('#month', el);
          if (!box) return; if (!m.length) { box.classList.add('hide'); return; }
          var spent = m.reduce(function (a, t) { return a + (t.fare || 0); }, 0);
          box.innerHTML = '<span>' + now + '</span><b>' + m.length + (m.length === 1 ? ' trip' : ' trips') + ' · ' + AR.fmt.money(spent) + '</b>'; box.classList.remove('hide');
        }).catch(function () {});
      }
      function paintShortcuts() {
        var hidden = AR.hiddenShortcuts ? AR.hiddenShortcuts() : [];
        var places = ((AR.state.profile && AR.state.profile.savedPlaces) || []).filter(function (p) { return hidden.indexOf(p.id) === -1; });
        var host = AR.$('#shortcuts', el);
        host.innerHTML = places.slice(0, 6).map(function (p, i) {
          return '<button class="shortcut" data-i="' + i + '">' + AR.icon(placeIcon(p), 18) + '<span class="sc-t">' + AR.esc(p.label) + '<small class="sc-fare"></small></span></button>';
        }).join('') + '<button class="shortcut" data-add>' + AR.icon('plus', 18) + '<span>' + (places.length ? 'Add place' : 'Add Home or Work') + '</span></button>';
        AR.$$('[data-i]', host).forEach(function (b) {
          b.addEventListener('click', function () {
            var p = places[+b.dataset.i]; AR.newTrip('RIDE');
            AR.trip.dest = { lat: p.lat, lng: p.lng, name: p.name, address: p.address };
            AR.nav.go('options');
          });
        });
        AR.$('[data-add]', host).addEventListener('click', function () { AR.nav.go('places'); });
        // Know the price before you even open booking: cheapest fare to your first two saved places.
        places.slice(0, 2).forEach(function (p, i) { fillFare(p, AR.$('[data-i="' + i + '"] .sc-fare', host)); });
        // Places you went to recently: one tap to go there again.
        if (AR.loadTrips) AR.loadTrips(false).then(function (list) {
          var seen = {}; places.forEach(function (p) { seen[p.name] = 1; });
          var recents = list.filter(function (t) { return t.done && !t.isParcel && !seen[t.to] && (seen[t.to] = 1); }).slice(0, 3);
          var add = AR.$('[data-add]', host); if (!add) return;
          recents.forEach(function (t) {
            var b = document.createElement('button'); b.className = 'shortcut';
            b.innerHTML = AR.icon('clock', 18) + '<span class="ellipsis" style="max-width:140px">' + AR.esc(String(t.to).split(',')[0]) + '</span>';
            b.addEventListener('click', function () { AR.newTrip('RIDE'); AR.trip.dest = { lat: t.raw.dropoffLat, lng: t.raw.dropoffLng, name: t.to }; AR.nav.go('options'); });
            host.insertBefore(b, add);
          });
        }).catch(function () {});
      }
      paintShortcuts(); paintPickup(); paintGreeting(); paintNudge(); loadNear(); paintBell(); paintMonth();
      var tick = setInterval(function () { paintGreeting(); loadNear(); }, 30000);

      return {
        show: function () { map.invalidateSize(); paintShortcuts(); paintGreeting(); paintNudge(); loadNear(); paintBell(); paintMonth(); },
        destroy: function () { clearInterval(tick); try { map.remove(); } catch (_) {} },
        setCenter: function (p) { map.setView([p.lat, p.lng], 16); }
      };
    }
  });

  // ------------------------------------------------------------- search page
  // params: { field: 'dest' | 'stop' | 'pickup', index?, onSelect?(place) }
  AR.register('search', {
    mount: function (el, params) {
      var field = params.field || 'dest';
      var T = AR.trip;
      var title = params.title || (field === 'stop' ? 'Add a stop' : (field === 'pickup' ? 'Pickup location' : 'Where to?'));
      el.innerHTML =
        '<div class="search-head"><div class="hstack gap12"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1 style="font-size:20px">' + title + '</h1></div>' +
        '<div class="route-box">' + (params.hidePickup ? '' : '<div class="route-rail"><i></i><b></b><em></em></div>') + '<div class="route-fields">' +
        (params.hidePickup ? '<input type="hidden" id="f-pickup"/>' : '') + (params.hidePickup ? '' : '<input class="input" id="f-pickup" placeholder="Pickup location" value="' + AR.esc(field === 'pickup' ? '' : ((T.pickup && T.pickup.name) || '')) + '" ' + (field === 'pickup' ? '' : 'readonly') + '/>') +
        '<input class="input" id="f-main" placeholder="' + (field === 'stop' ? 'Search for a stop' : (field === 'pickup' ? 'Search for pickup' : 'Search for a place')) + '" autocomplete="off"/></div></div></div>' +
        '<div class="scroll" id="results"></div>';
      if (field !== 'pickup') AR.$('#f-pickup', el).addEventListener('click', function () { AR.nav.go('search', { field: 'pickup', onSelect: function (p) { AR.trip.pickup = p; AR.$('#f-pickup', el).value = p.name; } }); });
      var inp = AR.$('#f-main', el), box = AR.$('#results', el);
      var origin = function () { var o = AR.trip.pickup || AR.map.LILONGWE; return { lat: o.lat, lng: o.lng }; };

      async function select(p) {
        if (params.onSelect) { params.onSelect(p); AR.nav.back(); return; }
        // From the home screen: the destination is chosen, go and see the options.
        AR.trip.dest = p;
        await AR.ensurePickup();
        AR.nav.replace('options');
      }

      function rows(list) {
        return list.map(function (p, i) {
          return '<button class="result" data-k="' + i + '" style="animation-delay:' + Math.min(i, 8) * 30 + 'ms"><span class="r-ic">' + AR.icon(placeIcon(p), 18) + '</span><span class="grow"><div style="font-weight:600" class="ellipsis">' + AR.esc(p.name) + '</div><div class="small dim ellipsis">' + AR.esc(p.area || p.address || '') + '</div></span>' +
            (p.distanceKm != null ? '<span class="r-km">' + AR.fmt.km(p.distanceKm) + '</span>' : '') + '</button>';
        }).join('');
      }
      function bind(list) { AR.$$('[data-k]', box).forEach(function (b) { b.addEventListener('click', function () { select(list[+b.dataset.k]); }); }); }

      function empty() {
        var saved = ((AR.state.profile && AR.state.profile.savedPlaces) || []).map(function (p) { return { label: p.label, name: p.name, area: p.address || p.label, lat: p.lat, lng: p.lng, address: p.address }; });
        box.innerHTML = '<button class="result" data-map><span class="r-ic" style="color:var(--gold-300)">' + AR.icon('map', 18) + '</span><span class="grow"><div style="font-weight:600">Choose on the map</div><div class="small dim">Drop a pin exactly where you want</div></span>' + AR.icon('chevronRight', 18, 'faint') + '</button>' +
          (saved.length ? '<div class="section-title">Saved places</div>' + rows(saved) : '') + '<div class="section-title" id="near-title">Popular nearby</div><div id="near"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>';
        AR.$('[data-map]', box).addEventListener('click', function () {
          AR.nav.go('pick', { title: title, onPick: function (p) { setTimeout(function () { select(p); }, 120); } });
        });
        AR.$$('[data-k]', box).forEach(function (b) { b.addEventListener('click', function () { select(saved[+b.dataset.k]); }); });
        var o = origin();
        fetch('/api/places/search?q=' + encodeURIComponent('Lilongwe') + '&lat=' + o.lat + '&lng=' + o.lng).then(function (r) { return r.json(); }).then(function (list) {
          var host = AR.$('#near', box); if (!host) return;
          list = (Array.isArray(list) ? list : []).slice(0, 6);
          host.innerHTML = rows(list); bind(list);
        }).catch(function () { var h = AR.$('#near', box); if (h) h.innerHTML = '<div class="dim small" style="padding:8px 4px">Could not load places. Type to search.</div>'; });
      }

      var token = 0;
      var run = AR.debounce(async function () {
        var q = inp.value.trim();
        if (q.length < 2) return empty();
        var my = ++token;
        box.innerHTML = '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>';
        try {
          var o = origin();
          var list = await fetch('/api/places/search?q=' + encodeURIComponent(q) + '&lat=' + o.lat + '&lng=' + o.lng).then(function (r) { return r.json(); });
          if (my !== token) return;
          list = Array.isArray(list) ? list : [];
          box.innerHTML = list.length ? rows(list) : '<div class="empty">' + AR.icon('search', 36) + '<h3>No places found</h3><p>Try another name, or choose the spot on the map.</p><button class="btn btn-line mt16" data-map style="width:auto;display:inline-flex">Choose on the map</button></div>';
          bind(list);
          var mb = AR.$('[data-map]', box); if (mb) mb.addEventListener('click', function () { AR.nav.go('pick', { title: title, onPick: function (p) { setTimeout(function () { select(p); }, 120); } }); });
        } catch (e) { box.innerHTML = '<div class="empty"><h3>Search is not available</h3><p>Check your internet and try again.</p></div>'; }
      }, 260);
      inp.addEventListener('input', run);
      AR.$('[data-back]', el).addEventListener('click', function () { AR.nav.back(); });
      empty();
      setTimeout(function () { inp.focus(); }, 380);
    }
  });

  // -------------------------------------------------------------- set on map
  // params: { title, onPick(place), start? }
  AR.register('pick', {
    mount: function (el, params) {
      var start = params.start || AR.trip.pickup || AR.map.LILONGWE;
      el.innerHTML =
        '<div class="map-wrap" id="wrap"><div class="map" id="pmap"></div></div>' +
        '<div class="home-top"><button class="icon-btn" data-back aria-label="Back" style="width:50px;height:50px;background:var(--glass)">' + AR.icon('chevronLeft') + '</button></div>' +
        '<div class="home-sheet" style="padding-bottom:calc(24px + var(--safe-bottom))"><div class="sheet-handle"></div><div class="eyebrow">' + AR.esc(params.title || 'Choose location') + '</div>' +
        '<div class="hstack gap12 mt8">' + AR.icon('pin', 22, 'gold') + '<div class="grow" style="min-width:0"><div style="font-weight:700;font-size:18px" class="ellipsis" id="pk-name">Move the map</div><div class="small dim ellipsis" id="pk-addr"></div></div></div>' +
        '<button class="btn btn-gold mt16" id="pk-ok">Confirm location</button></div>';
      var map = AR.map.create(AR.$('#pmap', el), { center: start, zoom: 17 });
      var pin = AR.map.centerPin(AR.$('#wrap', el));
      var cur = null, token = 0;
      var reverse = AR.debounce(async function () {
        var c = map.getCenter(), t = ++token;
        var r = await AR.map.reverse(c.lat, c.lng);
        if (t !== token) return;
        cur = { lat: c.lat, lng: c.lng, name: r.name, address: r.address, area: r.address };
        AR.$('#pk-name', el).textContent = r.name; AR.$('#pk-addr', el).textContent = r.address;
      }, 450);
      map.on('movestart', function () { pin.classList.add('moving'); });
      map.on('moveend', function () { pin.classList.remove('moving'); reverse(); });
      reverse();
      AR.$('[data-back]', el).addEventListener('click', function () { AR.nav.back(); });
      AR.$('#pk-ok', el).addEventListener('click', function () { if (!cur) return; params.onPick(cur); AR.nav.back(); });
      return { destroy: function () { try { map.remove(); } catch (_) {} } };
    }
  });
})();
