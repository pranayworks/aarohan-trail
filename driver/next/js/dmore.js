// ============================================================================
// Aarohan Captain: more tools for drivers (performance, commission statement, expenses, invite, goal, breaks).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, D = AR.D;
  var upd = function (e) { return e && e.status === 404 ? 'This part needs the Aarohan server to be updated. Restart the server and try again.' : (e && e.message) || 'Something went wrong.'; };

  // ------------------------------------------------ expenses (kept on this phone)
  var KEY = 'aarohan_drv_expenses', KINDS = ['Fuel', 'Repairs', 'Airtime and data', 'Parking and fines', 'Other'];
  function loadEx() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
  function saveEx(l) { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, 500))); } catch (_) {} }
  D.expensesSince = function (d) { return loadEx().filter(function (e) { return new Date(e.at) >= d; }).reduce(function (a, e) { return a + e.amount; }, 0); };
  D.goal = { get: function () { try { return parseInt(localStorage.getItem('aarohan_drv_goal') || '0', 10) || 0; } catch (_) { return 0; } }, set: function (n) { try { localStorage.setItem('aarohan_drv_goal', String(n)); } catch (_) {} } };

  AR.register('expenses', {
    mount: function (el) {
      var b = AR.page(el, 'Expenses'); var kind = KINDS[0];
      function paint() {
        var list = loadEx().sort(function (a, c) { return new Date(c.at) - new Date(a.at); });
        var m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0); var month = D.expensesSince(m0), byKind = {};
        list.filter(function (e) { return new Date(e.at) >= m0; }).forEach(function (e) { byKind[e.kind] = (byKind[e.kind] || 0) + e.amount; });
        b.innerHTML = '<div class="card money-hero"><div class="small dim" style="font-weight:600">Spent this month</div><div class="big">' + AR.fmt.money(month) + '</div><div class="small dim mt8">Kept only on this phone</div></div>' +
          (Object.keys(byKind).length ? '<div class="card mt12">' + Object.keys(byKind).map(function (k) { return '<div class="kv"><span>' + AR.esc(k) + '</span><b>' + AR.fmt.money(byKind[k]) + '</b></div>'; }).join('') + '</div>' : '') +
          '<div class="section-title">Add an expense</div><div class="card"><div class="stack gap12"><div class="chips" id="kinds">' + KINDS.map(function (k) { return '<button class="chip ' + (kind === k ? 'on' : '') + '" data-k="' + k + '">' + k + '</button>'; }).join('') + '</div><input class="input" id="amt" inputmode="numeric" placeholder="Amount in MK"/><input class="input" id="note" maxlength="60" placeholder="Note (optional)"/><div class="hint err hide" id="err"></div><button class="btn btn-gold" id="add">Save expense</button></div></div>' +
          '<div class="section-title">Recent</div>' + (list.length ? '<div class="list">' + list.slice(0, 30).map(function (e) { return '<div class="row"><span class="grow" style="min-width:0"><div class="r-title">' + AR.esc(e.kind) + (e.note ? ' · ' + AR.esc(e.note) : '') + '</div><div class="r-sub">' + AR.esc(AR.fmt.dateTime(e.at)) + '</div></span><b class="num">' + AR.fmt.money(e.amount) + '</b><button class="icon-btn plain" data-del="' + e.id + '" aria-label="Delete">' + AR.icon('trash', 18) + '</button></div>'; }).join('') + '</div>' : '<div class="card dim small">No expenses yet. Add fuel and repairs to see your real profit.</div>');
        AR.$$('[data-k]', b).forEach(function (x) { x.addEventListener('click', function () { kind = x.dataset.k; AR.$$('[data-k]', b).forEach(function (y) { y.classList.toggle('on', y === x); }); }); });
        AR.$$('[data-del]', b).forEach(function (x) { x.addEventListener('click', function () { saveEx(loadEx().filter(function (e) { return e.id !== x.dataset.del; })); paint(); }); });
        AR.$('#add', b).addEventListener('click', function () {
          var amt = parseInt(AR.$('#amt', b).value, 10), err = AR.$('#err', b);
          if (!(amt > 0) || amt > 5000000) { err.textContent = 'Enter the amount in kwacha.'; err.classList.remove('hide'); return; }
          var l = loadEx(); l.push({ id: 'e' + Date.now().toString(36), amount: amt, kind: kind, note: AR.$('#note', b).value.trim(), at: new Date().toISOString() }); saveEx(l); AR.toast('Expense saved.'); paint();
        });
      }
      paint();
    }
  });

  // ---------------------------------------------------------- my performance
  AR.register('performance', {
    mount: function (el) {
      var b = AR.page(el, 'My performance'); b.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      (async function () {
        try {
          var p = await AR.api('/driver/performance'), rate = function (v) { return v == null ? '-' : v + '%'; };
          var tip = p.acceptanceRate != null && p.acceptanceRate < 60 ? 'You missed or declined many offers. Accepting more keeps you near the top of the queue.' : (p.cancellationRate != null && p.cancellationRate > 10 ? 'You cancel more than most captains. Cancelling after accepting costs riders time and can affect your account.' : 'You are doing well. Keep your rating high by being on time and polite.');
          b.innerHTML = '<div class="card center" style="padding:26px 16px"><div class="big-rating">' + Number(p.rating || 5).toFixed(1) + '</div><div class="stars mt12" style="gap:4px">' + [1, 2, 3, 4, 5].map(function (n) { return '<span class="' + (n <= Math.round(p.rating || 5) ? 'gold' : 'faint') + '">' + AR.icon('star', 22) + '</span>'; }).join('') + '</div><div class="small dim mt8">' + p.ratingCount + ' ratings from riders</div></div>' +
            '<div class="section-title">Last ' + p.days + ' days</div><div class="stats" style="margin-top:0"><div class="stat"><b>' + p.completed + '</b><span>Trips done</span></div><div class="stat"><b>' + rate(p.acceptanceRate) + '</b><span>Accepted</span></div><div class="stat"><b>' + rate(p.cancellationRate) + '</b><span>You cancelled</span></div></div>' +
            '<div class="card mt12"><div class="kv"><span>Offers you received</span><b>' + p.offers + '</b></div><div class="kv"><span>Accepted</span><b>' + p.accepted + '</b></div><div class="kv"><span>Declined</span><b>' + p.declined + '</b></div><div class="kv"><span>Missed (timed out)</span><b>' + p.missed + '</b></div><div class="kv"><span>Trips you cancelled</span><b>' + p.cancelledByYou + '</b></div></div>' +
            '<div class="suggest mt16">' + AR.icon('info', 20) + '<span>' + AR.esc(tip) + '</span></div>';
        } catch (e) { b.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + AR.esc(upd(e)) + '</p></div>'; }
      })();
    }
  });

  // ------------------------------------------------------ commission statement
  AR.register('commission', {
    mount: function (el) {
      var b = AR.page(el, 'Commission'); b.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      var ST = { PENDING_VERIFICATION: ['Waiting for verification', ''], VERIFIED: ['Verified', 'steel'], REJECTED: ['Rejected', 'gold'] };
      async function load() {
        try {
          var c = await AR.api('/driver/commission'), pct = Math.min(100, Math.round(c.debtMWK / c.limitMWK * 100));
          var msg = c.level === 'BLOCKED' ? 'You have reached the limit, so you cannot go online until you pay.' : (c.level === 'HIGH' ? 'You are close to the limit. Pay soon so you do not lose trips.' : 'You are well within the limit.');
          b.innerHTML = '<div class="card"><div class="small dim" style="font-weight:600">You owe Aarohan</div><div class="num" style="font-size:36px;font-weight:700">' + AR.fmt.money(c.debtMWK) + '</div><div class="progress mt12"><i style="width:0" data-w="' + pct + '%"></i></div><div class="hstack small dim mt8" style="justify-content:space-between"><span>' + pct + '% of your limit</span><span>Limit ' + AR.fmt.money(c.limitMWK) + '</span></div><p class="small mt12" style="color:' + (c.level === 'OK' ? 'var(--text-dim)' : 'var(--gold-300)') + ';font-weight:600">' + msg + '</p>' + (c.pendingMWK ? '<p class="small dim mt8">' + AR.fmt.money(c.pendingMWK) + ' is waiting to be verified by our team.</p>' : '') + '<button class="btn btn-gold mt16" id="pay" ' + (c.debtMWK > 0 ? '' : 'disabled') + '>Pay commission</button></div>' +
            '<div class="section-title">How it works</div><div class="card small dim">You collect the full fare in cash and keep it. Aarohan\'s share is added here after every cash trip. Pay it by Airtel Money or TNM Mpamba, enter the reference, and our team verifies it. Set aside a part of every trip so you can pay easily.</div>' +
            '<div class="section-title">Your payments</div>' + (c.remittances.length ? '<div class="list">' + c.remittances.map(function (r) { var s = ST[r.status] || ST.PENDING_VERIFICATION; return AR.row({ icon: 'wallet', title: AR.fmt.money(r.amountMWK), sub: AR.fmt.dateTime(r.submittedAt) + (r.reviewNotes ? ' · ' + r.reviewNotes : ''), end: '<span class="badge ' + s[1] + '">' + s[0] + '</span>' }); }).join('') + '</div>' : '<div class="card dim small">No payments yet.</div>');
          setTimeout(function () { var i = AR.$('[data-w]', b); if (i) i.style.width = i.dataset.w; }, 120);
          AR.$('#pay', b).addEventListener('click', function () { D.payCommission(c.debtMWK, load); });
        } catch (e) { b.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + AR.esc(upd(e)) + '</p></div>'; }
      }
      load(); return { show: load };
    }
  });

  // ---------------------------------------------------------------- invite friends
  AR.register('invite', {
    mount: function (el) {
      var b = AR.page(el, 'Invite friends'); b.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      (async function () {
        try {
          var r = await AR.api('/me/rewards'), link = location.origin + '/rider/next/', msg = 'Ride or drive with Aarohan in Lilongwe. Use my code ' + r.referralCode + ' when you sign up. ' + link;
          b.innerHTML = '<div class="card center" style="padding:24px 16px"><h2 style="font-size:24px">Bring a friend to Aarohan</h2><p class="dim mt8">Share your code with riders and with other people who want to drive.</p></div><div class="section-title">Your code</div><div class="code-box"><b>' + AR.esc(r.referralCode) + '</b><button class="btn btn-gold btn-sm" id="share">' + AR.icon('share', 18) + 'Share</button></div><button class="btn btn-line mt12" id="copy">' + AR.icon('copy', 20) + 'Copy code</button><div class="stats mt16"><div class="stat"><b>' + r.referredCount + '</b><span>Friends joined</span></div></div>';
          AR.$('#share', b).addEventListener('click', function () { if (navigator.share) navigator.share({ title: 'Aarohan', text: msg }).catch(function () {}); else navigator.clipboard.writeText(msg).then(function () { AR.toast('Invite copied.'); }); });
          AR.$('#copy', b).addEventListener('click', function () { navigator.clipboard.writeText(r.referralCode).then(function () { AR.toast('Code copied.'); }); });
        } catch (e) { b.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      })();
    }
  });

  // ---------------------------------------------------------- break mode
  D.breakUntil = 0; var breakTimer = null;
  D.startBreak = async function (mins) {
    var r = await D.setOnline(false); if (!r.success) return AR.toast(r.error || 'Could not start the break.', 'gold');
    D.breakUntil = Date.now() + mins * 60000; clearInterval(breakTimer);
    breakTimer = setInterval(function () {
      if (Date.now() >= D.breakUntil) { clearInterval(breakTimer); D.breakUntil = 0; AR.haptic([40, 60, 40]); AR.sheet.open({ html: '<h2>Break over</h2><p class="dim">Ready to go back online?</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="on">Go online</button><button class="btn btn-ghost" style="width:100%" id="later">Not yet</button></div>', onOpen: function (c) { AR.$('#on', c.el).addEventListener('click', async function () { this.classList.add('is-loading'); var x = await D.setOnline(true); c.close(); if (!x.success) AR.toast(x.error || 'Could not go online.', 'gold'); else if (AR.nav.tabs.home && AR.nav.tabs.home.inst.show) AR.nav.tabs.home.inst.show(); }); AR.$('#later', c.el).addEventListener('click', function () { c.close(); }); } }); }
      if (D.onBreakTick) D.onBreakTick();
    }, 1000);
    AR.toast('Break started. You are offline.'); if (AR.nav.tabs.home && AR.nav.tabs.home.inst.show) AR.nav.tabs.home.inst.show();
  };
  D.endBreak = function () { clearInterval(breakTimer); D.breakUntil = 0; };
})();
