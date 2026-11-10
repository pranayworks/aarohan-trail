// ============================================================================
// Aarohan rider: Activity (trip history with filters, sorting and full details).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;

  var STATUS = { COMPLETED: 'Completed', CANCELLED_BY_RIDER: 'Cancelled', CANCELLED_BY_DRIVER: 'Cancelled by captain', EXPIRED: 'No captain found', NO_DRIVERS: 'No captain found', REQUESTED: 'No captain found', OFFERED: 'No captain found', DRIVER_ARRIVING: 'Not completed', ARRIVED: 'Not completed', IN_TRANSIT: 'Not completed' };
  var TIER_LABEL = { MOTO: 'Moto', AUTO: 'Auto', CAB: 'Cab' };

  // One simple shape for every screen that shows a trip.
  AR.tripView = function (t) {
    var d = t.driver || {}, v = d.vehicle || {};
    var done = t.status === 'COMPLETED';
    return {
      raw: t, id: t.id, isParcel: t.serviceType === 'PARCEL',
      tier: TIER_LABEL[String(t.tier || '').toUpperCase()] || AR.fmt.cap(t.tier),
      status: t.status, statusLabel: STATUS[t.status] || AR.fmt.cap(t.status), done: done, cancelled: !done,
      from: t.pickupAddress, to: t.dropoffAddress, stops: t.stops || [],
      when: done ? (t.completedAt || t.createdAt) : (t.cancelledAt || t.createdAt),
      fare: t.fareMWK, plate: v.plateNumber || '', model: v.makeModel || '', color: v.color || '',
      driver: (d.user && d.user.name) || '', driverRating: d.rating,
      given: (t.ratings && t.ratings[0] && t.ratings[0].stars) || null,
      tickets: t.supportTickets || [], parcel: t.parcelDetail || null, reason: t.cancelReason || ''
    };
  };

  var cache = { at: 0, list: null };
  AR.tripsCached = function () { return cache.list; };
  AR.loadTrips = async function (force) {
    if (!force && cache.list && Date.now() - cache.at < 15000) return cache.list;
    var d = await AR.api('/trips/history');
    cache = { at: Date.now(), list: (d.trips || []).map(AR.tripView) };
    return cache.list;
  };

  function card(tv, i) {
    return '<button class="trip-card" data-id="' + AR.esc(tv.id) + '" style="animation-delay:' + Math.min(i, 8) * 40 + 'ms">' +
      '<div class="tc-top"><div class="hstack gap8"><span class="r-ic" style="width:34px;height:34px;border-radius:11px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:' + (tv.done ? 'var(--gold-300)' : 'var(--silver-500)') + '">' + AR.icon(tv.isParcel ? 'parcel' : AR.vehicleIcon(tv.tier.toLowerCase()), 20) + '</span>' +
      '<div><div style="font-weight:700">' + (tv.isParcel ? 'Parcel' : AR.esc(tv.tier)) + '</div><div class="tiny dim">' + AR.esc(AR.fmt.dateTime(tv.when)) + '</div></div></div>' +
      '<div style="text-align:right"><div class="num" style="font-weight:700;font-size:17px;' + (tv.done ? '' : 'color:var(--silver-500);text-decoration:line-through') + '">' + AR.fmt.money(tv.fare) + '</div><span class="badge ' + (tv.done ? 'steel' : '') + '">' + AR.esc(tv.statusLabel) + '</span></div></div>' +
      '<div class="tc-route"><div class="mini-rail"><i></i><b></b><em></em></div><div class="grow" style="min-width:0"><div class="ellipsis">' + AR.esc(tv.from) + '</div><div class="ellipsis" style="margin-top:6px;font-weight:600">' + AR.esc(tv.to) + '</div></div></div>' +
      (tv.plate ? '<div class="hstack gap8 mt12 small dim">' + AR.icon('car', 16) + '<span>' + AR.esc(tv.model || 'Vehicle') + (tv.color ? ', ' + AR.esc(tv.color) : '') + '</span><span class="plate" style="font-size:12px;padding:1px 8px">' + AR.esc(tv.plate) + '</span></div>' : '') + '</button>';
  }
  AR.tripCardHtml = card;

  // ---------------------------------------------------------------- activity
  AR.register('activity', {
    mount: function (el) {
      var F = { type: 'ALL', status: 'ALL', month: 'ALL', sort: 'NEW' };
      el.innerHTML = '<div class="topbar"><button class="icon-btn" data-tabback aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>Activity</h1><button class="icon-btn" id="sortbtn" aria-label="Sort">' + AR.icon('sort', 20) + '</button></div>' +
        '<div class="filters" id="f-type"></div><div class="filters" id="f-status" style="padding-top:0"></div>' +
        '<div style="padding:0 var(--pad) 12px" id="f-month-wrap"></div><div class="scroll with-tabs" id="list" style="padding-top:0"></div>';
      var sumHtml = function (rows) {
        var now = AR.fmt.month(new Date()), m = rows.filter(function (t) { return t.done && AR.fmt.month(t.when) === now; });
        if (!m.length) return '';
        var spent = m.reduce(function (a, t) { return a + (t.fare || 0); }, 0), km = m.reduce(function (a, t) { return a + (t.raw.distanceKm || 0); }, 0);
        return '<div class="card mb" style="margin-bottom:14px"><div class="small dim" style="font-weight:600">' + now + '</div><div class="stats" style="margin:8px 0 0"><div class="stat"><b>' + m.length + '</b><span>Trips</span></div><div class="stat"><b>' + AR.fmt.money(spent) + '</b><span>Spent</span></div><div class="stat"><b>' + AR.fmt.km(km) + '</b><span>Travelled</span></div></div></div>';
      };
      AR.$('[data-tabback]', el).addEventListener('click', function () { AR.nav.tab('home'); });
      var list = AR.$('#list', el), data = [];

      function chips(host, items, key) {
        host.innerHTML = items.map(function (c) { return '<button class="chip ' + (F[key] === c[0] ? 'on' : '') + '" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('');
        AR.$$('.chip', host).forEach(function (b) { b.addEventListener('click', function () { F[key] = b.dataset.v; chips(host, items, key); paint(); }); });
      }
      chips(AR.$('#f-type', el), [['ALL', 'All'], ['RIDE', 'Rides'], ['PARCEL', 'Parcels']], 'type');
      chips(AR.$('#f-status', el), [['ALL', 'Any status'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']], 'status');

      function months() {
        var seen = {}, out = [];
        data.forEach(function (t) { var k = AR.fmt.month(t.when); if (!seen[k]) { seen[k] = 1; out.push(k); } });
        var host = AR.$('#f-month-wrap', el);
        host.innerHTML = out.length > 1 ? '<select class="select" id="month" style="min-height:44px;font-size:15px"><option value="ALL">All months</option>' + out.map(function (m) { return '<option ' + (F.month === m ? 'selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' : '';
        var s = AR.$('#month', el); if (s) s.addEventListener('change', function () { F.month = s.value; paint(); });
      }

      function filtered() {
        var r = data.filter(function (t) {
          if (F.type === 'RIDE' && t.isParcel) return false;
          if (F.type === 'PARCEL' && !t.isParcel) return false;
          if (F.status === 'COMPLETED' && !t.done) return false;
          if (F.status === 'CANCELLED' && !t.cancelled) return false;
          if (F.month !== 'ALL' && AR.fmt.month(t.when) !== F.month) return false;
          return true;
        });
        r.sort(function (a, b) {
          if (F.sort === 'OLD') return new Date(a.when) - new Date(b.when);
          if (F.sort === 'HIGH') return (b.fare || 0) - (a.fare || 0);
          if (F.sort === 'LOW') return (a.fare || 0) - (b.fare || 0);
          return new Date(b.when) - new Date(a.when);
        });
        return r;
      }

      function paint() {
        var r = filtered();
        if (!r.length) {
          list.innerHTML = '<div class="empty">' + AR.icon('activity', 44) + '<h3>' + (data.length ? 'Nothing matches' : 'No trips yet') + '</h3><p>' + (data.length ? 'Try a different filter.' : 'Your rides and parcels will show up here.') + '</p></div>';
          return;
        }
        var byDate = F.sort === 'NEW' || F.sort === 'OLD', last = '', html = '';
        r.forEach(function (t, i) {
          var m = AR.fmt.month(t.when);
          if (byDate && m !== last) { html += '<div class="month-head">' + m + '</div>'; last = m; }
          html += card(t, i);
        });
        list.innerHTML = (F.type === 'ALL' && F.status === 'ALL' && F.month === 'ALL' ? sumHtml(data) : '') + html;
        AR.$$('.trip-card', list).forEach(function (b) { b.addEventListener('click', function () { AR.nav.go('trip-detail', { id: b.dataset.id }); }); });
      }

      AR.$('#sortbtn', el).addEventListener('click', function () {
        var opts = [['NEW', 'Newest first'], ['OLD', 'Oldest first'], ['HIGH', 'Fare: high to low'], ['LOW', 'Fare: low to high']];
        AR.sheet.open({ html: '<h2>Sort trips</h2><div class="mt16">' + opts.map(function (o) { return '<button class="reason ' + (F.sort === o[0] ? 'on' : '') + '" data-s="' + o[0] + '"><span class="radio"></span><span>' + o[1] + '</span></button>'; }).join('') + '</div>',
          onOpen: function (c) { AR.$$('[data-s]', c.el).forEach(function (b) { b.addEventListener('click', function () { F.sort = b.dataset.s; c.close(); paint(); }); }); } });
      });

      async function load(force) {
        if (AR.tripsCached()) { data = AR.tripsCached(); months(); paint(); } else list.innerHTML = '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>';
        try { data = await AR.loadTrips(force); months(); paint(); }
        catch (e) { list.innerHTML = '<div class="empty">' + AR.icon('warning', 44) + '<h3>Could not load your trips</h3><p>' + AR.esc(e.message) + '</p><button class="btn btn-line mt16" id="retry" style="width:auto;display:inline-flex">Try again</button></div>'; AR.$('#retry', list).addEventListener('click', function () { load(true); }); }
      }
      load(false);
      return { show: function () { load(true); } };
    }
  });

  // ------------------------------------------------------------ trip details
  AR.register('trip-detail', {
    mount: function (el, params) {
      el.innerHTML = '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>Trip details</h1></div><div class="scroll" id="body"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>';
      AR.$('[data-back]', el).addEventListener('click', function () { AR.nav.back(); });
      var body = AR.$('#body', el);
      (async function () {
        var tv;
        try { tv = (await AR.loadTrips(false)).filter(function (x) { return x.id === params.id; })[0]; } catch (_) {}
        if (!tv) { body.innerHTML = '<div class="empty"><h3>Trip not found</h3></div>'; return; }
        var t = tv.raw, p = tv.parcel;
        var when = function (x) { return x ? AR.fmt.dateTime(x) : ''; };
        var row = function (k, v) { return v ? '<div class="kv"><span>' + k + '</span><b>' + AR.esc(v) + '</b></div>' : ''; };
        body.innerHTML =
          '<div class="card"><div class="hstack gap12"><span class="avatar" style="border-radius:16px;background:var(--surface-3);color:var(--gold-300)">' + AR.icon(tv.isParcel ? 'parcel' : AR.vehicleIcon(tv.tier.toLowerCase()), 26) + '</span><div class="grow"><div style="font-weight:700;font-size:18px">' + (tv.isParcel ? 'Parcel delivery' : AR.esc(tv.tier) + ' ride') + '</div><div class="small dim">' + AR.esc(when(tv.when)) + '</div></div><span class="badge ' + (tv.done ? 'steel' : '') + '">' + AR.esc(tv.statusLabel) + '</span></div></div>' +
          '<div class="section-title">Route</div><div class="card"><div class="route-line"><div class="route-rail" style="padding:6px 0"><i></i><b></b><em></em></div><div class="route-stops">' +
          '<div class="route-stop"><span>' + AR.esc(tv.from) + '</span></div>' + tv.stops.map(function (s, i) { return '<div class="route-stop"><span class="small steel" style="font-weight:800;width:10px">' + (i + 1) + '</span><span>' + AR.esc(s.address || s.name || 'Stop') + '</span></div>'; }).join('') +
          '<div class="route-stop"><span>' + AR.esc(tv.to) + '</span></div></div></div>' + row('Pickup note', t.pickupNote) + row('Distance', t.distanceKm ? AR.fmt.km(t.distanceKm) : '') + row('Trip time', t.durationMins ? t.durationMins + ' min' : '') + '</div>' +
          (tv.plate || tv.driver ? '<div class="section-title">Vehicle and captain</div><div class="card">' + row('Vehicle', (tv.model || tv.tier) + (tv.color ? ', ' + tv.color : '')) + row('Number plate', tv.plate) + row('Captain', tv.driver) + row('Captain rating', tv.driverRating ? Number(tv.driverRating).toFixed(1) + ' / 5' : '') + row('You rated', tv.given ? tv.given + ' / 5' : '') + '</div>' : '') +
          '<div class="section-title">Time</div><div class="card">' + row('Booked', when(t.createdAt)) + row('Captain accepted', when(t.acceptedAt)) + row('Arrived at pickup', when(t.arrivedAt)) + row('Trip started', when(t.startedAt)) + row(tv.done ? 'Completed' : 'Cancelled', when(tv.done ? t.completedAt : t.cancelledAt)) + '</div>' +
          '<div class="section-title">Payment</div><div class="card">' + row('Fare', AR.fmt.money(tv.fare)) + row('Booking fee', t.bookingFeeMWK ? AR.fmt.money(t.bookingFeeMWK) : '') + row('Stop fee', t.stopFeeMWK ? AR.fmt.money(t.stopFeeMWK) : '') + row('Paid with', 'Cash') + '</div>' +
          (p ? '<div class="section-title">Parcel</div><div class="card">' + row('Item', p.category) + row('Weight', p.weightKg ? p.weightKg + ' kg' : '') + row('Size', AR.fmt.cap(p.size)) + row('Fragile', p.fragile ? 'Yes' : 'No') + row('Receiver', p.recipientName) + row('Receiver phone', p.recipientPhone) + row('Who paid', p.payer === 'RECEIVER_AT_DELIVERY' ? 'Receiver, on delivery' : 'Sender, at pickup') + row('Notes', p.notes) + '</div>' : '') +
          (tv.cancelled && tv.reason ? '<div class="section-title">Why it was cancelled</div><div class="card">' + AR.esc(tv.reason) + '</div>' : '') +
          '<div class="section-title">Booking</div><div class="card">' + row('Booking number', String(tv.id).slice(0, 8).toUpperCase()) + '</div>' +
          (tv.tickets.length ? '<div class="section-title">Your tickets for this trip</div><div class="list">' + tv.tickets.map(function (k) { return '<button class="row" data-tk="' + AR.esc(k.id) + '"><span class="r-ic">' + AR.icon('ticket', 20) + '</span><span class="grow"><div class="r-title ellipsis">' + AR.esc(k.subject) + '</div><div class="r-sub">' + AR.esc(AR.fmt.cap(k.status)) + '</div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></button>'; }).join('') + '</div>' : '') +
          '<div class="stack gap12 mt24"><button class="btn btn-gold" id="raise">' + AR.icon('ticket', 20) + 'Raise a ticket about this trip</button>' + (tv.done ? '<button class="btn btn-line" id="receipt">' + AR.icon('share', 20) + 'Share receipt</button>' : '') + (tv.done && !tv.isParcel ? '<button class="btn btn-line" id="again">Book this trip again</button>' : '') + '</div>';
        AR.$('#raise', body).addEventListener('click', function () { AR.nav.go('new-ticket', { tripId: tv.id, subject: (tv.isParcel ? 'Parcel to ' : 'Trip to ') + tv.to }); });
        AR.$$('[data-tk]', body).forEach(function (b) { b.addEventListener('click', function () { AR.nav.go('ticket', { id: b.dataset.tk }); }); });
        var rc = AR.$('#receipt', body);
        if (rc) rc.addEventListener('click', function () {
          var text = 'Aarohan receipt\n' + (tv.isParcel ? 'Parcel delivery' : tv.tier + ' ride') + ' on ' + AR.fmt.dateTime(tv.when) + '\nFrom: ' + tv.from + '\nTo: ' + tv.to + (tv.plate ? '\nVehicle: ' + (tv.model || tv.tier) + ' (' + tv.plate + ')' : '') + '\nFare: ' + AR.fmt.money(tv.fare) + ' (cash)\nBooking: ' + String(tv.id).slice(0, 8).toUpperCase();
          if (navigator.share) navigator.share({ title: 'Aarohan receipt', text: text }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { AR.toast('Receipt copied.'); });
        });
        var again = AR.$('#again', body);
        if (again) again.addEventListener('click', function () {
          AR.newTrip('RIDE'); AR.trip.dest = { lat: t.dropoffLat, lng: t.dropoffLng, name: t.dropoffAddress };
          AR.trip.pickup = AR.trip.pickup || { lat: t.pickupLat, lng: t.pickupLng, name: t.pickupAddress };
          AR.nav.resetTo('home'); setTimeout(function () { AR.nav.go('options'); }, 350);
        });
      })();
    }
  });
})();
