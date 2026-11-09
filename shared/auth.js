// ============================================================================
// AAROHAN CLIENT AUTHENTICATION & SESSION ENGINE • LILONGWE, MALAWI
// ============================================================================
// Features:
//   - Token Storage: Rotating Refresh Tokens (30d) & Short-Lived Access Tokens (15m)
//   - Proactive Token Refresh: Automatically rotates tokens before expiration (at 12m)
//   - Reactive Token Interceptor: Refreshes token on 401 and retries API request
//   - Socket.IO Handshake JWT Integration & Auto-Reconnect with Fresh Tokens
//   - Mobile-First, Bilingual (EN / NY) Login Screen Overlay
//   - Admin Dual-Factor Login (Phone + Password + OTP)
//   - Driver Approval Status Enforcement (PENDING Banner)
// ============================================================================

(function (window) {
  'use strict';

  // ==========================================================================
  // FORGOT PASSWORD (admin accounts). Step 1: email. Step 2: the emailed code and a new password.
  // Riders and drivers have no password (they sign in with an emailed code), so this is only for admins.
  // ==========================================================================
  function openAdminForgotPassword(prefillEmail) {
    const old = document.getElementById('aarohan-forgot-modal'); if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'aarohan-forgot-modal';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(20,24,30,.6);display:flex;align-items:center;justify-content:center;padding:18px;font-family:inherit';
    const input = 'width:100%;height:46px;padding:0 14px;border:1px solid #CBD0D6;border-radius:14px;font-size:15px;background:#fff;color:#1E2228;box-sizing:border-box';
    const label = 'display:block;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#5E6672;margin:14px 0 6px';
    const btn = 'width:100%;height:46px;border:0;border-radius:14px;background:#2F343C;color:#fff;font-weight:800;font-size:15px;cursor:pointer;margin-top:18px';
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let email = (prefillEmail || '').trim().toLowerCase(), cooldown = 0, timer = null;
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    function close() { clearInterval(timer); box.remove(); }
    function say(msg, ok) { const m = box.querySelector('#fp-msg'); if (!m) return; m.style.color = ok ? '#2F5D3A' : '#8A2B2B'; m.textContent = msg || ''; }
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let d = {}; try { d = await r.json(); } catch (_) {}
      if (!r.ok) throw new Error(d.error || (d.errors && d.errors[0] && d.errors[0].message) || 'Something went wrong. Please try again.');
      return d;
    };
    function step1() {
      box.innerHTML = '<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.35)"><h2 style="margin:0;font-size:22px;font-weight:800;color:#1E2228">Forgot your password?</h2><p style="margin:8px 0 0;color:#5E6672;font-size:14px;line-height:1.5">Enter your admin email. We will send you a code to set a new password. This is only for admin accounts.</p>' +
        '<label style="' + label + '">Admin email</label><input id="fp-email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" style="' + input + '" value="' + esc(email) + '" placeholder="you@example.com"/>' +
        '<div id="fp-msg" style="margin-top:12px;font-size:13px;font-weight:600"></div><button id="fp-send" style="' + btn + '">Send reset code</button><button id="fp-cancel" type="button" style="width:100%;height:42px;border:0;background:transparent;color:#5E6672;font-weight:700;cursor:pointer;margin-top:6px">Back to sign in</button></div>';
      const em = box.querySelector('#fp-email'), send = box.querySelector('#fp-send');
      box.querySelector('#fp-cancel').onclick = close;
      em.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
      send.onclick = async () => {
        email = em.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return say('Enter a valid email address.', false);
        send.disabled = true; send.style.opacity = '.6'; say('');
        try { await post('/api/auth/admin/forgot-password', { email }); step2(true); }
        catch (e) { say(e.message, false); send.disabled = false; send.style.opacity = '1'; }
      };
      setTimeout(() => em.focus(), 100);
    }
    function step2(fresh) {
      cooldown = 60;
      box.innerHTML = '<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.35);max-height:92vh;overflow:auto"><h2 style="margin:0;font-size:22px;font-weight:800;color:#1E2228">Set a new password</h2><p style="margin:8px 0 0;color:#5E6672;font-size:14px;line-height:1.5">If <b>' + esc(email) + '</b> is an admin account, a 6-digit code is on its way (check spam). It is valid for 10 minutes.</p>' +
        '<label style="' + label + '">6-digit code</label><input id="fp-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="' + input + ';letter-spacing:6px;font-size:20px;text-align:center" placeholder="000000"/>' +
        '<label style="' + label + '">New password</label><div style="position:relative"><input id="fp-pw" type="password" autocomplete="new-password" style="' + input + ';padding-right:64px" placeholder="At least 10 characters"/><button type="button" id="fp-eye" style="position:absolute;right:8px;top:8px;height:30px;padding:0 10px;border:0;background:#F1F3F5;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;color:#2F343C">Show</button></div>' +
        '<label style="' + label + '">Type it again</label><input id="fp-pw2" type="password" autocomplete="new-password" style="' + input + '" placeholder="Repeat the new password"/>' +
        '<ul id="fp-rules" style="list-style:none;padding:0;margin:12px 0 0;font-size:12.5px;color:#5E6672;line-height:1.7"></ul><div id="fp-msg" style="margin-top:10px;font-size:13px;font-weight:600"></div>' +
        '<button id="fp-save" style="' + btn + '">Change password</button><button id="fp-resend" type="button" style="width:100%;height:42px;border:0;background:transparent;color:#5E6672;font-weight:700;cursor:pointer;margin-top:6px"></button></div>';
      const code = box.querySelector('#fp-code'), pw = box.querySelector('#fp-pw'), pw2 = box.querySelector('#fp-pw2'), save = box.querySelector('#fp-save'), resend = box.querySelector('#fp-resend'), rules = box.querySelector('#fp-rules');
      box.querySelector('#fp-eye').onclick = function () { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; pw2.type = pw.type; this.textContent = show ? 'Hide' : 'Show'; };
      const checks = () => {
        const v = pw.value, local = email.split('@')[0];
        return [['At least 10 characters', v.length >= 10], ['Letters and at least one number', /[a-z]/i.test(v) && /[0-9]/.test(v)], ['Does not contain your email name', !(local.length >= 4 && v.toLowerCase().includes(local))], ['Both boxes match', v.length > 0 && v === pw2.value]];
      };
      const paint = () => { rules.innerHTML = checks().map((c) => '<li style="color:' + (c[1] ? '#2F5D3A' : '#5E6672') + '">' + (c[1] ? '&#10003; ' : '&#9675; ') + c[0] + '</li>').join(''); };
      pw.addEventListener('input', paint); pw2.addEventListener('input', paint); paint();
      clearInterval(timer);
      const tick = () => { resend.disabled = cooldown > 0; resend.style.opacity = cooldown > 0 ? '.6' : '1'; resend.textContent = cooldown > 0 ? 'Send a new code in ' + cooldown + 's' : 'Send a new code'; if (cooldown > 0) cooldown--; };
      tick(); timer = setInterval(tick, 1000);
      resend.onclick = async () => { if (cooldown > 0) return; try { await post('/api/auth/admin/forgot-password', { email }); cooldown = 60; say('A new code was requested.', true); } catch (e) { say(e.message, false); } };
      save.onclick = async () => {
        if (!/^\d{6}$/.test(code.value.trim())) return say('Enter the 6-digit code from the email.', false);
        if (!checks().every((c) => c[1])) return say('Please meet all the password rules below.', false);
        save.disabled = true; save.style.opacity = '.6'; say('');
        try {
          await post('/api/auth/admin/reset-password', { email, otp: code.value.trim(), newPassword: pw.value });
          box.innerHTML = '<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:28px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.35)"><div style="width:64px;height:64px;border-radius:50%;background:#E4EFE7;color:#2F5D3A;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 14px">&#10003;</div><h2 style="margin:0;font-size:22px;font-weight:800;color:#1E2228">Password changed</h2><p style="color:#5E6672;font-size:14px;line-height:1.5">You were signed out everywhere for safety. Sign in with your new password.</p><button id="fp-done" style="' + btn + '">Back to sign in</button></div>';
          box.querySelector('#fp-done').onclick = () => { close(); const f = document.getElementById('auth-email-input'); if (f) { f.value = email; } };
        } catch (e) { say(e.message, false); save.disabled = false; save.style.opacity = '1'; }
      };
      setTimeout(() => code.focus(), 100);
    }
    document.body.appendChild(box);
    step1();
  }

  const ACCESS_TOKEN_KEY = 'aarohan_access_token';
  const REFRESH_TOKEN_KEY = 'aarohan_refresh_token';
  const USER_KEY = 'aarohan_user';
  // Must match the version shown on /legal/terms and /legal/privacy.
  const LEGAL_VERSION = 'v0.1';
  const CONSENT_RETRY_PREFIX = 'aarohan_consent_retry:';

  class AArohanAuth {
    constructor() {
      this.refreshTimer = null;
      this.activeSocket = null;
      this.onAuthChangeCallbacks = [];
      this.isReady = false;
      this.readyPromise = null;
      this.readyResolve = null;
      this.refreshPromise = null;
      this.initAutoRefresh();
    }

    whenReady() {
      if (this.isReady) return Promise.resolve(this.getUser());
      if (!this.readyPromise) {
        this.readyPromise = new Promise((resolve) => {
          this.readyResolve = resolve;
        });
      }
      return this.readyPromise;
    }

    setReady(user = null) {
      this.isReady = true;
      if (this.readyResolve) {
        const resolve = this.readyResolve;
        this.readyResolve = null;
        resolve(user || this.getUser());
      }
    }

    getAccessToken() {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    }

    getRefreshToken() {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    }

    getUser() {
      try {
        const u = localStorage.getItem(USER_KEY);
        return u ? JSON.parse(u) : null;
      } catch (e) {
        return null;
      }
    }

    isAuthenticated() {
      return !!this.getAccessToken() && !!this.getUser();
    }

    setSession(accessToken, refreshToken, user) {
      if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      this.initAutoRefresh();
      this.notifyAuthChange(user);
    }

    clearSession() {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      this.notifyAuthChange(null);
    }

    onAuthChange(cb) {
      this.onAuthChangeCallbacks.push(cb);
    }

    notifyAuthChange(user) {
      this.onAuthChangeCallbacks.forEach(cb => {
        try { cb(user); } catch (e) { console.warn('[Auth] Callback error:', e); }
      });
    }

    // Schedule automatic refresh ~3 minutes before 15m expiration (at 12 minutes)
    initAutoRefresh() {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      const token = this.getAccessToken();
      if (!token) return;

      try {
        // Parse JWT payload safely in browser
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expMs = payload.exp * 1000;
        const now = Date.now();
        const refreshTimeMs = Math.max(10000, expMs - now - 3 * 60 * 1000); // 3 mins before expiry

        this.refreshTimer = setTimeout(async () => {
          console.log('[Auth] Proactively rotating access token before expiry...');
          await this.refreshToken();
        }, refreshTimeMs);
      } catch (e) {
        // Fallback default 12-minute timer if decode fails
        this.refreshTimer = setTimeout(() => this.refreshToken(), 12 * 60 * 1000);
      }
    }

    // Rotating Refresh Token Exchange (deduplicated in-flight)
    async refreshToken() {
      if (this.refreshPromise) {
        return this.refreshPromise;
      }

      this.refreshPromise = (async () => {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) {
          this.clearSession();
          return null;
        }

        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.warn('[Auth] Token refresh failed:', errData.error || res.statusText);
            this.clearSession();
            return null;
          }

          const data = await res.json();
          this.setSession(data.accessToken, data.refreshToken, data.user || this.getUser());

          // Update active Socket.IO connection with the fresh token
          if (this.activeSocket) {
            this.activeSocket.auth = { token: data.accessToken };
          }

          return data.accessToken;
        } catch (err) {
          console.error('[Auth] Refresh network error:', err);
          return null;
        }
      })().finally(() => {
        this.refreshPromise = null;
      });

      return this.refreshPromise;
    }

    // Authenticated API request wrapper (never fires before auth is ready; retries once on 401)
    async fetchWithAuth(url, options = {}) {
      if (!this.isReady && !url.includes('/api/auth/')) {
        await this.whenReady();
      }

      let token = this.getAccessToken();
      if (!token) {
        // Unauthenticated - do not fire protected request
        return null;
      }

      const headers = Object.assign({}, options.headers || {}, {
        'Authorization': `Bearer ${token}`
      });

      let res = await fetch(url, Object.assign({}, options, { headers }));

      // If token expired (401), attempt immediate refresh and retry request once
      if (res.status === 401) {
        console.log(`[Auth] 401 Unauthorized for ${url}. Attempting token refresh and retry...`);
        const newToken = await this.refreshToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          res = await fetch(url, Object.assign({}, options, { headers }));
        }
      }

      return res;
    }

    // Connect Socket.IO client with authoritative JWT token
    connectSocket(ioConstructor, url = window.location.origin) {
      const token = this.getAccessToken();
      const socket = ioConstructor(url, {
        transports: ['websocket'],
        auth: { token }
      });

      this.activeSocket = socket;

      socket.on('connect_error', async (err) => {
        console.warn('[Socket.IO] Handshake error:', err.message);
        if (err.message && (err.message.includes('Authentication') || err.message.includes('expired') || err.message.includes('token'))) {
          const freshToken = await this.refreshToken();
          if (freshToken) {
            socket.auth = { token: freshToken };
            socket.connect();
          }
        }
      });

      return socket;
    }

    async logout() {
      const refreshToken = this.getRefreshToken();
      try {
        if (refreshToken) {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
          });
        }
      } catch (e) {}

      if (this.activeSocket) {
        try { this.activeSocket.disconnect(); } catch (e) {}
        this.activeSocket = null;
      }

      this.clearSession();
      window.location.reload();
    }

    // -------------------------------------------------------------------------
    // BILINGUAL MOBILE-FIRST LOGIN MODAL (EN / NY)
    // -------------------------------------------------------------------------
    showLoginModal({ role = 'RIDER', onLoginSuccess } = {}) {
      const emailMode = this._authMode === 'email';
      // Remove any existing modal
      const existing = document.getElementById('aarohan-auth-modal');
      if (existing) existing.remove();

      const i18n = window.aarohanI18n || {
        t: (k, params) => {
          const defaults = {
            loginTitle: role === 'ADMIN' ? 'Desk Operations Access' : (role === 'DRIVER' ? 'Captain Partner Sign In' : 'Sign In to Aarohan'),
            loginSub: role === 'ADMIN' ? 'Lilongwe Central Command Portal' : 'Fast, reliable urban mobility in Lilongwe',
            brandTagline: 'Rise • Build • Grow',
            phoneLabel: 'Malawian Mobile Number',
            requestOtpBtn: 'Send Verification Code (SMS)',
            otpTitle: 'Enter Verification Code',
            otpSub: 'Enter the 6-digit code sent to your phone',
            otpLabel: '6-Digit SMS Code',
            verifyOtpBtn: 'Verify & Continue',
            changePhoneBtn: 'Change Phone',
            adminPasswordLabel: 'Admin Password',
            adminLoginBtn: 'Verify & Sign In'
          };
          return defaults[k] || k;
        },
        getLang: () => 'en',
        toggleLang: () => 'ny'
      };

      const modalEl = document.createElement('div');
      modalEl.id = 'aarohan-auth-modal';
      modalEl.className = 'fixed inset-0 z-[99999] bg-[#0B0B0B]/95 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6';

      modalEl.innerHTML = `
        <div class="w-full max-w-sm bg-[#171717] border border-[#292929] rounded-3xl p-6 sm:p-7 shadow-2xl relative text-white animate-in fade-in zoom-in-95 duration-200">
          
          <!-- Top Right Language Switcher -->
          <div class="absolute top-5 right-5">
            <button id="auth-lang-btn" type="button" class="px-2.5 py-1 rounded-full bg-[#202020] border border-[#292929] text-[11px] font-extrabold text-[#A3A3A3] hover:text-white transition-all flex items-center gap-1 active:scale-95">
              <span id="auth-lang-label">NY</span>
            </button>
          </div>

          <!-- Centred Logo & Bilingual Tagline -->
          <div class="flex flex-col items-center justify-center text-center mb-6 pt-2">
            <img src="/assets/brand/logo-full-color.svg" alt="Aarohan" class="h-10 w-auto mb-2" />
            <p id="auth-tagline" class="text-xs font-semibold text-[#FFA247] tracking-wider uppercase">
              ${i18n.t('brandTagline') || 'Rise • Build • Grow'}
            </p>
            <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-[#202020] border border-[#292929] text-[10px] font-bold text-[#A3A3A3] uppercase tracking-wider">${role}</span>
          </div>

          <!-- Titles -->
          <div class="mb-5 text-center">
            <h2 id="auth-title" class="text-lg font-black text-white tracking-tight mb-1">
              ${i18n.t('loginTitle')}
            </h2>
            <p id="auth-sub" class="text-xs text-[#A3A3A3] font-medium leading-relaxed">
              ${i18n.t('loginSub')}
            </p>
          </div>

          <!-- Alert Container -->
          <div id="auth-alert" class="hidden mb-4 p-3 rounded-2xl text-xs font-semibold leading-snug"></div>

          <!-- STEP 1: Phone Input -->
          <form id="auth-step-phone" class="space-y-4">
            ${emailMode ? `
            <div>
              <label id="label-phone" class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1.5">
                ${i18n.t('emailLabel')}
              </label>
              <input
                type="email"
                id="auth-email-input"
                class="w-full h-12 px-4 bg-surface-container rounded-2xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm font-bold text-on-surface outline-none transition-all placeholder:text-outline/60"
                placeholder="you@example.com"
                autocomplete="${role === 'ADMIN' ? 'username' : 'email'}" name="${role === 'ADMIN' ? 'username' : 'email'}"
                autocapitalize="none"
                spellcheck="false"
                required
              />
            </div>
            ` : `
            <div>
              <label id="label-phone" class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1.5">
                ${i18n.t('phoneLabel')}
              </label>
              <div class="relative">
                <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-primary">+265</span>
                <input 
                  type="tel" 
                  id="auth-phone-input" 
                  class="w-full h-12 pl-20 pr-4 bg-surface-container rounded-2xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm font-bold text-on-surface outline-none transition-all placeholder:text-outline/60" 
                  placeholder="99 123 4567" 
                  autocomplete="tel" 
                  required
                />
              </div>
              <p class="text-[10px] text-on-surface-variant/80 mt-1.5 pl-1">Airtel (99, 98, 90) • TNM (88, 89, 31)</p>
            </div>
            `}

            ${role === 'ADMIN' ? `
            <div>
              <label id="label-admin-pass" class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1.5">
                ${i18n.t('adminPasswordLabel')}
              </label>
              <input 
                type="password" 
                id="auth-admin-password" 
                name="password" autocomplete="current-password" 
                class="w-full h-12 px-4 bg-surface-container rounded-2xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm font-bold text-on-surface outline-none transition-all" 
                placeholder="••••••••••••" 
                required
              />
            ${emailMode ? '<div class="mt-2 text-right"><button type="button" id="auth-forgot-btn" class="text-[12px] font-extrabold text-primary hover:underline">Forgot password?</button></div>' : ''}
            </div>
            ` : ''}

            ${role !== 'ADMIN' ? `
            <label class="flex items-start gap-3 text-xs text-on-surface-variant cursor-pointer select-none">
              <input type="checkbox" id="auth-consent" class="mt-0.5 w-5 h-5 shrink-0 accent-[#FF6A00]" />
              <span id="auth-consent-text">${i18n.t('consentLead')} <a href="/legal/terms" target="_blank" rel="noopener" class="text-primary font-bold underline">${i18n.t('consentTerms')}</a> ${i18n.t('consentAnd')} <a href="/legal/privacy" target="_blank" rel="noopener" class="text-primary font-bold underline">${i18n.t('consentPrivacy')}</a>.</span>
            </label>
            ` : ''}

            <button 
              type="submit" 
              id="auth-phone-submit" 
              class="w-full h-12 bg-[#FF6A00] hover:bg-[#FFA247] text-[#0B0B0B] font-black text-sm rounded-2xl shadow-lg shadow-[#FF6A00]/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span id="auth-btn-phone-text">${i18n.t('requestOtpBtn')}</span>
              <span class="material-symbols-outlined text-lg">arrow_forward</span>
            </button>
          </form>

          <!-- STEP 2: OTP Verification -->
          <form id="auth-step-otp" class="hidden space-y-4">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label id="label-otp" class="text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant">
                  ${emailMode ? i18n.t('otpLabelEmail') : i18n.t('otpLabel')}
                </label>
                <button type="button" id="auth-change-phone-btn" class="text-[11px] font-extrabold text-primary hover:underline">
                  ${i18n.t('changePhoneBtn')}
                </button>
              </div>

              <input 
                type="text" 
                id="auth-otp-input" 
                inputmode="numeric" 
                pattern="[0-9]*" 
                maxlength="6" 
                class="w-full h-14 text-center tracking-[0.4em] text-2xl font-black bg-surface-container rounded-2xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface outline-none transition-all" 
                placeholder="000000" 
                autocomplete="one-time-code" 
                required
              />
              <p id="otp-timer-sub" class="text-[11px] text-center text-on-surface-variant mt-2 font-medium">Valid for 5 minutes</p>
            </div>

            ${emailMode && role !== 'ADMIN' ? `
            <div id="auth-profile-fields" class="hidden space-y-3">
              <p class="text-[11px] text-on-surface-variant font-medium">${i18n.t('profileRequiredMsg')}</p>
              <div>
                <label class="block text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">${i18n.t('profileNameLabel')}</label>
                <input type="text" id="auth-profile-name" maxlength="60" autocomplete="name" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-sm font-bold text-on-surface outline-none" />
              </div>
              <div>
                <label class="block text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">${i18n.t('profilePhoneLabel')}</label>
                <input type="tel" id="auth-profile-phone" autocomplete="tel" placeholder="99 123 4567" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-sm font-bold text-on-surface outline-none" />
              </div>
            </div>
            ` : ''}

            <button 
              type="submit" 
              id="auth-otp-submit" 
              class="w-full h-12 bg-[#FF6A00] hover:bg-[#FFA247] text-[#0B0B0B] font-black text-sm rounded-2xl shadow-lg shadow-[#FF6A00]/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span id="auth-btn-otp-text">${role === 'ADMIN' ? i18n.t('adminLoginBtn') : i18n.t('verifyOtpBtn')}</span>
              <span class="material-symbols-outlined text-lg">check_circle</span>
            </button>
          </form>

          <!-- STEP 2b: Driver Onboarding Sign-Up & Document Upload -->
          <form id="auth-step-onboard" class="hidden space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div class="border-b border-outline-variant/30 pb-2">
              <span class="text-xs font-black uppercase text-primary tracking-wider">Step 1: Driver & Vehicle Details</span>
            </div>

            <div>
              <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Full Name *</label>
              <input type="text" id="onboard-name" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none" placeholder="e.g. Kondwani Banda" required />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Vehicle Type *</label>
                <select id="onboard-vehicle-type" class="w-full h-11 px-2.5 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none">
                  <option value="MOTO">MOTO (Motorcycle)</option>
                  <option value="AUTO">AUTO (Tuk-Tuk)</option>
                  <option value="CAB" selected>CAB (Sedan/Car)</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Make / Model *</label>
                <input type="text" id="onboard-make-model" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none" placeholder="Toyota Passo" required />
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Colour *</label>
                <input type="text" id="onboard-color" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none" placeholder="White" required />
              </div>
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Plate No. *</label>
                <input type="text" id="onboard-plate" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none uppercase" placeholder="BW 4920" required />
              </div>
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Year *</label>
                <input type="number" id="onboard-year" min="1990" max="2027" class="w-full h-11 px-2 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none" placeholder="2018" required />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Emergency Contact *</label>
                <input type="text" id="onboard-emergency-name" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none" placeholder="Next of Kin Name" required />
              </div>
              <div>
                <label class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1">Emergency Phone *</label>
                <input type="tel" id="onboard-emergency-phone" class="w-full h-11 px-3 bg-surface-container rounded-xl border border-outline-variant/40 focus:border-primary text-xs font-bold text-on-surface outline-none" placeholder="+265 99 111 2233" required />
              </div>
            </div>

            <div class="border-b border-outline-variant/30 pt-2 pb-1">
              <span class="text-xs font-black uppercase text-primary tracking-wider">Step 2: Upload Documents (Max 5MB each)</span>
              <p class="text-[10px] text-on-surface-variant">Formats: JPEG, PNG, PDF</p>
            </div>

            <div>
              <label class="block text-[10px] font-extrabold uppercase text-on-surface-variant mb-0.5">1. Driving Licence *</label>
              <input type="file" id="onboard-doc-license" accept="image/jpeg,image/png,image/jpg,application/pdf" class="w-full text-xs text-on-surface file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-surface-container-high file:text-on-surface" required />
            </div>

            <div>
              <label class="block text-[10px] font-extrabold uppercase text-on-surface-variant mb-0.5">2. National ID *</label>
              <input type="file" id="onboard-doc-id" accept="image/jpeg,image/png,image/jpg,application/pdf" class="w-full text-xs text-on-surface file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-surface-container-high file:text-on-surface" required />
            </div>

            <div>
              <label class="block text-[10px] font-extrabold uppercase text-on-surface-variant mb-0.5">3. Vehicle Registration (Blue Book) *</label>
              <input type="file" id="onboard-doc-veh" accept="image/jpeg,image/png,image/jpg,application/pdf" class="w-full text-xs text-on-surface file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-surface-container-high file:text-on-surface" required />
            </div>

            <div>
              <label class="block text-[10px] font-extrabold uppercase text-on-surface-variant mb-0.5">4. Driver Photo *</label>
              <input type="file" id="onboard-doc-photo" accept="image/jpeg,image/png,image/jpg" class="w-full text-xs text-on-surface file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-surface-container-high file:text-on-surface" required />
            </div>

            <label class="flex items-start gap-3 text-[11px] text-on-surface-variant cursor-pointer select-none pt-1">
              <input type="checkbox" id="onboard-agreement" class="mt-0.5 w-5 h-5 shrink-0 accent-[#FF6A00]" />
              <span id="onboard-agreement-text">${i18n.t('driverAgreementText')} (<a href="/legal/terms" target="_blank" rel="noopener" class="text-primary font-bold underline">${i18n.t('consentTerms')}</a>)</span>
            </label>

            <button type="submit" id="onboard-submit-btn" class="w-full h-12 mt-2 bg-[#FF6A00] hover:bg-[#FFA247] text-[#0B0B0B] font-black text-xs rounded-2xl shadow-lg shadow-[#FF6A00]/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <span id="onboard-submit-btn-text">Submit Application & Upload Documents</span>
              <span class="material-symbols-outlined text-base">cloud_upload</span>
            </button>
          </form>

          <!-- STEP 3: Driver PENDING Status Banner -->
          <div id="auth-step-pending" class="hidden text-center py-4 space-y-3">
            <div class="w-14 h-14 mx-auto rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center text-2xl">
              <span class="material-symbols-outlined text-3xl">pending_actions</span>
            </div>
            <h3 class="text-base font-black text-on-surface" id="pending-title">Application Pending Approval</h3>
            <p class="text-xs text-on-surface-variant font-medium leading-relaxed px-2" id="pending-desc">
              Your driver application and verification documents have been securely uploaded to Lilongwe Central Operations for compliance review. You cannot go online until approved.
            </p>
            <div class="pt-2 flex items-center justify-center gap-2">
              <button type="button" id="auth-check-status-btn" class="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-black shadow-md hover:bg-primary/90 transition-colors flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm">refresh</span>
                <span>Check Status</span>
              </button>
              <button type="button" onclick="window.aarohanAuth.logout()" class="px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/40 text-xs font-extrabold text-on-surface hover:bg-surface-container-high transition-colors">
                Sign Out
              </button>
            </div>
          </div>

          <!-- Mobile-first Footer Notice -->
          <p class="text-[10px] text-center text-outline mt-5 font-semibold">
            Safe, simple rides in Lilongwe
          </p>

        </div>
      `;

      document.body.appendChild(modalEl);

      // Elements
      const alertBox = document.getElementById('auth-alert');
      const stepPhone = document.getElementById('auth-step-phone');
      const stepOtp = document.getElementById('auth-step-otp');
      const stepOnboard = document.getElementById('auth-step-onboard');
      const stepPending = document.getElementById('auth-step-pending');
      const phoneInput = document.getElementById(emailMode ? 'auth-email-input' : 'auth-phone-input');
      const otpInput = document.getElementById('auth-otp-input');
      const adminPassInput = document.getElementById('auth-admin-password');
      const forgotBtn = document.getElementById('auth-forgot-btn');
      if (forgotBtn) forgotBtn.addEventListener('click', () => openAdminForgotPassword(phoneInput ? phoneInput.value : ''));
      const changePhoneBtn = document.getElementById('auth-change-phone-btn');
      const langBtn = document.getElementById('auth-lang-btn');
      const langLabel = document.getElementById('auth-lang-label');
      const checkStatusBtn = document.getElementById('auth-check-status-btn');

      let currentPhoneE164 = '';
      let consentGiven = false; // set only when the person ticked the box on this login

      function showAlert(msg, isError = true) {
        alertBox.className = isError
          ? 'mb-4 p-3 rounded-2xl text-xs font-semibold bg-error-container/80 text-on-error-container border border-error/20'
          : 'mb-4 p-3 rounded-2xl text-xs font-semibold bg-primary/10 text-primary border border-primary/20';
        alertBox.innerText = msg;
        alertBox.classList.remove('hidden');
      }

      function hideAlert() {
        alertBox.classList.add('hidden');
      }

      if (checkStatusBtn) {
        checkStatusBtn.addEventListener('click', async () => {
          checkStatusBtn.disabled = true;
          checkStatusBtn.classList.add('opacity-70');
          try {
            const res = await this.fetchWithAuth('/api/auth/me');
            if (res && res.ok) {
              const data = await res.json();
              const u = data.user;
              if (u && u.driverProfile) {
                this.setSession(this.getAccessToken(), this.getRefreshToken(), u);
                if (u.driverProfile.approvalStatus === 'APPROVED') {
                  showAlert('Your account has been APPROVED! Reloading...', false);
                  setTimeout(() => {
                    modalEl.remove();
                    location.reload();
                  }, 800);
                  return;
                } else if (u.driverProfile.approvalStatus === 'REJECTED') {
                  document.getElementById('pending-title').innerText = 'Application Rejected';
                  document.getElementById('pending-desc').innerText = `Rejection reason: ${u.driverProfile.rejectionReason || 'Documents did not meet compliance requirements'}`;
                  showAlert('Application rejected by admin.', true);
                } else {
                  showAlert('Application is still under review. Please check back shortly.', false);
                }
              }
            }
          } catch (e) {
            showAlert('Error checking status: ' + e.message);
          } finally {
            checkStatusBtn.disabled = false;
            checkStatusBtn.classList.remove('opacity-70');
          }
        });
      }

      // Language Switcher within Modal
      langBtn.addEventListener('click', () => {
        if (window.aarohanI18n) {
          const next = window.aarohanI18n.toggleLang();
          langLabel.innerText = next === 'en' ? 'NY' : 'EN';
          document.getElementById('auth-title').innerText = i18n.t('loginTitle');
          document.getElementById('auth-sub').innerText = i18n.t('loginSub');
          const taglineEl = document.getElementById('auth-tagline');
          if (taglineEl) taglineEl.innerText = i18n.t('brandTagline') || (next === 'ny' ? 'Uka • Manga • Kula' : 'Rise • Build • Grow'); // NEEDS NATIVE REVIEW (EN: "Rise • Build • Grow")
          document.getElementById('label-phone').innerText = i18n.t(emailMode ? 'emailLabel' : 'phoneLabel');
          document.getElementById('auth-btn-phone-text').innerText = i18n.t('requestOtpBtn');
          document.getElementById('label-otp').innerText = emailMode ? i18n.t('otpLabelEmail') : i18n.t('otpLabel');
          document.getElementById('auth-btn-otp-text').innerText = role === 'ADMIN' ? i18n.t('adminLoginBtn') : i18n.t('verifyOtpBtn');
          document.getElementById('auth-change-phone-btn').innerText = i18n.t('changePhoneBtn');
          const consentText = document.getElementById('auth-consent-text');
          if (consentText) {
            consentText.innerHTML = `${i18n.t('consentLead')} <a href="/legal/terms" target="_blank" rel="noopener" class="text-primary font-bold underline">${i18n.t('consentTerms')}</a> ${i18n.t('consentAnd')} <a href="/legal/privacy" target="_blank" rel="noopener" class="text-primary font-bold underline">${i18n.t('consentPrivacy')}</a>.`;
          }
          const agreementText = document.getElementById('onboard-agreement-text');
          if (agreementText) {
            agreementText.innerHTML = `${i18n.t('driverAgreementText')} (<a href="/legal/terms" target="_blank" rel="noopener" class="text-primary font-bold underline">${i18n.t('consentTerms')}</a>)`;
          }
        }
      });

      // Submit Phone -> Request OTP
      stepPhone.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        let rawPhone = phoneInput.value.replace(/[\s\-]/g, '');
        if (rawPhone.startsWith('0')) {
          rawPhone = '+265' + rawPhone.slice(1);
        } else if (!rawPhone.startsWith('+265')) {
          rawPhone = '+265' + rawPhone;
        }

        // Explicit consent: riders and drivers must tick the box before a code is sent.
        if (role !== 'ADMIN') {
          const consentBox = document.getElementById('auth-consent');
          if (consentBox && !consentBox.checked) {
            showAlert(i18n.t('consentRequired'));
            consentBox.focus();
            return;
          }
          consentGiven = true;
        }

        if (emailMode) {
          // Email is the identity: the code is sent to this address.
          const em = phoneInput.value.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em) || em.length > 254) {
            showAlert(i18n.t('emailInvalid'));
            return;
          }
          currentPhoneE164 = em;
        } else {
          currentPhoneE164 = rawPhone;
        }

        const submitBtn = document.getElementById('auth-phone-submit');
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70');

        try {
          const res = await fetch(emailMode ? '/api/auth/email/otp/request' : '/api/auth/otp/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(emailMode ? { email: currentPhoneE164 } : { phone: currentPhoneE164 })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to request code');

          stepPhone.classList.add('hidden');
          stepOtp.classList.remove('hidden');
          document.getElementById('auth-title').innerText = i18n.t('otpTitle');
          document.getElementById('auth-sub').innerText = i18n.t('otpSub', { phone: currentPhoneE164 });
          otpInput.focus();
          showAlert(emailMode
            ? `Verification code sent to ${currentPhoneE164}. Check your inbox (and spam folder).`
            : `Verification code sent via SMS to ${currentPhoneE164}`, false);
        } catch (err) {
          const isSmsFailure = err.message && (err.message.includes('SMS delivery failed') || err.message.includes('telecom') || err.message.includes('network'));
          const errorMsg = isSmsFailure ? i18n.t('smsDeliveryFailedMsg') : err.message;
          showAlert(errorMsg);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-70');
        }
      });

      // Change Phone Button
      changePhoneBtn.addEventListener('click', () => {
        hideAlert();
        stepOtp.classList.add('hidden');
        stepPhone.classList.remove('hidden');
        document.getElementById('auth-title').innerText = i18n.t('loginTitle');
        document.getElementById('auth-sub').innerText = i18n.t('loginSub');
        phoneInput.focus();
      });

      // Submit OTP -> Verify & Store JWT
      stepOtp.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const otp = otpInput.value.trim();
        if (otp.length !== 6) {
          showAlert('Please enter the full 6-digit code');
          return;
        }

        const submitBtn = document.getElementById('auth-otp-submit');
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70');

        try {
          let res;
          if (role === 'ADMIN') {
            const password = adminPassInput ? adminPassInput.value : '';
            res = await fetch(emailMode ? '/api/auth/admin/email-login' : '/api/auth/admin/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(emailMode ? { email: currentPhoneE164, password, otp } : { phone: currentPhoneE164, password, otp })
            });
          } else if (emailMode) {
            const payload = { email: currentPhoneE164, otp };
            const profileBox = document.getElementById('auth-profile-fields');
            if (profileBox && !profileBox.classList.contains('hidden')) {
              payload.name = (document.getElementById('auth-profile-name').value || '').trim();
              payload.phone = (document.getElementById('auth-profile-phone').value || '').trim();
            }
            res = await fetch('/api/auth/email/otp/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          } else {
            res = await fetch('/api/auth/otp/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: currentPhoneE164, otp })
            });
          }

          const data = await res.json();
          if (res.status === 409 && data.code === 'PROFILE_REQUIRED') {
            // First time with this email: ask for name + mobile number, then resubmit the SAME code.
            const profileBox = document.getElementById('auth-profile-fields');
            if (profileBox) {
              profileBox.classList.remove('hidden');
              showAlert(data.error, false);
              const nameEl = document.getElementById('auth-profile-name');
              if (nameEl) nameEl.focus();
              return;
            }
          }
          if (!res.ok) throw new Error(data.error || 'Verification failed');

          this.setSession(data.accessToken, data.refreshToken, data.user);

          // Fetch authoritative profile & wallet from /api/auth/me
          let fullUser = data.user;
          try {
            const meRes = await this.fetchWithAuth('/api/auth/me');
            if (meRes && meRes.ok) {
              const meData = await meRes.json();
              if (meData.user) {
                fullUser = Object.assign({}, fullUser, meData.user);
                this.setSession(data.accessToken, data.refreshToken, fullUser);
              }
            }
          } catch (e) {
            console.warn('[Auth] Post-login profile fetch error:', e);
          }

          // Record the explicit consent given on this login (retried on the next load if it fails).
          if (role !== 'ADMIN' && consentGiven) {
            this.recordConsent('TERMS_AND_PRIVACY');
          }

          // For driver portal: verify driverProfile & approvalStatus
          if (role === 'DRIVER') {
            if (!fullUser.driverProfile) {
              stepOtp.classList.add('hidden');
              stepOnboard.classList.remove('hidden');
              document.getElementById('auth-title').innerText = 'Driver Onboarding';
              document.getElementById('auth-sub').innerText = 'Complete vehicle registration and upload your compliance documents';
              const card = modalEl.querySelector('#aarohan-auth-modal > div');
              if (card) { card.classList.remove('max-w-sm'); card.classList.add('max-w-md'); }
              return;
            } else if (fullUser.driverProfile.approvalStatus !== 'APPROVED') {
              stepOtp.classList.add('hidden');
              stepPending.classList.remove('hidden');
              document.getElementById('auth-title').innerText = 'Application Pending Approval';
              document.getElementById('auth-sub').innerText = '';
              return;
            }
          }

          modalEl.remove();
          this.setReady(fullUser);
          if (typeof onLoginSuccess === 'function') {
            onLoginSuccess(fullUser);
          }
        } catch (err) {
          const isSmsFailure = err.message && (err.message.includes('SMS delivery failed') || err.message.includes('telecom') || err.message.includes('network'));
          const errorMsg = isSmsFailure ? i18n.t('smsDeliveryFailedMsg') : err.message;
          showAlert(errorMsg);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-70');
        }
      });

      // Submit Onboarding Form (Register driver + Upload 4 documents)
      stepOnboard.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const name = document.getElementById('onboard-name').value.trim();
        const vehicleType = document.getElementById('onboard-vehicle-type').value;
        const makeModel = document.getElementById('onboard-make-model').value.trim();
        const color = document.getElementById('onboard-color').value.trim();
        const plateNumber = document.getElementById('onboard-plate').value.trim().toUpperCase();
        const year = parseInt(document.getElementById('onboard-year').value.trim(), 10);
        const emergencyContactName = document.getElementById('onboard-emergency-name').value.trim();
        const emergencyContactPhone = document.getElementById('onboard-emergency-phone').value.trim();

        const licenseFile = document.getElementById('onboard-doc-license').files[0];
        const idFile = document.getElementById('onboard-doc-id').files[0];
        const regFile = document.getElementById('onboard-doc-veh').files[0];
        const photoFile = document.getElementById('onboard-doc-photo').files[0];

        if (!licenseFile || !idFile || !regFile || !photoFile) {
          showAlert('Please select all 4 required verification documents');
          return;
        }

        const agreementBox = document.getElementById('onboard-agreement');
        if (agreementBox && !agreementBox.checked) {
          showAlert(i18n.t('driverAgreementRequired'));
          agreementBox.focus();
          return;
        }

        const maxBytes = 5 * 1024 * 1024;
        const allowedDocMimes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
        const allowedPhotoMimes = ['image/jpeg', 'image/png', 'image/jpg'];

        for (const f of [licenseFile, idFile, regFile]) {
          if (f.size > maxBytes) {
            showAlert(`File "${f.name}" exceeds 5 MB limit`);
            return;
          }
          if (!allowedDocMimes.includes(f.type.toLowerCase())) {
            showAlert(`File "${f.name}" has invalid type. Only JPEG, PNG, PDF allowed.`);
            return;
          }
        }

        if (photoFile.size > maxBytes) {
          showAlert('Driver photo exceeds 5 MB limit');
          return;
        }
        if (!allowedPhotoMimes.includes(photoFile.type.toLowerCase())) {
          showAlert('Driver photo must be JPEG or PNG');
          return;
        }

        const submitBtn = document.getElementById('onboard-submit-btn');
        const btnText = document.getElementById('onboard-submit-btn-text');
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70');
        btnText.innerText = 'Registering vehicle...';

        try {
          // 1. Register driver and vehicle
          const regRes = await this.fetchWithAuth('/api/auth/driver/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              vehicleType,
              makeModel,
              color,
              plateNumber,
              year,
              emergencyContactName,
              emergencyContactPhone,
              emergencyContact: `${emergencyContactName} (${emergencyContactPhone})`
            })
          });

          const regData = await regRes.json();
          if (!regRes.ok) throw new Error(regData.error || 'Failed to register driver profile');
          this.recordConsent('DRIVER_AGREEMENT');

          // 2. Upload documents
          const docs = [
            { type: 'DRIVING_LICENSE', file: licenseFile, label: 'Driving Licence' },
            { type: 'NATIONAL_ID', file: idFile, label: 'National ID' },
            { type: 'VEHICLE_REGISTRATION', file: regFile, label: 'Vehicle Registration' },
            { type: 'DRIVER_PHOTO', file: photoFile, label: 'Driver Photo' }
          ];

          for (let i = 0; i < docs.length; i++) {
            btnText.innerText = `Uploading ${docs[i].label} (${i + 1}/4)...`;
            const fd = new FormData();
            fd.append('documentType', docs[i].type);
            fd.append('file', docs[i].file);

            const upRes = await this.fetchWithAuth('/api/driver/documents', {
              method: 'POST',
              body: fd
            });

            const upData = await upRes.json();
            if (!upRes.ok) throw new Error(upData.error || `Failed to upload ${docs[i].label}`);
          }

          // 3. Refresh user session
          btnText.innerText = 'Finalizing submission...';
          const meRes = await this.fetchWithAuth('/api/auth/me');
          if (meRes && meRes.ok) {
            const meData = await meRes.json();
            if (meData.user) {
              this.setSession(this.getAccessToken(), this.getRefreshToken(), meData.user);
            }
          }

          // 4. Transition to Pending
          stepOnboard.classList.add('hidden');
          stepPending.classList.remove('hidden');
          document.getElementById('auth-title').innerText = 'Application Pending Approval';
          document.getElementById('auth-sub').innerText = '';
        } catch (err) {
          const isSmsFailure = err.message && (err.message.includes('SMS delivery failed') || err.message.includes('telecom') || err.message.includes('network'));
          const errorMsg = isSmsFailure ? i18n.t('smsDeliveryFailedMsg') : err.message;
          showAlert(errorMsg);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-70');
          btnText.innerText = 'Submit Application & Upload Documents';
        }
      });
    }

    // Ensure user is authenticated before page loads; pops modal if unauthenticated
    // How people sign in: 'phone' (SMS codes) or 'email' (email codes). Read once from /api/app-config.
    loadAuthMode() {
      if (!this._authModePromise) {
        this._authModePromise = fetch('/api/app-config')
          .then((r) => r.json())
          .then((cfg) => { this._authMode = cfg && cfg.authMode === 'email' ? 'email' : 'phone'; return this._authMode; })
          .catch(() => { this._authMode = 'phone'; return 'phone'; });
      }
      return this._authModePromise;
    }

    // Records consent on the server. If it fails (e.g. no network), it is retried on the next load.
    async recordConsent(kind = 'TERMS_AND_PRIVACY') {
      const retryKey = CONSENT_RETRY_PREFIX + kind;
      try {
        const body = kind === 'DRIVER_AGREEMENT'
          ? { documentType: 'DRIVER_AGREEMENT', version: LEGAL_VERSION }
          : { type: 'TERMS_AND_PRIVACY', version: LEGAL_VERSION };
        const res = await this.fetchWithAuth('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res && res.ok) {
          localStorage.removeItem(retryKey);
          return true;
        }
        localStorage.setItem(retryKey, '1');
        return false;
      } catch (e) {
        try { localStorage.setItem(retryKey, '1'); } catch (_) {}
        return false;
      }
    }

    retryPendingConsent() {
      try {
        for (const kind of ['TERMS_AND_PRIVACY', 'DRIVER_AGREEMENT']) {
          if (localStorage.getItem(CONSENT_RETRY_PREFIX + kind) === '1') this.recordConsent(kind);
        }
      } catch (_) {}
    }

    async ensureAuth({ role = 'RIDER', onAuthenticated }) {
      await this.loadAuthMode();
      if (this.isAuthenticated()) {
        this.retryPendingConsent();
        try {
          const res = await this.fetchWithAuth('/api/auth/me');
          if (res && res.ok) {
            const data = await res.json();
            const user = data.user;
            this.setSession(this.getAccessToken(), this.getRefreshToken(), user);

            if (role === 'DRIVER' && (!user.driverProfile || user.driverProfile.approvalStatus !== 'APPROVED')) {
              this.setReady(user);
              this.showLoginModal({
                role,
                onLoginSuccess: (u) => {
                  this.setReady(u);
                  if (typeof onAuthenticated === 'function') onAuthenticated(u);
                }
              });

              if (!user.driverProfile) {
                document.getElementById('auth-step-phone')?.classList.add('hidden');
                document.getElementById('auth-step-onboard')?.classList.remove('hidden');
                document.getElementById('auth-title').innerText = 'Driver Onboarding';
                document.getElementById('auth-sub').innerText = 'Complete vehicle registration and upload your compliance documents';
                const card = document.querySelector('#aarohan-auth-modal > div');
                if (card) { card.classList.remove('max-w-sm'); card.classList.add('max-w-md'); }
              } else if (user.driverProfile.approvalStatus !== 'APPROVED') {
                document.getElementById('auth-step-phone')?.classList.add('hidden');
                document.getElementById('auth-step-pending')?.classList.remove('hidden');
                document.getElementById('auth-title').innerText = 'Application Pending Approval';
                document.getElementById('auth-sub').innerText = '';
              }
              return;
            }

            this.setReady(user);
            if (typeof onAuthenticated === 'function') {
              onAuthenticated(user);
            }
            return;
          }
        } catch (e) {
          console.warn('[Auth] Session check exception:', e);
        }
      }

      // Not authenticated -> resolve ready state and show login modal
      this.setReady(null);
      this.showLoginModal({
        role,
        onLoginSuccess: (user) => {
          this.setReady(user);
          if (typeof onAuthenticated === 'function') {
            onAuthenticated(user);
          }
        }
      });
    }
  }

  window.aarohanAuth = new AArohanAuth();
  window.aarohanAuth.loadAuthMode();
  window.fetchWithAuth = (url, options) => window.aarohanAuth.fetchWithAuth(url, options);
})(window);
