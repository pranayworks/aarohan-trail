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
              <span>🇲🇼</span>
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
            Lilongwe Smart Urban Mobility • Protected by AArohan Escrow
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
      const phoneInput = document.getElementById('auth-phone-input');
      const otpInput = document.getElementById('auth-otp-input');
      const adminPassInput = document.getElementById('auth-admin-password');
      const changePhoneBtn = document.getElementById('auth-change-phone-btn');
      const langBtn = document.getElementById('auth-lang-btn');
      const langLabel = document.getElementById('auth-lang-label');
      const checkStatusBtn = document.getElementById('auth-check-status-btn');

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
          if (taglineEl) taglineEl.innerText = i18n.t('brandTagline') || (next === 'ny' ? 'Uka • Manga • Kula (NEEDS NATIVE REVIEW)' : 'Rise • Build • Grow');
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
          showAlert(err.message);
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
          showAlert(err.message);
        } finally {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-70');
          btnText.innerText = 'Submit Application & Upload Documents';
        }
      });
    }

    // Ensure user is authenticated before page loads; pops modal if unauthenticated
    async ensureAuth({ role = 'RIDER', onAuthenticated }) {
      if (this.isAuthenticated()) {
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
  window.fetchWithAuth = (url, options) => window.aarohanAuth.fetchWithAuth(url, options);
})(window);
