// ============================================================================
// Aarohan Captain: Earnings, commission, daily goals and bonuses, trip history.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, D = AR.D;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------------------------------------------------------------- earnings
  AR.register('earnings', {
    mount: function (el) {
      el.innerHTML = '<div class="topbar"><h1>Earnings</h1></div><div class="scroll with-tabs" id="body"><div class="skeleton" style="height:150px"></div><div class="skeleton sk-row mt16"></div></div>';
      var body = AR.$('#body', el);
      async function load() {
        var list = [], sum = null;
        try { list = await AR.loadTrips(false); } catch (_) {}
        try { if (D.driverId) sum = await AR.api('/driver/financial-summary/' + D.driverId); } catch (_) {}
        var t0 = D.dayStart(), done = list.filter(function (t) { return t.done; });
        var today = done.filter(function (t) { return new Date(t.when) >= t0; }), todayEarn = today.reduce(function (a, t) { return a + (t.fare || 0); }, 0);
        var days = []; for (var i = 6; i >= 0; i--) { var s = new Date(t0.getTime() - i * 86400000), e = new Date(s.getTime() + 86400000); var sumd = done.filter(function (t) { var w = new Date(t.when); return w >= s && w < e; }).reduce(function (a, t) { return a + (t.fare || 0); }, 0); days.push({ d: DAYS[new Date(s.getTime() + 2 * 3600000).getUTCDay()], v: sumd }); }
        var max = Math.max.apply(null, days.map(function (x) { return x.v; }).concat([1])), week = days.reduce(function (a, x) { return a + x.v; }, 0);
        var com = null; try { com = await AR.api('/driver/commission'); } catch (_) {}
        var debt = com ? com.debtMWK : (sum ? sum.commissionDebtMWK : 0);
        var cashToday = today.reduce(function (a, t) { return a + (t.gross || 0); }, 0), commToday = today.reduce(function (a, t) { return a + ((t.raw && t.raw.commissionMWK) || 0); }, 0);
        var exp7 = D.expensesSince ? D.expensesSince(new Date(t0.getTime() - 6 * 86400000)) : 0, goal = D.goal ? D.goal.get() : 0, pctDebt = com ? Math.min(100, Math.round(debt / com.limitMWK * 100)) : 0;
        body.innerHTML = '<div class="card money-hero"><div class="small dim" style="font-weight:600">Today</div><div class="big" id="big">MK 0</div><div class="small dim mt8">' + today.length + (today.length === 1 ? ' trip' : ' trips') + ' completed</div></div>' +
          '<div class="card mt12"><div class="hstack" style="justify-content:space-between"><b>Last 7 days</b><span class="small dim">' + AR.fmt.money(week) + '</span></div><div class="bars">' + days.map(function (x) { return '<div><i data-h="' + Math.max(4, Math.round(x.v / max * 100)) + '%" style="height:4px"></i><span>' + x.d + '</span></div>'; }).join('') + '</div></div>' +
          (sum ? '<div class="section-title">All time</div><div class="card"><div class="kv"><span>Trips completed</span><b>' + sum.tripsCompleted + '</b></div><div class="kv"><span>Your earnings</span><b>' + AR.fmt.money(sum.netEarningsMWK) + '</b></div><div class="kv"><span>Cash collected from riders</span><b>' + AR.fmt.money(sum.cashCollectedMWK) + '</b></div><div class="kv"><span>Aarohan commission</span><b>' + AR.fmt.money(sum.platformCommissionMWK) + '</b></div></div>' : '') +
          '<div class="section-title">Set aside today</div><div class="card"><div class="kv"><span>Cash collected today</span><b>' + AR.fmt.money(cashToday) + '</b></div><div class="kv"><span>Keep for Aarohan\'s commission</span><b>' + AR.fmt.money(commToday) + '</b></div><div class="kv"><span>Yours to keep</span><b>' + AR.fmt.money(cashToday - commToday) + '</b></div></div>' +
          '<div class="section-title">Real profit (7 days)</div><div class="card"><div class="kv"><span>Earned</span><b>' + AR.fmt.money(week) + '</b></div><div class="kv"><span>Expenses</span><b>- ' + AR.fmt.money(exp7) + '</b></div><div class="kv"><span>You kept</span><b>' + AR.fmt.money(week - exp7) + '</b></div></div>' +
          '<div class="section-title">My daily goal</div><div class="card">' + (goal ? '<div class="hstack" style="justify-content:space-between"><b>' + AR.fmt.money(todayEarn) + ' of ' + AR.fmt.money(goal) + '</b><button class="btn btn-ghost btn-sm" id="goalbtn" style="padding:0">Change</button></div><div class="progress mt12"><i style="width:' + Math.min(100, Math.round(todayEarn / goal * 100)) + '%"></i></div>' + (todayEarn >= goal ? '<div class="small mt8" style="font-weight:600">Goal reached. Great work today.</div>' : '<div class="small dim mt8">' + AR.fmt.money(goal - todayEarn) + ' to go</div>') : '<div class="small dim">Set how much you want to earn each day and follow your progress.</div><button class="btn btn-line btn-sm mt12" id="goalbtn">Set my goal</button>') + '</div>' +
          '<div class="section-title">Commission</div><div class="card"><div class="hstack" style="justify-content:space-between"><div><div class="small dim">You owe Aarohan</div><div class="num" style="font-size:26px;font-weight:700">' + AR.fmt.money(debt) + '</div></div><button class="btn btn-gold btn-sm" id="pay" ' + (debt > 0 ? '' : 'disabled') + '>Pay commission</button></div>' + (com ? '<div class="progress mt12"><i style="width:' + pctDebt + '%"></i></div><div class="tiny dim mt8">' + pctDebt + '% of your ' + AR.fmt.money(com.limitMWK) + ' limit' + (com.level === 'BLOCKED' ? ' · you cannot go online until you pay' : (com.level === 'HIGH' ? ' · getting close, pay soon' : '')) + '</div>' : '') +
          '<p class="small dim mt12">You keep the cash from each trip. Aarohan\'s share is added here, and you pay it by mobile money.' + (sum && sum.pendingRemittancesMWK ? ' ' + AR.fmt.money(sum.pendingRemittancesMWK) + ' is waiting to be verified.' : '') + '</p></div>' +
          '<div class="list mt16">' + AR.row({ id: 'inc', icon: 'star', title: 'Daily goals and bonuses', sub: 'Reach trip goals to earn more', gold: true }) + AR.row({ id: 'stmt', icon: 'wallet', title: 'Commission statement', sub: 'What you owe and what you paid' }) + AR.row({ id: 'perf', icon: 'star', title: 'My performance', sub: 'Acceptance, cancellations, rating' }) + AR.row({ id: 'exp', icon: 'file', title: 'Expenses', sub: 'Fuel, repairs and more' }) + '</div>';
        var n = 0, target = todayEarn, big = AR.$('#big', body), step = Math.max(1, Math.ceil(target / 28)); var tm = setInterval(function () { n = Math.min(target, n + step); big.textContent = AR.fmt.money(n); if (n >= target) clearInterval(tm); }, 24);
        setTimeout(function () { AR.$$('.bars i', body).forEach(function (b) { b.style.height = b.dataset.h; }); }, 100);
        (function () { var slot = document.createElement('div'); slot.className = 'hide'; slot.style.marginTop = '12px'; body.insertBefore(slot, body.firstChild ? body.firstChild.nextSibling : null); AR.ads.mount(slot, 'DRIVER', 'EARNINGS'); })();
        AR.bindRows(body, { inc: function () { AR.nav.go('incentives'); }, stmt: function () { AR.nav.go('commission'); }, perf: function () { AR.nav.go('performance'); }, exp: function () { AR.nav.go('expenses'); } });
        var gb = AR.$('#goalbtn', body);
        if (gb) gb.addEventListener('click', function () {
          AR.sheet.open({ html: '<h2>My daily goal</h2><p class="dim small">How much do you want to earn each day?</p><input class="input mt16" id="g" inputmode="numeric" placeholder="e.g. 20000" value="' + (goal || '') + '"/><div class="stack gap12 mt16"><button class="btn btn-gold" id="ok">Save goal</button>' + (goal ? '<button class="btn btn-ghost" style="width:100%" id="clr">Remove goal</button>' : '') + '</div>',
            onOpen: function (c) { AR.$('#ok', c.el).addEventListener('click', function () { var v = parseInt(AR.$('#g', c.el).value, 10); if (!(v > 0)) return AR.toast('Enter an amount in kwacha.', 'gold'); D.goal.set(v); c.close(); load(); }); var cl = AR.$('#clr', c.el); if (cl) cl.addEventListener('click', function () { D.goal.set(0); c.close(); load(); }); } });
        });
        AR.$('#pay', body).addEventListener('click', function () { payCommission(debt, load); });
      }
      load();
      return { show: function () { AR.loadTrips(true).catch(function () {}).then(load); } };
    }
  });

  D.payCommission = payCommission;
  function payCommission(debt, after) {
    var net = 'AIRTEL_MONEY';
    AR.sheet.open({
      html: '<h2>Pay commission</h2><p class="dim small">Send the money to Aarohan by mobile money first, then enter the details here so our team can verify it.</p><div class="stack gap12 mt16"><div class="field"><label>Amount paid (MK)</label><input class="input" id="amt" inputmode="numeric" value="' + (debt || '') + '"/></div><div class="chips" id="net"><button class="chip on" data-n="AIRTEL_MONEY">Airtel Money</button><button class="chip" data-n="TNM_MPAMBA">TNM Mpamba</button></div><div class="field"><label>Transaction reference</label><input class="input" id="ref" maxlength="40" placeholder="The code in the confirmation message"/></div><div class="hint err hide" id="e"></div><button class="btn btn-gold" id="ok">Submit for verification</button></div>',
      onOpen: function (c) {
        AR.$$('[data-n]', c.el).forEach(function (b) { b.addEventListener('click', function () { net = b.dataset.n; AR.$$('[data-n]', c.el).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
        AR.$('#ok', c.el).addEventListener('click', async function () {
          var amt = parseInt(AR.$('#amt', c.el).value, 10), ref = AR.$('#ref', c.el).value.trim(), e = AR.$('#e', c.el);
          var fail = function (m) { e.textContent = m; e.classList.remove('hide'); };
          if (!(amt > 0)) return fail('Enter the amount you paid.'); if (ref.length < 4) return fail('Enter the transaction reference.');
          this.classList.add('is-loading');
          try { await AR.api('/driver/cash-settlement/submit', { method: 'POST', body: { amount: amt, provider: net, reference: ref } }); c.close(); AR.toast('Submitted. We will verify it soon.'); if (after) after(); }
          catch (er) { this.classList.remove('is-loading'); fail(er.message); }
        });
      }
    });
  }

  // ------------------------------------------------------ goals and bonuses
  AR.register('incentives', {
    mount: function (el) {
      var b = AR.page(el, 'Daily goals'); b.innerHTML = '<div class="skeleton" style="height:140px"></div>';
      (async function () {
        try {
          var d = await AR.api('/driver/incentives');
          if (!d.enabled) { b.innerHTML = '<div class="empty">' + AR.icon('star', 44) + '<h3>No goals right now</h3><p>New goals and bonuses will appear here.</p></div>'; return; }
          var top = d.tiers[d.tiers.length - 1];
          b.innerHTML = '<div class="card money-hero"><div class="small dim" style="font-weight:600">Trips completed today</div><div class="big">' + d.today + '</div><div class="small dim mt8">' + d.week + ' in the last 7 days</div></div>' +
            '<div class="section-title">Today\'s goals</div><div class="stack gap12 stagger">' + d.tiers.map(function (t) {
              var pct = Math.min(100, Math.round(d.today / t.trips * 100));
              return '<div class="card"><div class="hstack" style="justify-content:space-between"><div><div style="font-weight:700;font-size:17px">Complete ' + t.trips + ' trips today</div><div class="small dim">' + (t.bonusMWK ? 'Earn a ' + AR.fmt.money(t.bonusMWK) + ' bonus' : 'Bonus set by Aarohan') + '</div></div>' + (t.reached ? '<span class="badge steel">Reached</span>' : '<span class="badge">' + t.remaining + ' to go</span>') + '</div><div class="progress mt12"><i style="width:0" data-w="' + pct + '%"></i></div><div class="tiny dim mt8">' + Math.min(d.today, t.trips) + ' of ' + t.trips + '</div></div>';
            }).join('') + '</div><div class="card mt16 small dim">' + AR.esc(d.note) + ' Goals reset every day at midnight, Malawi time.</div>';
          setTimeout(function () { AR.$$('.progress i', b).forEach(function (i) { i.style.width = i.dataset.w; }); }, 120);
        } catch (e) { b.innerHTML = '<div class="empty"><h3>Could not load goals</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      })();
    }
  });

  // ------------------------------------------------------------ trip history
  AR.register('trips', {
    mount: function (el) {
      var F = { type: 'ALL', st: 'ALL' }, data = [];
      el.innerHTML = '<div class="topbar"><h1>Trips</h1></div><div class="filters" id="f1"></div><div class="filters" id="f2" style="padding-top:0"></div><div class="scroll with-tabs" id="list" style="padding-top:0"></div>';
      var list = AR.$('#list', el);
      function chips(host, items, key) { host.innerHTML = items.map(function (c) { return '<button class="chip ' + (F[key] === c[0] ? 'on' : '') + '" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join(''); AR.$$('.chip', host).forEach(function (b) { b.addEventListener('click', function () { F[key] = b.dataset.v; chips(host, items, key); paint(); }); }); }
      chips(AR.$('#f1', el), [['ALL', 'All'], ['RIDE', 'Rides'], ['PARCEL', 'Parcels']], 'type'); chips(AR.$('#f2', el), [['ALL', 'Any status'], ['DONE', 'Completed'], ['CANC', 'Cancelled']], 'st');
      function paint() {
        var r = data.filter(function (t) { return (F.type === 'ALL' || (F.type === 'PARCEL') === t.isParcel) && (F.st === 'ALL' || (F.st === 'DONE') === t.done); }).sort(function (a, b) { return new Date(b.when) - new Date(a.when); });
        if (!r.length) { list.innerHTML = '<div class="empty">' + AR.icon('activity', 44) + '<h3>' + (data.length ? 'Nothing matches' : 'No trips yet') + '</h3><p>' + (data.length ? 'Try another filter.' : 'Trips you complete will show up here.') + '</p></div>'; return; }
        var last = '', html = ''; r.forEach(function (t, i) { var m = AR.fmt.month(t.when); if (m !== last) { html += '<div class="month-head">' + m + '</div>'; last = m; } html += AR.tripCardHtml(t, i); });
        list.innerHTML = html; AR.$$('.trip-card', list).forEach(function (b) { b.addEventListener('click', function () { AR.nav.go('driver-trip', { id: b.dataset.id }); }); });
      }
      async function load(force) {
        if (AR.tripsCached()) { data = AR.tripsCached(); paint(); } else list.innerHTML = '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>';
        try { data = await AR.loadTrips(force); paint(); } catch (e) { list.innerHTML = '<div class="empty"><h3>Could not load trips</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      }
      load(false); return { show: function () { load(true); } };
    }
  });

  AR.register('driver-trip', {
    mount: function (el, params) {
      var b = AR.page(el, 'Trip details'); b.innerHTML = '<div class="skeleton sk-row"></div>';
      AR.loadTrips(false).then(function (l) {
        var t = l.filter(function (x) { return x.id === params.id; })[0]; if (!t) { b.innerHTML = '<div class="empty"><h3>Trip not found</h3></div>'; return; }
        var r = t.raw, row = function (k, v) { return v ? '<div class="kv"><span>' + k + '</span><b>' + AR.esc(v) + '</b></div>' : ''; }, when = function (x) { return x ? AR.fmt.dateTime(x) : ''; }, p = t.parcel;
        b.innerHTML = '<div class="card"><div class="hstack gap12"><div class="grow"><div style="font-weight:700;font-size:18px">' + (t.isParcel ? 'Parcel delivery' : AR.esc(t.tier) + ' ride') + '</div><div class="small dim">' + AR.esc(when(t.when)) + '</div></div><span class="badge ' + (t.done ? 'steel' : '') + '">' + AR.esc(t.statusLabel) + '</span></div></div>' +
          '<div class="section-title">Route</div><div class="card"><div class="route-line"><div class="route-rail" style="padding:6px 0"><i></i><b></b><em></em></div><div class="route-stops"><div class="route-stop"><span>' + AR.esc(t.from) + '</span></div><div class="route-stop"><span>' + AR.esc(t.to) + '</span></div></div></div>' + row('Distance', r.distanceKm ? AR.fmt.km(r.distanceKm) : '') + row('Pickup note', r.pickupNote) + '</div>' +
          '<div class="section-title">Money</div><div class="card">' + row('Your earnings', t.done ? AR.fmt.money(t.fare) : '') + row('Fare paid by the rider', AR.fmt.money(t.gross)) + row('Aarohan commission', r.commissionMWK ? AR.fmt.money(r.commissionMWK) : '') + row('Tip', t.tip ? AR.fmt.money(t.tip) : '') + row('Paid with', 'Cash') + '</div>' +
          '<div class="section-title">Time</div><div class="card">' + row('Accepted', when(r.acceptedAt)) + row('Arrived', when(r.arrivedAt)) + row('Started', when(r.startedAt)) + row(t.done ? 'Completed' : 'Cancelled', when(t.done ? r.completedAt : r.cancelledAt)) + '</div>' +
          (p ? '<div class="section-title">Parcel</div><div class="card">' + row('Item', p.category) + row('Weight', p.weightKg ? p.weightKg + ' kg' : '') + row('Receiver', p.recipientName) + row('Who paid', p.payer === 'RECEIVER_AT_DELIVERY' ? 'Receiver, on delivery' : 'Sender, at pickup') + '</div>' : '') +
          (t.cancelled && t.reason ? '<div class="section-title">Why it was cancelled</div><div class="card">' + AR.esc(t.reason) + '</div>' : '') +
          '<button class="btn btn-gold mt24" id="raise">' + AR.icon('ticket', 20) + 'Raise a ticket about this trip</button>';
        AR.$('#raise', b).addEventListener('click', function () { AR.nav.go('new-ticket', { tripId: t.id, subject: 'Trip to ' + t.to }); });
      }).catch(function () { b.innerHTML = '<div class="empty"><h3>Could not load</h3></div>'; });
    }
  });
})();
