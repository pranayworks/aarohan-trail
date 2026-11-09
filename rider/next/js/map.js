// ============================================================================
// Aarohan rider: map helper (dark tiles, markers, routes, fixed centre pin).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  var LILONGWE = { lat: -13.9626, lng: 33.7873 };
  var cfgPromise = null;

  function config() {
    if (!cfgPromise) cfgPromise = fetch('/api/map-config').then(function (r) { return r.json(); }).catch(function () { return {}; });
    return cfgPromise;
  }

  function tileLayer(cfg) {
    var token = (cfg && (cfg.mapboxToken || (cfg.provider === 'mapbox' ? cfg.apiKey : ''))) || '';
    var light = true;
    var low = document.documentElement.hasAttribute('data-lowdata'); // smaller map tiles, less data
    if (token) {
      return L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/' + (light ? 'light-v11' : 'dark-v11') + (low ? '/tiles/256/{z}/{x}/{y}?access_token=' : '/tiles/512/{z}/{x}/{y}@2x?access_token=') + token, { maxZoom: 19, tileSize: low ? 256 : 512, zoomOffset: low ? 0 : -1, attribution: '© Mapbox © OpenStreetMap' });
    }
    return L.tileLayer('https://{s}.basemaps.cartocdn.com/' + (light ? 'light_all' : 'dark_all') + '/{z}/{x}/{y}' + (low ? '' : '{r}') + '.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' });
  }

  var ALL = [];
  AR.map = {
    LILONGWE: LILONGWE,
    // Swap every open map to the tiles for the current theme.
    retile: function () { config().then(function (cfg) { ALL.forEach(function (e) { try { if (e.tile) e.map.removeLayer(e.tile); e.tile = tileLayer(cfg).addTo(e.map); e.tile.bringToBack(); } catch (_) {} }); }); },

    // Creates a map inside `el`. Returns the Leaflet map.
    create: function (el, opts) {
      opts = opts || {};
      var c = opts.center || LILONGWE;
      var map = L.map(el, { zoomControl: false, attributionControl: false, zoomSnap: 0.5, tap: true }).setView([c.lat, c.lng], opts.zoom || 15);
      var credit = document.createElement('div'); credit.className = 'map-credit'; (el.parentElement || el).appendChild(credit);
      var entry = { map: map, tile: null, credit: credit };
      ALL.push(entry);
      map.on('unload', function () { var i = ALL.indexOf(entry); if (i !== -1) ALL.splice(i, 1); });
      config().then(function (cfg) {
        entry.tile = tileLayer(cfg).addTo(map);
        credit.textContent = (entry.tile.options.attribution || '').replace(/&copy;/g, '©');
      });
      setTimeout(function () { map.invalidateSize(); }, 60);
      return map;
    },

    icon: function (kind, extra) {
      var html = kind === 'me' ? '<div class="dot-me"></div>' : '<div class="marker ' + kind + '">' + (extra || '') + '</div>';
      var size = kind === 'me' ? 18 : (kind === 'vehicle' ? 40 : 22);
      return L.divIcon({ className: '', html: html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    },
    marker: function (map, ll, kind, extra) { return L.marker([ll.lat, ll.lng], { icon: AR.map.icon(kind, extra), interactive: false }).addTo(map); },

    // Draws a route given [[lat,lng], ...]. Returns the polyline.
    route: function (map, coords, fit) {
      var line = L.polyline(coords, { color: AR.css('--route'), weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      L.polyline(coords, { color: AR.css('--route-under'), weight: 9, opacity: 1, lineCap: 'round' }).addTo(map).bringToBack();
      if (fit !== false) map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 17 });
      return line;
    },

    // The fixed centre pin used on the home and set-on-map screens.
    centerPin: function (wrap) {
      var pin = AR.el('<div class="center-pin"><div class="shadow"></div><svg class="pin" viewBox="0 0 34 52" aria-hidden="true"><defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--pin-a)"/><stop offset="1" style="stop-color:var(--pin-b)"/></linearGradient></defs><path d="M17 51C7 40 2 32 2 21a15 15 0 0 1 30 0c0 11-5 19-15 30Z" fill="url(#pg)" stroke="#fff" stroke-width="2"/><circle cx="17" cy="21" r="6" style="fill:var(--pin-dot)"/></svg></div>');
      wrap.appendChild(pin);
      return pin;
    },

    // Developer-only: pretend to be in Lilongwe. Exists only when the server is in development mode.
    TEST_POINT: { lat: -13.9626, lng: 33.7873 },
    testOn: function () { try { return localStorage.getItem('aarohan_test_loc') === '1' && !!(AR.state.cfg && AR.state.cfg.allowLocationSimulation); } catch (_) { return false; } },
    setTest: function (on) { try { localStorage.setItem('aarohan_test_loc', on ? '1' : '0'); } catch (_) {} },
    // Production works in Malawi only. Returns true when the location is fine (or when this is a development server).
    MALAWI: { minLat: -17.5, maxLat: -9.0, minLng: 32.5, maxLng: 36.0 }, // the same limits as the server (services/location.js)
    guardMalawi: function (g) {
      if (!g || !g.ok || (AR.state.cfg && AR.state.cfg.allowLocationSimulation)) return true;
      var b = AR.map.MALAWI; if (g.lat >= b.minLat && g.lat <= b.maxLat && g.lng >= b.minLng && g.lng <= b.maxLng) return true;
      if (!AR.map._outShown) { AR.map._outShown = true; AR.sheet.open({ html: '<h2>Aarohan works in Malawi only</h2><p class="dim">Your phone says you are outside Malawi, so rides and trips are not available from here. When you are in Malawi, everything works as normal.</p><button class="btn btn-gold mt24" id="ok">OK</button>', onOpen: function (c) { AR.$('#ok', c.el).addEventListener('click', function () { c.close(); AR.map._outShown = false; }); } }); }
      return false;
    },
    // If you are far from Lilongwe (for example testing from India), offer the test location once.
    offerTest: function (g) {
      if (!g || !g.ok || g.test || !(AR.state.cfg && AR.state.cfg.allowLocationSimulation) || AR.map._offered) return;
      var r = Math.PI / 180, dLat = (g.lat - LILONGWE.lat) * r, dLng = (g.lng - LILONGWE.lng) * r, x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(g.lat * r) * Math.cos(LILONGWE.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      if (6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) < 150) return;
      AR.map._offered = true;
      AR.sheet.open({ html: '<h2>You are far from Lilongwe</h2><p class="dim">Aarohan only runs in Lilongwe, so trips cannot start from where you are. Because this is a test server, you can pretend to be in Lilongwe.</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="tl">Use a test location in Lilongwe</button><button class="btn btn-ghost" style="width:100%" id="no">No, keep my real location</button></div>',
        onOpen: function (c) { AR.$('#tl', c.el).addEventListener('click', function () { AR.map.setTest(true); location.reload(); }); AR.$('#no', c.el).addEventListener('click', function () { c.close(); }); } });
    },

    // Where is the person? Resolves {lat,lng,ok}. Never rejects.
    locate: function () {
      if (AR.map.testOn()) { var tp = AR.map.TEST_POINT; return Promise.resolve({ lat: tp.lat + (Math.random() - 0.5) * 0.0004, lng: tp.lng + (Math.random() - 0.5) * 0.0004, ok: true, test: true }); }
      return new Promise(function (resolve) {
        if (!navigator.geolocation) return resolve({ lat: LILONGWE.lat, lng: LILONGWE.lng, ok: false });
        navigator.geolocation.getCurrentPosition(
          function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, ok: true, accuracy: p.coords.accuracy }); },
          function () { resolve({ lat: LILONGWE.lat, lng: LILONGWE.lng, ok: false }); },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
        );
      });
    },

    // Street name for a point (never throws).
    reverse: async function (lat, lng) {
      try {
        var r = await fetch('/api/places/reverse?lat=' + lat + '&lng=' + lng);
        if (!r.ok) throw new Error();
        var d = await r.json();
        return { name: d.title || d.displayName || 'Pinned location', address: d.displayName || d.subtitle || '' };
      } catch (_) { return { name: 'Pinned location', address: lat.toFixed(4) + ', ' + lng.toFixed(4) }; }
    }
  };
})();

// Remember the last good location so ads meant for one area can be matched (never stored on the server).
(function () {
  var AR = window.AR; if (!AR || !AR.map || !AR.map.locate) return;
  var orig = AR.map.locate;
  AR.map.locate = function () { return orig.apply(AR.map, arguments).then(function (g) { if (g && g.ok) AR.map._last = { lat: g.lat, lng: g.lng }; return g; }); };
})();
