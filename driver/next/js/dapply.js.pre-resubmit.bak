// ============================================================================
// Aarohan Captain: motivation, application steps, documents, review, waiting for approval.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  var DOC_INFO = {
    NATIONAL_ID: ['National ID', 'Front of your Malawi National ID. All four corners visible, no glare.'],
    DRIVING_LICENSE: ['Driving licence', 'Front and details page. Must be valid and match the class of your vehicle.'],
    VEHICLE_REGISTRATION: ['Vehicle registration', 'The registration book page showing the plate number and owner.'],
    CERTIFICATE_OF_FITNESS: ['Certificate of fitness', 'A current certificate of fitness for your vehicle.'],
    NUMBER_PLATE_PHOTO: ['Number plate photo', 'Stand 1 to 2 metres behind the vehicle and photograph the number plate. Every letter and digit must be sharp and readable. Use daylight.'],
    VEHICLE_PHOTO: ['Photo of your vehicle', 'The whole vehicle from the side, so we can see its type and colour. Park in an open space with good light.'],
    INSURANCE_CERTIFICATE: ['Insurance certificate', 'A current insurance certificate that shows the policy number and expiry date.']
  };

  AR.D.reloadApp = async function () {
    try { AR.D.app = (await AR.api('/driver/application')).application; AR.D.driverId = AR.D.app.driverId; } catch (e) { if (e.status === 404) AR.D.app = null; else throw e; }
    return AR.D.app;
  };

  // Shrinks big phone photos so uploads are quick on weak signal (PDFs are sent as they are).
  AR.compressImage = function (file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.size < 600 * 1024) return resolve(file);
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1800, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { URL.revokeObjectURL(url); resolve(b && b.size < file.size ? new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  };

  // ------------------------------------------------------------ motivation
  var SLIDES = [
    { icon: 'route', t: 'Drive when it suits you', p: 'Go online when you are ready and choose the trips you take. You see the pickup, the drop-off and what you will earn before you accept.' },
    { icon: 'wallet', t: 'Know what you earn', p: 'Every offer shows your earnings. Follow today, this week and your commission in one clear place.' },
    { icon: 'star', t: 'Daily goals and bonuses', p: 'Reach daily trip goals to unlock bonuses from Aarohan. The more you complete, the closer you get.' },
    { icon: 'shieldCheck', t: 'Safer for you too', p: 'Riders share a PIN before a trip starts, parcels need codes, and the SOS button reaches the Aarohan safety team.' }
  ];
  AR.register('intro', {
    locked: true,
    mount: function (el) {
      el.classList.add('intro'); var i = 0;
      el.innerHTML = '<div class="topbar"><div class="grow"></div><button class="btn btn-ghost btn-sm" data-skip>' + AR.t('skip') + '</button></div><div class="intro-stage"><div class="intro-art" id="art"></div><div id="slides"></div></div>' +
        '<div class="stack gap24" style="padding:0 28px calc(28px + var(--safe-bottom))"><div class="dots" id="dots"></div><button class="btn btn-gold" data-next>' + AR.t('cont') + '</button></div>';
      var art = AR.$('#art', el), slides = AR.$('#slides', el), dots = AR.$('#dots', el), next = AR.$('[data-next]', el);
      slides.innerHTML = SLIDES.map(function (s) { return '<div class="slide"><span class="eyebrow">Aarohan Captain</span><h2>' + AR.esc(s.t) + '</h2><p>' + AR.esc(s.p) + '</p></div>'; }).join('');
      dots.innerHTML = SLIDES.map(function () { return '<i></i>'; }).join('');
      function seen() { try { localStorage.setItem('aarohan_intro_seen', '1'); } catch (_) {} }
      function show(n) { i = n; AR.$$('.slide', el).forEach(function (s, k) { s.classList.toggle('on', k === n); }); AR.$$('i', dots).forEach(function (d, k) { d.classList.toggle('on', k === n); }); art.innerHTML = '<div class="art-glow"></div><div class="orbit o2"><i></i></div><div class="orbit o1"><i></i></div><div class="art-tile">' + AR.icon(SLIDES[n].icon, 68) + '</div>'; next.textContent = n === SLIDES.length - 1 ? 'Start driving with Aarohan' : AR.t('cont'); }
      next.addEventListener('click', function () { if (i < SLIDES.length - 1) show(i + 1); else { seen(); AR.nav.go('auth'); } });
      AR.$('[data-skip]', el).addEventListener('click', function () { seen(); AR.nav.go('auth'); });
      var x0 = null; el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (dx < -50 && i < SLIDES.length - 1) show(i + 1); else if (dx > 50 && i > 0) show(i - 1); });
      show(0);
    }
  });

  // ------------------------------------------------------------ the steps
  function steps() {
    var a = AR.D.app, p = AR.state.profile || {};
    var docsOk = !!a && a.requiredDocuments.every(function (t) { return a.documents[t] && a.documents[t].status !== 'REJECTED'; }) && a.photo;
    var personal = !!(p.dateOfBirth && p.gender && p.name && !/^Passenger \d{4}$/.test(p.name));
    return [
      { k: 'apply-personal', t: 'About you', s: 'Name, date of birth, gender', done: personal, open: true },
      { k: 'apply-vehicle', t: 'Your vehicle', s: 'Type, make, colour and number plate', done: !!(a && a.vehicle), open: personal },
      { k: 'apply-identity', t: 'Identity and licence', s: 'ID, licence, address, next of kin, payout number', done: !!(a && a.kyc), open: !!(a && a.vehicle) },
      { k: 'apply-docs', t: 'Documents', s: 'Face check, 5 documents and 2 vehicle photos', done: docsOk, open: !!(a && a.kyc) },
      { k: 'apply-review', t: 'Review and submit', s: 'Confirm everything is true', done: !!(a && a.submitted), open: !!(a && a.canSubmit) }
    ];
  }
  AR.register('apply', {
    locked: true,
    mount: function (el) {
      function paint() {
        var a = AR.D.app, list = steps(), doneN = list.filter(function (x) { return x.done; }).length;
        el.innerHTML = '<div class="topbar"><h1>Join as a captain</h1><button class="icon-btn" id="out" aria-label="Log out">' + AR.icon('logout', 20) + '</button></div><div class="scroll">' +
          (a && a.rejectionReason ? '<div class="suggest" style="margin-bottom:14px;border-color:var(--gold-500)">' + AR.icon('warning', 22) + '<span><b>Your application needs changes.</b> ' + AR.esc(a.rejectionReason) + '</span></div>' : '') +
          '<div class="card"><div class="hstack" style="justify-content:space-between"><b>Your progress</b><span class="small dim">' + doneN + ' of 5 steps</span></div><div class="progress mt12"><i style="width:' + (doneN / 5 * 100) + '%"></i></div>' +
          '<p class="small dim mt12">Complete every step honestly. Our team checks each document, and false information leads to permanent removal.</p></div>' +
          '<div class="list mt16">' + list.map(function (s, i) { return '<button class="step ' + (s.done ? 'done' : '') + '" data-k="' + s.k + '" ' + (s.open ? '' : 'disabled style="opacity:.45"') + '><span class="n">' + (s.done ? AR.icon('check', 18) : (i + 1)) + '</span><span class="grow"><div class="r-title">' + s.t + '</div><div class="r-sub">' + s.s + '</div></span>' + (s.open ? AR.icon('chevronRight', 18, 'faint') : AR.icon('lock', 18, 'faint')) + '</button>'; }).join('') + '</div></div>';
        AR.$$('[data-k]', el).forEach(function (b) { b.addEventListener('click', function () { AR.nav.go(b.dataset.k); }); });
        AR.$('#out', el).addEventListener('click', function () { AR.session.signOut(); });
      }
      paint();
      return { show: async function () { try { await AR.session.refresh(); await AR.D.reloadApp(); } catch (_) {} paint(); } };
    }
  });

  AR.register('apply-personal', {
    mount: function (el) {
      var p = AR.state.profile || {}, g = p.gender || '', today = new Date(); today.setFullYear(today.getFullYear() - 18);
      var b = AR.page(el, 'About you');
      b.innerHTML = '<div class="stack gap16"><div class="field"><label>Full name (as on your National ID)</label><input class="input" id="name" value="' + AR.esc(/^Passenger \d{4}$/.test(p.name || '') ? '' : (p.name || '')) + '"/></div>' +
        '<div class="field"><label>Mobile number</label><input class="input" value="' + AR.esc(p.phone || '') + '" disabled style="opacity:.7"/></div>' +
        '<div class="field"><label>Date of birth</label><input class="input" id="dob" type="date" max="' + today.toISOString().slice(0, 10) + '" value="' + AR.esc(p.dateOfBirth || '') + '"/><div class="hint">You must be 18 or older.</div></div>' +
        '<div class="field"><label>Gender</label><div class="chips">' + [['FEMALE', 'Female'], ['MALE', 'Male'], ['OTHER', 'Other'], ['PREFER_NOT', 'Prefer not to say']].map(function (x) { return '<button type="button" class="chip ' + (g === x[0] ? 'on' : '') + '" data-g="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="hint err hide" id="err"></div><button class="btn btn-gold" id="save">Save and continue</button></div>';
      AR.$$('[data-g]', b).forEach(function (x) { x.addEventListener('click', function () { g = x.dataset.g; AR.$$('[data-g]', b).forEach(function (y) { y.classList.toggle('on', y === x); }); }); });
      function err(m) { var h = AR.$('#err', b); h.textContent = m || ''; h.classList.toggle('hide', !m); }
      var save = AR.$('#save', b);
      save.addEventListener('click', async function () {
        var name = AR.$('#name', b).value.trim(), dob = AR.$('#dob', b).value;
        if (name.length < 3) return err('Enter your full name as it appears on your ID.'); if (!dob) return err('Enter your date of birth.'); if (!g) return err('Choose an option for gender.');
        save.classList.add('is-loading'); err('');
        try { await AR.api('/me', { method: 'PATCH', body: { name: name, dateOfBirth: dob, gender: g } }); await AR.session.refresh(); AR.nav.back(); } catch (e) { err(e.message); } finally { save.classList.remove('is-loading'); }
      });
    }
  });

  AR.register('apply-vehicle', {
    mount: function (el) {
      var a = AR.D.app, v = a && a.vehicle, type = v ? v.type : 'MOTO', b = AR.page(el, 'Your vehicle'), yr = new Date().getFullYear();
      if (v) {
        b.innerHTML = '<div class="card">' + [['Type', AR.fmt.cap(v.type)], ['Make and model', v.makeModel], ['Colour', v.color], ['Number plate', v.plateNumber], ['Year', v.year || '']].map(function (r) { return r[1] ? '<div class="kv"><span>' + r[0] + '</span><b>' + AR.esc(r[1]) + '</b></div>' : ''; }).join('') + '</div><p class="small dim mt16">For your safety, vehicle details cannot be changed here. To correct a mistake, please contact Aarohan support.</p><button class="btn btn-line mt16" id="tk">Contact support</button>';
        AR.$('#tk', b).addEventListener('click', function () { AR.nav.go('new-ticket', { category: 'OTHER', subject: 'Correct my vehicle details' }); }); return;
      }
      b.innerHTML = '<div class="stack gap16"><div class="field"><label>Vehicle type</label><div class="chips" id="vt">' + [['MOTO', 'Moto'], ['AUTO', 'Auto'], ['CAB', 'Cab']].map(function (x) { return '<button class="chip ' + (type === x[0] ? 'on' : '') + '" data-t="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="field"><label>Make and model</label><input class="input" id="mm" maxlength="40" placeholder="e.g. Boxer 150, Toyota Passo"/></div><div class="field"><label>Colour</label><input class="input" id="col" maxlength="20" placeholder="e.g. Red"/></div>' +
        '<div class="field"><label>Number plate</label><input class="input" id="plate" maxlength="12" autocapitalize="characters" placeholder="e.g. BT 1234"/><div class="hint">Exactly as on the vehicle and the registration book.</div></div>' +
        '<div class="field"><label>Year of manufacture</label><input class="input" id="year" inputmode="numeric" maxlength="4" placeholder="' + (yr - 5) + '"/></div><div class="hint err hide" id="err"></div><button class="btn btn-gold" id="save">Save and continue</button></div>';
      AR.$$('[data-t]', b).forEach(function (x) { x.addEventListener('click', function () { type = x.dataset.t; AR.$$('[data-t]', b).forEach(function (y) { y.classList.toggle('on', y === x); }); }); });
      function err(m) { var h = AR.$('#err', b); h.textContent = m || ''; h.classList.toggle('hide', !m); }
      var save = AR.$('#save', b);
      save.addEventListener('click', async function () {
        var mm = AR.$('#mm', b).value.trim(), col = AR.$('#col', b).value.trim(), plate = AR.$('#plate', b).value.trim().toUpperCase().replace(/\s+/g, ' '), y = parseInt(AR.$('#year', b).value, 10);
        if (mm.length < 2) return err('Enter the make and model.'); if (col.length < 2) return err('Enter the colour.'); if (plate.length < 3) return err('Enter the number plate.');
        if (!(y >= 1990 && y <= yr + 1)) return err('Enter a valid year, for example ' + (yr - 5) + '.');
        save.classList.add('is-loading'); err('');
        try { await AR.api('/auth/driver/register', { method: 'POST', body: { name: (AR.state.profile || {}).name, makeModel: mm, color: col, plateNumber: plate, vehicleType: type, year: y } }); await AR.D.reloadApp(); AR.nav.back(); }
        catch (e) { err(e.message); } finally { save.classList.remove('is-loading'); }
      });
    }
  });

  // ------------------------------------------------- identity and licence
  AR.register('apply-identity', {
    mount: function (el) {
      var a = AR.D.app, k = a && a.kyc, locked = !!(a && a.locked), b = AR.page(el, 'Identity and licence'), net = k ? k.payoutNetwork : 'AIRTEL_MONEY';
      var F = function (id, label, ph, val, extra) { return '<div class="field"><label>' + label + '</label><input class="input" id="' + id + '" placeholder="' + (ph || '') + '" value="' + AR.esc(val || '') + '" ' + (extra || '') + (locked ? ' disabled' : '') + '/></div>'; };
      var D = function (id, label, val, hint) { return '<div class="field"><label>' + label + '</label><input class="input" id="' + id + '" type="date" value="' + AR.esc(val || '') + '"' + (locked ? ' disabled' : '') + '/>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; };
      b.innerHTML = '<div class="stack gap16">' + (locked ? '<div class="suggest">' + AR.icon('lock', 20) + '<span>Your application is being reviewed, so these details are locked.</span></div>' : (k ? '<div class="suggest">' + AR.icon('info', 20) + '<span>For your security, ID and licence numbers are hidden. Enter them again if you change anything.</span></div>' : '')) +
        F('legalName', 'Full legal name (as on your ID)', '', k && k.legalName) +
        F('nid', 'National ID number', k ? 'Ends in ' + k.nationalIdLast4 : 'Enter exactly as printed', '', 'autocapitalize="characters" maxlength="20"') +
        F('lic', 'Driving licence number', k ? 'Ends in ' + k.licenseLast4 : 'Enter exactly as printed', '', 'autocapitalize="characters" maxlength="25"') +
        F('cls', 'Licence class', 'e.g. A', k && k.licenseClass, 'maxlength="10" autocapitalize="characters"') + D('lexp', 'Licence expiry date', k && k.licenseExpiry, 'Must be valid for at least 30 more days.') +
        F('addr', 'Home address', 'Area, street or landmark', k && k.address) + F('dist', 'District', 'e.g. Lilongwe', k && k.district) +
        '<div class="section-title" style="padding:8px 4px 0">Next of kin</div>' + F('kname', 'Full name', '', k && k.nextOfKinName) +
        '<div class="field"><label>Phone number</label><div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="kphone" type="tel" inputmode="tel" value="' + AR.esc(k ? k.nextOfKinPhone.replace('+265', '') : '') + '"' + (locked ? ' disabled' : '') + '/></div></div>' + F('krel', 'Relationship', 'e.g. Wife, Brother', k && k.nextOfKinRelation) +
        '<div class="section-title" style="padding:8px 4px 0">Vehicle papers</div>' + D('rexp', 'Registration expiry date', k && k.registrationExpiry) + F('pol', 'Insurance policy number', '', k && k.insurancePolicyNo) + D('iexp', 'Insurance expiry date', k && k.insuranceExpiry, 'Must be valid for at least 7 more days.') + D('fexp', 'Certificate of fitness expiry', k && k.fitnessExpiry) +
        '<div class="section-title" style="padding:8px 4px 0">How we pay you</div><div class="chips" id="net">' + [['AIRTEL_MONEY', 'Airtel Money'], ['TNM_MPAMBA', 'TNM Mpamba']].map(function (x) { return '<button class="chip ' + (net === x[0] ? 'on' : '') + '" data-n="' + x[0] + '"' + (locked ? ' disabled' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="field"><label>Mobile money number (must be yours)</label><div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="pphone" type="tel" inputmode="tel" value="' + AR.esc(k ? k.payoutPhone.replace('+265', '') : '') + '"' + (locked ? ' disabled' : '') + '/></div></div>' +
        '<div class="hint err hide" id="err"></div>' + (locked ? '' : '<button class="btn btn-gold" id="save">Save and continue</button>') + '</div>';
      AR.$$('[data-n]', b).forEach(function (x) { x.addEventListener('click', function () { net = x.dataset.n; AR.$$('[data-n]', b).forEach(function (y) { y.classList.toggle('on', y === x); }); }); });
      var save = AR.$('#save', b); if (!save) return;
      function err(m) { var h = AR.$('#err', b); h.textContent = m || ''; h.classList.toggle('hide', !m); if (m) h.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      var v = function (id) { return (AR.$('#' + id, b).value || '').trim(); };
      save.addEventListener('click', async function () {
        var body = { legalName: v('legalName'), nationalId: v('nid'), licenseNumber: v('lic'), licenseClass: v('cls'), licenseExpiry: v('lexp'), address: v('addr'), district: v('dist'), nextOfKinName: v('kname'), nextOfKinPhone: AR.phone.normalize(v('kphone')), nextOfKinRelation: v('krel') || undefined, payoutNetwork: net, payoutPhone: AR.phone.normalize(v('pphone')), registrationExpiry: v('rexp'), insurancePolicyNo: v('pol'), insuranceExpiry: v('iexp'), fitnessExpiry: v('fexp') };
        var blank = Object.keys(body).filter(function (x) { return body[x] === '' || body[x] === '+265'; }); if (blank.length) return err('Please fill in every field. Missing: ' + blank.length + '.');
        save.classList.add('is-loading'); err('');
        try { await AR.api('/driver/kyc', { method: 'PUT', body: body }); await AR.D.reloadApp(); AR.toast('Details saved.'); AR.nav.back(); } catch (e) { err(e.message); } finally { save.classList.remove('is-loading'); }
      });
    }
  });

  // ------------------------------------------------------------- documents
  var STATUS = { PENDING: ['Uploaded', ''], APPROVED: ['Approved', 'steel'], REJECTED: ['Needs replacing', 'gold'], ALT: ['Video check requested', ''], UPLOADING: ['Uploading...', ''], FAILED: ['Upload failed', 'gold'] };

  // ---- Background upload queue: the driver takes a photo, taps "Use this photo" and moves on AT ONCE. The photo uploads in the
  // background (retrying by itself if the network drops), so nobody sits and waits.
  var UP = AR.D.uploads = { items: {}, listeners: [] };
  UP.state = function (t) { return UP.items[t] && UP.items[t].state; };
  UP.pending = function () { return Object.keys(UP.items).filter(function (k) { return UP.items[k].state === 'uploading'; }).length; };
  UP.failed = function () { return Object.keys(UP.items).filter(function (k) { return UP.items[k].state === 'failed'; }).length; };
  UP.changed = function () { UP.listeners.slice().forEach(function (f) { try { f(); } catch (_) {} }); };
  function sendDoc(type) {
    var it = UP.items[type]; it.state = 'uploading'; it.tries = (it.tries || 0) + 1; UP.changed();
    var fd = new FormData(); fd.append('documentType', type); fd.append('file', it.blob, type.toLowerCase() + '.jpg');
    return window.aarohanAuth.fetchWithAuth('/api/driver/documents', { method: 'POST', body: fd }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var err = new Error(data.error || 'The upload did not work.'); err.status = res.status; throw err; }
        it.state = 'done'; it.blob = null; it.error = null;
        if (AR.D.app) { AR.D.app.documents = AR.D.app.documents || {}; AR.D.app.documents[type] = { status: 'PENDING' }; }
        UP.changed();
        if (!UP.pending()) { AR.D.reloadApp().then(UP.changed).catch(function () {}); } // sync with the server once everything is up
      });
    }).catch(function (e) {
      it.state = 'failed'; it.error = e.message; UP.changed();
      if (!e.status && it.tries < 4) { setTimeout(function () { if (UP.items[type] === it && it.state === 'failed') sendDoc(type); }, 3000 * it.tries); } // network trouble: try again by itself
    });
  }
  UP.start = function (type, blob) { UP.items[type] = { state: 'uploading', blob: blob, error: null, tries: 0 }; return sendDoc(type); };
  UP.retry = function (type) { if (UP.items[type] && UP.items[type].blob) { UP.items[type].tries = 0; return sendDoc(type); } };
  UP.whenDone = function (cb) { if (!UP.pending()) return cb(); var f = function () { if (!UP.pending()) { UP.listeners = UP.listeners.filter(function (x) { return x !== f; }); cb(); } }; UP.listeners.push(f); };

  AR.register('apply-docs', {
    mount: function (el) {
      var b = AR.page(el, 'Documents');
      if (AR.live && AR.live.preload) AR.live.preload(); // warm up the face detector now, so the face check starts instantly
      function rows() {
        var a = AR.D.app || { documents: {}, photo: false, requiredDocuments: [], locked: false }, locked = a.locked;
        var alt = !!(a.liveness && a.liveness.status === 'ALTERNATIVE_REQUESTED');
        var items = [['DRIVER_PHOTO', 'Live face check', 'A short check with your camera: you will turn your head right, left, up and down. No sunglasses or hats.', a.photo ? { status: alt ? 'ALT' : 'PENDING' } : null, true]].concat(a.requiredDocuments.map(function (t) {
          var s = UP.state(t), d = a.documents[t] || null;
          if (s === 'uploading') d = { status: 'UPLOADING' }; else if (s === 'failed') d = { status: 'FAILED', rejectionReason: UP.items[t].error };
          return [t, DOC_INFO[t][0], DOC_INFO[t][1], d, false];
        }));
        var done = items.filter(function (it) { return it[3] && it[3].status !== 'REJECTED' && it[3].status !== 'FAILED'; }).length, total = items.length, left = total - done;
        var mins = Math.max(1, Math.round(left * 0.7));
        var head = locked ? '' : '<div class="card" style="margin-bottom:14px"><div class="hstack" style="justify-content:space-between"><b>' + done + ' of ' + total + ' done</b><span class="small dim">' + (left ? 'about ' + mins + ' min left' : 'All done') + '</span></div><div class="progress mt12"><i style="width:' + Math.round(done / total * 100) + '%"></i></div><div class="small dim mt8">Your progress is saved. You can stop and come back at any time. Photos upload in the background, so you never have to wait.</div></div>';
        b.innerHTML = head + '<div class="suggest" style="margin-bottom:14px">' + AR.icon('info', 20) + '<span>Everything is photographed live with your camera, so there are no gallery uploads. Photos must be clear and show the whole document. Fake or edited documents lead to permanent removal.</span></div><div class="list">' +
          items.map(function (it, idx) {
            var d = it[3], st = d ? (STATUS[d.status] || STATUS.PENDING) : null;
            var open = idx === 0 || items.slice(0, idx).every(function (p) { return p[3] && p[3].status !== 'REJECTED' && p[3].status !== 'FAILED'; }); // every earlier step must be done (an upload in progress counts)
            var up = d && d.status === 'UPLOADING', failed = d && d.status === 'FAILED';
            var action = locked ? '' : (!open ? '<span class="tiny dim" style="flex:none;max-width:84px;text-align:right">Finish the step above first</span>'
              : (up ? '<span class="spinner" style="width:22px;height:22px;flex:none"></span>'
              : (failed ? '<button class="btn btn-gold btn-sm" data-retry="' + it[0] + '" style="flex:none">Retry</button>'
              : '<button class="btn btn-line btn-sm" data-cam="' + it[0] + '" style="flex:none">' + (it[4] ? (d ? 'Redo' : 'Start') : (d ? 'Retake' : 'Scan')) + '</button>')));
            return '<div class="doc" style="' + (open ? '' : 'opacity:.5') + '"><div class="thumb">' + AR.icon(!open ? 'lock' : (it[4] ? 'user' : 'file'), 24) + '</div><div class="grow" style="min-width:0"><div class="r-title" style="font-size:15.5px">' + it[1] + '</div><div class="small dim">' + (d && d.rejectionReason ? AR.esc(d.rejectionReason) : AR.esc(it[2])) + '</div>' + (st ? '<span class="badge ' + st[1] + '" style="margin-top:6px">' + st[0] + '</span>' : '') + '</div>' + action + '</div>';
          }).join('') + '</div>' +
          '<button class="btn btn-gold mt16" id="done">' + (UP.pending() ? 'Photos are uploading... tap to continue' : 'Continue') + '</button>';
        AR.$$('[data-cam]', b).forEach(function (btn) { btn.addEventListener('click', function () { var t = btn.dataset.cam; if (t === 'DRIVER_PHOTO') AR.nav.go('liveness'); else AR.nav.go('scan', { type: t, label: DOC_INFO[t][0], hint: DOC_INFO[t][1] }); }); });
        AR.$$('[data-retry]', b).forEach(function (btn) { btn.addEventListener('click', function () { UP.retry(btn.dataset.retry); }); });
        AR.$('#done', b).addEventListener('click', function () { AR.nav.back(); });
      }
      UP.listeners.push(rows);
      rows();
      return { show: rows, destroy: function () { UP.listeners = UP.listeners.filter(function (f) { return f !== rows; }); } };
    }
  });

  // ---------------------------------------------------------- review, submit
  AR.register('apply-review', {
    mount: function (el) {
      var a = AR.D.app, b = AR.page(el, 'Review and submit'), ok = false;
      var missing = a ? a.missing : ['Everything'];
      b.innerHTML = '<div class="card">' + (a ? [['Name', a.personal.name], ['Date of birth', a.personal.dateOfBirth], ['Vehicle', a.vehicle ? a.vehicle.makeModel + ', ' + a.vehicle.color : ''], ['Number plate', a.vehicle ? a.vehicle.plateNumber : ''], ['National ID', a.kyc ? 'ends in ' + a.kyc.nationalIdLast4 : ''], ['Licence', a.kyc ? 'ends in ' + a.kyc.licenseLast4 + ' (class ' + a.kyc.licenseClass + ')' : ''], ['Payout', a.kyc ? AR.fmt.cap(a.kyc.payoutNetwork) + ' ' + a.kyc.payoutPhone : '']].map(function (r) { return r[1] ? '<div class="kv"><span>' + r[0] + '</span><b>' + AR.esc(r[1]) + '</b></div>' : ''; }).join('') : '') + '</div>' +
        (missing.length ? '<div class="suggest mt16" style="border-color:var(--gold-500)">' + AR.icon('warning', 22) + '<span><b>Not finished yet:</b><br>' + missing.map(function (m) { return AR.esc(m.replace('Document: ', '').replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); })); }).join('<br>') + '</span></div>' : '') +
        '<div class="card mt16"><b>Declaration</b><p class="small dim mt8">I declare that all the information and documents I have given are true, genuine and belong to me. I understand that false, copied or forged information will lead to my permanent removal from Aarohan and may be reported to the police.</p>' +
        '<button class="consent mt12" id="decl" style="text-align:left" ' + (missing.length ? 'disabled' : '') + '><span class="check">' + AR.icon('check', 16) + '</span><span>I agree and I confirm this is true.</span></button></div>' +
        '<div class="hint err hide mt12" id="err"></div><button class="btn btn-gold mt16" id="send" disabled>Submit for review</button>';
      var send = AR.$('#send', b), decl = AR.$('#decl', b);
      decl.addEventListener('click', function () { if (missing.length) return; ok = !ok; AR.$('.check', decl).classList.toggle('on', ok); send.disabled = !ok; });
      send.addEventListener('click', async function () {
        send.classList.add('is-loading');
        try { if (UP.pending()) { AR.toast('Finishing your photo uploads...'); await new Promise(function (r) { UP.whenDone(r); }); } if (UP.failed()) throw new Error('One photo did not upload. Go back to Documents and tap Retry.'); await AR.api('/driver/application/submit', { method: 'POST', body: { declaration: true } }); await AR.D.reloadApp(); AR.nav.stack.forEach(function (x) { try { x.el.remove(); } catch (_) {} }); AR.nav.stack = []; AR.nav.go('submitted', {}, { anim: 'fade' }); }
        catch (e) { var h = AR.$('#err', b); h.textContent = e.message + (e.data && e.data.missing ? ' ' + e.data.missing.join(', ') : ''); h.classList.remove('hide'); send.classList.remove('is-loading'); }
      });
    }
  });

  // --------------------------------------------------- waiting for approval
  AR.register('pending', {
    locked: true,
    mount: function (el) {
      var timer = null;
      function paint() {
        var a = AR.D.app || { documents: {}, requiredDocuments: [] };
        el.innerHTML = '<div class="topbar"><div class="grow"></div><button class="icon-btn" id="out" aria-label="Log out">' + AR.icon('logout', 20) + '</button></div><div class="scroll"><div class="center" style="padding:18px 0 6px"><div class="waiting-art">' + AR.icon('shieldCheck', 54) + '</div>' +
          '<h1 style="font-size:28px">We are checking your details</h1><p class="dim mt12">Your documents were uploaded successfully and our team is verifying them. Please be patient. Verification is completed within 24 hours, and we will notify you as soon as it is done.</p><p class="small dim mt12">You cannot use the captain app until you are approved.</p></div>' +
          '<div class="section-title">Your documents</div><div class="list">' + a.requiredDocuments.map(function (t) { var d = a.documents[t], st = d ? STATUS[d.status] : null; return AR.row({ icon: 'file', title: DOC_INFO[t][0], sub: d && d.rejectionReason ? d.rejectionReason : '', end: st ? '<span class="badge ' + st[1] + '">' + (d.status === 'PENDING' ? 'Under review' : st[0]) + '</span>' : '<span class="badge gold">Missing</span>' }); }).join('') + '</div>' +
          '<button class="btn btn-line mt24" id="help">' + AR.icon('ticket', 20) + 'Contact support</button></div>';
        AR.$('#out', el).addEventListener('click', function () { AR.session.signOut(); });
        AR.$('#help', el).addEventListener('click', function () { AR.nav.go('new-ticket', { category: 'OTHER', subject: 'Question about my driver application' }); });
      }
      async function check() {
        try {
          await AR.D.reloadApp(); var a = AR.D.app; if (!a) return;
          if (a.approvalStatus === 'APPROVED') { clearInterval(timer); AR.D.approved(); }
          else if (!a.submitted || a.approvalStatus === 'REJECTED') { clearInterval(timer); timer = null; AR.toast('Your application needs changes.', 'gold'); AR.session.start(); }
          else paint();
        } catch (_) {}
      }
      paint(); timer = setInterval(check, 5000);
      return { show: check, destroy: function () { clearInterval(timer); } };
    }
  });

  // Shown once, the moment an application is approved (instantly if the app is open, or on the next open).
  AR.D.approved = async function () {
    if (AR.D.approvedShown) return; // the welcome screen is shown once per app start, never again
    AR.D.approvedShown = true;
    var cur = AR.nav.current && AR.nav.current(); if (cur && cur.name === 'approved') return;
    try { await AR.D.reloadApp(); } catch (_) {}
    AR.haptic([30, 40, 30]); AR.nav.stack.forEach(function (e) { try { e.el.remove(); } catch (_) {} }); AR.nav.stack = [];
    AR.nav.go('approved', {}, { anim: 'fade' });
  };
  AR.register('approved', {
    locked: true,
    mount: function (el) {
      el.innerHTML = '<div class="scroll" style="display:flex;flex-direction:column;justify-content:center"><div class="center"><div class="done-ring" style="width:110px;height:110px"><svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.3 4.3 8.7-9.6"/></svg></div>' +
        '<h1 style="font-size:30px">You are approved</h1><p class="dim mt12">Welcome to Aarohan. Your documents were checked and your captain account is ready. Go online and start earning.</p><button class="btn btn-gold mt24" id="go">Start driving</button></div></div>';
      var done = false;
      function enter() { if (done) return; done = true; AR.nav.stack.forEach(function (e) { try { e.el.remove(); } catch (_) {} }); AR.nav.stack = []; AR.session.enterApp(); }
      AR.$('#go', el).addEventListener('click', enter);
      var t = setTimeout(enter, 8000);
      return { destroy: function () { clearTimeout(t); } };
    }
  });

  AR.register('retry', {
    locked: true,
    mount: function (el, params) {
      el.innerHTML = '<div class="scroll" style="display:flex;flex-direction:column;justify-content:center"><div class="center"><div class="waiting-art" style="animation:none">' + AR.icon('warning', 52) + '</div><h1 style="font-size:26px">We could not load your application</h1><p class="dim mt12">' + AR.esc((params && params.message) || 'Please check your connection.') + '</p><p class="small dim mt12">Your details are safe. If this keeps happening, the Aarohan server may need to be updated.</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="again">Try again</button><button class="btn btn-ghost" style="width:100%" id="out">Log out</button></div></div></div>';
      AR.$('#again', el).addEventListener('click', function () { this.classList.add('is-loading'); AR.session.start(); });
      AR.$('#out', el).addEventListener('click', function () { AR.session.signOut(); });
    }
  });

  // Shown right after a successful submit.
  AR.register('submitted', {
    locked: true,
    mount: function (el) {
      el.innerHTML = '<div class="scroll" style="display:flex;flex-direction:column;justify-content:center"><div class="center"><div class="done-ring" style="width:110px;height:110px"><svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.3 4.3 8.7-9.6"/></svg></div>' +
        '<h1 style="font-size:28px">Documents uploaded successfully</h1><p class="dim mt12">Our team is verifying your documents, so please be patient. <b>Verification is completed within 24 hours.</b> We will notify you as soon as it is done, in the app and by email.</p>' +
        '<p class="small dim mt12">Until you are approved you cannot go online or receive trips.</p><button class="btn btn-gold mt24" id="go">OK</button></div></div>';
      AR.$('#go', el).addEventListener('click', function () { AR.session.start(); });
    }
  });

  AR.register('suspended', {
    locked: true,
    mount: function (el) {
      el.innerHTML = '<div class="scroll" style="display:flex;flex-direction:column;justify-content:center"><div class="center"><div class="waiting-art" style="animation:none">' + AR.icon('lock', 52) + '</div><h1 style="font-size:28px">Your account is on hold</h1><p class="dim mt12">Your captain account has been suspended. Please contact Aarohan support to find out why and what to do next.</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="help">Contact support</button><button class="btn btn-ghost" style="width:100%" id="out">Log out</button></div></div></div>';
      AR.$('#help', el).addEventListener('click', function () { AR.nav.go('new-ticket', { category: 'OTHER', subject: 'My captain account is suspended' }); });
      AR.$('#out', el).addEventListener('click', function () { AR.session.signOut(); });
    }
  });
})();
