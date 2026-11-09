// ============================================================================
// Aarohan rider: Account hub, personal details, live rating, safety, saved places, settings.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;

  // ------------------------------------------------------------- shared bits
  AR.page = function (el, title, right) {
    el.innerHTML = '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>' + title + '</h1>' + (right || '') + '</div><div class="scroll" id="body"></div>';
    AR.$('[data-back]', el).addEventListener('click', function () { AR.nav.back(); });
    return AR.$('#body', el);
  };
  AR.row = function (o) {
    return '<button class="row" ' + (o.id ? 'data-k="' + o.id + '"' : '') + '><span class="r-ic ' + (o.gold ? 'gold' : '') + '">' + AR.icon(o.icon, 20) + '</span><span class="grow"><div class="r-title">' + AR.esc(o.title) + '</div>' + (o.sub ? '<div class="r-sub">' + AR.esc(o.sub) + '</div>' : '') + '</span><span class="r-end">' + (o.end || AR.icon('chevronRight', 18)) + '</span></button>';
  };
  AR.bindRows = function (host, map) { AR.$$('[data-k]', host).forEach(function (b) { b.addEventListener('click', function () { var f = map[b.dataset.k]; if (f) f(b); }); }); };
  var P = function () { return AR.state.profile || {}; };
  var GENDERS = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other', PREFER_NOT: 'Prefer not to say' };

  // -------------------------------------------------------------------- hub
  AR.register('account', {
    mount: function (el) {
      function paint() {
        var p = P(), r = p.rating || {};
        el.innerHTML = '<div class="topbar"><button class="icon-btn" data-tabback aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>Account</h1></div><div class="scroll with-tabs">' +
          '<button class="profile-head" id="head" style="width:100%;text-align:left"><span class="avatar">' + AR.esc(AR.fmt.initials(p.name)) + '</span><span class="grow" style="min-width:0"><div style="font-family:var(--font-display);font-size:22px;font-weight:700" class="ellipsis">' + AR.esc(p.name || 'Rider') + '</div>' +
          '<div class="small dim">' + (p.memberSince ? 'Member since ' + AR.fmt.month(p.memberSince) : AR.esc(p.phone || '')) + '</div></span><span class="rating-pill">' + AR.icon('star', 16) + (r.score != null ? Number(r.score).toFixed(1) : '5.0') + '</span></button>' +
          (AR.state.degraded ? '<div class="suggest" style="margin-bottom:12px">' + AR.icon('info', 20) + '<span>Some details are loading. Pull to refresh in a moment.</span></div>' : '') +
          '<div class="list stagger">' + AR.row({ id: 'profile', icon: 'user', title: 'Personal details', sub: 'Name, phone, email, date of birth' }) + AR.row({ id: 'rating', icon: 'star', title: 'Rider rating', sub: 'Calculated live from your trips', gold: true, end: '<span class="num" style="color:var(--gold-300);font-weight:700">' + (r.score != null ? Number(r.score).toFixed(1) : '5.0') + '</span>' }) + '</div>' +
          '<div class="section-title">Help and trips</div><div class="list">' + AR.row({ id: 'help', icon: 'help', title: 'Help', sub: 'Trips, fares, captains, payments' }) + AR.row({ id: 'parcel', icon: 'parcel', title: 'Parcel', sub: 'Send items' }) + AR.row({ id: 'payment', icon: 'wallet', title: 'Payment', sub: 'Cash' }) + AR.row({ id: 'rides', icon: 'activity', title: 'My rides', sub: 'Your trip history' }) + '</div>' +
          '<div class="section-title">Safety and rewards</div><div class="list">' + AR.row({ id: 'safety', icon: 'shieldCheck', title: 'Safety', sub: 'Emergency contacts and trusted places' }) + AR.row({ id: 'refer', icon: 'gift', title: 'Refer and earn' }) + AR.row({ id: 'rewards', icon: 'star', title: 'My rewards' }) + AR.row({ id: 'coins', icon: 'coin', title: 'Aarohan coins' }) + AR.row({ id: 'notifications', icon: 'bell', title: 'Notifications' }) + AR.row({ id: 'claims', icon: 'file', title: 'Claims' }) + '</div>' +
          '<div class="section-title">More</div><div class="list">' + AR.row({ id: 'settings', icon: 'settings', title: 'Settings' }) + '</div></div>';
        AR.$('[data-tabback]', el).addEventListener('click', function () { AR.nav.tab('home'); });
        var go = function (n, p) { return function () { AR.nav.go(n, p); }; };
        AR.bindRows(el, { profile: go('profile'), rating: go('rating'), help: go('help'), parcel: function () { AR.newTrip('PARCEL'); AR.nav.go('parcel'); }, payment: go('payment'), rides: function () { AR.nav.tab('activity'); }, safety: go('safety'), refer: go('refer'), rewards: go('rewards'), coins: go('coins'), notifications: go('notifications'), claims: go('claims'), settings: go('settings') });
        AR.$('#head', el).addEventListener('click', go('profile'));
      }
      paint();
      return { show: async function () { try { await AR.session.refresh(); } catch (_) {} paint(); } };
    }
  });

  // --------------------------------------------------------- personal details
  AR.register('profile', {
    mount: function (el) {
      var p = P(), g = p.gender || '';
      var today = new Date(); today.setFullYear(today.getFullYear() - 18);
      var emailLocked = AR.state.authMode === 'email' && !!p.email;
      var body = AR.page(el, 'Personal details');
      body.innerHTML = '<div class="stack gap16">' +
        '<div class="field"><label>Full name</label><input class="input" id="name" value="' + AR.esc(/^Passenger \d{4}$/.test(p.name || '') ? '' : (p.name || '')) + '"/></div>' +
        '<div class="field"><label>Mobile number</label><input class="input" value="' + AR.esc(p.phone || '') + '" disabled style="opacity:.7"/><div class="hint">To change your number, contact Aarohan support.</div></div>' +
        '<div class="field"><label>Email address</label><input class="input" id="email" type="email" value="' + AR.esc(p.email || '') + '" ' + (emailLocked ? 'disabled style="opacity:.7"' : '') + '/>' + (emailLocked ? '<div class="hint">Your email is how you sign in, so it cannot be changed here.</div>' : '') + '</div>' +
        '<div class="field"><label>Gender</label><div class="chips">' + Object.keys(GENDERS).map(function (k) { return '<button type="button" class="chip ' + (g === k ? 'on' : '') + '" data-g="' + k + '">' + GENDERS[k] + '</button>'; }).join('') + '</div></div>' +
        '<div class="field"><label>Date of birth</label><input class="input" id="dob" type="date" max="' + today.toISOString().slice(0, 10) + '" value="' + AR.esc(p.dateOfBirth || '') + '"/></div>' +
        '<div class="field"><label>Member since</label><input class="input" value="' + AR.esc(p.memberSince ? AR.fmt.date(p.memberSince) : '') + '" disabled style="opacity:.7"/></div>' +
        '<div class="field"><label>Emergency contacts</label><button class="row card" id="ec" style="border-radius:var(--r-md)"><span class="grow"><div class="r-title">' + ((p.emergencyContacts || []).length ? (p.emergencyContacts || []).map(function (c) { return AR.esc(c.name); }).join(', ') : 'None added yet') + '</div><div class="r-sub">Up to 3 people we can tell if you press SOS</div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></button></div>' +
        '<div class="hint err hide" id="err"></div><button class="btn btn-gold" id="save">Save changes</button></div>';
      AR.$$('[data-g]', body).forEach(function (b) { b.addEventListener('click', function () { g = b.dataset.g; AR.$$('[data-g]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
      AR.$('#ec', body).addEventListener('click', function () { AR.nav.go('safety'); });
      function err(m) { var h = AR.$('#err', body); h.textContent = m || ''; h.classList.toggle('hide', !m); }
      var save = AR.$('#save', body);
      save.addEventListener('click', async function () {
        var name = AR.$('#name', body).value.trim(), dob = AR.$('#dob', body).value, em = AR.$('#email', body);
        if (name.length < 2) return err('Enter your full name.');
        var patch = { name: name }; if (g) patch.gender = g; if (dob) patch.dateOfBirth = dob;
        if (em && !em.disabled && em.value.trim() && em.value.trim().toLowerCase() !== (p.email || '')) patch.email = em.value.trim().toLowerCase();
        save.classList.add('is-loading'); err('');
        try { await AR.api('/me', { method: 'PATCH', body: patch }); await AR.session.refresh(); AR.toast('Details saved.'); AR.nav.back(); }
        catch (e) { err(e.message); } finally { save.classList.remove('is-loading'); }
      });
    }
  });

  // ------------------------------------------------------------ rider rating
  AR.register('rating', {
    mount: function (el) {
      var body = AR.page(el, 'Rider rating');
      body.innerHTML = '<div class="skeleton" style="height:180px"></div>';
      (async function () {
        try { await AR.session.refresh(); } catch (_) {}
        var r = P().rating || { score: 5, average: 5, ratingsCount: 0, finishedTrips: 0, lateCancellations: 0, earlyCancellations: 0, latePenalty: 0, earlyPenalty: 0 };
        var pct = Math.max(0, Math.min(100, ((r.score - 1) / 4) * 100));
        body.innerHTML = '<div class="card center" style="padding:28px 16px"><div class="big-rating gold">' + Number(r.score).toFixed(1) + '</div><div class="stars mt12" style="gap:4px">' + [1, 2, 3, 4, 5].map(function (n) { return '<span class="' + (n <= Math.round(r.score) ? 'gold' : 'faint') + '">' + AR.icon('star', 22) + '</span>'; }).join('') + '</div><div class="bar mt16"><i style="width:0" data-w="' + pct + '%"></i></div><p class="small dim mt12">Updated live. It changes as captains rate you and as you finish or cancel trips.</p></div>' +
          '<div class="section-title">How it is worked out</div><div class="card">' +
          '<div class="kv"><span>Average of captains\' ratings</span><b>' + Number(r.average).toFixed(1) + (r.ratingsCount ? ' (' + r.ratingsCount + ')' : ' (none yet)') + '</b></div>' +
          '<div class="kv"><span>Cancelled after a captain was assigned</span><b>' + r.lateCancellations + (r.latePenalty ? ' · -' + r.latePenalty.toFixed(1) : '') + '</b></div>' +
          '<div class="kv"><span>Cancelled before a captain was assigned</span><b>' + r.earlyCancellations + (r.earlyPenalty ? ' · -' + r.earlyPenalty.toFixed(1) : '') + '</b></div>' +
          '<div class="kv"><span>Trips counted (your last 30)</span><b>' + r.finishedTrips + '</b></div></div>' +
          '<div class="section-title">Keep it high</div><div class="card"><div class="stack gap12 small dim"><span>Be ready at your pickup point when your captain arrives.</span><span>Cancel only if you really have to. Late cancellations count the most.</span><span>Be polite. Captains rate every trip.</span></div></div>';
        setTimeout(function () { var i = AR.$('[data-w]', body); if (i) i.style.width = i.dataset.w; }, 120);
      })();
    }
  });

  // ------------------------------------------------------------ saved places
  // Used by Favorites and by the trusted-locations part of Safety.
  function placeIcon(p) { var l = String(p.label || '').toLowerCase(); return l === 'home' ? 'home' : (l === 'work' ? 'building' : 'pin'); }
  function placesBlock(host, onChange) {
    var places = P().savedPlaces || [];
    host.innerHTML = (places.length ? '<div class="list">' + places.map(function (p) {
      return '<div class="row"><span class="r-ic">' + AR.icon(placeIcon(p), 20) + '</span><span class="grow" style="min-width:0"><div class="r-title">' + AR.esc(p.label) + '</div><div class="r-sub ellipsis">' + AR.esc(p.name) + '</div></span><button class="icon-btn plain" data-del="' + AR.esc(p.id) + '" aria-label="Remove ' + AR.esc(p.label) + '">' + AR.icon('trash', 20) + '</button></div>';
    }).join('') + '</div>' : '<div class="card dim small">No places yet. Add Home or Work so you can book in one tap.</div>') +
      '<button class="btn btn-line mt12" id="addplace">' + AR.icon('plus', 20) + 'Add a place</button>';
    AR.$$('[data-del]', host).forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!(await AR.confirm({ title: 'Remove this place?', body: 'You can add it again any time.', yes: 'Remove', no: 'Keep it', danger: true }))) return;
        try { await AR.api('/me/places/' + b.dataset.del, { method: 'DELETE' }); await AR.session.refresh(); placesBlock(host, onChange); if (onChange) onChange(); } catch (e) { AR.toast(e.message, 'gold'); }
      });
    });
    AR.$('#addplace', host).addEventListener('click', function () {
      var label = 'Home', custom = '';
      AR.sheet.open({
        html: '<h2>Add a place</h2><p class="dim small">What should we call it?</p><div class="chips mt16" id="lbl">' + ['Home', 'Work', 'Other'].map(function (l) { return '<button class="chip ' + (l === 'Home' ? 'on' : '') + '" data-l="' + l + '">' + l + '</button>'; }).join('') + '</div>' +
          '<input class="input mt12 hide" id="custom" maxlength="30" placeholder="For example: Gym, Mum\'s house"/><button class="btn btn-gold mt24" id="next">' + AR.icon('search', 20) + 'Search for an address</button><button class="btn btn-line mt12" id="onmap">' + AR.icon('map', 20) + 'Choose on the map</button>',
        onOpen: function (c) {
          AR.$$('[data-l]', c.el).forEach(function (b) { b.addEventListener('click', function () { label = b.dataset.l; AR.$$('[data-l]', c.el).forEach(function (x) { x.classList.toggle('on', x === b); }); AR.$('#custom', c.el).classList.toggle('hide', label !== 'Other'); }); });
          function save(name) {
            return async function (pl) {
              try { await AR.api('/me/places', { method: 'POST', body: { label: name, name: pl.name, address: pl.address || undefined, lat: pl.lat, lng: pl.lng } }); await AR.session.refresh(); AR.toast(name + ' saved.'); placesBlock(host, onChange); if (onChange) onChange(); }
              catch (e) { AR.toast(e.message, 'gold'); }
            };
          }
          function chosenName() {
            custom = AR.$('#custom', c.el).value.trim();
            var name = label === 'Other' ? custom : label;
            if (!name) { AR.toast('Give this place a name.', 'gold'); return null; }
            return name;
          }
          AR.$('#next', c.el).addEventListener('click', function () {
            var name = chosenName(); if (!name) return; c.close();
            setTimeout(function () { AR.nav.go('search', { field: 'dest', title: 'Find ' + name, hidePickup: true, onSelect: save(name) }); }, 420);
          });
          AR.$('#onmap', c.el).addEventListener('click', function () {
            var name = chosenName(); if (!name) return; c.close();
            setTimeout(function () { AR.nav.go('pick', { title: name, start: AR.trip.pickup, onPick: save(name) }); }, 420);
          });
        }
      });
    });
  }
  AR.register('places', { mount: function (el) { var b = AR.page(el, 'Favorites'); placesBlock(b); return { show: function () { placesBlock(AR.$('#body', el)); } }; } });

  // ------------------------------------------------------------------ safety
  AR.register('safety', {
    mount: function (el) {
      var body = AR.page(el, 'Safety');
      function paint() {
        var cs = P().emergencyContacts || [];
        body.innerHTML = '<div class="card"><div class="hstack gap12">' + AR.icon('shieldCheck', 26, 'gold') + '<div><div style="font-weight:700">If you press SOS</div><div class="small dim mt8">Aarohan\'s safety team is alerted with your location and trip. Your emergency contacts get a text with the same details.</div></div></div></div>' +
          '<div class="section-title">Emergency contacts (' + cs.length + ' of 3)</div>' +
          (cs.length ? '<div class="list">' + cs.map(function (c, i) {
            return '<div class="row"><span class="avatar" style="width:40px;height:40px;font-size:15px">' + AR.esc(AR.fmt.initials(c.name)) + '</span><span class="grow" style="min-width:0"><div class="r-title ellipsis">' + AR.esc(c.name) + '</div><div class="r-sub">' + AR.esc(c.phone) + (c.relation ? ' · ' + AR.esc(c.relation) : '') + '</div></span><button class="icon-btn plain" data-rm="' + i + '" aria-label="Remove ' + AR.esc(c.name) + '">' + AR.icon('trash', 20) + '</button></div>';
          }).join('') + '</div>' : '<div class="card dim small">No contacts yet. Add someone you trust.</div>') +
          (cs.length < 3 ? '<button class="btn btn-line mt12" id="addc">' + AR.icon('plus', 20) + 'Add a contact</button>' : '') +
          '<div class="section-title">Trusted places</div><div id="places"></div>';
        placesBlock(AR.$('#places', body));
        AR.$$('[data-rm]', body).forEach(function (b) { b.addEventListener('click', async function () { var next = cs.filter(function (_, i) { return i !== +b.dataset.rm; }); await saveContacts(next); }); });
        var add = AR.$('#addc', body);
        if (add) add.addEventListener('click', function () {
          var rel = 'Family';
          AR.sheet.open({
            html: '<h2>Add emergency contact</h2><div class="stack gap12 mt16"><input class="input" id="cn" placeholder="Full name" autocomplete="off"/><div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="cp" type="tel" inputmode="tel" placeholder="99 123 4567"/></div>' +
              '<div class="chips" id="rel">' + ['Family', 'Friend', 'Partner', 'Other'].map(function (r) { return '<button class="chip ' + (r === 'Family' ? 'on' : '') + '" data-r="' + r + '">' + r + '</button>'; }).join('') + '</div><div class="hint err hide" id="e"></div><button class="btn btn-gold" id="ok">Save contact</button></div>',
            onOpen: function (c) {
              AR.$$('[data-r]', c.el).forEach(function (b) { b.addEventListener('click', function () { rel = b.dataset.r; AR.$$('[data-r]', c.el).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
              AR.$('#ok', c.el).addEventListener('click', async function () {
                var n = AR.$('#cn', c.el).value.trim(), ph = AR.phone.normalize(AR.$('#cp', c.el).value), e = AR.$('#e', c.el);
                var fail = function (m) { e.textContent = m; e.classList.remove('hide'); };
                if (n.length < 2) return fail('Enter their name.'); if (!AR.phone.valid(ph)) return fail('Enter a valid Malawian mobile number.');
                this.classList.add('is-loading');
                try { await saveContacts(cs.concat([{ name: n, phone: ph, relation: rel }]), true); c.close(); } catch (er) { this.classList.remove('is-loading'); fail(er.message); }
              });
            }
          });
        });
      }
      async function saveContacts(list, throwErr) {
        try { await AR.api('/me/emergency-contacts', { method: 'PUT', body: { contacts: list.map(function (c) { return { name: c.name, phone: c.phone, relation: c.relation || undefined }; }) } }); await AR.session.refresh(); paint(); AR.toast('Emergency contacts saved.'); }
        catch (e) { if (throwErr) throw e; AR.toast(e.message, 'gold'); }
      }
      paint();
    }
  });

  // ---------------------------------------------------------------- settings
  AR.register('settings', {
    mount: function (el) {
      var body = AR.page(el, 'Settings');
      body.innerHTML = '<div class="section-title" style="padding-top:4px">General</div><div class="list">' +
        AR.row({ id: 'profile', icon: 'user', title: 'Profile', sub: 'Your personal details' }) + AR.row({ id: 'places', icon: 'heart', title: 'Favorites', sub: 'Home, Work and saved places' }) + AR.row({ id: 'language', icon: 'map', title: AR.t('language'), sub: AR.lang.get() === 'ny' ? 'Chichewa' : 'English' }) + ((AR.state.cfg && AR.state.cfg.allowLocationSimulation) ? '<button class="row" id="testloc"><span class="r-ic">' + AR.icon('locate', 20) + '</span><span class="grow"><div class="r-title">Test location (developer)</div><div class="r-sub">Pretend to be in Lilongwe</div></span><span class="toggle ' + (AR.map.testOn() ? 'on' : '') + '"></span></button>' : '') + AR.row({ id: 'shortcuts', icon: 'settings', title: 'App shortcuts', sub: 'Choose what shows on Home' }) +
        '<button class="row" id="lowdata"><span class="r-ic">' + AR.icon('map', 20) + '</span><span class="grow"><div class="r-title">Low-data mode</div><div class="r-sub">Lighter maps, no animations. Good for weak signal.</div></span><span class="toggle ' + (document.documentElement.hasAttribute('data-lowdata') ? 'on' : '') + '"></span></button></div>' +
        '<div class="section-title">Others</div><div class="list">' + AR.row({ id: 'about', icon: 'info', title: 'About' }) + AR.row({ id: 'logout', icon: 'logout', title: 'Log out' }) + AR.row({ id: 'delete', icon: 'trash', title: 'Delete account', sub: 'Remove your account and personal details' }) + '</div>';
      AR.$('#lowdata', body).addEventListener('click', function () {
        var on = !document.documentElement.hasAttribute('data-lowdata');
        if (on) document.documentElement.setAttribute('data-lowdata', ''); else document.documentElement.removeAttribute('data-lowdata');
        try { localStorage.setItem('aarohan_lowdata', on ? '1' : '0'); } catch (_) {}
        AR.$('.toggle', this).classList.toggle('on', on); if (AR.map.retile) AR.map.retile();
        AR.toast(on ? 'Low-data mode is on.' : 'Low-data mode is off.');
      });
      var tl = AR.$('#testloc', body); if (tl) tl.addEventListener('click', function () { AR.map.setTest(!AR.map.testOn()); AR.toast('Test location ' + (AR.map.testOn() ? 'on' : 'off') + '. Reloading...'); setTimeout(function () { location.reload(); }, 600); });
      AR.bindRows(body, {
        language: function () { AR.nav.go('language', {}); }, profile: function () { AR.nav.go('profile'); }, places: function () { AR.nav.go('places'); }, shortcuts: function () { AR.nav.go('shortcuts'); }, about: function () { AR.nav.go('about'); },
        logout: function () { AR.session.signOut(); }, delete: function () { AR.deleteAccount(); }
      });
    }
  });

  AR.hiddenShortcuts = function () { try { return JSON.parse(localStorage.getItem('aarohan_hidden_shortcuts') || '[]'); } catch (_) { return []; } };
  AR.register('shortcuts', {
    mount: function (el) {
      var body = AR.page(el, 'App shortcuts'), places = P().savedPlaces || [], hidden = AR.hiddenShortcuts();
      body.innerHTML = '<p class="dim small" style="padding:0 4px 12px">Pick which saved places appear as quick buttons on your Home screen.</p>' +
        (places.length ? '<div class="list">' + places.map(function (p) { return '<button class="row" data-id="' + AR.esc(p.id) + '"><span class="r-ic">' + AR.icon(placeIcon(p), 20) + '</span><span class="grow"><div class="r-title">' + AR.esc(p.label) + '</div><div class="r-sub ellipsis">' + AR.esc(p.name) + '</div></span><span class="toggle ' + (hidden.indexOf(p.id) === -1 ? 'on' : '') + '"></span></button>'; }).join('') + '</div>' : '<div class="card dim small">You have no saved places yet. Add some in Favorites.</div>');
      AR.$$('[data-id]', body).forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.dataset.id, i = hidden.indexOf(id); if (i === -1) hidden.push(id); else hidden.splice(i, 1);
          try { localStorage.setItem('aarohan_hidden_shortcuts', JSON.stringify(hidden)); } catch (_) {}
          AR.$('.toggle', b).classList.toggle('on', hidden.indexOf(id) === -1);
        });
      });
    }
  });

  AR.register('about', {
    mount: function (el) {
      var body = AR.page(el, 'About'), cfg = AR.state.cfg || {};
      body.innerHTML = '<div class="center" style="padding:16px 0 8px"><div style="display:inline-block">' + AR.mark(76) + '</div><h2 class="mt12">Aarohan</h2><div class="dim small">Safe, simple rides in Lilongwe</div><div class="faint tiny mt8">Pilot version 1.0</div></div>' +
        '<div class="list mt16"><a class="row" href="/legal/terms" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="r-ic">' + AR.icon('file', 20) + '</span><span class="grow"><div class="r-title">Terms of Service</div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></a>' +
        '<a class="row" href="/legal/privacy" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="r-ic">' + AR.icon('lock', 20) + '</span><span class="grow"><div class="r-title">Privacy Policy</div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></a></div>' +
        '<div class="card mt16 small dim">Map data © OpenStreetMap contributors. Map tiles © Mapbox / CARTO. Aarohan is a pilot service in Lilongwe, Malawi. For emergencies call 997.</div>';
    }
  });

  AR.deleteAccount = function () {
    AR.sheet.open({
      html: '<h2>Delete your account?</h2><p class="dim">This removes your name, phone, email, contacts and saved places. Your past trips are kept without your personal details, as the law requires. <b>This cannot be undone.</b></p>' +
        '<div class="field mt16"><label>Type DELETE to confirm</label><input class="input" id="w" autocapitalize="characters" autocomplete="off"/></div><div class="hint err hide" id="e"></div>' +
        '<div class="stack gap12 mt16"><button class="btn btn-gold" id="go" disabled>Delete my account</button><button class="btn btn-ghost" style="width:100%" id="no">Keep my account</button></div>',
      onOpen: function (c) {
        var w = AR.$('#w', c.el), go = AR.$('#go', c.el);
        w.addEventListener('input', function () { go.disabled = w.value.trim() !== 'DELETE'; });
        AR.$('#no', c.el).addEventListener('click', function () { c.close(); });
        go.addEventListener('click', async function () {
          go.classList.add('is-loading');
          try { await AR.api('/me/delete', { method: 'POST', body: { confirm: 'DELETE' } }); window.aarohanAuth.clearSession(); location.href = '/rider/next/'; }
          catch (e) { go.classList.remove('is-loading'); var h = AR.$('#e', c.el); h.textContent = e.message; h.classList.remove('hide'); }
        });
      }
    });
  };
})();
