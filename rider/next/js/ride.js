// ============================================================================
// Aarohan rider: the ride flow (options and stops, searching, cancel reasons, tracking, completion).
// Also used by parcels (serviceType PARCEL).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  var R = (AR.ride = { cur: null, selfCancel: false });

  var TIERS = {
    moto: { label: 'Moto', sub: 'Fastest through traffic', seats: 'Up to 20 kg of parcel', ride: '1 rider' },
    auto: { label: 'Auto', sub: 'Comfortable local ride', seats: 'Up to 80 kg of parcel', ride: 'Up to 3 riders' },
    cab: { label: 'Cab', sub: 'Private car', seats: 'Up to 150 kg of parcel', ride: 'Up to 4 riders' }
  };
  var LIMIT_KG = { moto: 20, auto: 80, cab: 150 };
  R.TIERS = TIERS; R.LIMIT_KG = LIMIT_KG;

  var CANCEL_REASONS = [
    'Found a better price elsewhere',
    'My captain is not moving',
    'My captain asked for more money',
    'My captain asked me to cancel',
    'Waiting too long',
    'I booked by mistake',
    'My plans changed',
    'Other'
  ];

  function tierKey(t) { return String((t && (t.categoryId || t.id)) || 'moto').toLowerCase(); }
  function stopPoint(p) { return { lat: p.lat, lng: p.lng, name: p.name }; }
  R.tierKey = tierKey;
  R.recommend = function (kg) { return kg <= LIMIT_KG.moto ? 'moto' : (kg <= LIMIT_KG.auto ? 'auto' : 'cab'); };

  // ----------------------------------------------------------------- quote
  R.requote = async function () {
    var T = AR.trip;
    if (!T.pickup || T.pickup.lat == null) await AR.ensurePickup();
    if (!T.dest) throw new Error('Choose where you are going first.');
    var body = { pickup: stopPoint(T.pickup), destination: stopPoint(T.dest), stops: (T.stops || []).map(stopPoint), serviceType: T.serviceType || 'RIDE' };
    if (T.serviceType === 'PARCEL' && T.parcel) body.parcelSize = T.parcel.size;
    var d = await AR.api('/rides/quote', { method: 'POST', body: body });
    // The server sends prices keyed by vehicle. The screens work with an ordered list.
    var raw = d.tiers || {};
    var list = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { return Object.assign({ categoryId: k }, raw[k]); });
    var order = { moto: 0, auto: 1, cab: 2 };
    list.sort(function (a, b) { return (order[tierKey(a)] == null ? 9 : order[tierKey(a)]) - (order[tierKey(b)] == null ? 9 : order[tierKey(b)]); });
    d.tiers = list;
    T.quote = d;
    return d;
  };

  // --------------------------------------------------------------- options
  AR.register('options', {
    mount: function (el) {
      var T = AR.trip, isParcel = T.serviceType === 'PARCEL';
      var layers = [];
      el.innerHTML = '<div class="map-wrap"><div class="map" id="omap"></div></div>' +
        '<div class="home-top"><button class="icon-btn" data-back aria-label="Back" style="width:50px;height:50px;background:var(--glass)">' + AR.icon('chevronLeft') + '</button></div>' +
        '<div class="ride-sheet" id="sheet"></div>';
      var map = AR.map.create(AR.$('#omap', el), { center: T.pickup, zoom: 14 });
      var sheet = AR.$('#sheet', el);
      AR.$('[data-back]', el).addEventListener('click', function () { AR.nav.back(); });

      function clearLayers() { layers.forEach(function (l) { try { map.removeLayer(l); } catch (_) {} }); layers = []; }
      function drawMap() {
        clearLayers();
        var q = T.quote; if (!q || !q.route) return;
        var coords = (q.route.polyline && q.route.polyline.length) ? q.route.polyline : [[T.pickup.lat, T.pickup.lng], [T.dest.lat, T.dest.lng]];
        var line = L.polyline(coords, { color: AR.css('--route'), weight: 5, opacity: 0.95, lineCap: 'round' }).addTo(map);
        var under = L.polyline(coords, { color: AR.css('--route-under'), weight: 9, opacity: 1 }).addTo(map); under.bringToBack();
        layers.push(line, under, AR.map.marker(map, T.pickup, 'steel'), AR.map.marker(map, T.dest, 'gold'));
        (T.stops || []).forEach(function (s, i) { layers.push(AR.map.marker(map, s, 'steel', '<span style="font-size:10px;font-weight:800;color:#0A0D13">' + (i + 1) + '</span>')); });
        var h = (sheet && sheet.offsetHeight) || 380;
        map.fitBounds(line.getBounds(), { paddingTopLeft: [40, 90], paddingBottomRight: [40, h + 24], maxZoom: 16 });
      }

      function routeHtml() {
        var stops = (T.stops || []).map(function (s, i) {
          return '<div class="route-stop"><span class="small steel" style="width:10px;text-align:center;font-weight:800">' + (i + 1) + '</span><span class="ellipsis">' + AR.esc(s.name) + '</span><button class="x" data-rm="' + i + '" aria-label="Remove stop">' + AR.icon('close', 18) + '</button></div>';
        }).join('');
        return '<div class="route-line"><div class="route-rail" style="padding:6px 0"><i></i><b></b><em></em></div><div class="route-stops">' +
          '<div class="route-stop"><span class="ellipsis">' + AR.esc(T.pickup.name) + '</span></div>' + stops +
          '<div class="route-stop"><span class="ellipsis">' + AR.esc(T.dest.name) + '</span></div></div></div>' +
          ((T.stops || []).length < 2 && !isParcel ? '<button class="btn btn-ghost btn-sm mt8" data-addstop style="padding:0;min-height:36px">' + AR.icon('plus', 18) + '<span>Add a stop</span></button>' : '');
      }

      function tiersHtml(q) {
        var w = isParcel && T.parcel ? Number(T.parcel.weightKg || 0) : 0;
        var recommended = isParcel ? R.recommend(w) : 'auto';
        return q.tiers.map(function (t) {
          var k = tierKey(t), info = TIERS[k] || { label: t.name, sub: t.subtitle || '', seats: '', ride: '' };
          var fits = !isParcel || !w || w <= LIMIT_KG[k];
          var badge = isParcel ? (k === recommended && fits ? '<span class="badge steel">Recommended</span>' : '') : (k === 'auto' ? '<span class="badge">Popular</span>' : '');
          return '<button class="tier ' + (T.tierId === k ? 'on' : '') + (fits ? '' : ' off') + '" data-t="' + k + '"><span class="t-ic">' + AR.icon(AR.vehicleIcon(k), 28) + '</span>' +
            '<span class="grow"><div class="t-name">' + info.label + ' ' + badge + '</div><div class="t-sub">' + (isParcel ? (fits ? info.seats : 'Too heavy for ' + info.label) : info.ride + ' · ' + info.sub) + '</div></span>' +
            '<span class="t-fare">' + AR.fmt.money(t.finalFare) + '</span></button>';
        }).join('');
      }

      function parcelAdvice() {
        var w = Number(T.parcel.weightKg || 0);
        if (w > LIMIT_KG.cab) return '<div class="suggest" style="margin-bottom:12px">' + AR.icon('warning', 22) + '<span>This parcel is over ' + LIMIT_KG.cab + ' kg, which is more than our vehicles can carry.</span></div>';
        var msg = w <= LIMIT_KG.moto ? 'Your parcel is ' + w + ' kg, so a Moto is enough.' : (w <= LIMIT_KG.auto ? 'At ' + w + ' kg your parcel needs an Auto.' : 'At ' + w + ' kg your parcel needs a Cab.');
        return '<div class="suggest" style="margin-bottom:12px">' + AR.icon('info', 22) + '<span>' + msg + ' Prices follow your route.</span></div>';
      }

      function paint() {
        var q = T.quote;
        if (!q) { sheet.innerHTML = '<div class="sheet-handle"></div><div class="rs-scroll"><div class="skeleton" style="height:70px;margin-bottom:12px"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div><div class="rs-foot"><div class="skeleton" style="height:52px"></div></div>'; return; }
        if (!T.tierId || !q.tiers.some(function (t) { return tierKey(t) === T.tierId; })) T.tierId = isParcel && T.parcel ? R.recommend(Number(T.parcel.weightKg || 0)) : tierKey(q.tiers[0]);
        var tier = q.tiers.filter(function (t) { return tierKey(t) === T.tierId; })[0] || q.tiers[0];
        sheet.innerHTML = '<div class="sheet-handle"></div><div class="rs-scroll">' + routeHtml() +
          '<div class="meta-line"><b>' + AR.fmt.km(q.route.distanceKm) + '</b><i></i><b>' + Math.round(q.route.durationMins) + ' min</b>' + (q.stopCount ? '<i></i><span>' + q.stopCount + (q.stopCount > 1 ? ' stops' : ' stop') + ' · ' + AR.fmt.money(q.stopFeeMWK) + '</span>' : '') + '</div>' +
          (isParcel ? parcelAdvice() : '') + tiersHtml(q) +
          '<div class="field mt12"><label>Help your captain find you (optional)</label><input class="input" id="pnote" maxlength="160" placeholder="e.g. Blue gate, opposite the market" value="' + AR.esc(T.pickupNote || '') + '"/></div>' +
          '<button class="row card" id="forother" style="margin-top:12px;border-radius:var(--r-md);min-height:56px"><span class="grow"><div class="r-title">Booking for someone else</div><div class="r-sub">Your captain will contact them at pickup</div></span><span class="toggle ' + (T.forOther ? 'on' : '') + '"></span></button>' +
          '<div class="stack gap8 ' + (T.forOther ? '' : 'hide') + '" id="otherbox" style="margin-top:8px"><input class="input" id="oname" placeholder="Their name" maxlength="40" value="' + AR.esc(T.otherName || '') + '"/><div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="ophone" type="tel" inputmode="tel" placeholder="99 123 4567" value="' + AR.esc(T.otherPhone || '') + '"/></div></div>' +
          '<button class="row card" id="callme" style="margin:12px 0;border-radius:var(--r-md);min-height:56px"><span class="grow"><div class="r-title">Call me when you are close</div><div class="r-sub">Your captain will phone you at pickup</div></span><span class="toggle ' + (T.callOnArrival ? 'on' : '') + '"></span></button></div>' +
          '<div class="rs-foot"><div class="pay-row compact">' + AR.icon('wallet', 22, 'gold') + '<span class="grow"><b>Cash</b><div class="small dim">' + (isParcel ? (T.parcel.payer === 'RECEIVER_AT_DELIVERY' ? 'The receiver pays on delivery' : 'You pay your captain at pickup') : 'Pay your captain at the end of the trip') + '</div></span></div>' +
          '<button class="btn btn-gold" id="book">' + (isParcel ? 'Confirm and book' : 'Book ' + (TIERS[T.tierId] ? TIERS[T.tierId].label : '')) + ' · ' + AR.fmt.money(tier.finalFare) + '</button></div>';
        AR.$$('[data-t]', sheet).forEach(function (b) { b.addEventListener('click', function () { T.tierId = b.dataset.t; if (!isParcel) { try { localStorage.setItem('aarohan_tier', T.tierId); } catch (_) {} } AR.haptic(10); paint(); }); });
        AR.$$('[data-rm]', sheet).forEach(function (b) { b.addEventListener('click', function () { T.stops.splice(+b.dataset.rm, 1); load(); }); });
        var add = AR.$('[data-addstop]', sheet);
        if (add) add.addEventListener('click', function () { AR.nav.go('search', { field: 'stop', onSelect: function (p) { T.stops.push(p); load(); } }); });
        AR.$('#pnote', sheet).addEventListener('input', function () { T.pickupNote = this.value.trim(); });
        AR.$('#forother', sheet).addEventListener('click', function () { T.forOther = !T.forOther; AR.$('.toggle', this).classList.toggle('on', T.forOther); AR.$('#otherbox', sheet).classList.toggle('hide', !T.forOther); });
        AR.$('#oname', sheet).addEventListener('input', function () { T.otherName = this.value.trim(); });
        AR.$('#ophone', sheet).addEventListener('input', function () { T.otherPhone = this.value; });
        AR.$('#callme', sheet).addEventListener('click', function () { T.callOnArrival = !T.callOnArrival; AR.$('.toggle', this).classList.toggle('on', T.callOnArrival); });
        AR.$('#book', sheet).addEventListener('click', function () { book(this, tier); });
      }

      async function load() {
        T.quote = null; paint();
        try { await R.requote(); paint(); drawMap(); }
        catch (e) {
          sheet.innerHTML = '<div class="sheet-handle"></div><div class="empty" style="padding:24px 8px">' + AR.icon('warning', 40) + '<h3>We could not price this trip</h3><p>' + AR.esc(e.message) + '</p><button class="btn btn-line mt16" data-back2 style="width:auto;display:inline-flex">Go back</button></div>';
          AR.$('[data-back2]', sheet).addEventListener('click', function () { AR.nav.back(); });
        }
      }

      function book(btn, tier) {
        if (btn.classList.contains('is-loading')) return;
        AR.haptic(18);
        var q = T.quote, k = tierKey(tier);
        if (isParcel && Number(T.parcel.weightKg) > LIMIT_KG[k]) return AR.toast('This parcel is too heavy for a ' + TIERS[k].label + '.', 'gold');
        var note = T.pickupNote || '';
        if (T.forOther) {
          var op = AR.phone.normalize(T.otherPhone || '');
          if ((T.otherName || '').length < 2 || !AR.phone.valid(op)) return AR.toast('Enter the passenger\'s name and a valid mobile number.', 'gold');
          note = ('For ' + T.otherName + ' ' + op + '. ' + note).slice(0, 160);
        }
        btn.classList.add('is-loading');
        R.cur = null; R.selfCancel = false;
        AR.store().requestTrip({
          pickup: T.pickup.name, destination: T.dest.name, tier: TIERS[k].label, tierId: k, fare: tier.finalFare, paymentMethod: 'CASH',
          distanceKm: q.route.distanceKm, durationMins: Math.round(q.route.durationMins), quoteId: q.quoteId, routeGeometry: null,
          pickupCoords: { lat: T.pickup.lat, lng: T.pickup.lng }, dropoffCoords: { lat: T.dest.lat, lng: T.dest.lng },
          stops: (T.stops || []).map(stopPoint), pickupNote: note || undefined, callOnArrival: !!T.callOnArrival, serviceType: isParcel ? 'PARCEL' : 'RIDE', parcel: isParcel ? T.parcel : undefined
        }, function (res) {
          btn.classList.remove('is-loading');
          if (res && res.success) { R.cur = res.trip; AR.nav.replace('searching'); }
        });
      }

      load();
      return { destroy: function () { try { map.remove(); } catch (_) {} } };
    }
  });

  // --------------------------------------------------------- cancel reasons
  // Asks WHY, then cancels. `assigned` = a captain was already assigned.
  R.askCancel = function (assigned, after) {
    var chosen = null;
    return AR.sheet.open({
      html: '<h2>Why are you cancelling?</h2><p class="dim small">Your answer helps us improve.' + (assigned ? ' Cancelling after a captain is assigned can lower your rider rating.' : '') + '</p>' +
        '<div class="mt16" id="reasons">' + CANCEL_REASONS.map(function (r, i) { return '<button class="reason" data-i="' + i + '"><span class="radio"></span><span>' + AR.esc(r) + '</span></button>'; }).join('') + '</div>' +
        '<textarea class="textarea hide" id="other" maxlength="200" placeholder="Tell us what happened"></textarea>' +
        '<div class="stack gap12 mt16"><button class="btn btn-gold" id="confirm" disabled>Cancel trip</button><button class="btn btn-ghost" style="width:100%" id="keep">Keep my trip</button></div>',
      onOpen: function (c) {
        var box = AR.$('#reasons', c.el), other = AR.$('#other', c.el), ok = AR.$('#confirm', c.el);
        AR.$$('.reason', box).forEach(function (b) {
          b.addEventListener('click', function () {
            chosen = CANCEL_REASONS[+b.dataset.i];
            AR.$$('.reason', box).forEach(function (x) { x.classList.toggle('on', x === b); });
            other.classList.toggle('hide', chosen !== 'Other'); ok.disabled = false;
          });
        });
        AR.$('#keep', c.el).addEventListener('click', function () { c.close(); });
        ok.addEventListener('click', function () {
          var reason = chosen === 'Other' ? ('Other: ' + (other.value.trim() || 'no details')) : chosen;
          ok.classList.add('is-loading'); R.selfCancel = true;
          AR.store().cancelTrip(reason, function () { c.close(true); if (after) after(reason); });
        });
      }
    });
  };

  // ------------------------------------------------------------- searching
  AR.register('searching', {
    locked: true,
    mount: function (el) {
      var T = AR.trip, trip = R.cur || {};
      var isParcel = T.serviceType === 'PARCEL';
      var tk = T.tierId || 'moto';
      (function () { var slot = document.createElement('div'); slot.className = 'hide'; slot.style.margin = '12px 16px'; (AR.$('.scroll', el) || el).appendChild(slot); AR.ads.mount(slot, 'RIDER', 'SEARCHING'); })();
      var phrases = [
        ['Finding your captain', 'Looking for the nearest captain to ' + AR.esc((T.pickup && T.pickup.name) || 'you') + '.'],
        ['Contacting a captain', 'Waiting for the nearest captain to say yes.'],
        ['Still looking', 'Trying the next captain a little further away.'],
        ['Almost there', 'Checking everyone nearby. Thanks for waiting.']
      ];
      var fare = trip.fareMWK || (T.quote && ((T.quote.tiers || []).filter(function (t) { return tierKey(t) === tk; })[0] || {}).finalFare) || 0;
      el.classList.add('searching');
      el.innerHTML =
        '<div class="topbar"><button class="icon-btn" id="sback" aria-label="Back">' + AR.icon('chevronLeft') + '</button><div class="grow"></div><span class="badge gold" id="clock">0:00</span></div>' +
        '<div class="search-stage"><div class="radar"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="grid"></div><div class="sweep"></div>' +
        '<span class="blip" style="top:20%;left:62%;animation-delay:.4s"></span><span class="blip" style="top:64%;left:24%;animation-delay:1.3s"></span><span class="blip" style="top:70%;left:70%;animation-delay:2s"></span>' +
        '<div class="core">' + AR.icon(isParcel ? 'parcel' : AR.vehicleIcon(tk), 40) + '</div></div>' +
        '<h2 class="search-title" id="st">' + phrases[0][0] + '</h2><p class="search-sub" id="ss">' + phrases[0][1] + '</p>' +
        '<div class="timer-bar"><i id="bar"></i></div></div>' +
        '<div class="search-foot"><div class="trip-mini"><div class="mini-rail"><i></i><b></b><em></em></div><div class="grow" style="min-width:0"><div class="ellipsis" style="font-weight:600">' + AR.esc((T.pickup && T.pickup.name) || '') + '</div><div class="ellipsis dim" style="font-weight:600;margin-top:6px">' + AR.esc((T.dest && T.dest.name) || '') + '</div></div>' +
        '<div style="text-align:right"><div class="num" style="font-weight:700">' + AR.fmt.money(fare) + '</div><div class="small dim">' + (isParcel ? 'Parcel' : ((TIERS[tk] || {}).label || '')) + '</div></div></div>' +
        '<button class="btn btn-line mt16" id="cancel">Cancel</button></div>';

      var t0 = Date.now(), n = 0;
      var st = AR.$('#st', el), ss = AR.$('#ss', el);
      st.style.transition = ss.style.transition = 'opacity .22s';
      var tick = setInterval(function () {
        var s = Math.floor((Date.now() - t0) / 1000);
        AR.$('#clock', el).textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        AR.$('#bar', el).style.width = Math.min(100, (s / 90) * 100) + '%';
        var idx = Math.min(phrases.length - 1, Math.floor(s / 12));
        if (idx !== n) { n = idx; st.style.opacity = 0; ss.style.opacity = 0; setTimeout(function () { st.textContent = phrases[n][0]; ss.textContent = phrases[n][1]; st.style.opacity = 1; ss.style.opacity = 1; }, 220); }
      }, 1000);

      function askLeave() { R.askCancel(false, function () { AR.toast('Trip cancelled.'); AR.nav.resetTo('home'); }); }
      AR.$('#cancel', el).addEventListener('click', askLeave);
      AR.$('#sback', el).addEventListener('click', askLeave);
      return { destroy: function () { clearInterval(tick); } };
    }
  });

  // -------------------------------------------------------------- tracking
  function driverOf(trip) { return R.driver || (trip && trip.driver) || null; }
  function dName(d) { return (d && ((d.user && d.user.name) || d.name)) || 'Your captain'; }
  function dPhone(d) { return (d && ((d.user && d.user.phone) || d.phone)) || ''; }
  function dVeh(d) { var v = (d && d.vehicle) || {}; return { model: v.makeModel || v.model || (d && d.car) || 'Vehicle', color: v.color || '', plate: v.plateNumber || (d && d.plate) || '' }; }
  R.driverOf = driverOf; R.dName = dName; R.dVeh = dVeh;

  AR.register('tracking', {
    locked: true,
    mount: function (el) {
      var T = AR.trip, isParcel = T.serviceType === 'PARCEL';
      el.innerHTML = '<div class="map-wrap"><div class="map" id="tmap"></div></div>' +
        '<button class="sos-fab" id="sos" aria-label="Safety">' + AR.icon('shield', 18) + '<span>SOS</span></button>' +
        '<div class="t-sheet" id="tsheet"></div>';
      var map = AR.map.create(AR.$('#tmap', el), { center: T.pickup || AR.map.LILONGWE, zoom: 15 });
      var vehicle = null, route = null;
      var tripNow = function () { return R.cur || {}; };

      function etaMins(from, to) {
        if (!from || !to) return null;
        var rad = Math.PI / 180, dLat = (to.lat - from.lat) * rad, dLng = (to.lng - from.lng) * rad;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return Math.max(1, Math.round((6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 24) * 60));
      }

      function drawRoute() {
        var coords = (T.quote && T.quote.route && T.quote.route.polyline && T.quote.route.polyline.length) ? T.quote.route.polyline : null;
        if (!coords || route) return;
        route = L.polyline(coords, { color: AR.css('--route'), weight: 5, opacity: 0.85, lineCap: 'round' }).addTo(map);
        if (T.pickup) AR.map.marker(map, T.pickup, 'steel');
        if (T.dest) AR.map.marker(map, T.dest, 'gold');
        map.fitBounds(route.getBounds(), { paddingTopLeft: [40, 90], paddingBottomRight: [40, 360], maxZoom: 16 });
      }

      function paint() {
        var t = tripNow(), d = driverOf(t), v = dVeh(d), st = t.status || 'DRIVER_ARRIVING';
        var sheet = AR.$('#tsheet', el);
        var headline = st === 'ARRIVED' ? (isParcel ? 'Your captain is at the pickup' : 'Your captain has arrived') : (st === 'IN_TRANSIT' ? (isParcel ? 'Your parcel is on its way' : 'On your way') : 'Your captain is on the way');
        var eta = '';
        if (st === 'DRIVER_ARRIVING' && R.driverLoc && T.pickup) { var m = etaMins(R.driverLoc, T.pickup); eta = m ? 'About ' + m + ' min away' : ''; }
        else if (st === 'IN_TRANSIT') eta = 'To ' + (T.dest ? T.dest.name : 'your destination');
        else if (st === 'ARRIVED') eta = isParcel ? 'Give the pickup code to your captain' : 'Share your PIN to start the ride';
        var pinHtml = (st !== 'IN_TRANSIT' && t.pin) ? '<div class="pin-card mt12"><div><div class="small gold" style="font-weight:700">' + (isParcel ? 'Pickup code' : 'Your PIN') + '</div><div class="tiny dim">' + (isParcel ? 'Give it to the captain when they collect the parcel.' : 'Tell it to your captain only when you board.') + '</div></div><div class="pin-digits">' + String(t.pin).split('').map(function (c) { return '<b>' + AR.esc(c) + '</b>'; }).join('') + '</div></div>' : '';
        var delHtml = (isParcel && t.deliveryCode) ? '<div class="pin-card mt12" style="border-color:rgba(var(--tint2-rgb), .45);background:rgba(var(--tint2-rgb), .08)"><div><div class="small steel" style="font-weight:700">Delivery code</div><div class="tiny dim">Share it with the receiver. They give it to the captain on delivery.</div></div><div class="pin-digits">' + String(t.deliveryCode).split('').map(function (c) { return '<b style="border-color:var(--steel-400);color:var(--steel-200)">' + AR.esc(c) + '</b>'; }).join('') + '</div></div>' : '';
        sheet.innerHTML = '<div class="sheet-handle"></div><div class="status-line">' + headline + '</div><div class="dim" style="margin-top:2px">' + AR.esc(eta) + '</div>' +
          '<div class="hstack gap12 mt16"><div class="avatar">' + AR.esc(AR.fmt.initials(dName(d))) + '</div><div class="grow" style="min-width:0"><div style="font-weight:700;font-size:17px" class="ellipsis">' + AR.esc(dName(d)) + '</div>' +
          '<div class="hstack gap8 small dim">' + AR.icon('star', 14, 'gold') + '<span>' + (d && d.rating ? Number(d.rating).toFixed(1) : '5.0') + '</span><span>·</span><span class="ellipsis">' + AR.esc(v.model + (v.color ? ', ' + v.color : '')) + '</span></div></div>' +
          (v.plate ? '<span class="plate">' + AR.esc(v.plate) + '</span>' : '') + '</div>' + pinHtml + delHtml +
          '<div class="actions"><button class="action" id="a-call">' + AR.icon('phone', 22) + '<span>Call</span></button><button class="action" id="a-chat">' + AR.icon('chat', 22) + '<span>Chat</span><span id="chat-unread-dot" class="chat-dot hidden"></span></button><button class="action" id="a-share">' + AR.icon('share', 22) + '<span>Share</span></button><button class="action" id="a-more">' + AR.icon('settings', 22) + '<span>Trip</span></button></div>' +
          (st === 'IN_TRANSIT' ? '' : '<button class="btn btn-ghost" id="a-cancel" style="width:100%;margin-top:8px">Cancel trip</button>');
        var tel = dPhone(d);
        AR.$('#a-call', sheet).addEventListener('click', function () { if (tel) location.href = 'tel:' + tel; else AR.toast('Phone number is not available yet.'); });
        AR.$('#a-chat', sheet).addEventListener('click', function () { window.openChatDrawer(); });
        AR.$('#a-share', sheet).addEventListener('click', function () { R.share(); });
        AR.$('#a-more', sheet).addEventListener('click', function () { R.tripSheet(); });
        var c = AR.$('#a-cancel', sheet); if (c) c.addEventListener('click', function () { R.askCancel(true, function () { AR.toast('Trip cancelled.'); AR.nav.resetTo('home'); }); });
        var cs = AR.store() && AR.store().chatState ? AR.store().chatState() : null; var dot = AR.$('#chat-unread-dot', sheet); if (dot && cs) dot.classList.toggle('hidden', !(cs.unread > 0));
      }

      AR.$('#sos', el).addEventListener('click', function () { R.sos(); });
      R.onTrack = function (kind, payload) {
        if (kind === 'moved' && payload) {
          var ll = [payload.lat, payload.lng];
          if (!vehicle) vehicle = L.marker(ll, { icon: AR.map.icon('vehicle', AR.icon(AR.vehicleIcon(T.tierId), 20)), interactive: false }).addTo(map); else vehicle.setLatLng(ll);
          R.driverLoc = { lat: payload.lat, lng: payload.lng };
        }
        paint();
      };
      drawRoute(); paint();
      return { destroy: function () { R.onTrack = null; try { map.remove(); } catch (_) {} } };
    }
  });

  // --------------------------------------------------------------- helpers
  R.share = function () {
    var t = R.cur || {}, d = driverOf(t), v = dVeh(d), T = AR.trip;
    var text = 'I am travelling with Aarohan.\nCaptain: ' + dName(d) + (v.plate ? ' (' + v.plate + ')' : '') + '\nVehicle: ' + v.model + (v.color ? ', ' + v.color : '') + '\nFrom: ' + (T.pickup ? T.pickup.name : '') + '\nTo: ' + (T.dest ? T.dest.name : '');
    if (navigator.share) navigator.share({ title: 'My Aarohan trip', text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { AR.toast('Trip details copied. Paste them to a friend.'); });
    else AR.toast('Sharing is not supported on this device.');
  };

  R.tripSheet = function () {
    var t = R.cur || {}, T = AR.trip;
    AR.sheet.open({ html: '<h2>Trip details</h2>' +
      '<div class="kv"><span>From</span><b>' + AR.esc(T.pickup ? T.pickup.name : (t.pickupAddress || '')) + '</b></div>' +
      ((t.pickupNote || T.pickupNote) ? '<div class="kv"><span>Pickup note</span><b>' + AR.esc(t.pickupNote || T.pickupNote) + '</b></div>' : '') +
      (T.stops || []).map(function (s, i) { return '<div class="kv"><span>Stop ' + (i + 1) + '</span><b>' + AR.esc(s.name) + '</b></div>'; }).join('') +
      '<div class="kv"><span>To</span><b>' + AR.esc(T.dest ? T.dest.name : (t.dropoffAddress || '')) + '</b></div>' +
      '<div class="kv"><span>Fare</span><b>' + AR.fmt.money(t.fareMWK) + ' in cash</b></div>' +
      '<div class="kv"><span>Booking</span><b>' + AR.esc(String(t.id || '').slice(0, 8).toUpperCase()) + '</b></div>' });
  };

  R.sos = function () {
    AR.sheet.open({
      html: '<h2>Need help?</h2><p class="dim">An SOS alerts the Aarohan safety team with your location and trip. <b>If you are in immediate danger, call 997 first.</b></p>' +
        '<div class="stack gap12 mt24"><button class="btn btn-gold" id="send">Send SOS to Aarohan</button><a class="btn btn-line" href="tel:997">Call 997 (police)</a><button class="btn btn-ghost" style="width:100%" id="no">I am safe</button></div>',
      onOpen: function (c) {
        AR.$('#no', c.el).addEventListener('click', function () { c.close(); });
        AR.$('#send', c.el).addEventListener('click', async function () {
          this.classList.add('is-loading');
          var res = await AR.store().triggerSOS('RIDER', 'Rider pressed SOS from the trip screen');
          c.close();
          setTimeout(function () {
            AR.sheet.open({ html: res && res.delivered
              ? '<h2>The safety team has been alerted</h2><p class="dim">Aarohan has your location and trip details. Keep this screen open. If you are in danger, call 997 now.</p><a class="btn btn-gold mt24" href="tel:997">Call 997</a>'
              : '<h2>We could not reach Aarohan</h2><p class="dim">Your SOS was not delivered. Please call 997 or someone you trust right now.</p><a class="btn btn-gold mt24" href="tel:997">Call 997</a>' });
          }, 420);
        });
      }
    });
  };

  // -------------------------------------------------------------- completed
  AR.register('completed', {
    locked: true,
    mount: function (el) {
      var t = R.cur || {}, T = AR.trip, isParcel = (t.serviceType || T.serviceType) === 'PARCEL';
      var d = driverOf(t), v = dVeh(d), stars = 0, tags = [];
      var TAGS = ['On time', 'Polite', 'Safe driving', 'Clean vehicle', 'Good route'];
      el.innerHTML = '<div class="scroll" style="padding-top:calc(var(--safe-top) + 20px)"><div class="done-hero"><div class="done-ring"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.3 4.3 8.7-9.6"/></svg></div>' +
        '<h1 style="font-size:28px">' + (isParcel ? 'Parcel delivered' : 'You have arrived') + '</h1><div class="fare-big mt8">' + AR.fmt.money(t.fareMWK) + '</div>' +
        '<p class="dim">' + ((t.parcelDetail && t.parcelDetail.payer === 'RECEIVER_AT_DELIVERY') ? 'Paid in cash by the receiver' : 'Pay your captain in cash') + '</p></div>' +
        '<div class="card mt16"><div class="kv"><span>From</span><b>' + AR.esc((T.pickup && T.pickup.name) || t.pickupAddress || '') + '</b></div><div class="kv"><span>To</span><b>' + AR.esc((T.dest && T.dest.name) || t.dropoffAddress || '') + '</b></div>' +
        '<div class="kv"><span>Vehicle</span><b>' + AR.esc(v.model + (v.plate ? ' · ' + v.plate : '')) + '</b></div><div class="kv"><span>Captain</span><b>' + AR.esc(dName(d)) + '</b></div></div>' +
        '<h3 class="center" style="margin-top:28px;font-size:20px">How was ' + AR.esc((dName(d) || '').split(' ')[0]) + '?</h3><div class="stars mt12" id="stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<button data-s="' + n + '" aria-label="' + n + ' stars">' + AR.icon('star', 38) + '</button>'; }).join('') + '</div>' +
        '<div class="chips mt16" id="tags" style="justify-content:center"></div><textarea class="textarea mt16 hide" id="comment" maxlength="300" placeholder="Anything else? (optional)"></textarea>' +
        '<div class="stack gap12 mt24"><button class="btn btn-gold" id="submit" disabled>Submit rating</button><button class="btn btn-ghost" style="width:100%" id="issue">Report a problem with this trip</button><button class="btn btn-ghost" style="width:100%" id="skip">Done</button></div></div>';
      (function () { var slot = document.createElement('div'); slot.className = 'hide'; slot.style.marginTop = '16px'; var c = AR.$('.card', el); if (c && c.parentNode) c.parentNode.insertBefore(slot, c.nextSibling); AR.ads.mount(slot, 'RIDER', 'COMPLETED'); })();
      var sEl = AR.$('#stars', el), tg = AR.$('#tags', el), submit = AR.$('#submit', el);
      tg.innerHTML = TAGS.map(function (x) { return '<button class="chip" data-tag="' + x + '">' + x + '</button>'; }).join('');
      AR.$$('[data-s]', sEl).forEach(function (b) { b.addEventListener('click', function () { stars = +b.dataset.s; AR.$$('[data-s]', sEl).forEach(function (x) { x.classList.toggle('on', +x.dataset.s <= stars); }); submit.disabled = false; AR.$('#comment', el).classList.remove('hide'); }); });
      AR.$$('[data-tag]', tg).forEach(function (b) { b.addEventListener('click', function () { b.classList.toggle('on'); tags = AR.$$('[data-tag].on', tg).map(function (x) { return x.dataset.tag; }); }); });
      function finish() { R.cur = null; R.driver = null; AR.nav.resetTo('home'); }
      AR.$('#skip', el).addEventListener('click', finish);
      AR.$('#issue', el).addEventListener('click', function () { AR.nav.go('new-ticket', { tripId: t.id, subject: 'Problem with my trip' }); });
      submit.addEventListener('click', function () {
        submit.classList.add('is-loading');
        var s = AR.store().socket;
        var done = function (ok) { submit.classList.remove('is-loading'); AR.toast(ok ? 'Thank you for rating.' : 'Could not save your rating.', ok ? '' : 'gold'); if (ok) finish(); };
        if (!s || !t.id) return done(false);
        s.timeout(8000).emit('trip:rate', { tripId: t.id, rating: stars, tags: tags, comment: (AR.$('#comment', el).value || '').trim() || undefined }, function (err, res) { done(!err && !!res && res.success !== false); });
      });
    }
  });

  // ------------------------------------------- live events and app resume
  var wired = false;
  function wire() {
    if (wired || !AR.store()) return; wired = true;
    AR.store().subscribe(function (state, ev, payload) {
      var top = AR.nav.current && AR.nav.current();
      var name = top && top.name;
      if (ev === 'TRIP_ACCEPTED') {
        R.cur = Object.assign({}, R.cur || {}, (payload && payload.trip) || payload || {});
        R.driver = (payload && payload.driver) || R.cur.driver || null;
        if (name === 'searching' || name === 'options') AR.nav.replace('tracking'); else if (R.onTrack) R.onTrack('status');
        AR.haptic([30, 40, 30]); AR.toast('A captain accepted your trip.');
      } else if (ev === 'DRIVER_MOVED') { if (R.onTrack) R.onTrack('moved', payload); }
      else if (ev === 'DRIVER_ARRIVED' || ev === 'TRIP_IN_TRANSIT') {
        R.cur = Object.assign({}, R.cur || {}, payload || {});
        if (payload && payload.driver) R.driver = payload.driver;
        if (R.onTrack) R.onTrack('status');
        AR.toast(ev === 'DRIVER_ARRIVED' ? 'Your captain has arrived.' : 'Your trip has started.');
      } else if (ev === 'TRIP_COMPLETED') {
        R.cur = Object.assign({}, R.cur || {}, (payload && payload.trip) || payload || {});
        if (name === 'tracking') AR.nav.replace('completed');
      } else if (ev === 'TRIP_CANCELLED') {
        if (R.selfCancel) { R.selfCancel = false; return; }
        if (name === 'searching' || name === 'tracking') {
          AR.sheet.open({ html: '<h2>This trip ended</h2><p class="dim">' + AR.esc((payload && payload.reason) || 'Your captain cancelled.') + '</p><button class="btn btn-gold mt24" id="ok">Back to home</button>', onOpen: function (c) { AR.$('#ok', c.el).addEventListener('click', function () { c.close(); AR.nav.resetTo('home'); }); } });
        }
      } else if (ev === 'CHAT_MESSAGE' || ev === 'CHAT_THREAD') {
        var dot = AR.$('#chat-unread-dot'); if (dot) dot.classList.toggle('hidden', !(AR.store().chatState().unread > 0));
      }
    });
    AR.onSocket('trip:no_drivers', function (p) {
      var top = AR.nav.current && AR.nav.current();
      if (top && top.name === 'searching') {
        AR.sheet.open({ html: '<h2>No captains available right now</h2><p class="dim">All nearby captains are busy. Please try again in a few minutes.</p>' + (p && p.debug ? '<div class="suggest mt16" style="align-items:flex-start">' + AR.icon('info', 20) + '<span><b>Test server info</b><br>' + p.debug.map(AR.esc).join('<br>') + '</span></div>' : '') + '<div class="stack gap12 mt24"><button class="btn btn-gold" id="again">Try again</button><button class="btn btn-ghost" style="width:100%" id="home">Back to home</button></div>',
          onOpen: function (c) {
            AR.$('#again', c.el).addEventListener('click', function () { c.close(); AR.nav.replace('options'); });
            AR.$('#home', c.el).addEventListener('click', function () { c.close(); AR.nav.resetTo('home'); });
          } });
      }
    });
  }

  // On app start: is a trip already running?
  R.resume = async function () {
    wire();
    try {
      var d = await AR.api('/trips/active');
      var t = d && d.activeTrip; if (!t) return;
      R.cur = t; R.driver = t.driver || null;
      AR.trip.serviceType = t.serviceType || 'RIDE'; AR.trip.tierId = String(t.tier || 'moto').toLowerCase();
      AR.trip.pickup = { lat: t.pickupLat, lng: t.pickupLng, name: t.pickupAddress };
      AR.trip.dest = { lat: t.dropoffLat, lng: t.dropoffLng, name: t.dropoffAddress };
      AR.trip.stops = (t.stops || []).map(function (s) { return { lat: s.lat, lng: s.lng, name: s.address || s.name || 'Stop' }; });
      AR.trip.quote = { route: { polyline: [[t.pickupLat, t.pickupLng], [t.dropoffLat, t.dropoffLng]] }, tiers: [] };
      AR.nav.go(t.status === 'REQUESTED' || t.status === 'OFFERED' ? 'searching' : 'tracking', {}, { anim: 'fade' });
    } catch (_) { /* no active trip */ }
  };
  document.addEventListener('DOMContentLoaded', function () { setTimeout(wire, 500); });
})();
