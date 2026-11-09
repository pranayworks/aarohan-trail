// ============================================================================
// Aarohan Captain: Account, documents and vehicle, help, settings.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, D = AR.D;
  var DOCS = { NUMBER_PLATE_PHOTO: 'Number plate photo', VEHICLE_PHOTO: 'Photo of your vehicle', NATIONAL_ID: 'National ID', DRIVING_LICENSE: 'Driving licence', VEHICLE_REGISTRATION: 'Vehicle registration', CERTIFICATE_OF_FITNESS: 'Certificate of fitness', INSURANCE_CERTIFICATE: 'Insurance certificate' };
  var FAQ = [
    ['Money and commission', 'wallet', [['How does commission work?', 'You keep the cash from each trip. Aarohan\'s commission is added to what you owe, and you pay it by mobile money from the Earnings tab. Enter the transaction reference so our team can verify it.'], ['Why can I not go online?', 'If the commission you owe is too high, going online is blocked until you pay. Open Earnings and tap Pay commission.'], ['I did not get my bonus', 'Bonuses are checked and paid by Aarohan staff. Raise a ticket with the date and the number of trips you completed.']], 'PAYMENT_DISPUTE'],
    ['Trips and riders', 'route', [['The rider gave a wrong PIN', 'Ask the rider to read the PIN from their screen. You can try again. If it keeps failing, contact support from the trip screen.'], ['The rider did not show up', 'Wait a few minutes, call or chat with them, and if they do not arrive cancel with the reason "The rider is not at the pickup".'], ['A rider was rude or unsafe', 'If you feel unsafe press SOS and call 997. Afterwards raise a ticket and choose the trip.']], 'OTHER'],
    ['Documents and account', 'file', [['My document expires soon', 'Raise a ticket and attach the new document details. We will help you replace it so you can keep driving.'], ['I want to change my details', 'For safety, identity and vehicle details can only be changed by support. Raise a ticket and tell us what to correct.']], 'OTHER'],
    ['App problems', 'settings', [['The app is slow', 'Turn on Low-data mode in Settings, and check your signal.'], ['I am not getting trips', 'Make sure you are online, location is on, and you stay on the Home screen. Trips depend on riders nearby.']], 'APP_ISSUE']
  ];

  AR.register('account', {
    mount: function (el) {
      function paint() {
        var p = AR.state.profile || {}, a = D.app || {}, v = a.vehicle;
        el.innerHTML = '<div class="topbar"><h1>Account</h1></div><div class="scroll with-tabs"><div class="profile-head"><span class="avatar">' + AR.esc(AR.fmt.initials(p.name)) + '</span><span class="grow" style="min-width:0"><div style="font-family:var(--font-display);font-size:22px;font-weight:700" class="ellipsis">' + AR.esc(p.name || 'Captain') + '</div><div class="small dim">' + (v ? AR.esc(v.makeModel) + ' · ' + AR.esc(v.plateNumber) : 'Aarohan Captain') + '</div></span><span class="rating-pill">' + AR.icon('star', 16) + Number(a.rating || 5).toFixed(1) + '</span></div>' +
          '<div class="stats" style="margin-top:0"><div class="stat"><b>' + (a.tripsCompleted || 0) + '</b><span>Trips</span></div><div class="stat"><b>' + (a.ratingCount || 0) + '</b><span>Ratings</span></div><div class="stat"><b>' + (p.memberSince ? AR.fmt.month(p.memberSince).split(' ')[0].slice(0, 3) : '-') + '</b><span>Joined</span></div></div>' +
          '<div class="list stagger mt16">' + AR.row({ id: 'docs', icon: 'file', title: 'Documents and vehicle', sub: 'Status and expiry dates' }) + AR.row({ id: 'inc', icon: 'star', title: 'Daily goals and bonuses', gold: true }) + AR.row({ id: 'perf', icon: 'star', title: 'My performance', sub: 'Acceptance, cancellations, rating' }) + AR.row({ id: 'stmt', icon: 'wallet', title: 'Commission statement' }) + AR.row({ id: 'exp', icon: 'file', title: 'Expenses', sub: 'Fuel, repairs and more' }) + AR.row({ id: 'invite', icon: 'gift', title: 'Invite friends' }) + AR.row({ id: 'help', icon: 'help', title: 'Help', sub: 'Questions and tickets' }) + AR.row({ id: 'safety', icon: 'shieldCheck', title: 'Safety', sub: 'Emergency contacts' }) + AR.row({ id: 'notifications', icon: 'bell', title: 'Notifications' }) + AR.row({ id: 'language', icon: 'map', title: AR.t('language'), sub: AR.lang.get() === 'ny' ? 'Chichewa' : 'English' }) + AR.row({ id: 'settings', icon: 'settings', title: 'Settings' }) + '</div></div>';
        var go = function (n) { return function () { AR.nav.go(n, n === 'language' ? {} : undefined); }; };
        AR.bindRows(el, { docs: go('d-docs'), inc: go('incentives'), perf: go('performance'), stmt: go('commission'), exp: go('expenses'), invite: go('invite'), help: go('help'), safety: go('safety'), notifications: go('notifications'), language: go('language'), settings: go('d-settings') });
      }
      paint(); return { show: async function () { try { await AR.session.refresh(); await AR.D.reloadApp(); } catch (_) {} paint(); } };
    }
  });

  AR.register('d-docs', {
    mount: function (el) {
      var b = AR.page(el, 'Documents and vehicle'); var a = D.app || { documents: {}, requiredDocuments: [], vehicle: null, kyc: null };
      b.innerHTML = (a.vehicle ? '<div class="card">' + [['Vehicle', AR.fmt.cap(a.vehicle.type) + ', ' + a.vehicle.makeModel], ['Colour', a.vehicle.color], ['Number plate', a.vehicle.plateNumber], ['Year', a.vehicle.year]].map(function (r) { return r[1] ? '<div class="kv"><span>' + r[0] + '</span><b>' + AR.esc(r[1]) + '</b></div>' : ''; }).join('') + '</div>' : '') +
        '<div class="section-title">Documents</div><div class="list">' + a.requiredDocuments.filter(function (t) { return a.approvalStatus !== 'APPROVED' || a.documents[t]; }).map(function (t) { var d = a.documents[t], exp = a.kyc && ({ DRIVING_LICENSE: a.kyc.licenseExpiry, VEHICLE_REGISTRATION: a.kyc.registrationExpiry, INSURANCE_CERTIFICATE: a.kyc.insuranceExpiry, CERTIFICATE_OF_FITNESS: a.kyc.fitnessExpiry }[t]); var soon = exp && (new Date(exp) - Date.now()) < 30 * 86400000;
          return AR.row({ icon: 'file', title: DOCS[t], sub: exp ? 'Expires ' + AR.fmt.date(exp) + (soon ? ' (soon)' : '') : '', end: '<span class="badge ' + (soon ? 'gold' : 'steel') + '">' + (d ? AR.fmt.cap(d.status) : 'Missing') + '</span>' }); }).join('') + '</div>' +
        '<p class="small dim mt16">To replace a document or correct your details, contact support. Keep your papers valid so you can keep driving.</p><button class="btn btn-line mt12" id="tk">' + AR.icon('ticket', 20) + 'Contact support</button>';
      AR.$('#tk', b).addEventListener('click', function () { AR.nav.go('new-ticket', { category: 'OTHER', subject: 'Update my documents or details' }); });
    }
  });

  AR.register('help', {
    mount: function (el) {
      var b = AR.page(el, 'Help', '<button class="btn btn-line btn-sm" id="tk">' + AR.icon('ticket', 18) + 'Tickets</button>');
      AR.$('#tk', el).addEventListener('click', function () { AR.nav.go('tickets'); });
      b.innerHTML = FAQ.map(function (g, gi) { return '<div class="section-title" style="padding-top:' + (gi ? 22 : 4) + 'px">' + g[0] + '</div><div class="list">' + g[2].map(function (it, i) { return '<div><button class="row" data-q="' + gi + '-' + i + '"><span class="grow"><div class="r-title" style="font-size:15.5px">' + AR.esc(it[0]) + '</div></span><span class="r-end" data-c>' + AR.icon('chevronDown', 18) + '</span></button><div class="hide" data-a="' + gi + '-' + i + '" style="padding:0 16px 16px"><p class="dim" style="font-size:15px">' + AR.esc(it[1]) + '</p><button class="btn btn-line btn-sm mt12" data-t="' + gi + '-' + i + '">' + AR.icon('ticket', 18) + 'Still need help? Raise a ticket</button></div></div>'; }).join('') + '</div>'; }).join('');
      AR.$$('[data-q]', b).forEach(function (q) { q.addEventListener('click', function () { var a = AR.$('[data-a="' + q.dataset.q + '"]', b); a.classList.toggle('hide'); AR.$('[data-c]', q).style.transform = a.classList.contains('hide') ? '' : 'rotate(180deg)'; }); });
      AR.$$('[data-t]', b).forEach(function (t) { t.addEventListener('click', function () { var p = t.dataset.t.split('-'); AR.nav.go('new-ticket', { category: FAQ[+p[0]][3], subject: FAQ[+p[0]][2][+p[1]][0] }); }); });
    }
  });

  AR.register('d-settings', {
    mount: function (el) {
      var b = AR.page(el, 'Settings');
      b.innerHTML = '<div class="list">'+ ((AR.state.cfg && AR.state.cfg.allowLocationSimulation) ? '<button class="row" id="testloc"><span class="r-ic">' + AR.icon('locate', 20) + '</span><span class="grow"><div class="r-title">Test location (developer)</div><div class="r-sub">Pretend to be in Lilongwe</div></span><span class="toggle ' + (AR.map.testOn() ? 'on' : '') + '"></span></button>' : '') + '<button class="row" id="lowdata"><span class="r-ic">' + AR.icon('map', 20) + '</span><span class="grow"><div class="r-title">Low-data mode</div><div class="r-sub">Lighter maps, no animations. Good for weak signal.</div></span><span class="toggle ' + (document.documentElement.hasAttribute('data-lowdata') ? 'on' : '') + '"></span></button>' + AR.row({ id: 'language', icon: 'map', title: AR.t('language') }) + AR.row({ id: 'about', icon: 'info', title: 'About' }) + AR.row({ id: 'logout', icon: 'logout', title: 'Log out' }) + '</div>';
      AR.$('#lowdata', b).addEventListener('click', function () { var on = !document.documentElement.hasAttribute('data-lowdata'); if (on) document.documentElement.setAttribute('data-lowdata', ''); else document.documentElement.removeAttribute('data-lowdata'); try { localStorage.setItem('aarohan_lowdata', on ? '1' : '0'); } catch (_) {} AR.$('.toggle', this).classList.toggle('on', on); AR.toast(on ? 'Low-data mode is on.' : 'Low-data mode is off.'); });
      var tl = AR.$('#testloc', b); if (tl) tl.addEventListener('click', function () { AR.map.setTest(!AR.map.testOn()); AR.toast('Test location ' + (AR.map.testOn() ? 'on' : 'off') + '. Reloading...'); setTimeout(function () { location.reload(); }, 600); });
      AR.bindRows(b, { language: function () { AR.nav.go('language', {}); }, about: function () { AR.nav.go('about'); }, logout: function () { AR.session.signOut(); } });
    }
  });
})();
