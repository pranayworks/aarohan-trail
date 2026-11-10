// ============================================================================
// AAROHAN DRIVER CAPACITOR NATIVE BRIDGE • LILONGWE, MALAWI
// Background Geolocation, Offline GPS Queue, FCM Push & Bilingual Permissions
// ============================================================================

(function (window) {
  'use strict';

  const OFFLINE_GPS_QUEUE_KEY = 'aarohan_offline_gps_queue';
  const MAX_OFFLINE_POINTS = 500; // retain up to ~80 mins of offline breadcrumbs

  class DriverCapacitorBridge {
    constructor() {
      this.isNative = Boolean(window.Capacitor && window.Capacitor.isNativePlatform());
      this.watcherId = null;
      this.isWatching = false;
      this.isFlushing = false;
      this.currentLang = 'en'; // 'en' | 'ny' (Chichewa)
      this.lastSentTimestamp = 0;
      this.throttleIntervalMs = 5000; // 5 seconds GPS throttle to save battery
    }

    /**
     * Initialize native plugins, permissions, and offline sync
     */
    async init() {
      console.log(`[CapacitorBridge] Initializing. Native platform: ${this.isNative}`);

      // Bind socket reconnection hook to flush offline GPS points
      if (window.mwendoSocket) {
        window.mwendoSocket.on('connect', () => {
          console.log('[CapacitorBridge] Socket reconnected. Flushing offline GPS queue...');
          this.flushOfflineQueue();
        });
      }

      window.addEventListener('online', () => {
        console.log('[CapacitorBridge] Network back online. Flushing offline GPS queue...');
        this.flushOfflineQueue();
      });

      if (!this.isNative) {
        console.log('[CapacitorBridge] Running in browser mode. Native background services skipped.');
        return;
      }

      await this.initPushNotifications();
    }

    // =========================================================================
    // 1. BILINGUAL PERMISSION DIALOG (English / Chichewa)
    // =========================================================================

    showPermissionExplanationModal({ type, onProceed, onCancel }) {
      const isLocation = type === 'location';

      const content = {
        en: {
          title: isLocation ? 'Background Location Permission' : 'Dispatch Notification Alerts',
          body: isLocation
            ? 'AArohan Driver needs background location access (\'Allow all the time\') so passengers and dispatch can locate you and track rides even when your screen is locked or another app is open.'
            : 'Enable notifications to receive instant ride and parcel requests so you never miss an earning opportunity in Lilongwe.',
          note: isLocation
            ? 'On the next screen, please select \'Allow all the time\'.'
            : 'You will hear an alert sound for incoming trips.',
          proceedBtn: 'Continue',
          cancelBtn: 'Later',
          toggleLang: 'Werengani m\'Chichewa'
        },
        ny: {
          title: isLocation ? 'Chilolezo Cha Malo (Background Location)' : 'Zidziwitso Za Maulendo (Notifications)',
          body: isLocation
            ? 'AArohan Driver ikufunika malo anu nthawi zonse (\'Allow all the time\') kuti makasitomala ndi ofesi azitha kukupezani ndikutsatira ulendo ngakhale foni ili m\'thumba kapena mutatsimphitsa chophimba.'
            : 'Lolani zidziwitso kuti mulandire maulendo ndi maphukusi nthawi yomweyo kuti musaphonye mwayi wopeza ndalama mu mzinda wa Lilongwe.',
          note: isLocation
            ? 'Patsamba lotsatira, sankhani \'Allow all the time\'.'
            : 'Mudzamva kulira kochenjeza pakafika ulendo watsopano.',
          proceedBtn: 'Pitirizani',
          cancelBtn: 'Pambuyo pake',
          toggleLang: 'Read in English'
        }
      };

      let activeLang = this.currentLang || 'en';

      const overlay = document.createElement('div');
      overlay.id = 'aarohan-permission-modal-overlay';
      overlay.className = 'fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none';

      const renderCard = () => {
        const text = content[activeLang];
        overlay.innerHTML = `
          <div class="bg-[#171717] text-white rounded-3xl p-6 max-w-sm w-full border border-[#292929] shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div class="flex items-center justify-between">
              <div class="w-12 h-12 rounded-2xl bg-orange-500/20 text-orange-400 flex items-center justify-center">
                <span class="material-symbols-outlined text-[28px]">${isLocation ? 'location_on' : 'notifications_active'}</span>
              </div>
              <button id="perm-lang-toggle" class="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all">
                ${text.toggleLang}
              </button>
            </div>

            <div>
              <h3 class="text-lg font-black text-white">${text.title}</h3>
              <p class="text-xs text-white/80 mt-2 leading-relaxed">${text.body}</p>
              <div class="mt-3 p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/30 text-[11px] text-orange-300 font-semibold flex items-center gap-2">
                <span class="material-symbols-outlined text-[16px]">info</span>
                <span>${text.note}</span>
              </div>
            </div>

            <div class="flex items-center gap-2.5 pt-2">
              <button id="perm-cancel-btn" class="flex-1 py-3 bg-white/10 hover:bg-white/15 rounded-xl text-xs font-bold text-white transition-all">
                ${text.cancelBtn}
              </button>
              <button id="perm-proceed-btn" class="flex-1 py-3 bg-[#E65100] hover:bg-[#C0392B] rounded-xl text-xs font-black text-white shadow-lg transition-all">
                ${text.proceedBtn}
              </button>
            </div>
          </div>
        `;

        overlay.querySelector('#perm-lang-toggle').onclick = () => {
          activeLang = activeLang === 'en' ? 'ny' : 'en';
          this.currentLang = activeLang;
          renderCard();
        };

        overlay.querySelector('#perm-cancel-btn').onclick = () => {
          document.body.removeChild(overlay);
          if (typeof onCancel === 'function') onCancel();
        };

        overlay.querySelector('#perm-proceed-btn').onclick = () => {
          document.body.removeChild(overlay);
          if (typeof onProceed === 'function') onProceed();
        };
      };

      renderCard();
      document.body.appendChild(overlay);
    }

    // =========================================================================
    // 2. BACKGROUND GEOLOCATION (High accuracy while online, throttled)
    // =========================================================================

    async startBackgroundGeolocation() {
      if (this.isWatching) return;

      if (!this.isNative) {
        console.log('[CapacitorBridge] Using browser geolocation fallback');
        this.startBrowserGeolocation();
        return;
      }

      this.showPermissionExplanationModal({
        type: 'location',
        onProceed: async () => {
          try {
            const { registerPlugin } = window.Capacitor;
            const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

            if (!BackgroundGeolocation) {
              console.warn('[CapacitorBridge] BackgroundGeolocation plugin not registered, falling back.');
              this.startBrowserGeolocation();
              return;
            }

            this.watcherId = await BackgroundGeolocation.addWatcher(
              {
                backgroundMessage: 'AArohan Driver is Active • Transmitting GPS coordinates for dispatch',
                backgroundTitle: 'Gaman Captain Online',
                requestPermissions: true,
                stale: false,
                distanceFilter: 10 // meters threshold to save battery
              },
              (location, error) => {
                if (error) {
                  if (error.code === 'NOT_AUTHORIZED') {
                    console.warn('[CapacitorBridge] Location permission denied by user.');
                  }
                  return;
                }
                if (location) {
                  this.handleLocationUpdate({
                    lat: location.latitude,
                    lng: location.longitude,
                    accuracy: location.accuracy,
                    speed: location.speed,
                    heading: location.bearing,
                    recordedAt: new Date(location.time || Date.now()).toISOString()
                  });
                }
              }
            );
            this.isWatching = true;
            console.log('[CapacitorBridge] Background geolocation started with watcherId:', this.watcherId);
          } catch (err) {
            console.warn('[CapacitorBridge] Error starting native background geolocation:', err);
            this.startBrowserGeolocation();
          }
        },
        onCancel: () => {
          console.log('[CapacitorBridge] User deferred background location permission');
        }
      });
    }

    async stopBackgroundGeolocation() {
      if (!this.isWatching) return;
      if (this.isNative && this.watcherId) {
        try {
          const { registerPlugin } = window.Capacitor;
          const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
          if (BackgroundGeolocation) {
            await BackgroundGeolocation.removeWatcher({ id: this.watcherId });
          }
        } catch (e) {
          console.warn('[CapacitorBridge] Error stopping background watcher:', e.message);
        }
      } else if (this.browserWatchId) {
        navigator.geolocation.clearWatch(this.browserWatchId);
        this.browserWatchId = null;
      }
      this.isWatching = false;
      this.watcherId = null;
      console.log('[CapacitorBridge] Background geolocation stopped.');
    }

    startBrowserGeolocation() {
      if (!navigator.geolocation) return;
      this.browserWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          this.handleLocationUpdate({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            recordedAt: new Date(pos.timestamp).toISOString()
          });
        },
        (err) => console.warn('[BrowserGeo] Error:', err.message),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );
      this.isWatching = true;
    }

    /**
     * Handle coordinate update with 5s throttling & offline fallback queueing
     */
    async handleLocationUpdate(point) {
      const now = Date.now();
      if (now - this.lastSentTimestamp < this.throttleIntervalMs) {
        return; // throttled to prevent radio drain
      }
      this.lastSentTimestamp = now;

      // Update local UI position if map exists
      if (typeof window.updateDriverMarkerPosition === 'function') {
        window.updateDriverMarkerPosition(point.lat, point.lng, point.heading);
      }

      const socket = window.mwendoSocket;
      const isConnected = socket && socket.connected;
      const isOnline = navigator.onLine;

      if (isConnected && isOnline) {
        socket.emit('trip:driver_moved', point);
      } else {
        // Enqueue point in offline queue for dispute audit integrity
        await this.enqueueOfflinePoint(point);
      }
    }

    // =========================================================================
    // 3. OFFLINE GPS QUEUE (Preferences / LocalStorage)
    // =========================================================================

    async getOfflineQueue() {
      try {
        if (this.isNative && window.Capacitor?.Plugins?.Preferences) {
          const { value } = await window.Capacitor.Plugins.Preferences.get({ key: OFFLINE_GPS_QUEUE_KEY });
          return value ? JSON.parse(value) : [];
        }
        const stored = localStorage.getItem(OFFLINE_GPS_QUEUE_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch (e) {
        return [];
      }
    }

    async saveOfflineQueue(queue) {
      try {
        const jsonStr = JSON.stringify(queue.slice(-MAX_OFFLINE_POINTS));
        if (this.isNative && window.Capacitor?.Plugins?.Preferences) {
          await window.Capacitor.Plugins.Preferences.set({ key: OFFLINE_GPS_QUEUE_KEY, value: jsonStr });
        } else {
          localStorage.setItem(OFFLINE_GPS_QUEUE_KEY, jsonStr);
        }
      } catch (e) {
        console.warn('[CapacitorBridge] Error saving offline queue:', e.message);
      }
    }

    async enqueueOfflinePoint(point) {
      try {
        const queue = await this.getOfflineQueue();
        queue.push({
          ...point,
          queuedAt: Date.now()
        });
        await this.saveOfflineQueue(queue);
        console.log(`[CapacitorBridge] GPS queued offline. Total points in queue: ${queue.length}`);
      } catch (e) {
        console.warn('[CapacitorBridge] Failed to enqueue GPS point:', e.message);
      }
    }

    async flushOfflineQueue() {
      if (this.isFlushing) return;
      const socket = window.mwendoSocket;
      if (!socket || !socket.connected || !navigator.onLine) return;

      this.isFlushing = true;
      try {
        const queue = await this.getOfflineQueue();
        if (queue.length === 0) {
          this.isFlushing = false;
          return;
        }

        console.log(`[CapacitorBridge] Flushing ${queue.length} offline GPS breadcrumb(s) to server...`);
        while (queue.length > 0 && socket.connected) {
          const batch = queue.splice(0, 10);
          for (const pt of batch) {
            socket.emit('trip:driver_moved', pt);
          }
          await this.saveOfflineQueue(queue);
          await new Promise(r => setTimeout(r, 100)); // slight pacing
        }
        console.log('[CapacitorBridge] Offline GPS queue successfully synchronized.');
      } catch (e) {
        console.warn('[CapacitorBridge] Warning flushing offline GPS queue:', e.message);
      } finally {
        this.isFlushing = false;
      }
    }

    // =========================================================================
    // 4. FIREBASE CLOUD MESSAGING (Push Notifications)
    // =========================================================================

    async initPushNotifications() {
      if (!this.isNative) return;

      this.showPermissionExplanationModal({
        type: 'notifications',
        onProceed: async () => {
          try {
            const { PushNotifications } = window.Capacitor.Plugins;
            if (!PushNotifications) return;

            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === 'prompt') {
              perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive !== 'granted') {
              console.warn('[FCM] Push notification permission not granted');
              return;
            }

            await PushNotifications.register();

            PushNotifications.addListener('registration', async (token) => {
              console.log('[FCM] Push registration token received:', token.value?.substring(0, 10) + '...');
              await this.registerTokenWithServer(token.value);
            });

            PushNotifications.addListener('registrationError', (err) => {
              console.warn('[FCM] Push registration error:', err.error);
            });

            PushNotifications.addListener('pushNotificationReceived', (notification) => {
              console.log('[FCM] Push received in foreground:', notification);
              if (window.mwendoSound) window.mwendoSound.playDispatch();
            });

            PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
              console.log('[FCM] Push action performed:', notification);
              const data = notification.notification?.data;
              if (data?.tripId && typeof window.handleIncomingPushTripOffer === 'function') {
                window.handleIncomingPushTripOffer(data.tripId);
              }
            });
          } catch (e) {
            console.warn('[FCM] Error initializing native push notifications:', e.message);
          }
        },
        onCancel: () => {
          console.log('[FCM] User deferred notification permissions');
        }
      });
    }

    async registerTokenWithServer(token) {
      try {
        const res = await window.authFetch('/api/driver/device-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, platform: 'ANDROID' })
        });
        if (res.ok) {
          console.log('[FCM] Device token successfully registered with AArohan backend');
        }
      } catch (err) {
        console.warn('[FCM] Failed to register device token with backend:', err.message);
      }
    }
  }

  window.driverCapacitorBridge = new DriverCapacitorBridge();

  // Auto-init on page load
  document.addEventListener('DOMContentLoaded', () => {
    window.driverCapacitorBridge.init().catch(e => console.warn('[CapacitorBridge] Auto-init error:', e));
  });

})(window);

