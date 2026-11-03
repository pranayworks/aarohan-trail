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

  const ACCESS_TOKEN_KEY = 'aarohan_access_token';
  const REFRESH_TOKEN_KEY = 'aarohan_refresh_token';
  const USER_KEY = 'aarohan_user';

  class AArohanAuth {
    constructor() {
      this.refreshTimer = null;
      this.activeSocket = null;
      this.onAuthChangeCallbacks = [];
      this.initAutoRefresh();
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

    // Rotating Refresh Token Exchange
    async refreshToken() {
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
    }

    // Authenticated API request wrapper (attaches JWT, retries on 401 via refresh token)
    async fetchWithAuth(url, options = {}) {
      let token = this.getAccessToken();
      if (!token) {
        throw new Error('Unauthenticated: Please log in');
      }

      const headers = Object.assign({}, options.headers || {}, {
        'Authorization': `Bearer ${token}`
      });

      let res = await fetch(url, Object.assign({}, options, { headers }));

      // If token expired (401), attempt immediate refresh and retry request
      if (res.status === 401) {
        console.log('[Auth] Received 401 Unauthorized. Attempting refresh token exchange...');
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
      // Remove any existing modal
      const existing = document.getElementById('aarohan-auth-modal');
      if (existing) existing.remove();

      const i18n = window.aarohanI18n || {
        t: (k, params) => {
          const defaults = {
            loginTitle: role === 'ADMIN' ? 'Desk Operations Access' : (role === 'DRIVER' ? 'Captain Partner Sign In' : 'Sign In to AArohan'),
            loginSub: role === 'ADMIN' ? 'Lilongwe Central Command Portal' : 'Fast, reliable urban mobility in Lilongwe',
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
      modalEl.className = 'fixed inset-0 z-[99999] bg-surface/95 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6';

      modalEl.innerHTML = `
        <div class="w-full max-w-sm bg-surface-container-low border border-outline-variant/30 rounded-3xl p-6 sm:p-7 shadow-2xl relative text-on-surface animate-in fade-in zoom-in-95 duration-200">
          
          <!-- Top Header: Logo & Language Switcher -->
          <div class="flex items-center justify-between mb-5">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-on-primary font-black text-sm shadow-md shadow-primary/20">
                A
              </div>
              <div>
                <h1 class="text-base font-black tracking-tight leading-none text-on-surface">AArohan</h1>
                <span class="text-[10px] font-bold text-primary tracking-wider uppercase">${role}</span>
              </div>
            </div>

            <button id="auth-lang-btn" type="button" class="px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-[11px] font-extrabold text-on-surface-variant hover:text-on-surface transition-all flex items-center gap-1 active:scale-95">
              <span>🇲🇼</span>
              <span id="auth-lang-label">NY</span>
            </button>
          </div>

          <!-- Titles -->
          <div class="mb-5">
            <h2 id="auth-title" class="text-xl font-black text-on-surface tracking-tight mb-1">
              ${i18n.t('loginTitle')}
            </h2>
            <p id="auth-sub" class="text-xs text-on-surface-variant font-medium leading-relaxed">
              ${i18n.t('loginSub')}
            </p>
          </div>

          <!-- Alert Container -->
          <div id="auth-alert" class="hidden mb-4 p-3 rounded-2xl text-xs font-semibold leading-snug"></div>

          <!-- STEP 1: Phone Input -->
          <form id="auth-step-phone" class="space-y-4">
            <div>
              <label id="label-phone" class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1.5">
                ${i18n.t('phoneLabel')}
              </label>
              <div class="relative">
                <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-primary">🇲🇼 +265</span>
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

            ${role === 'ADMIN' ? `
            <div>
              <label id="label-admin-pass" class="block text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant mb-1.5">
                ${i18n.t('adminPasswordLabel')}
              </label>
              <input 
                type="password" 
                id="auth-admin-password" 
                class="w-full h-12 px-4 bg-surface-container rounded-2xl border border-outline-variant/40 focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm font-bold text-on-surface outline-none transition-all" 
                placeholder="••••••••••••" 
                required
              />
            </div>
            ` : ''}

            <button 
              type="submit" 
              id="auth-phone-submit" 
              class="w-full h-12 bg-primary hover:bg-primary/90 text-on-primary font-black text-sm rounded-2xl shadow-lg shadow-primary/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
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
                  ${i18n.t('otpLabel')}
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

            <button 
              type="submit" 
              id="auth-otp-submit" 
              class="w-full h-12 bg-primary hover:bg-primary/90 text-on-primary font-black text-sm rounded-2xl shadow-lg shadow-primary/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span id="auth-btn-otp-text">${role === 'ADMIN' ? i18n.t('adminLoginBtn') : i18n.t('verifyOtpBtn')}</span>
              <span class="material-symbols-outlined text-lg">check_circle</span>
            </button>
          </form>

          <!-- STEP 3: Driver PENDING Status Banner -->
          <div id="auth-step-pending" class="hidden text-center py-4 space-y-3">
            <div class="w-14 h-14 mx-auto rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center text-2xl">
              <span class="material-symbols-outlined text-3xl">pending_actions</span>
            </div>
            <h3 class="text-base font-black text-on-surface">${i18n.t('driverPendingTitle')}</h3>
            <p class="text-xs text-on-surface-variant font-medium leading-relaxed px-2">
              ${i18n.t('driverPendingSub')}
            </p>
            <div class="pt-2">
              <button type="button" onclick="window.aarohanAuth.logout()" class="px-5 py-2.5 rounded-xl bg-surface-container border border-outline-variant/40 text-xs font-extrabold text-on-surface hover:bg-surface-container-high transition-colors">
                ${i18n.t('logoutBtn')}
              </button>
            </div>
          </div>

          <!-- Mobile-first Footer Notice -->
          <p class="text-[10px] text-center text-outline mt-5 font-semibold">
            Lilongwe Smart Urban Mobility • Protected by AArohan Escrow
          </p>

        </div>
      `;

      document.body.appendChild(modalEl);

      // Elements
      const alertBox = document.getElementById('auth-alert');
      const stepPhone = document.getElementById('auth-step-phone');
      const stepOtp = document.getElementById('auth-step-otp');
      const stepPending = document.getElementById('auth-step-pending');
      const phoneInput = document.getElementById('auth-phone-input');
      const otpInput = document.getElementById('auth-otp-input');
      const adminPassInput = document.getElementById('auth-admin-password');
      const changePhoneBtn = document.getElementById('auth-change-phone-btn');
      const langBtn = document.getElementById('auth-lang-btn');
      const langLabel = document.getElementById('auth-lang-label');

      let currentPhoneE164 = '';

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

      // Language Switcher within Modal
      langBtn.addEventListener('click', () => {
        if (window.aarohanI18n) {
          const next = window.aarohanI18n.toggleLang();
          langLabel.innerText = next === 'en' ? 'NY' : 'EN';
          document.getElementById('auth-title').innerText = i18n.t('loginTitle');
          document.getElementById('auth-sub').innerText = i18n.t('loginSub');
          document.getElementById('label-phone').innerText = i18n.t('phoneLabel');
          document.getElementById('auth-btn-phone-text').innerText = i18n.t('requestOtpBtn');
          document.getElementById('label-otp').innerText = i18n.t('otpLabel');
          document.getElementById('auth-btn-otp-text').innerText = role === 'ADMIN' ? i18n.t('adminLoginBtn') : i18n.t('verifyOtpBtn');
          document.getElementById('auth-change-phone-btn').innerText = i18n.t('changePhoneBtn');
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

        currentPhoneE164 = rawPhone;

        const submitBtn = document.getElementById('auth-phone-submit');
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70');

        try {
          const res = await fetch('/api/auth/otp/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: currentPhoneE164 })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to request code');

          stepPhone.classList.add('hidden');
          stepOtp.classList.remove('hidden');
          document.getElementById('auth-title').innerText = i18n.t('otpTitle');
          document.getElementById('auth-sub').innerText = i18n.t('otpSub', { phone: currentPhoneE164 });
          otpInput.focus();
          showAlert(`Verification code sent via SMS to ${currentPhoneE164}`, false);
        } catch (err) {
          showAlert(err.message);
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
            res = await fetch('/api/auth/admin/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: currentPhoneE164, password, otp })
            });
          } else {
            res = await fetch('/api/auth/otp/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: currentPhoneE164, otp })
            });
          }

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Verification failed');

          this.setSession(data.accessToken, data.refreshToken, data.user);

          // For driver portal: verify approvalStatus
          if (role === 'DRIVER') {
            if (!data.user.driverProfile || data.user.driverProfile.approvalStatus !== 'APPROVED') {
              stepOtp.classList.add('hidden');
              stepPending.classList.remove('hidden');
              document.getElementById('auth-title').innerText = i18n.t('driverPendingTitle');
              document.getElementById('auth-sub').innerText = '';
              return;
            }
          }

          modalEl.remove();
          if (typeof onLoginSuccess === 'function') {
            onLoginSuccess(data.user);
          }
        } catch (err) {
          showAlert(err.message);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-70');
        }
      });
    }

    // Ensure user is authenticated before page loads; pops modal if unauthenticated
    async ensureAuth({ role = 'RIDER', onAuthenticated }) {
      if (this.isAuthenticated()) {
        try {
          const res = await this.fetchWithAuth('/api/auth/me');
          if (res.ok) {
            const data = await res.json();
            const user = data.user;
            this.setSession(this.getAccessToken(), this.getRefreshToken(), user);

            if (role === 'DRIVER' && (!user.driverProfile || user.driverProfile.approvalStatus !== 'APPROVED')) {
              this.showLoginModal({ role, onLoginSuccess: onAuthenticated });
              return;
            }

            if (typeof onAuthenticated === 'function') {
              onAuthenticated(user);
            }
            return;
          }
        } catch (e) {
          console.warn('[Auth] Session check exception:', e);
        }
      }

      // Not authenticated -> show login modal
      this.showLoginModal({ role, onLoginSuccess: onAuthenticated });
    }
  }

  window.aarohanAuth = new AArohanAuth();
})(window);
