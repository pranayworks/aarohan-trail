// Mwendo Real-Time Cross-App & WebSocket State Bus
(function(window) {
  'use strict';

  const STORAGE_KEY = 'mwendo_app_state_v1';
  const CHANNEL_NAME = 'mwendo_realtime_channel';

  const defaultInitialState = {
    rider: {
      name: '',
      phone: '',
      walletBalance: 0,
      rating: 5.0,
      tripsCompleted: 0,
      kycTier: 'Standard Passenger'
    },
    driver: {
      name: '',
      phone: '',
      plate: '',
      car: '',
      rating: 5.0,
      tripsCompleted: 0,
      availableBalance: 0,
      todayEarnings: 0,
      todayTrips: 0,
      status: 'OFFLINE',
      kycTier: 'Captain Partner',
      location: { lat: -13.9650, lng: 33.7820, heading: 45 }
    },
    activeTrip: {
      id: null,
      status: 'IDLE', // IDLE, REQUESTED, ACCEPTED, EN_ROUTE, ARRIVED, IN_TRANSIT, COMPLETED
      pickup: '',
      pickupLandmark: '',
      destination: '',
      destinationLandmark: '',
      tier: 'cab',
      baseFare: 0,
      discount: 0,
      finalFare: 0,
      paymentMethod: 'CASH',
      paymentRef: '',
      pin: '',
      distanceKm: 0,
      durationMins: 0,
      etaMins: 0,
      driverLocation: { lat: -13.9650, lng: 33.7820 },
      requestedAt: null,
      acceptedAt: null,
      completedAt: null,
      rating: 5,
      tipAmount: 0,
      compliments: []
    },
    chatMessages: [],
    surgeMultipliers: {
      'Gateway Mall': 1.4,
      'Area 3 Commercial': 1.3,
      'Old Town Market': 1.2,
      'Area 47 Sector 3': 1.0,
      'Bingu Stadium': 1.1
    },
    emergencyAlerts: [],
    supportTickets: [],
    transactionLogs: [],
    driverSettlements: []
  };

  class MwendoStateStore {
    constructor() {
      this.listeners = [];
      this.channel = null;
      this.socket = null;
      this.isRealtimeConnected = false;
      this._authListenerAttached = false;

      // 1. Attach auth lifecycle to delay socket & active trip fetch until token exists
      this.attachAuthLifecycle();

      // If token already present, initialize immediately
      if (typeof window !== 'undefined' && window.aarohanAuth && window.aarohanAuth.getAccessToken()) {
        this.fetchInitialState();
        this.initSocketIo();
      }

      // 3. BroadcastChannel fallback
      try {
        if ('BroadcastChannel' in window) {
          this.channel = new BroadcastChannel(CHANNEL_NAME);
          this.channel.onmessage = (event) => {
            this.handleRemoteEvent(event.data);
          };
        }
      } catch (e) {
        console.warn('BroadcastChannel fallback only', e);
      }

      // 4. Storage event fallback
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            this.notifyListeners(parsed, 'STORAGE_SYNC');
          } catch (err) {}
        }
      });
    }

    attachAuthLifecycle() {
      const tryAttach = () => {
        if (typeof window !== 'undefined' && window.aarohanAuth && !this._authListenerAttached) {
          this._authListenerAttached = true;
          window.aarohanAuth.onAuthChange((user) => {
            const token = window.aarohanAuth.getAccessToken();
            if (user && token) {
              if (!this.socket) {
                this.initSocketIo();
              } else {
                this.socket.auth = { token };
                if (!this.socket.connected) this.socket.connect();
              }
              this.fetchInitialState();
            } else {
              if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
                this.isRealtimeConnected = false;
                this.updateConnectionBadge(false);
              }
            }
          });

          if (window.aarohanAuth.getAccessToken() && !this.socket) {
            this.fetchInitialState();
            this.initSocketIo();
          }
        }
      };

      if (typeof window !== 'undefined') {
        if (window.aarohanAuth) {
          tryAttach();
        } else {
          window.addEventListener('DOMContentLoaded', tryAttach);
          setTimeout(tryAttach, 0);
          setTimeout(tryAttach, 50);
          setTimeout(tryAttach, 200);
        }
      }
    }

    fetchInitialState() {
      const auth = (typeof window !== 'undefined' && window.aarohanAuth) ? window.aarohanAuth : null;
      if (!auth) return;

      const origin = (window.location.protocol.startsWith('http')) ? window.location.origin : 'http://localhost:3000';
      const fetchPromise = (auth.fetchWithAuth)
        ? auth.fetchWithAuth(`${origin}/api/trips/active`)
        : fetch(`${origin}/api/trips/active`);

      fetchPromise
        .then(r => {
          if (!r || !r.ok) return null;
          return r.json();
        })
        .then(serverState => {
          if (serverState && !serverState.error && serverState.activeTrip) {
            const current = this.getState();
            const merged = Object.assign({}, current, serverState);
            this.saveState(merged);
            this.notifyListeners(merged, 'SYNC', null);
          }
        })
        .catch(err => console.warn('Could not fetch initial server state:', err));
    }

    initSocketIo() {
      this.attachAuthLifecycle();
      const token = (typeof window !== 'undefined' && window.aarohanAuth) ? window.aarohanAuth.getAccessToken() : null;
      if (!token) {
        // Connect only after access token exists
        return;
      }

      // Connect to Socket.IO if available
      const setupSocket = () => {
        if (typeof window.io === 'function' && !this.socket) {
          try {
            const origin = (window.location.protocol.startsWith('http')) ? window.location.origin : 'http://localhost:3000';
            this.socket = window.io(origin, {
              transports: ['websocket'],
              auth: { token },
              reconnectionAttempts: 15,
              reconnectionDelay: 1000,
              timeout: 6000
            });

            if (window.aarohanAuth) {
              window.aarohanAuth.activeSocket = this.socket;
            }

            this.socket.on('connect_error', async (err) => {
              console.warn('[MwendoStateStore] ⚠️ Socket handshake error:', err.message);
              if (window.aarohanAuth && err.message && (err.message.includes('Authentication') || err.message.includes('token') || err.message.includes('expired'))) {
                console.log('[MwendoStateStore] Proactively refreshing JWT token for Socket.IO reconnect...');
                const freshToken = await window.aarohanAuth.refreshToken();
                if (freshToken) {
                  this.socket.auth = { token: freshToken };
                  this.socket.connect();
                }
              }
            });

            this.socket.on('connect', () => {
              this.isRealtimeConnected = true;
              console.log('[MwendoStateStore] 🟢 Connected to Real-Time WebSocket Server at', origin);
              this.updateConnectionBadge(true);
            });

            this.socket.on('disconnect', () => {
              this.isRealtimeConnected = false;
              console.warn('[MwendoStateStore] 🔴 Disconnected from WebSocket Server');
              this.updateConnectionBadge(false);
            });

            // Synchronize full state from server
            this.socket.on('state:sync', (serverState) => {
              if (serverState && !serverState.error) {
                const current = this.getState();
                const merged = Object.assign({}, current, serverState);
                this.saveState(merged);
                this.notifyListeners(merged, 'SYNC', null);
              }
            });

            // Real-Time Events
            this.socket.on('trip:requested', (trip) => {
              const state = this.getState();
              state.activeTrip = Object.assign({}, state.activeTrip, trip);
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_REQUESTED', trip);
              if (window.mwendoSound) window.mwendoSound.playDispatchAlert();
            });

            this.socket.on('trip:offered', (offerPayload) => {
              const state = this.getState();
              if (offerPayload && offerPayload.tripId) {
                state.activeTrip.id = offerPayload.tripId;
                state.activeTrip.status = 'OFFERED';
              }
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_OFFERED', offerPayload);
              if (window.mwendoSound) window.mwendoSound.playDispatchAlert();
            });

            this.socket.on('trip:offer', (payload) => {
              const state = this.getState();
              if (payload && payload.trip) {
                state.activeTrip = Object.assign({}, state.activeTrip, payload.trip);
              }
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_OFFERED', payload);
              if (window.mwendoSound) window.mwendoSound.playDispatchAlert();
            });

            this.socket.on('trip:accepted', (payload) => {
              const state = this.getState();
              const trip = payload.trip || payload;
              state.activeTrip = Object.assign({}, state.activeTrip, trip);
              if (payload.driver) {
                state.driver = Object.assign({}, state.driver, {
                  id: payload.driver.id,
                  name: payload.driver.user?.name || payload.driver.name || state.driver.name,
                  phone: payload.driver.user?.phone || payload.driver.phone || state.driver.phone,
                  plate: payload.driver.vehicle?.plateNumber || payload.driver.plate || state.driver.plate,
                  car: payload.driver.vehicle?.model || payload.driver.vehicle?.make || payload.driver.car || 'Partner Vehicle',
                  rating: payload.driver.rating || state.driver.rating || 5.0
                });
              }
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_ACCEPTED', payload);
              if (window.mwendoSound) window.mwendoSound.playAcceptChime();
            });

            this.socket.on('trip:driver_moved', (coords) => {
              const state = this.getState();
              state.driver.location = coords;
              state.activeTrip.driverLocation = coords;
              this.notifyListeners(state, 'DRIVER_MOVED', coords);
            });

            this.socket.on('trip:arrived', (trip) => {
              const state = this.getState();
              state.activeTrip = Object.assign({}, state.activeTrip, trip);
              if (trip.driver) {
                state.driver = Object.assign({}, state.driver, {
                  id: trip.driver.id,
                  name: trip.driver.user?.name || trip.driver.name || state.driver.name,
                  phone: trip.driver.user?.phone || trip.driver.phone || state.driver.phone,
                  plate: trip.driver.vehicle?.plateNumber || trip.driver.plate || state.driver.plate,
                  car: trip.driver.vehicle?.model || trip.driver.vehicle?.make || trip.driver.car || 'Partner Vehicle',
                  rating: trip.driver.rating || state.driver.rating || 5.0
                });
              }
              this.saveState(state);
              this.notifyListeners(state, 'DRIVER_ARRIVED', trip);
              if (window.mwendoSound) window.mwendoSound.playTone(600, 'triangle', 0.2);
            });

            this.socket.on('trip:in_transit', (trip) => {
              const state = this.getState();
              state.activeTrip = Object.assign({}, state.activeTrip, trip);
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_IN_TRANSIT', trip);
            });

            this.socket.on('trip:completed', (payload) => {
              const state = this.getState();
              const trip = payload.trip || payload;
              state.activeTrip = Object.assign({}, state.activeTrip, trip);
              if (payload.rider) state.rider = Object.assign({}, state.rider, payload.rider);
              if (payload.driver) state.driver = Object.assign({}, state.driver, payload.driver);
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_COMPLETED', payload);
              if (window.mwendoSound) window.mwendoSound.playTripCompleteFanfare();
            });

            this.socket.on('trip:cancelled', (payload) => {
              const state = this.getState();
              state.activeTrip.status = 'IDLE';
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_CANCELLED', payload);
            });

            this.socket.on('chat:message', (msg) => {
              const state = this.getState();
              state.chatMessages = state.chatMessages || [];
              state.chatMessages.push(msg);
              this.saveState(state);
              this.notifyListeners(state, 'CHAT_MESSAGE', msg);
              if (window.mwendoSound) window.mwendoSound.playTone(880, 'sine', 0.1);
            });

            this.socket.on('sos:alert', (alertItem) => {
              const state = this.getState();
              state.emergencyAlerts.unshift(alertItem);
              this.saveState(state);
              this.notifyListeners(state, 'EMERGENCY_SOS', alertItem);
              if (window.mwendoSound) window.mwendoSound.playEmergencyAlarm();
            });

            this.socket.on('sos:resolved', (id) => {
              const state = this.getState();
              state.emergencyAlerts = state.emergencyAlerts.filter(a => a.id !== id);
              this.saveState(state);
              this.notifyListeners(state, 'SOS_RESOLVED', id);
            });

            this.socket.on('surge:updated', (data) => {
              const state = this.getState();
              state.surgeMultipliers[data.zone] = parseFloat(data.multiplier);
              this.saveState(state);
              this.notifyListeners(state, 'SURGE_UPDATED', data);
            });

            this.socket.on('wallet:updated', (data) => {
              const state = this.getState();
              if (data.rider) state.rider = data.rider;
              if (data.tx) state.transactionLogs.unshift(data.tx);
              this.saveState(state);
              this.notifyListeners(state, 'WALLET_TOPPED_UP', data);
            });

          } catch (err) {
            console.warn('[MwendoStateStore] Socket.IO connection failed', err);
          }
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupSocket);
      } else {
        setupSocket();
      }
    }

    updateConnectionBadge(isConnected) {
      const badge = document.getElementById('network-connection-badge');
      if (badge) {
        if (isConnected) {
          badge.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-fixed text-primary';
          badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span> Live Real-Time';
        } else {
          badge.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-outline-variant/30 text-outline';
          badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-outline"></span> Local Offline';
        }
      }
    }

    getState() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.saveState(defaultInitialState);
        return defaultInitialState;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || parsed.error || !parsed.activeTrip) {
          const healed = Object.assign({}, defaultInitialState, (parsed && typeof parsed === 'object' && !parsed.error) ? parsed : {});
          if (!healed.activeTrip || typeof healed.activeTrip !== 'object') {
            healed.activeTrip = Object.assign({}, defaultInitialState.activeTrip);
          }
          this.saveState(healed);
          return healed;
        }
        if (parsed.activeTrip.destination && typeof parsed.activeTrip.destination !== 'string') {
          parsed.activeTrip.destination = parsed.activeTrip.destination.name || parsed.activeTrip.destination.address || 'Destination';
        }
        if (parsed.activeTrip.pickup && typeof parsed.activeTrip.pickup !== 'string') {
          parsed.activeTrip.pickup = parsed.activeTrip.pickup.name || parsed.activeTrip.pickup.address || 'Pickup Point';
        }
        return parsed;
      } catch (e) {
        return defaultInitialState;
      }
    }

    saveState(state) {
      try {
        if (!state || typeof state !== 'object' || state.error) return;
        if (!state.activeTrip) {
          state.activeTrip = Object.assign({}, defaultInitialState.activeTrip);
        }
        if (state.activeTrip.destination && typeof state.activeTrip.destination !== 'string') {
          state.activeTrip.destination = state.activeTrip.destination.name || state.activeTrip.destination.address || 'Destination';
        }
        if (state.activeTrip.pickup && typeof state.activeTrip.pickup !== 'string') {
          state.activeTrip.pickup = state.activeTrip.pickup.name || state.activeTrip.pickup.address || 'Pickup Point';
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {}
    }

    notifyListeners(state, eventName, payload) {
      if (state && state.activeTrip) {
        if (state.activeTrip.destination && typeof state.activeTrip.destination !== 'string') {
          state.activeTrip.destination = state.activeTrip.destination.name || state.activeTrip.destination.address || 'Destination';
        }
        if (state.activeTrip.pickup && typeof state.activeTrip.pickup !== 'string') {
          state.activeTrip.pickup = state.activeTrip.pickup.name || state.activeTrip.pickup.address || 'Pickup Point';
        }
      }
      this.listeners.forEach(fn => {
        try {
          fn(state, eventName, payload);
        } catch (e) {
          console.error('State subscriber error', e);
        }
      });
    }

    handleRemoteEvent(data) {
      if (!data) return;
      const state = this.getState();
      this.notifyListeners(state, data.event, data.payload);
    }

    broadcast(event, payload) {
      if (this.channel) {
        try {
          this.channel.postMessage({ event, payload, timestamp: Date.now() });
        } catch (e) {}
      }
    }

    subscribe(callback) {
      this.listeners.push(callback);
      callback(this.getState(), 'INIT', null);
      return () => {
        this.listeners = this.listeners.filter(fn => fn !== callback);
      };
    }

    // --- Action Methods ---

    requestTrip(params = {}, callback) {
      const state = this.getState();
      if (!state.activeTrip) {
        state.activeTrip = Object.assign({}, defaultInitialState.activeTrip);
      }
      const {
        pickup,
        destination,
        tier,
        fare,
        paymentMethod,
        distanceKm,
        quoteId,
        tierId,
        routeGeometry,
        durationMins,
        pickupCoords,
        dropoffCoords
      } = params;

      const pickupStr = (typeof pickup === 'string') ? pickup : (pickup?.name || pickup?.address || 'Pickup Point');
      const destStr = (typeof destination === 'string') ? destination : (destination?.name || destination?.address || 'Destination');

      state.activeTrip.status = 'REQUESTED';
      state.activeTrip.pickup = pickupStr;
      state.activeTrip.destination = destStr;
      state.activeTrip.tier = tier || state.activeTrip.tier || 'Moto';
      state.activeTrip.tierId = (tierId || 'moto').toLowerCase();
      state.activeTrip.quoteId = quoteId || null;
      state.activeTrip.finalFare = fare || state.activeTrip.finalFare || 1500;
      state.activeTrip.paymentMethod = paymentMethod || 'CASH';
      state.activeTrip.distanceKm = distanceKm || 3.5;
      state.activeTrip.durationMins = durationMins || 8;
      state.activeTrip.routeGeometry = routeGeometry || null;
      state.activeTrip.pickupCoords = pickupCoords || null;
      state.activeTrip.dropoffCoords = dropoffCoords || null;
      state.activeTrip.requestedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      this.saveState(state);
      this.broadcast('TRIP_REQUESTED', state.activeTrip);
      this.notifyListeners(state, 'TRIP_REQUESTED', state.activeTrip);

      const requestPayload = {
        quoteId: quoteId || undefined,
        tierId: (tierId || 'moto').toLowerCase(),
        fare: fare ? Math.round(fare) : undefined,
        paymentMethod: paymentMethod || 'CASH',
        stops: params.stops || undefined,
        serviceType: params.serviceType || undefined,
        parcel: params.parcel || params.parcelDetail || undefined,
        parcelDetail: params.parcel || params.parcelDetail || undefined,
        pickup: (pickupCoords && typeof pickupCoords.lat === 'number') ? {
          name: pickupStr,
          lat: pickupCoords.lat,
          lng: pickupCoords.lng
        } : pickupStr,
        destination: (dropoffCoords && typeof dropoffCoords.lat === 'number') ? {
          name: destStr,
          lat: dropoffCoords.lat,
          lng: dropoffCoords.lng
        } : destStr,
        distanceKm: distanceKm || 3.5,
        durationMins: durationMins || 8
      };

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:request', requestPayload, (res) => {
          if (res && res.success && res.trip) {
            const curState = this.getState();
            curState.activeTrip = Object.assign({}, curState.activeTrip, res.trip);
            this.saveState(curState);
            this.broadcast('TRIP_REQUESTED', curState.activeTrip);
            this.notifyListeners(curState, 'TRIP_REQUESTED', curState.activeTrip);
            if (typeof callback === 'function') callback({ success: true, trip: res.trip });
          } else {
            const errorMsg = (res && res.error) ? res.error : 'Trip request failed';
            console.error('[MwendoStateStore] trip:request failed:', errorMsg);
            if (typeof callback === 'function') callback({ success: false, error: errorMsg });
            if (typeof window.showToast === 'function') window.showToast('⚠️ ' + errorMsg);
          }
        });
      } else {
        const errorMsg = 'Not connected to real-time server. Please log in or check connection.';
        console.warn('[MwendoStateStore]', errorMsg);
        if (typeof callback === 'function') callback({ success: false, error: errorMsg });
        if (typeof window.showToast === 'function') window.showToast('⚠️ ' + errorMsg);
      }

      if (window.mwendoSound) window.mwendoSound.playDispatchAlert();
      return state.activeTrip;
    }

    // Tell the server the driver declined the open offer so the next driver is tried right away.
    declineTrip(tripId) {
      if (tripId && this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:decline', { tripId });
      }
    }

    acceptTrip(tripIdOrData, callback) {
      const state = this.getState();
      const id = (typeof tripIdOrData === 'string')
        ? tripIdOrData
        : (tripIdOrData?.tripId || tripIdOrData?.id || state.activeTrip?.id);

      if (!id) {
        if (typeof callback === 'function') callback({ success: false, error: 'tripId is required' });
        return;
      }

      state.activeTrip.id = id;
      state.activeTrip.status = 'DRIVER_ARRIVING';
      state.activeTrip.acceptedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      this.saveState(state);
      this.broadcast('TRIP_ACCEPTED', state.activeTrip);
      this.notifyListeners(state, 'TRIP_ACCEPTED', state.activeTrip);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:accept', { tripId: id }, (res) => {
          if (res && res.success && res.trip) {
            const cur = this.getState();
            cur.activeTrip = Object.assign({}, cur.activeTrip, res.trip);
            this.saveState(cur);
            this.broadcast('TRIP_ACCEPTED', cur.activeTrip);
            this.notifyListeners(cur, 'TRIP_ACCEPTED', cur.activeTrip);
            if (typeof callback === 'function') callback({ success: true, trip: res.trip });
          } else {
            const errorMsg = res?.error || 'Failed to accept trip';
            if (typeof callback === 'function') callback({ success: false, error: errorMsg });
          }
        });
      } else {
        if (typeof callback === 'function') callback({ success: false, error: 'Not connected to server' });
      }

      if (window.mwendoSound) window.mwendoSound.playAcceptChime();
      return state.activeTrip;
    }

    sendDriverLocation(coords) {
      const state = this.getState();
      state.driver.location = coords;
      state.activeTrip.driverLocation = coords;
      this.saveState(state);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:driver_moved', coords);
      }
    }

    driverArrived(tripIdOrData, callback) {
      const state = this.getState();
      const id = (typeof tripIdOrData === 'string')
        ? tripIdOrData
        : (tripIdOrData?.tripId || tripIdOrData?.id || state.activeTrip?.id);

      if (this.socket && this.isRealtimeConnected && id) {
        this.socket.emit('trip:arrived', { tripId: id }, (res) => {
          if (res && res.success && res.trip) {
            const cur = this.getState();
            cur.activeTrip = Object.assign({}, cur.activeTrip, res.trip);
            cur.activeTrip.status = 'ARRIVED';
            this.saveState(cur);
            this.broadcast('DRIVER_ARRIVED', cur.activeTrip);
            this.notifyListeners(cur, 'DRIVER_ARRIVED', cur.activeTrip);
            if (typeof callback === 'function') callback({ success: true, trip: res.trip });
          } else {
            if (typeof callback === 'function') callback({ success: false, error: res?.error || 'Failed to update arrival' });
          }
        });
      } else {
        if (state.activeTrip) state.activeTrip.status = 'ARRIVED';
        this.saveState(state);
        this.broadcast('DRIVER_ARRIVED', state.activeTrip);
        this.notifyListeners(state, 'DRIVER_ARRIVED', state.activeTrip);
        if (typeof callback === 'function') callback({ success: true, trip: state.activeTrip });
      }
    }

    startTransit(data = {}, callback) {
      const state = this.getState();
      const id = (typeof data === 'string')
        ? data
        : (data.tripId || data.id || state.activeTrip?.id);
      const pinStr = (data.pin || state.activeTrip?.pin || '').toString().trim();

      if (!id || !pinStr) {
        const msg = 'tripId and 4-digit PIN required';
        if (typeof callback === 'function') callback({ success: false, error: msg });
        return;
      }

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:start_transit', { tripId: id, pin: pinStr }, (res) => {
          if (res && res.success && res.trip) {
            const cur = this.getState();
            cur.activeTrip = Object.assign({}, cur.activeTrip, res.trip);
            cur.activeTrip.status = 'IN_TRANSIT';
            this.saveState(cur);
            this.broadcast('TRIP_IN_TRANSIT', cur.activeTrip);
            this.notifyListeners(cur, 'TRIP_IN_TRANSIT', cur.activeTrip);
            if (typeof callback === 'function') callback({ success: true, trip: res.trip });
          } else {
            const err = res?.error || 'PIN verification failed';
            if (typeof callback === 'function') callback({ success: false, error: err });
          }
        });
      } else {
        state.activeTrip.status = 'IN_TRANSIT';
        this.saveState(state);
        this.broadcast('TRIP_IN_TRANSIT', state.activeTrip);
        this.notifyListeners(state, 'TRIP_IN_TRANSIT', state.activeTrip);
        if (typeof callback === 'function') callback({ success: true, trip: state.activeTrip });
      }

      return state.activeTrip;
    }

    completeTrip(params = {}, callback) {
      const state = this.getState();
      const id = (typeof params === 'string')
        ? params
        : (params.tripId || params.id || state.activeTrip?.id);
      const paymentMethod = params.paymentMethod || state.activeTrip?.paymentMethod || 'CASH';
      const driverTip = params.driverTip || 0;

      if (this.socket && this.isRealtimeConnected && id) {
        const recipientPin = params.recipientPin || params.deliveryCode || undefined;
        this.socket.emit('trip:complete', { tripId: id, paymentMethod, driverTip, recipientPin, deliveryCode: recipientPin }, (res) => {
          if (res && res.success && res.trip) {
            const cur = this.getState();
            cur.activeTrip = Object.assign({}, cur.activeTrip, res.trip);
            cur.activeTrip.status = 'COMPLETED';
            cur.activeTrip.completedAt = cur.activeTrip.completedAt || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            this.saveState(cur);
            this.broadcast('TRIP_COMPLETED', cur.activeTrip);
            this.notifyListeners(cur, 'TRIP_COMPLETED', cur.activeTrip);
            if (window.mwendoSound) window.mwendoSound.playTripCompleteFanfare();
            if (typeof callback === 'function') callback({ success: true, trip: res.trip });
          } else {
            if (typeof callback === 'function') callback({ success: false, error: res?.error || 'Failed to complete trip' });
          }
        });
      } else {
        state.activeTrip.status = 'COMPLETED';
        state.activeTrip.completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.saveState(state);
        this.broadcast('TRIP_COMPLETED', state.activeTrip);
        this.notifyListeners(state, 'TRIP_COMPLETED', state.activeTrip);
        if (window.mwendoSound) window.mwendoSound.playTripCompleteFanfare();
        if (typeof callback === 'function') callback({ success: true, trip: state.activeTrip });
      }

      return state;
    }

    cancelTrip(reason = 'Cancelled by user', callback) {
      const state = this.getState();
      const id = state.activeTrip?.id;
      state.activeTrip.status = 'IDLE';
      this.saveState(state);
      this.broadcast('TRIP_CANCELLED', { reason });
      this.notifyListeners(state, 'TRIP_CANCELLED', { reason });

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:cancel', { tripId: id, reason }, (res) => {
          if (typeof callback === 'function') callback(res);
        });
      } else if (typeof callback === 'function') {
        callback({ success: true });
      }
    }

    sendChatMessage(sender, text) {
      const msg = {
        sender: sender,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      const state = this.getState();
      state.chatMessages = state.chatMessages || [];
      state.chatMessages.push(msg);
      this.saveState(state);
      this.broadcast('CHAT_MESSAGE', msg);
      this.notifyListeners(state, 'CHAT_MESSAGE', msg);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('chat:send', msg);
      }
    }

    submitRating({ rating, tip, compliments }) {
      const state = this.getState();
      state.activeTrip.rating = rating;
      state.activeTrip.tipAmount = tip;
      state.activeTrip.compliments = compliments || [];

      if (tip > 0) {
        state.rider.walletBalance = Math.max(0, state.rider.walletBalance - tip);
        state.driver.availableBalance += tip;
        state.driver.todayEarnings += tip;

        state.driverSettlements.unshift({
          id: 'DS-TIP-' + Math.floor(100 + Math.random() * 900),
          title: `Passenger Gratuity`,
          amount: tip,
          method: '100% Direct Driver Tip',
          time: 'Just now',
          status: 'Direct Credited'
        });
      }

      this.saveState(state);
      this.broadcast('TRIP_RATED', { rating, tip, compliments });
      this.notifyListeners(state, 'TRIP_RATED', { rating, tip, compliments });

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:rate', { rating, tip, compliments });
      }

      if (window.mwendoSound) window.mwendoSound.playCashRegister();
      return state;
    }

    topUpRiderWallet(amount, provider = 'Airtel Money') {
      const state = this.getState();
      state.rider.walletBalance += amount;
      const tx = {
        id: 'TX-' + Math.floor(100 + Math.random() * 900),
        type: 'TOPUP',
        title: `Top Up from ${provider}`,
        amount: amount,
        method: provider,
        time: 'Just now',
        status: 'Success'
      };
      state.transactionLogs.unshift(tx);

      this.saveState(state);
      this.broadcast('WALLET_TOPPED_UP', { amount, provider });
      this.notifyListeners(state, 'WALLET_TOPPED_UP', { amount, provider });

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('wallet:topup', { amount, provider });
      }

      if (window.mwendoSound) window.mwendoSound.playCashRegister();
      return state.rider.walletBalance;
    }

    cashOutDriver(amount, provider = 'Airtel Money') {
      const state = this.getState();
      if (state.driver.availableBalance < amount) return false;

      state.driver.availableBalance -= amount;
      state.driverSettlements.unshift({
        id: 'DS-WD-' + Math.floor(100 + Math.random() * 900),
        title: `Cashout to ${provider}`,
        amount: -amount,
        method: provider,
        time: 'Just now',
        status: 'Settled to Mobile Phone'
      });

      this.saveState(state);
      this.broadcast('DRIVER_CASHOUT', { amount, provider });
      this.notifyListeners(state, 'DRIVER_CASHOUT', { amount, provider });
      if (window.mwendoSound) window.mwendoSound.playCashRegister();
      return true;
    }

    setDriverStatus(status) {
      const state = this.getState();
      state.driver.status = status;
      this.saveState(state);
      this.broadcast('DRIVER_STATUS', status);
      this.notifyListeners(state, 'DRIVER_STATUS', status);
    }

    // Sends an SOS to the Aarohan safety team with the active trip and the best GPS fix.
    // Path 1: the live socket. Path 2 (backup): HTTP POST /api/sos, used when the socket is down
    // or does not confirm in time. Resolves with { delivered, alert?, error? }: callers MUST tell
    // the user the truth (never claim help is coming unless the server confirmed it).
    triggerSOS(source, note = 'Emergency assistance requested') {
      const state = this.getState();
      const tripId = state && state.activeTrip && state.activeTrip.id ? state.activeTrip.id : undefined;

      const viaHttp = async (payload) => {
        try {
          const auth = window.aarohanAuth;
          const call = auth && auth.fetchWithAuth ? auth.fetchWithAuth.bind(auth) : fetch;
          const res = await call('/api/sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const body = await res.json().catch(() => ({}));
          if (res.ok && body.success) return { delivered: true, alert: body.alert, duplicate: !!body.duplicate, via: 'http' };
          return { delivered: false, error: body.error || `HTTP ${res.status}` };
        } catch (e) {
          return { delivered: false, error: e.message || 'Network error' };
        }
      };

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

        const send = (coords) => {
          const payload = { source, note, tripId };
          if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) {
            payload.lat = coords.latitude;
            payload.lng = coords.longitude;
          }

          if (!this.socket || !this.isRealtimeConnected) {
            viaHttp(payload).then(finish);
            return;
          }
          this.socket.timeout(8000).emit('sos:trigger', payload, (err, res) => {
            if (err || !res || !res.success) {
              // No confirmation from the socket: try the HTTP backup. The server de-duplicates,
              // so a request that actually arrived the first time is not raised twice.
              viaHttp(payload).then(finish);
              return;
            }
            finish({ delivered: true, alert: res.alert, duplicate: !!res.duplicate, via: 'socket' });
          });
        };

        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => send(pos.coords),
            () => send(null),
            { enableHighAccuracy: true, timeout: 4000, maximumAge: 15000 }
          );
        } else {
          send(null);
        }
      });
    }

    resolveSOS(id) {
      const state = this.getState();
      state.emergencyAlerts = state.emergencyAlerts.filter(a => a.id !== id);
      this.saveState(state);
      this.broadcast('SOS_RESOLVED', id);
      this.notifyListeners(state, 'SOS_RESOLVED', id);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('sos:resolve', id);
      }
    }

    updateSurge(zone, multiplier) {
      const state = this.getState();
      state.surgeMultipliers[zone] = parseFloat(multiplier);
      this.saveState(state);
      this.broadcast('SURGE_UPDATED', { zone, multiplier });
      this.notifyListeners(state, 'SURGE_UPDATED', { zone, multiplier });

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('surge:update', { zone, multiplier });
      }
    }

    resolveTicket(id) {
      const state = this.getState();
      const t = state.supportTickets.find(item => item.id === id);
      if (t) {
        t.status = 'Resolved & Refunded (MWK 3,200 credited)';
        state.rider.walletBalance += t.amount;
        state.transactionLogs.unshift({
          id: 'TX-REF-' + id,
          type: 'REFUND',
          title: `Refund for Ticket #${id}`,
          amount: t.amount,
          method: 'Mwendo Care Credit',
          time: 'Just now',
          status: 'Resolved'
        });
      }
      this.saveState(state);
      this.broadcast('TICKET_RESOLVED', id);
      this.notifyListeners(state, 'TICKET_RESOLVED', id);
      if (window.mwendoSound) window.mwendoSound.playCashRegister();
    }

    resetAll() {
      this.saveState(defaultInitialState);
      this.broadcast('STATE_RESET', defaultInitialState);
      this.notifyListeners(defaultInitialState, 'STATE_RESET', null);
      if (window.mwendoSound) window.mwendoSound.playAcceptChime();
    }
  }

  window.mwendoStore = new MwendoStateStore();
  window.gamanStore = window.mwendoStore;
  window.aarohanStore = window.mwendoStore;
})(window);
