// ============================================================================
// Aarohan rider: onboarding (why Aarohan, then sign up / sign in).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;

  // ------------------------------------------------------------ phone tools
  AR.phone = {
    normalize: function (raw) {
      var p = String(raw || '').replace(/[\s-]/g, '');
      if (!p) return '';
      if (p.indexOf('0') === 0) return '+265' + p.slice(1);
      if (p.indexOf('+265') !== 0) return '+265' + p;
      return p;
    },
    valid: function (p) { return /^\+265(88|89|98|99|90|31)\d{7}$/.test(p); }
  };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ------------------------------------------------------------------ intro
  var SLIDES = [
    { icon: 'shieldCheck', title: 'Rides you can trust', text: 'Every captain is checked and approved by Aarohan before taking a single trip, and your ride only starts when you share your PIN.' },
    { icon: 'route', title: 'Know your fare before you go', text: 'See the price for Moto, Auto or Cab upfront, add stops on the way, and pay cash when you arrive.' },
    { icon: 'parcel', title: 'Parcels that reach the right hands', text: 'A pickup code and a delivery code mean your parcel only changes hands with the people you choose.' },
    { icon: 'users', title: 'Safety travels with you', text: 'Share your trip, keep emergency contacts ready, and reach the Aarohan safety team from the SOS button.' }
  ];

  AR.register('intro', {
    locked: true,
    mount: function (el) {
      el.classList.add('intro');
      var i = 0;
      el.innerHTML =
        '<div class="topbar"><div class="grow"></div><button class="btn btn-ghost btn-sm" data-skip>' + AR.t('skip') + '</button></div>' +
        '<div class="intro-stage"><div class="intro-art" id="art"></div><div id="slides"></div></div>' +
        '<div class="stack gap24" style="padding:0 28px calc(28px + var(--safe-bottom))"><div class="dots" id="dots"></div><button class="btn btn-gold" data-next>Continue</button></div>';
      var art = AR.$('#art', el), slides = AR.$('#slides', el), dots = AR.$('#dots', el), next = AR.$('[data-next]', el);
      slides.innerHTML = SLIDES.map(function (s) { return '<div class="slide"><span class="eyebrow">Aarohan</span><h2>' + AR.esc(s.title) + '</h2><p>' + AR.esc(s.text) + '</p></div>'; }).join('');
      dots.innerHTML = SLIDES.map(function () { return '<i></i>'; }).join('');

      function show(n) {
        i = n;
        AR.$$('.slide', el).forEach(function (s, k) { s.classList.toggle('on', k === n); });
        AR.$$('i', dots).forEach(function (d, k) { d.classList.toggle('on', k === n); });
        art.innerHTML = '<div class="art-glow"></div><div class="orbit o2"><i></i></div><div class="orbit o1"><i></i></div><div class="art-tile">' + AR.icon(SLIDES[n].icon, 68) + '</div>';
        next.textContent = n === SLIDES.length - 1 ? AR.t('start') : AR.t('cont');
      }
      function seen() { try { localStorage.setItem('aarohan_intro_seen', '1'); } catch (_) {} }
      next.addEventListener('click', function () { if (i < SLIDES.length - 1) show(i + 1); else { seen(); AR.nav.go('auth'); } });
      AR.$('[data-skip]', el).addEventListener('click', function () { seen(); AR.nav.go('auth'); });
      // Swipe between slides
      var x0 = null;
      el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', function (e) {
        if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (dx < -50 && i < SLIDES.length - 1) show(i + 1); else if (dx > 50 && i > 0) show(i - 1);
      });
      show(0);
    }
  });

  // ------------------------------------------------------------ sign up / in
  AR.register('auth', {
    locked: true,
    mount: function (el) {
      var mode = (AR.state.authMode === 'email') ? 'email' : 'phone';
      var S = { step: 'id', id: '', consent: false, code: '', resend: 0, timer: null, needsName: false, busy: false };

      function stepIndex() { return S.step === 'id' ? 0 : (S.step === 'code' ? 1 : 2); }
      function dots() { return '<div class="step-dots">' + [0, 1, 2].map(function (k) { return '<i class="' + (k <= stepIndex() ? 'on' : '') + '"></i>'; }).join('') + '</div>'; }
      function head(title, sub) {
        return '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button></div>' + dots() +
          '<div style="padding:26px var(--pad) 6px"><h1 style="font-size:30px;line-height:1.1">' + title + '</h1><p class="dim mt8">' + sub + '</p></div>';
      }
      function err(msg) { var h = AR.$('[data-err]', el); if (h) { h.textContent = msg || ''; h.classList.toggle('hide', !msg); if (msg) { try { h.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} } } }
      function busy(btn, on) { S.busy = on; if (btn) btn.classList.toggle('is-loading', on); }

      // ---- Sign in with Google (shown only when the server has a Google client id)
      var gclient = (AR.state.cfg && AR.state.cfg.googleClientId) || '';
      // Inside the Android app, Google blocks its normal web button. There the native Google plugin is used when it is installed;
      // otherwise Google is simply left out and the email code works (it works everywhere).
      var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      var nativeG = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
      var isDev = !!(AR.state.cfg && AR.state.cfg.allowLocationSimulation);
      function googleHtml() {
        if (!gclient) return isDev ? '<div class="hint center">Test server: Google sign-in is off until GOOGLE_CLIENT_ID is set.</div>' : '';
        if (isNative && !nativeG) return '';
        if (nativeG) return '<div id="gwrap" style="opacity:.45;pointer-events:none;transition:opacity .2s"><button type="button" class="btn btn-line" id="gnative" style="width:100%">Continue with Google</button></div>' +
          '<div class="hint center" id="gnote">Tick the box below to continue with Google.</div>' +
          '<div class="hstack gap12 faint small"><span class="grow divider" style="margin:0"></span><span>or use your email</span><span class="grow divider" style="margin:0"></span></div>';
        return '<div id="gwrap" style="opacity:.45;pointer-events:none;transition:opacity .2s"><div id="gbtn" style="display:flex;justify-content:center;min-height:44px"></div></div>' +
          '<div class="hint center" id="gnote">Tick the box below to continue with Google.</div>' +
          '<div class="hstack gap12 faint small"><span class="grow divider" style="margin:0"></span><span>or use your email</span><span class="grow divider" style="margin:0"></span></div>';
      }
      function gate() { var w = AR.$('#gwrap', el), n = AR.$('#gnote', el); if (!w) return; w.style.opacity = S.consent ? '1' : '.45'; w.style.pointerEvents = S.consent ? 'auto' : 'none'; if (n) n.classList.toggle('hide', S.consent); }
      function mountGoogle() {
        if (nativeG && gclient) {
          var nb = AR.$('#gnative', el);
          if (nb) nb.addEventListener('click', async function () {
            try { await nativeG.initialize({ clientId: gclient, scopes: ['profile', 'email'], grantOfflineAccess: false }); var r = await nativeG.signIn(); await onGoogle({ credential: r && r.authentication && r.authentication.idToken }); }
            catch (e) { var n = AR.$('#gnote', el); if (n) { n.textContent = 'Google sign-in did not finish. You can use your email instead.'; n.classList.remove('hide'); } }
          });
          return;
        }
        var host = AR.$('#gbtn', el); if (!gclient || !host) return;
        function draw() {
          try {
            window.google.accounts.id.initialize({ client_id: gclient, callback: onGoogle, ux_mode: 'popup' });
            window.google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
          } catch (_) { host.innerHTML = ''; }
          gate();
        }
        if (window.google && window.google.accounts && window.google.accounts.id) return draw();
        var sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = draw;
        sc.onerror = function () { var w = AR.$('#gwrap', el); if (w) w.style.display = 'none'; var n = AR.$('#gnote', el); if (n) n.textContent = 'Google is not available right now. Use your email below, it works the same.'; };
        document.head.appendChild(sc);
      }
      async function onGoogle(resp) {
        if (!resp || !resp.credential) return;
        if (!S.consent) return err('Please tick the box to agree to the Terms and Privacy Policy.');
        S.googleCred = resp.credential;
        try { var data = await post('/api/auth/google', { credential: S.googleCred }); await finishSession(data); done(); }
        catch (e) {
          if (e.data && e.data.code === 'PROFILE_REQUIRED') { S.name = e.data.suggestedName || ''; S.needsName = true; S.step = 'profile'; renderProfile(); }
          else err(e.message);
        }
      }

      // ---- step 1: email or phone, plus consent
      function renderId() {
        var isEmail = mode === 'email';
        el.innerHTML = head(isEmail ? (S.returning ? 'Welcome back' : 'Create your account or sign in') : 'Your mobile number', isEmail ? (S.returning ? 'We will email you a 6-digit code to sign in. No password needed.' : 'We will email you a 6-digit code. No password needed.') : 'We will text you a 6-digit code.') +
          '<div class="scroll"><div class="stack gap16 mt16">' + googleHtml() +
          '<div class="field"><label>' + (isEmail ? 'Email address' : 'Mobile number') + '</label>' +
          (isEmail
            ? '<input class="input" id="id" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com" value="' + AR.esc(S.id) + '"/>'
            : '<div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="id" type="tel" inputmode="tel" autocomplete="tel" placeholder="99 123 4567" value="' + AR.esc(S.id) + '"/></div>') +
          '<div class="hint err hide" data-err></div></div>' +
          '<button class="consent" type="button" id="consent" style="text-align:left"><span class="check ' + (S.consent ? 'on' : '') + '">' + AR.icon('check', 16) + '</span><span>I agree to the <a class="link" href="/legal/terms" target="_blank" rel="noopener">Terms of Service</a> and <a class="link" href="/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></button>' +
          '<button class="btn btn-gold" id="go">' + (S.returning ? 'Send sign-in code' : 'Send code') + '</button>' + (S.returning ? '<button class="btn btn-ghost btn-sm" type="button" id="notme" style="width:100%">Not you? Use a different email</button>' : '') + '</div></div>';
        var inp = AR.$('#id', el), go = AR.$('#go', el);
        if (S.returning) { var cb = AR.$('#consent', el); if (cb) cb.classList.add('hide'); S.consent = true; var nm = AR.$('#notme', el); if (nm) nm.addEventListener('click', function () { S.returning = false; S.consent = false; S.id = ''; S._checked = null; S.isNew = null; renderId(); }); }
        // a friendly message under the email box (not an error)
        function note(msg) { var o = AR.$('#emailnote', el); if (o) o.remove(); if (!msg) return; var n = document.createElement('div'); n.id = 'emailnote'; n.className = 'suggest mt8'; n.innerHTML = AR.icon('info', 20) + '<span>' + AR.esc(msg) + '</span>'; inp.parentNode.appendChild(n); }
        // A mistyped email domain means the code never arrives and the person gives up. Ask before sending.
        var TYPOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmil.com': 'gmail.com', 'gmail.cm': 'gmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'outlok.com': 'outlook.com' };
        var sg = document.createElement('button'); sg.type = 'button'; sg.className = 'btn btn-ghost btn-sm hide'; sg.style.cssText = 'padding:0;min-height:28px;text-align:left;justify-content:flex-start'; inp.parentNode.appendChild(sg);
        function typoFix() { if (!isEmail) return null; var v = (inp.value || '').trim().toLowerCase(), at = v.indexOf('@'); if (at < 1) return null; var f = TYPOS[v.slice(at + 1)]; return f ? { v: v, at: at, fix: f } : null; }
        function suggest() { var t = typoFix(); if (!t) return sg.classList.add('hide'); sg.textContent = 'Did you mean ' + t.v.slice(0, t.at) + '@' + t.fix + '? Tap to use it.'; sg.classList.remove('hide'); sg.onclick = function () { inp.value = t.v.slice(0, t.at) + '@' + t.fix; S.id = inp.value; sg.classList.add('hide'); }; }
        inp.addEventListener('blur', suggest);
        inp.addEventListener('input', function () { S.id = inp.value; err(''); sg.classList.add('hide'); });
        AR.$('#consent', el).addEventListener('click', function (e) { if (e.target.closest('a')) return; S.consent = !S.consent; AR.$('.check', el).classList.toggle('on', S.consent); err(''); gate(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
        go.addEventListener('click', async function () {
          var id = isEmail ? S.id.trim().toLowerCase() : AR.phone.normalize(S.id);
          if (isEmail && !EMAIL_RE.test(id)) return err('Enter a valid email address.');
          if (typoFix() && !S._typoAsked) { S._typoAsked = true; suggest(); return err('Please check the spelling of your email, then tap Send code again.'); }
          if (!isEmail && !AR.phone.valid(id)) return err('Enter a valid Malawian mobile number, for example 99 123 4567.');
          // Is this email already registered? A returning person goes to sign in. A new email is verified and then the account is created.
          if (isEmail && !S.returning) {
            var known = S._checked && S._checked.email === id ? S._checked : null;
            if (!known) {
              busy(go, true);
              try { var st = await post('/api/auth/email/check', { email: id }); known = S._checked = { email: id, exists: !!st.exists, status: st.status || null }; }
              catch (ce) { known = null; /* no signal or the server is older: carry on, the code step still works */ }
              busy(go, false);
            }
            if (known && known.status === 'SUSPENDED') return err('This account is suspended. Please contact Aarohan support.');
            if (known && known.status === 'DELETED') return err('This account was closed. Please contact Aarohan support.');
            if (known && known.exists) {
              note('I think you have already registered with this email. Taking you to sign in...');
              await new Promise(function (r) { setTimeout(r, 1800); });
              S.returning = true; S.consent = true; S.id = id; renderId();
              var again = AR.$('#go', el); if (again) again.click(); // the code is sent straight away
              return;
            }
            S.isNew = known ? true : null;
            if (known && !known.exists && !S.consent) { note('New here? We will verify this email and create your account.'); return err('Please tick the box to agree to the Terms and Privacy Policy, then tap Send code.'); }
          }
          if (!S.consent && !S.returning) return err('Please tick the box to agree to the Terms and Privacy Policy.');
          busy(go, true);
          try {
            var r = await post(isEmail ? '/api/auth/email/otp/request' : '/api/auth/otp/request', isEmail ? { email: id } : { phone: id });
            S.idClean = id; S.maskedTo = r.message ? '' : '';
            S.step = 'code'; startResend(); renderCode();
          } catch (e) { err(e.message); } finally { busy(go, false); }
        });
        mountGoogle(); gate();
        setTimeout(function () { if (!gclient) inp.focus(); }, 350);
      }

      // ---- step 2: the 6-digit code
      function renderCode() {
        var isEmail = mode === 'email';
        el.innerHTML = head(S.returning ? 'Enter your sign-in code' : (S.isNew ? 'Verify your email' : 'Enter your code'), (S.isNew ? 'This is a new email, so after you verify it we will create your account. ' : '') + 'Sent to <b>' + AR.esc(S.idClean) + '</b>' + (isEmail ? '. Check your spam folder if it does not arrive.' : '.')) +
          '<div class="scroll"><div class="stack gap16 mt16">' +
          '<div class="field"><input class="input otp" id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"/><div class="hint err hide" data-err></div></div>' +
          '<button class="btn btn-gold" id="verify">Verify</button>' +
          '<div class="center small dim" id="resend"></div></div></div>';
        var code = AR.$('#code', el), vbtn = AR.$('#verify', el);
        code.addEventListener('input', function () { code.value = code.value.replace(/\D/g, '').slice(0, 6); err(''); if (code.value.length === 6) vbtn.click(); });
        vbtn.addEventListener('click', async function () {
          if (S.busy) return;
          S.code = code.value;
          if (S.code.length !== 6) return err('Enter the 6 digits from your message.');
          busy(vbtn, true);
          try { await verify(); }
          catch (e) {
            if (e.data && e.data.code === 'PROFILE_REQUIRED') { S.needsName = true; S.step = 'profile'; renderProfile(); }
            else err(e.message);
          } finally { busy(vbtn, false); }
        });
        paintResend();
        setTimeout(function () { code.focus(); }, 350);
      }
      function startResend() { S.resend = 60; clearInterval(S.timer); S.timer = setInterval(function () { S.resend--; paintResend(); if (S.resend <= 0) clearInterval(S.timer); }, 1000); }
      function paintResend() {
        var r = AR.$('#resend', el); if (!r) return;
        if (S.resend > 0) r.textContent = 'You can ask for a new code in ' + S.resend + 's';
        else { r.innerHTML = '<button class="btn btn-ghost" id="again">Send a new code</button>'; AR.$('#again', el).addEventListener('click', async function () { try { await post(mode === 'email' ? '/api/auth/email/otp/request' : '/api/auth/otp/request', mode === 'email' ? { email: S.idClean } : { phone: S.idClean }); AR.toast('A new code is on its way.'); startResend(); paintResend(); } catch (e) { err(e.message); } }); }
      }

      // ---- step 3: about you
      function renderProfile() {
        var isEmail = mode === 'email';
        var today = new Date(); today.setFullYear(today.getFullYear() - 18);
        var maxDob = today.toISOString().slice(0, 10);
        S.gender = S.gender || '';
        el.innerHTML = head('Tell us about you', 'This helps your captain recognise you and keeps your account safe.') +
          '<div class="scroll"><div class="stack gap16 mt8">' +
          '<div class="field"><label>Full name</label><input class="input" id="name" autocomplete="name" placeholder="As on your ID" value="' + AR.esc(S.name || '') + '"/></div>' +
          (isEmail
            ? '<div class="field"><label>Mobile number</label><div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="phone" name="mw-mobile" type="tel" inputmode="tel" autocomplete="off" placeholder="99 123 4567" value="' + AR.esc(S.phone || '') + '"/></div><div class="hint">Your captain may call you on this number. It must be a Malawian mobile number.</div>' + ((AR.state.cfg && AR.state.cfg.allowLocationSimulation) ? '<button type="button" class="btn btn-ghost btn-sm" id="testphone" style="padding:0;min-height:30px">Testing? Use a made-up Malawi number</button>' : '') + '</div>'
            : '<div class="field"><label>Email address</label><input class="input" id="email" type="email" autocomplete="email" autocapitalize="none" placeholder="you@example.com" value="' + AR.esc(S.email || '') + '"/></div>') +
          '<div class="field"><label>Date of birth</label><input class="input" id="dob" type="date" max="' + maxDob + '" value="' + AR.esc(S.dob || '') + '"/><div class="hint">You must be 18 or older.</div></div>' +
          '<div class="field"><label>Gender</label><div class="chips" id="gender">' +
          [['FEMALE', 'Female'], ['MALE', 'Male'], ['OTHER', 'Other'], ['PREFER_NOT', 'Prefer not to say']].map(function (g) { return '<button type="button" class="chip ' + (S.gender === g[0] ? 'on' : '') + '" data-g="' + g[0] + '">' + g[1] + '</button>'; }).join('') + '</div></div>' +
          (AR.state.hideReferral ? '' : '<div class="field"><label>Do you have a referral code?</label><div class="chips"><button type="button" class="chip ' + (S.hasRef ? '' : 'on') + '" data-hr="no">No</button><button type="button" class="chip ' + (S.hasRef ? 'on' : '') + '" data-hr="yes">Yes, I have one</button></div>' +
          '<div class="' + (S.hasRef ? '' : 'hide') + '" id="refbox" style="margin-top:10px"><input class="input" id="ref" autocapitalize="characters" placeholder="Enter the code" value="' + AR.esc(S.ref || '') + '"/><div class="hint" id="refhint">A friend\'s code gives you both coins.</div></div></div>') +
          '<div class="hint err hide" data-err></div>' +
          '<button class="btn btn-gold" id="create">Create my account</button></div></div>';
        var tp = AR.$('#testphone', el); if (tp) tp.addEventListener('click', function () { var n = '99'; for (var k = 0; k < 7; k++) n += Math.floor(Math.random() * 10); AR.$('#phone', el).value = n; AR.toast('Test number filled in.'); });
        var refTimer = null;
        AR.$$('[data-hr]', el).forEach(function (b) { b.addEventListener('click', function () { S.hasRef = b.dataset.hr === 'yes'; AR.$$('[data-hr]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); AR.$('#refbox', el).classList.toggle('hide', !S.hasRef); if (!S.hasRef) { S.ref = ''; S.refOk = false; } }); });
        var refEl = AR.$('#ref', el); // not present in the driver app
        if (refEl) refEl.addEventListener('input', function () {
          var v = this.value.trim().toUpperCase(), hint = AR.$('#refhint', el); S.ref = v; S.refOk = false; clearTimeout(refTimer);
          if (v.length < 4) { hint.className = 'hint'; hint.textContent = 'A friend\'s code gives you both coins.'; return; }
          hint.className = 'hint'; hint.textContent = 'Checking...';
          refTimer = setTimeout(async function () {
            try { var r = await fetch('/api/auth/referral/' + encodeURIComponent(v)).then(function (x) { return x.json(); });
              if (S.ref !== v) return; S.refOk = !!r.valid;
              hint.className = 'hint' + (r.valid ? '' : ' err'); hint.textContent = r.valid ? 'Code from ' + r.from + '. You will both earn coins.' : 'We could not find that code. Check the spelling.';
            } catch (_) { hint.textContent = 'Could not check the code right now.'; }
          }, 450);
        });
        AR.$$('[data-g]', el).forEach(function (b) { b.addEventListener('click', function () { S.gender = b.dataset.g; AR.$$('[data-g]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
        var create = AR.$('#create', el);
        create.addEventListener('click', async function () {
          S.name = AR.$('#name', el).value.trim(); S.dob = AR.$('#dob', el).value; S.ref = (S.hasRef && AR.$('#ref', el)) ? (AR.$('#ref', el).value || '').trim().toUpperCase() : '';
          if (isEmail) S.phone = AR.$('#phone', el).value; else S.email = AR.$('#email', el).value.trim().toLowerCase();
          if (isEmail && /^\s*\+(?!265)/.test(S.phone || '')) return err('Aarohan works with Malawian numbers only (+265). ' + ((AR.state.cfg && AR.state.cfg.allowLocationSimulation) ? 'For testing, tap "Use a made-up Malawi number" under the box.' : 'Please enter a Malawian mobile number.'));
          if (S.name.length < 2) return err('Enter your full name.');
          var ph = isEmail ? AR.phone.normalize(S.phone) : null;
          if (isEmail && !AR.phone.valid(ph)) return err('Enter a valid Malawian mobile number.');
          if (!isEmail && !EMAIL_RE.test(S.email)) return err('Enter a valid email address.');
          if (!S.dob) return err('Enter your date of birth.');
          if (!S.gender) return err('Choose an option for gender.');
          if (S.hasRef && S.ref && !S.refOk) return err('That referral code is not valid. Check it, or choose "No".');
          busy(create, true);
          try {
            if (S.googleCred) { var gd = await post('/api/auth/google', { credential: S.googleCred, name: S.name, phone: ph }); await finishSession(gd); }
            else if (isEmail) await verify({ name: S.name, phone: ph });
            else await finishSession(S.pending);
            await AR.api('/me', { method: 'PATCH', body: Object.assign({ name: S.name, dateOfBirth: S.dob, gender: S.gender }, isEmail ? {} : { email: S.email }, S.ref ? { referralCode: S.ref } : {}) });
            done();
          } catch (e) { err(e.message); } finally { busy(create, false); }
        });
      }

      // ---- talking to the server
      async function post(url, body) {
        var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        var data = {}; try { data = await res.json(); } catch (_) {}
        if (!res.ok) { var e = new Error(data.error || 'Something went wrong. Please try again.'); e.data = data; e.status = res.status; throw e; }
        return data;
      }
      async function verify(extra) {
        var isEmail = mode === 'email';
        var data = await post(isEmail ? '/api/auth/email/otp/verify' : '/api/auth/otp/verify', Object.assign(isEmail ? { email: S.idClean, otp: S.code } : { phone: S.idClean, otp: S.code }, extra || {}));
        if (isEmail) { await finishSession(data); if (!extra) { if (data.user && data.user.name) done(); } return; }
        // phone mode: a brand-new rider has a placeholder name, so ask for details
        S.pending = data;
        if (data.user && /^Passenger \d{4}$/.test(data.user.name || '')) { await finishSession(data); S.step = 'profile'; renderProfile(); S.pending = data; return; }
        await finishSession(data); done();
      }
      async function finishSession(data) {
        if (!data) return;
        window.aarohanAuth.setSession(data.accessToken, data.refreshToken, data.user);
        window.aarohanAuth.setReady(data.user);
        try { window.aarohanAuth.recordConsent('TERMS_AND_PRIVACY'); } catch (_) {}
      }
      function done() { clearInterval(S.timer); AR.session.start(); }

      el.addEventListener('click', function (e) {
        if (!e.target.closest('[data-back]')) return;
        if (S.step === 'id') { if (AR.nav.stack.length > 1) AR.nav.back(); else AR.nav.replace('intro'); } else if (S.step === 'code') { S.step = 'id'; renderId(); } else { S.step = 'code'; renderCode(); }
      });
      renderId();
      return { destroy: function () { clearInterval(S.timer); } };
    }
  });

  // Existing riders who signed up before date of birth and gender were asked.
  AR.register('complete-profile', {
    locked: true,
    mount: function (el) {
      var today = new Date(); today.setFullYear(today.getFullYear() - 18);
      var P = AR.state.profile || {}; var g = P.gender || '';
      el.innerHTML = '<div class="topbar"><h1>Complete your profile</h1><button class="btn btn-ghost btn-sm" data-skip>Later</button></div>' +
        '<div class="scroll"><p class="dim">A few details so your captain can recognise you and your account stays safe.</p><div class="stack gap16 mt16">' +
        '<div class="field"><label>Full name</label><input class="input" id="name" value="' + AR.esc(/^Passenger \d{4}$/.test(P.name || '') ? '' : (P.name || '')) + '" placeholder="As on your ID"/></div>' +
        '<div class="field"><label>Date of birth</label><input class="input" id="dob" type="date" max="' + today.toISOString().slice(0, 10) + '" value="' + AR.esc(P.dateOfBirth || '') + '"/></div>' +
        '<div class="field"><label>Gender</label><div class="chips">' + [['FEMALE', 'Female'], ['MALE', 'Male'], ['OTHER', 'Other'], ['PREFER_NOT', 'Prefer not to say']].map(function (x) { return '<button type="button" class="chip ' + (g === x[0] ? 'on' : '') + '" data-g="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="hint err hide" data-err></div><button class="btn btn-gold" id="save">Save</button></div></div>';
      AR.$$('[data-g]', el).forEach(function (b) { b.addEventListener('click', function () { g = b.dataset.g; AR.$$('[data-g]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
      function err(m) { var h = AR.$('[data-err]', el); h.textContent = m || ''; h.classList.toggle('hide', !m); }
      AR.$('[data-skip]', el).addEventListener('click', function () { AR.nav.back(); });
      var save = AR.$('#save', el);
      save.addEventListener('click', async function () {
        var name = AR.$('#name', el).value.trim(), dob = AR.$('#dob', el).value;
        if (name.length < 2) return err('Enter your full name.'); if (!dob) return err('Enter your date of birth.'); if (!g) return err('Choose an option for gender.');
        save.classList.add('is-loading');
        try { await AR.api('/me', { method: 'PATCH', body: { name: name, dateOfBirth: dob, gender: g } }); await AR.session.refresh(); AR.toast('Profile saved.'); AR.nav.back(); }
        catch (e) { err(e.message); } finally { save.classList.remove('is-loading'); }
      });
    }
  });
})();
