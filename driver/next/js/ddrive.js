// ============================================================================
// Aarohan Captain: the trip itself (pickup, PIN, drive, collect cash, complete, rate the rider).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, D = AR.D;
  var CANCEL = ['The rider is not at the pickup', 'The rider asked me to cancel', 'My vehicle has a problem', 'I feel unsafe', 'The pickup is too far', 'Other'];
  var selfCancel = false;
  var pt = function (t) { return { lat: t.pickupLat, lng: t.pickupLng }; };
  var dt = function (t) { return { lat: t.dropoffLat, lng: t.dropoffLng }; };
  function navUrl(p) { return 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lng + '&travelmode=driving'; }
  function riderOf(t) { var r = t.rider || {}; return { name: (r.user && r.user.name) || r.name || t.riderName || 'Rider', phone: (r.user && r.user.phone) || r.phone || t.riderPhone || '' }; }
  function parcelOf(t) { return t.parcelDetail || t.parcel || null; }

  D.resume = async function () {
    try {
      var d = await AR.api('/trips/active'), t = d && d.activeTrip;
      if (t && ['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'].indexOf(t.status) !== -1) { D.trip = t; D.online = true; D.startGps(); AR.nav.go('drive', {}, { anim: 'fade' }); }
    } catch (_) {}
  };

  AR.register('drive', {
    locked: true,
    mount: function (el) {
      var T = D.trip, parcel = T.serviceType === 'PARCEL', pin = '';
      // Make sure the shared store knows this is the active trip (after a reload it forgets), so chat and rating work.
      try { var ss = AR.store().getState(); if (!ss.activeTrip || ss.activeTrip.id !== T.id) { ss.activeTrip = Object.assign({}, ss.activeTrip || {}, T); AR.store().saveState(ss); } } catch (_) {}
      el.innerHTML = '<div class="map-wrap"><div class="map" id="mp"></div></div><button class="sos-fab" id="sos" aria-label="Safety">' + AR.icon('shield', 18) + '<span>SOS</span></button><div class="t-sheet" id="sh"></div>';
      var map = AR.map.create(AR.$('#mp', el), { center: pt(T), zoom: 15 }), me = null;
      AR.map.marker(map, pt(T), 'steel'); AR.map.marker(map, dt(T), 'gold');
      var line = L.polyline([[T.pickupLat, T.pickupLng], [T.dropoffLat, T.dropoffLng]], { color: AR.css('--route'), weight: 4, dashArray: '6 9', opacity: 0.9 }).addTo(map);
      map.fitBounds(line.getBounds(), { paddingTopLeft: [40, 90], paddingBottomRight: [40, 340], maxZoom: 16 });
      D.onMove = function (c) { if (!me) me = AR.map.marker(map, c, 'vehicle', AR.icon('moto', 18)); else me.setLatLng([c.lat, c.lng]); };
      if (D.coords) D.onMove(D.coords);

      function paint() {
        var t = D.trip, st = t.status, r = riderOf(t), p = parcelOf(t), sh = AR.$('#sh', el);
        var head = st === 'ARRIVED' ? (parcel ? 'Collect the parcel' : 'Waiting for the rider') : (st === 'IN_TRANSIT' ? (parcel ? 'Deliver the parcel' : 'Take the rider to drop-off') : 'Head to the pickup');
        var addr = st === 'IN_TRANSIT' ? t.dropoffAddress : t.pickupAddress;
        var away = D.coords && st === 'DRIVER_ARRIVING' ? AR.fmt.km(D.km(D.coords, pt(t))) + ' away' : '';
        var html = '<div class="sheet-handle"></div><div class="status-line">' + head + '</div><div class="dim ellipsis" style="margin-top:2px">' + AR.esc(addr) + (away ? ' · ' + away : '') + '</div>';
        if (st === 'DRIVER_ARRIVING') {
          html += (t.pickupNote ? '<div class="suggest mt12">' + AR.icon('pin', 20) + '<span><b>Rider says:</b> ' + AR.esc(t.pickupNote) + '</span></div>' : '') + (t.callOnArrival ? '<div class="suggest mt12">' + AR.icon('phone', 20) + '<span>The rider asked you to call when you are close.</span></div>' : '');
        } else if (st === 'ARRIVED') {
          html += '<div class="mt16 center small dim">' + (parcel ? 'Ask the sender for the 4-digit pickup code.' : 'Ask the rider for their 4-digit PIN.') + '</div><div class="pin-input mt12" id="pin"><input inputmode="numeric" maxlength="1"/><input inputmode="numeric" maxlength="1"/><input inputmode="numeric" maxlength="1"/><input inputmode="numeric" maxlength="1"/></div><div class="hint err hide center mt12" id="perr"></div>' +
            (parcel && p && p.payer !== 'RECEIVER_AT_DELIVERY' ? '<div class="suggest mt12">' + AR.icon('wallet', 20) + '<span>The sender pays in cash now. Collect <b>' + AR.fmt.money(t.fareMWK) + '</b> before you leave.</span></div>' : '');
        } else {
          html += (parcel && p ? '<div class="card mt12"><div class="kv"><span>Receiver</span><b>' + AR.esc(p.recipientName) + '</b></div><div class="kv"><span>Receiver phone</span><b>' + AR.esc(p.recipientPhone) + '</b></div><div class="kv"><span>Item</span><b>' + AR.esc((p.category || '') + (p.weightKg ? ', ' + p.weightKg + ' kg' : '') + (p.fragile ? ', fragile' : '')) + '</b></div></div>' : '') + ((t.stops || []).length ? '<div class="small dim mt12">Stops: ' + t.stops.map(function (s) { return AR.esc(s.address || s.name || 'Stop'); }).join(' then ') + '</div>' : '');
        }
        html += '<div class="actions" style="grid-template-columns:repeat(3,1fr)"><button class="action" id="a-nav">' + AR.icon('map', 22) + '<span>Navigate</span></button><button class="action" id="a-chat">' + AR.icon('chat', 22) + '<span>Chat</span><span id="chat-unread-dot" class="chat-dot hidden"></span></button><button class="action" id="a-call">' + AR.icon('phone', 22) + '<span>Call</span></button></div>';
        html += st === 'DRIVER_ARRIVING' ? '<button class="btn btn-gold mt12" id="arrived">I have arrived</button>' : (st === 'ARRIVED' ? '<button class="btn btn-gold mt12" id="start" disabled>Start trip</button>' : '<button class="btn btn-gold mt12" id="finish">Complete trip</button>');
        if (st !== 'IN_TRANSIT') html += '<button class="btn btn-ghost" id="cancel" style="width:100%;margin-top:4px">Cancel trip</button>';
        sh.innerHTML = html;
        AR.$('#a-nav', sh).addEventListener('click', function () { window.open(navUrl(st === 'IN_TRANSIT' ? dt(t) : pt(t)), '_blank'); });
        AR.$('#a-chat', sh).addEventListener('click', function () { window.openChatDrawer(); });
        AR.$('#a-call', sh).addEventListener('click', function () { var ph = st === 'IN_TRANSIT' && parcel && p ? p.recipientPhone : r.phone; if (ph) location.href = 'tel:' + ph; else AR.toast('Phone number is not available. Use chat.'); });
        var b;
        if ((b = AR.$('#arrived', sh))) b.addEventListener('click', function () { b.classList.add('is-loading'); AR.store().driverArrived(t.id, function (res) { b.classList.remove('is-loading'); if (res && res.success) { D.trip = Object.assign({}, D.trip, res.trip || {}, { status: 'ARRIVED' }); paint(); } else AR.toast((res && res.error) || 'Could not update.', 'gold'); }); });
        if (st === 'ARRIVED') pinBoxes(sh);
        if ((b = AR.$('#finish', sh))) b.addEventListener('click', function () { complete(); });
        if ((b = AR.$('#cancel', sh))) b.addEventListener('click', function () { askCancel(); });
        var cs = AR.store().chatState ? AR.store().chatState() : null, dot = AR.$('#chat-unread-dot', sh); if (dot && cs) dot.classList.toggle('hidden', !(cs.unread > 0));
      }

      function pinBoxes(sh) {
        var ins = AR.$$('#pin input', sh), go = AR.$('#start', sh);
        function read() { pin = ins.map(function (i) { return i.value; }).join(''); go.disabled = pin.length !== 4; }
        ins.forEach(function (inp, i) {
          inp.addEventListener('input', function () { inp.value = inp.value.replace(/\D/g, '').slice(0, 1); if (inp.value && ins[i + 1]) ins[i + 1].focus(); read(); });
          inp.addEventListener('keydown', function (e) { if (e.key === 'Backspace' && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
        });
        go.addEventListener('click', function () {
          go.classList.add('is-loading'); var e = AR.$('#perr', sh); e.classList.add('hide');
          AR.store().startTransit({ tripId: D.trip.id, pin: pin }, function (res) {
            go.classList.remove('is-loading');
            if (res && res.success) { D.trip = Object.assign({}, D.trip, res.trip || {}, { status: 'IN_TRANSIT' }); AR.haptic(25); paint(); }
            else { e.textContent = (res && res.error) || 'That PIN is not correct.'; e.classList.remove('hide'); ins.forEach(function (i) { i.value = ''; }); ins[0].focus(); read(); }
          });
        });
        setTimeout(function () { ins[0].focus(); }, 300);
      }

      function complete() {
        var t = D.trip, p = parcelOf(t), recv = parcel && p && p.payer === 'RECEIVER_AT_DELIVERY', unknownPayer = parcel && !p, code = '', cash = !parcel || recv || unknownPayer, ack = !cash;
        AR.sheet.open({
          html: '<h2>Complete this ' + (parcel ? 'delivery' : 'trip') + '?</h2>' + (parcel ? '<p class="dim small">Ask the receiver for the 4-digit delivery code.</p><input class="input otp mt12" id="dc" inputmode="numeric" maxlength="4" placeholder="0000"/><p class="small dim mt8">Only hand over the parcel after the receiver tells you this code. No code, no delivery.</p><button class="btn btn-ghost mt8" style="width:100%" id="nocode">The receiver cannot give the code</button>' : '') +
            (cash ? '<div class="card mt16 center"><div class="small dim">' + (unknownPayer ? 'Collect in cash unless the sender already paid you' : 'Collect in cash') + '</div><div class="big-rating" style="font-size:40px">' + AR.fmt.money(t.fareMWK) + '</div></div><button class="consent mt16" id="ack" style="text-align:left"><span class="check">' + AR.icon('check', 16) + '</span><span>I have collected the cash.</span></button>' : '<p class="dim mt12">The sender already paid you at pickup.</p>') +
            '<div class="hint err hide mt12" id="e"></div><div class="stack gap12 mt16"><button class="btn btn-gold" id="ok" disabled>Complete</button><button class="btn btn-ghost" style="width:100%" id="back">Not yet</button></div>',
          onOpen: function (c) {
            var ok = AR.$('#ok', c.el), dc = AR.$('#dc', c.el), a = AR.$('#ack', c.el);
            function ready() { ok.disabled = !((!parcel || (dc.value.length === 4)) && ack); }
            if (dc) dc.addEventListener('input', function () { dc.value = dc.value.replace(/\D/g, '').slice(0, 4); ready(); });
            if (a) a.addEventListener('click', function () { ack = !ack; AR.$('.check', a).classList.toggle('on', ack); ready(); });
            AR.$('#back', c.el).addEventListener('click', function () { c.close(); }); ready();
            var nc = AR.$('#nocode', c.el); if (nc) nc.addEventListener('click', function () { c.close(); setTimeout(function () { noCodeHelp(t, p); }, 320); });
            ok.addEventListener('click', function () {
              ok.classList.add('is-loading');
              AR.store().completeTrip({ tripId: t.id, paymentMethod: 'CASH', recipientPin: dc ? dc.value : undefined }, function (res) {
                if (res && res.success) { c.close(); D.done = Object.assign({}, D.trip, res.trip || {}, { status: 'COMPLETED' }); AR.haptic([30, 40, 30]); AR.nav.replace('trip-done'); }
                else { ok.classList.remove('is-loading'); var e = AR.$('#e', c.el); e.textContent = (res && res.error) || 'Could not complete the trip.'; e.classList.remove('hide'); }
              });
            });
          }
        });
      }

      // Parcel delivery without a code: call the receiver, then the sender, then contact Aarohan support.
      function noCodeHelp(t, p) {
        var recvPhone = p && p.recipientPhone, sendPhone = riderOf(t).phone;
        AR.sheet.open({
          html: '<h2>Receiver cannot give the code</h2><p class="dim small">The delivery can only be completed with the code. Follow these steps in order. Do not leave the parcel with anyone without it.</p>' +
            '<div class="stack gap12 mt16">' +
            '<div class="card"><div style="font-weight:700">1. Call the receiver</div>' + (recvPhone ? '<a class="btn btn-line mt8" style="width:100%" href="tel:' + AR.esc(recvPhone) + '">Call ' + AR.esc((p && p.recipientName) || 'receiver') + '</a>' : '<div class="small dim mt8">No receiver number is available.</div>') + '</div>' +
            '<div class="card"><div style="font-weight:700">2. Call the customer who booked</div>' + (sendPhone ? '<a class="btn btn-line mt8" style="width:100%" href="tel:' + AR.esc(sendPhone) + '">Call the customer</a>' : '<div class="small dim mt8">Use the chat to reach the customer.</div>') + '</div>' +
            '<div class="card"><div style="font-weight:700">3. Nobody answers? Contact Aarohan support</div><div class="small dim mt8">We will see your trip, the parcel and your location, and tell you what to do.</div><button class="btn btn-gold mt8" style="width:100%" id="nc-support">Contact support about this parcel</button><div class="hint err hide mt8" id="nc-err"></div></div>' +
            '</div><button class="btn btn-ghost mt16" style="width:100%" id="nc-back">Back to the code</button>',
          onOpen: function (c) {
            AR.$('#nc-back', c.el).addEventListener('click', function () { c.close(); setTimeout(complete, 320); });
            AR.$('#nc-support', c.el).addEventListener('click', async function () {
              var b = this, e = AR.$('#nc-err', c.el); b.classList.add('is-loading'); e.classList.add('hide');
              try {
                await AR.api('/tickets', { method: 'POST', body: { tripId: t.id, category: 'PARCEL_ISSUE', priority: 'HIGH', subject: 'Parcel delivery: receiver cannot give the delivery code', description: 'The captain reached the drop-off. The receiver could not give the delivery code and the captain could not reach them by phone. Please contact the captain and the customer. Trip ' + t.id + '.' } });
                c.close(); setTimeout(function () { AR.sheet.open({ html: '<h2>Aarohan support has been told</h2><p class="dim">Wait near the drop-off. A support agent will contact you and the customer. Keep the parcel with you until you are told what to do.</p><button class="btn btn-gold mt24" id="ok">OK</button>', onOpen: function (d) { AR.$('#ok', d.el).addEventListener('click', function () { d.close(); }); } }); }, 320);
              } catch (err) { b.classList.remove('is-loading'); e.textContent = (err && err.message) || 'Could not reach support. Call the customer or try again.'; e.classList.remove('hide'); }
            });
          }
        });
      }

      function askCancel() {
        var chosen = null;
        AR.sheet.open({
          html: '<h2>Why are you cancelling?</h2><p class="dim small">Cancelling too often can affect your account.</p><div class="mt16" id="rs">' + CANCEL.map(function (r, i) { return '<button class="reason" data-i="' + i + '"><span class="radio"></span><span>' + r + '</span></button>'; }).join('') + '</div><div class="stack gap12 mt16"><button class="btn btn-gold" id="ok" disabled>Cancel trip</button><button class="btn btn-ghost" style="width:100%" id="keep">Keep the trip</button></div>',
          onOpen: function (c) {
            AR.$$('.reason', c.el).forEach(function (b) { b.addEventListener('click', function () { chosen = CANCEL[+b.dataset.i]; AR.$$('.reason', c.el).forEach(function (x) { x.classList.toggle('on', x === b); }); AR.$('#ok', c.el).disabled = false; }); });
            AR.$('#keep', c.el).addEventListener('click', function () { c.close(); });
            AR.$('#ok', c.el).addEventListener('click', function () { this.classList.add('is-loading'); selfCancel = true; AR.store().cancelTrip(chosen, function () { c.close(true); AR.toast('Trip cancelled.'); D.trip = null; AR.nav.resetTo('home'); }); });
          }
        });
      }

      AR.$('#sos', el).addEventListener('click', function () {
        AR.sheet.open({ html: '<h2>Need help?</h2><p class="dim">An SOS alerts the Aarohan safety team with your location and trip. <b>If you are in immediate danger, call 997 first.</b></p><div class="stack gap12 mt24"><button class="btn btn-gold" id="send">Send SOS to Aarohan</button><a class="btn btn-line" href="tel:997">Call 997 (police)</a><button class="btn btn-ghost" style="width:100%" id="no">I am safe</button></div>',
          onOpen: function (c) { AR.$('#no', c.el).addEventListener('click', function () { c.close(); }); AR.$('#send', c.el).addEventListener('click', async function () { this.classList.add('is-loading'); var res = await AR.store().triggerSOS('DRIVER', 'Captain pressed SOS during a trip'); c.close(); setTimeout(function () { AR.sheet.open({ html: res && res.delivered ? '<h2>The safety team has been alerted</h2><p class="dim">Aarohan has your location and trip. If you are in danger, call 997 now.</p><a class="btn btn-gold mt24" href="tel:997">Call 997</a>' : '<h2>We could not reach Aarohan</h2><p class="dim">Your SOS was not delivered. Please call 997 or someone you trust right now.</p><a class="btn btn-gold mt24" href="tel:997">Call 997</a>' }); }, 420); }); } });
      });

      D.onTripEvent = function (ev, payload) {
        if (ev === 'TRIP_CANCELLED') {
          if (selfCancel) { selfCancel = false; return; }
          AR.sheet.open({ dismissable: false, html: '<h2>The rider cancelled</h2><p class="dim">' + AR.esc((payload && payload.reason) || 'This trip was cancelled.') + '</p><button class="btn btn-gold mt24" id="ok">Back to home</button>', onOpen: function (c) { AR.$('#ok', c.el).addEventListener('click', function () { c.close(); D.trip = null; AR.nav.resetTo('home'); }); } });
        } else if (ev === 'CHAT_MESSAGE' || ev === 'CHAT_THREAD') { var dot = AR.$('#chat-unread-dot'); if (dot) dot.classList.toggle('hidden', !(AR.store().chatState().unread > 0)); }
      };
      paint();
      return { destroy: function () { D.onTripEvent = null; D.onMove = null; try { map.remove(); } catch (_) {} } };
    }
  });

  // ------------------------------------------------------------ trip finished
  AR.register('trip-done', {
    locked: true,
    mount: function (el) {
      var t = D.done || {}, stars = 0, tags = [], earned = t.driverShareMWK != null ? t.driverShareMWK : t.fareMWK;
      el.innerHTML = '<div class="scroll" style="padding-top:calc(var(--safe-top) + 20px)"><div class="done-hero"><div class="done-ring"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.3 4.3 8.7-9.6"/></svg></div><h1 style="font-size:28px">Trip complete</h1><div class="fare-big mt8">' + AR.fmt.money(earned) + '</div><p class="dim">your earnings</p></div>' +
        '<div class="card mt16"><div class="kv"><span>Fare collected in cash</span><b>' + AR.fmt.money(t.fareMWK) + '</b></div>' + (t.commissionMWK ? '<div class="kv"><span>Aarohan commission</span><b>' + AR.fmt.money(t.commissionMWK) + '</b></div>' : '') + '<div class="kv"><span>From</span><b>' + AR.esc(t.pickupAddress) + '</b></div><div class="kv"><span>To</span><b>' + AR.esc(t.dropoffAddress) + '</b></div></div>' +
        '<h3 class="center" style="margin-top:26px;font-size:20px">How was the rider?</h3><div class="stars mt12" id="stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<button data-s="' + n + '" aria-label="' + n + ' stars">' + AR.icon('star', 38) + '</button>'; }).join('') + '</div>' +
        '<div class="chips mt16" id="tags" style="justify-content:center">' + ['Polite', 'On time', 'Easy pickup', 'Clear directions'].map(function (x) { return '<button class="chip" data-tag="' + x + '">' + x + '</button>'; }).join('') + '</div>' +
        '<div class="stack gap12 mt24"><button class="btn btn-gold" id="submit" disabled>Submit rating</button><button class="btn btn-ghost" style="width:100%" id="skip">Done</button></div></div>';
      var submit = AR.$('#submit', el);
      AR.$$('[data-s]', el).forEach(function (b) { b.addEventListener('click', function () { stars = +b.dataset.s; AR.$$('[data-s]', el).forEach(function (x) { x.classList.toggle('on', +x.dataset.s <= stars); }); submit.disabled = false; }); });
      AR.$$('[data-tag]', el).forEach(function (b) { b.addEventListener('click', function () { b.classList.toggle('on'); tags = AR.$$('[data-tag].on', el).map(function (x) { return x.dataset.tag; }); }); });
      function finish() { D.trip = null; D.done = null; try { AR.loadTrips(true); } catch (_) {} AR.nav.resetTo('home'); }
      AR.$('#skip', el).addEventListener('click', finish);
      submit.addEventListener('click', function () {
        submit.classList.add('is-loading'); var s = AR.store().socket;
        if (!s || !t.id) { AR.toast('Could not save the rating.', 'gold'); return finish(); }
        s.timeout(8000).emit('trip:rate', { tripId: t.id, rating: stars, tags: tags }, function (err, res) { AR.toast(!err && res && res.success !== false ? 'Thank you.' : 'Could not save the rating.', !err && res && res.success !== false ? '' : 'gold'); finish(); });
      });
    }
  });
})();
