// Mwendo Real-Time Cross-App & WebSocket State Bus
(function(window) {
  'use strict';

  const STORAGE_KEY = 'mwendo_app_state_v1';
  const CHANNEL_NAME = 'mwendo_realtime_channel';

  const defaultInitialState = {
    rider: {
      name: 'Chisomo Banda',
      phone: '+265 99 123 4567',
      walletBalance: 38500,
      rating: 4.90,
      tripsCompleted: 24,
      kycTier: 'KYC Tier 1 (Verified)'
    },
    driver: {
      name: 'Chikondi Phiri',
      phone: '+265 99 554 1122',
      plate: 'BW 4920',
      car: 'White Toyota Passo',
      rating: 4.92,
      tripsCompleted: 1420,
      availableBalance: 142800,
      todayEarnings: 42500,
      todayTrips: 8,
      status: 'ONLINE',
      kycTier: 'Verified Gaman Pro Captain',
      location: { lat: -13.9650, lng: 33.7820, heading: 45 }
    },
    activeTrip: {
      id: 'TRIP-LL-9821',
      status: 'IDLE', // IDLE, REQUESTED, ACCEPTED, EN_ROUTE, ARRIVED, IN_TRANSIT, COMPLETED
      pickup: 'Area 47 Sector 3, Kaunda Road',
      pickupLandmark: 'Near Green Pharmacy',
      destination: 'Gateway Mall, Kaunda Rd',
      destinationLandmark: 'Main Entrance Drop Zone',
      tier: 'Gaman Cab',
      baseFare: 6200,
      discount: 0,
      finalFare: 6200,
      paymentMethod: 'Airtel Money Locked',
      paymentRef: 'AM-MW-9821401',
      pin: '8421',
      distanceKm: 6.8,
      durationMins: 18,
      etaMins: 3,
      driverLocation: { lat: -13.9650, lng: 33.7820 },
      requestedAt: null,
      acceptedAt: null,
      completedAt: null,
      rating: 5,
      tipAmount: 1000,
      compliments: ['Smooth Driving', 'Clean Car', 'Polite & Friendly']
    },
    chatMessages: [
      { sender: 'driver', text: 'Moni Chisomo! I am on Kenyatta Drive approaching Area 47 Sector 3.', time: '14:21' }
    ],
    surgeMultipliers: {
      'Gateway Mall': 1.4,
      'Area 3 Commercial': 1.3,
      'Old Town Market': 1.2,
      'Area 47 Sector 3': 1.0,
      'Bingu Stadium': 1.1
    },
    emergencyAlerts: [],
    supportTickets: [
      {
        id: 'MW-8821',
        user: 'Chisomo Banda',
        issue: 'Payment Dispute (Duplicate Airtel Money Entry)',
        amount: 3200,
        status: 'Under Review',
        assigned: 'Lilongwe Finance Team',
        updated: '1 hour ago'
      }
    ],
    transactionLogs: [
      { id: 'TX-101', type: 'TRIP', title: 'Trip to Gateway Mall', amount: -6200, method: 'Airtel Money', time: 'Today 14:30', status: 'Completed' },
      { id: 'TX-102', type: 'TOPUP', title: 'Top Up from TNM Mpamba', amount: 20000, method: 'TNM Mpamba', time: 'Yesterday 09:15', status: 'Success' },
      { id: 'TX-103', type: 'TRIP', title: 'Kabaza: Old Town Market', amount: -2500, method: 'Gaman Cash', time: '2 days ago', status: 'Completed' }
    ],
    driverSettlements: [
      { id: 'DS-201', title: 'Gateway Mall to Area 47', amount: 5270, method: 'Airtel Money credit', time: 'Today 14:42', status: 'Instant Settled' },
      { id: 'DS-202', title: 'City Center to Old Town', amount: 3400, method: 'Cash trip recorded', time: 'Today 12:15', status: 'Cash In Pocket' }
    ]
  };

  class MwendoStateStore {
    constructor() {
      this.listeners = [];
      this.channel = null;
      this.socket = null;
      this.isRealtimeConnected = false;

      // 1. Fetch initial state from server API immediately for 0-latency hydration
      this.fetchInitialState();

      // 2. Initialize WebSocket Connection
      this.initSocketIo();

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

    fetchInitialState() {
      const origin = (window.location.protocol.startsWith('http')) ? window.location.origin : 'http://localhost:3000';
      fetch(`${origin}/api/trips/active`)
        .then(r => r.json())
        .then(serverState => {
          if (serverState) {
            this.saveState(serverState);
            this.notifyListeners(serverState, 'SYNC', null);
          }
        })
        .catch(err => console.warn('Could not fetch initial server state:', err));
    }

    initSocketIo() {
      // Connect to Socket.IO if available
      const setupSocket = () => {
        if (typeof window.io === 'function' && !this.socket) {
          try {
            const origin = (window.location.protocol.startsWith('http')) ? window.location.origin : 'http://localhost:3000';
            this.socket = window.io(origin, {
              reconnectionAttempts: 15,
              reconnectionDelay: 1000,
              timeout: 6000
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
              if (serverState) {
                this.saveState(serverState);
                this.notifyListeners(serverState, 'SYNC', null);
              }
            });

            // Real-Time Events
            this.socket.on('trip:requested', (trip) => {
              const state = this.getState();
              state.activeTrip = trip;
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_REQUESTED', trip);
              if (window.mwendoSound) window.mwendoSound.playDispatchAlert();
            });

            this.socket.on('trip:accepted', (payload) => {
              const state = this.getState();
              state.activeTrip = payload.trip || state.activeTrip;
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
              state.activeTrip = trip;
              this.saveState(state);
              this.notifyListeners(state, 'DRIVER_ARRIVED', trip);
              if (window.mwendoSound) window.mwendoSound.playTone(600, 'triangle', 0.2);
            });

            this.socket.on('trip:in_transit', (trip) => {
              const state = this.getState();
              state.activeTrip = trip;
              this.saveState(state);
              this.notifyListeners(state, 'TRIP_IN_TRANSIT', trip);
            });

            this.socket.on('trip:completed', (payload) => {
              const state = this.getState();
              state.activeTrip = payload.trip || state.activeTrip;
              if (payload.rider) state.rider = payload.rider;
              if (payload.driver) state.driver = payload.driver;
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
        if (parsed && parsed.activeTrip) {
          if (parsed.activeTrip.destination && typeof parsed.activeTrip.destination !== 'string') {
            parsed.activeTrip.destination = parsed.activeTrip.destination.name || parsed.activeTrip.destination.address || 'Destination';
          }
          if (parsed.activeTrip.pickup && typeof parsed.activeTrip.pickup !== 'string') {
            parsed.activeTrip.pickup = parsed.activeTrip.pickup.name || parsed.activeTrip.pickup.address || 'Pickup Point';
          }
        }
        return parsed;
      } catch (e) {
        return defaultInitialState;
      }
    }

    saveState(state) {
      try {
        if (state && state.activeTrip) {
          if (state.activeTrip.destination && typeof state.activeTrip.destination !== 'string') {
            state.activeTrip.destination = state.activeTrip.destination.name || state.activeTrip.destination.address || 'Destination';
          }
          if (state.activeTrip.pickup && typeof state.activeTrip.pickup !== 'string') {
            state.activeTrip.pickup = state.activeTrip.pickup.name || state.activeTrip.pickup.address || 'Pickup Point';
          }
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

    requestTrip({ pickup, destination, tier, fare, paymentMethod, distanceKm, quoteId, tierId, routeGeometry, durationMins, pickupCoords, dropoffCoords }) {
      const state = this.getState();
      state.activeTrip.status = 'REQUESTED';
      const pickupStr = (typeof pickup === 'string') ? pickup : (pickup?.name || pickup?.address || state.activeTrip.pickup || 'Pickup');
      const destStr = (typeof destination === 'string') ? destination : (destination?.name || destination?.address || state.activeTrip.destination || 'Destination');
      state.activeTrip.pickup = pickupStr;
      state.activeTrip.destination = destStr;
      state.activeTrip.tier = tier || state.activeTrip.tier;
      state.activeTrip.tierId = tierId || 'moto';
      state.activeTrip.quoteId = quoteId || null;
      state.activeTrip.finalFare = fare || state.activeTrip.finalFare;
      state.activeTrip.paymentMethod = paymentMethod || state.activeTrip.paymentMethod;
      state.activeTrip.distanceKm = distanceKm || 6.8;
      state.activeTrip.durationMins = durationMins || 15;
      state.activeTrip.routeGeometry = routeGeometry || null;
      state.activeTrip.pickupCoords = pickupCoords || null;
      state.activeTrip.dropoffCoords = dropoffCoords || null;
      state.activeTrip.requestedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      state.activeTrip.pin = Math.floor(1000 + Math.random() * 9000).toString();

      this.saveState(state);
      this.broadcast('TRIP_REQUESTED', state.activeTrip);
      this.notifyListeners(state, 'TRIP_REQUESTED', state.activeTrip);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:request', state.activeTrip);
      }

      if (window.mwendoSound) window.mwendoSound.playDispatchAlert();
      return state.activeTrip;
    }

    acceptTrip() {
      const state = this.getState();
      state.activeTrip.status = 'ACCEPTED';
      state.activeTrip.acceptedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      this.saveState(state);
      this.broadcast('TRIP_ACCEPTED', state.activeTrip);
      this.notifyListeners(state, 'TRIP_ACCEPTED', state.activeTrip);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:accept', state.activeTrip);
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

    driverArrived() {
      const state = this.getState();
      state.activeTrip.status = 'ARRIVED';
      this.saveState(state);
      this.broadcast('DRIVER_ARRIVED', state.activeTrip);
      this.notifyListeners(state, 'DRIVER_ARRIVED', state.activeTrip);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:arrived');
      }
    }

    startTransit() {
      const state = this.getState();
      state.activeTrip.status = 'IN_TRANSIT';

      this.saveState(state);
      this.broadcast('TRIP_IN_TRANSIT', state.activeTrip);
      this.notifyListeners(state, 'TRIP_IN_TRANSIT', state.activeTrip);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:start_transit');
      }

      return state.activeTrip;
    }

    completeTrip() {
      const state = this.getState();
      state.activeTrip.status = 'COMPLETED';
      state.activeTrip.completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const fare = state.activeTrip.finalFare || 6200;
      const netDriverEarnings = Math.round(fare * 0.70); // 70% Driver Share
      const platformCommission = fare - netDriverEarnings; // 30% Gaman Commission

      state.rider.walletBalance = Math.max(0, state.rider.walletBalance - fare);
      state.rider.tripsCompleted += 1;

      state.driver.availableBalance += netDriverEarnings;
      state.driver.todayEarnings += netDriverEarnings;
      state.driver.todayTrips += 1;
      state.driver.tripsCompleted += 1;

      const destStr = typeof state.activeTrip.destination === 'string'
        ? state.activeTrip.destination
        : (state.activeTrip.destination?.name || state.activeTrip.destination?.address || 'Destination');
      const pickupStr = typeof state.activeTrip.pickup === 'string'
        ? state.activeTrip.pickup
        : (state.activeTrip.pickup?.name || state.activeTrip.pickup?.address || 'Pickup');
      const methodStr = typeof state.activeTrip.paymentMethod === 'string'
        ? state.activeTrip.paymentMethod.split(' ')[0]
        : 'Digital';

      state.transactionLogs.unshift({
        id: 'TX-' + Math.floor(100 + Math.random() * 900),
        type: 'TRIP',
        title: `Trip to ${destStr.split(',')[0]}`,
        amount: -fare,
        method: methodStr,
        time: 'Just now',
        status: 'Completed'
      });

      state.driverSettlements.unshift({
        id: 'DS-' + Math.floor(200 + Math.random() * 800),
        title: `${pickupStr.split(',')[0]} to ${destStr.split(',')[0]}`,
        amount: netDriverEarnings,
        method: '70% Driver Share (30% AArohan Escrow)',
        time: 'Just now',
        status: 'Instant Settled'
      });

      this.saveState(state);
      this.broadcast('TRIP_COMPLETED', state.activeTrip);
      this.notifyListeners(state, 'TRIP_COMPLETED', state.activeTrip);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:complete');
      }

      if (window.mwendoSound) window.mwendoSound.playTripCompleteFanfare();
      return state;
    }

    cancelTrip(reason = 'Cancelled by user') {
      const state = this.getState();
      state.activeTrip.status = 'IDLE';
      this.saveState(state);
      this.broadcast('TRIP_CANCELLED', { reason });
      this.notifyListeners(state, 'TRIP_CANCELLED', { reason });

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('trip:cancel', reason);
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
          title: `Passenger Gratuity (Chisomo)`,
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

    triggerSOS(source, note = 'Emergency assistance requested on corridor') {
      const state = this.getState();
      const alertItem = {
        id: 'SOS-' + Date.now().toString().slice(-4),
        source: source,
        passenger: state.rider.name,
        driver: state.driver.name,
        location: 'Kenyatta Drive, Lilongwe',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'ACTIVE_DISPATCH_ALERT',
        note: note
      };
      state.emergencyAlerts.unshift(alertItem);

      this.saveState(state);
      this.broadcast('EMERGENCY_SOS', alertItem);
      this.notifyListeners(state, 'EMERGENCY_SOS', alertItem);

      if (this.socket && this.isRealtimeConnected) {
        this.socket.emit('sos:trigger', { source, note });
      }

      if (window.mwendoSound) window.mwendoSound.playEmergencyAlarm();
      return alertItem;
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
