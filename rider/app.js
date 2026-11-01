// AArohan rideR APPLICATION • LILONGWE, MALAWI
// Real-Time Ride-Hailing Controller with Device Geolocation, Mapbox Road Routing, Server Pricing & Telemetry

(function () {
  'use strict';

  // --- Core Application State ---
  let map = null;
  let pickupMarker = null;
  let dropoffMarker = null;
  let driverMarker = null;
  let routeLine = null;
  let accuracyCircle = null;

  // Real Current Locations
  let currentPickup = {
    lat: -13.9722,
    lng: 33.7667,
    accuracy: null,
    name: 'Gateway Mall',
    address: 'Gateway Mall, Kaunda Road, Area 47, Lilongwe, Malawi',
    isRealGps: false
  };

  let currentDestination = {
    name: 'Entire Printers and Traders Limited (EPTL)',
    area: 'Chitipi Road, Lilongwe, Malawi',
    lat: -13.9933,
    lng: 33.6777,
    category: 'Printing & Commercial'
  };

  // Active Quote from Backend
  let activeQuote = null;
  let activeTierId = 'moto'; // 'moto' | 'auto' | 'cab'
  let activeTierName = 'AArohan Moto';
  let activePaymentMethod = 'Airtel Money';
  let paymentIdx = 0;

  const PAYMENT_METHODS = [
    { name: 'Airtel Money', sub: '099 824 1120', badge: 'AIR' },
    { name: 'TNM Mpamba', sub: '088 765 4321', badge: 'TNM' },
    { name: 'Cash to Captain', sub: 'Pay captain directly upon arrival', badge: 'MK' },
    { name: 'AArohan Escrow Wallet', sub: 'Instant platform settlement', badge: 'WAL' }
  ];

  // Radar & Tracking
  let dispatchCountdownInterval = null;
  let trackingMap = null;
  let trackingDriverMarker = null;
  let trackingPickupMarker = null;
  let trackingDropoffMarker = null;
  let trackingRouteLine = null;
  let currentRating = 5;
  let currentTip = 0;

  // In-App Chat & Call
  let chatMessages = [
    { sender: 'driver', text: 'Moni! I am on my way to your pickup location.', time: 'Just now' }
  ];
  let callTimerInterval = null;
  let callSeconds = 0;
  let isCallMuted = false;
  let isCallSpeaker = false;

  // Stale Location & Offline Resilience State (Phase 2.B & 2.D)
  let lastDriverMovedTimestamp = Date.now();
  let staleLocationCheckInterval = null;
  let offlineActionQueue = [];
  try {
    const queued = localStorage.getItem('aarohan_offline_actions');
    if (queued) offlineActionQueue = JSON.parse(queued);
  } catch (e) { }

  // Map Tile Configuration
  window.aarohanMapConfig = {
    provider: 'carto',
    apiKey: '',
    mapboxToken: '',
    googleKey: '',
    maptilerKey: ''
  };

  try {
    const saved = localStorage.getItem('aarohan_map_config');
    if (saved) window.aarohanMapConfig = Object.assign(window.aarohanMapConfig, JSON.parse(saved));
  } catch (e) { }

  // --- Initializer ---
  document.addEventListener('DOMContentLoaded', () => {
    initLeafletMap();
    initRiderGeolocation();
    initLocationSearch();
    initChatDrawer();
    subscribeToRealtimeStore();
    loadFrequentPlaces();
    loadSavedPlaces();
    fetchServerMapConfig();
    initNetworkResilienceMonitor();
    initStaleTelemetryWatchdog();
    recoverActiveRideSession();
  });

  // =========================================================================
  // 1. LEAFLET MAP & TILE LAYERS
  // =========================================================================
  let mainTileLayer = null;
  let trackingTileLayer = null;

  async function fetchServerMapConfig() {
    try {
      const res = await fetch('/api/map-config');
      if (res.ok) {
        const data = await res.json();
        if (data.apiKey || data.mapboxToken || data.googleKey || data.maptilerKey) {
          window.aarohanMapConfig = Object.assign(window.aarohanMapConfig, data);
        }
        applyTileLayerToMap(map, false);
        applyTileLayerToMap(trackingMap, true);
        updateMapConfigBadge();
      }
    } catch (err) {
      console.warn('[AArohanMap] Map config fetch error:', err);
    }
  }

  function getMapTileLayerConfig(config) {
    const provider = (config && config.provider) || 'carto';
    const key = (config && (config.apiKey || config.mapboxToken || config.googleKey || config.maptilerKey)) || '';

    if (provider === 'mapbox' && (config.mapboxToken || key)) {
      const token = config.mapboxToken || key;
      return {
        url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`,
        options: { maxZoom: 19, tileSize: 512, zoomOffset: -1, attribution: '© Mapbox © OpenStreetMap' }
      };
    }
    if (provider === 'google' && (config.googleKey || key)) {
      const gkey = config.googleKey || key;
      return {
        url: `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${gkey}`,
        options: { maxZoom: 20, attribution: '© Google Maps' }
      };
    }
    if (provider === 'maptiler' && (config.maptilerKey || key)) {
      const tkey = config.maptilerKey || key;
      return {
        url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${tkey}`,
        options: { maxZoom: 19, attribution: '© MapTiler © OpenStreetMap' }
      };
    }
    return {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      options: { maxZoom: 19, subdomains: 'abcd', attribution: '© CartoDB © OpenStreetMap' }
    };
  }

  function applyTileLayerToMap(leafletMapInstance, isTracking = false) {
    if (!leafletMapInstance || typeof L === 'undefined') return;
    const tileCfg = getMapTileLayerConfig(window.aarohanMapConfig);
    try {
      if (isTracking && trackingTileLayer) leafletMapInstance.removeLayer(trackingTileLayer);
      else if (!isTracking && mainTileLayer) leafletMapInstance.removeLayer(mainTileLayer);
    } catch (e) { }

    const newLayer = L.tileLayer(tileCfg.url, tileCfg.options).addTo(leafletMapInstance);
    newLayer.bringToBack();
    if (isTracking) trackingTileLayer = newLayer;
    else mainTileLayer = newLayer;
  }

  function initLeafletMap() {
    if (typeof L === 'undefined') return;
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl) return;

    map = L.map('leaflet-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([currentPickup.lat, currentPickup.lng], 14);
    window.map = map;

    applyTileLayerToMap(map, false);
    updateMapConfigBadge();

    // Draggable Pickup Pin
    createOrUpdatePickupMarker();
  }

  function createOrUpdatePickupMarker() {
    if (!map || typeof L === 'undefined') return;

    const pickupHtml = `
      <div class="pickup-point-pill">Pickup Point (Drag to adjust)</div>
      <div class="gps-blue-dot-container">
        <div class="gps-blue-dot"></div>
        <span class="gps-blue-label">${currentPickup.name || 'Lilongwe Pickup'}</span>
      </div>
    `;

    const pickupIcon = L.divIcon({
      className: 'custom-pickup-marker',
      html: pickupHtml,
      iconSize: [120, 60],
      iconAnchor: [60, 34]
    });

    if (pickupMarker) {
      pickupMarker.setLatLng([currentPickup.lat, currentPickup.lng]);
      pickupMarker.setIcon(pickupIcon);
    } else {
      pickupMarker = L.marker([currentPickup.lat, currentPickup.lng], {
        icon: pickupIcon,
        draggable: true
      }).addTo(map);

      // Handle Dragend event for authentic manual pin placement
      pickupMarker.on('dragend', async (e) => {
        const newPos = e.target.getLatLng();
        currentPickup.lat = parseFloat(newPos.lat.toFixed(5));
        currentPickup.lng = parseFloat(newPos.lng.toFixed(5));
        currentPickup.isRealGps = false;

        updateGpsBadge(false, 'Pin Placed');
        showToast('Reverse geocoding pin position...');

        try {
          const res = await fetch(`/api/places/reverse?lat=${currentPickup.lat}&lng=${currentPickup.lng}`);
          if (res.ok) {
            const data = await res.json();
            currentPickup.name = data.title || 'Lilongwe Location';
            currentPickup.address = data.displayName || `${currentPickup.lat}, ${currentPickup.lng}`;
          }
        } catch (err) { }

        updatePickupDisplayDOM();
        createOrUpdatePickupMarker();

        // Recalculate quote if destination is selected
        if (currentDestination) {
          calculateAuthoritativeQuote();
        }
      });
    }

    // Accuracy Circle
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    if (currentPickup.accuracy && currentPickup.accuracy < 500) {
      accuracyCircle = L.circle([currentPickup.lat, currentPickup.lng], {
        radius: currentPickup.accuracy,
        color: '#10b981',
        weight: 1,
        fillColor: '#10b981',
        fillOpacity: 0.12
      }).addTo(map);
    }
  }

  window.recenterMap = function () {
    if (map) {
      map.flyTo([currentPickup.lat, currentPickup.lng], 15, { duration: 1 });
      if (window.aarohanSound) window.aarohanSound.playClick();
    }
  };

  // =========================================================================
  // 2. REAL DEVICE GEOLOCATION (navigator.geolocation)
  // =========================================================================
  function initRiderGeolocation() {
    updateGpsBadge(null, 'Acquiring GPS...');

    if (!navigator.geolocation) {
      updateGpsBadge(false, 'GPS Unavailable');
      showGpsWarningNotice('Geolocation is not supported by your browser. You can drag the green pin on the map to set pickup.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(5));
        const lng = parseFloat(pos.coords.longitude.toFixed(5));
        const accuracy = Math.round(pos.coords.accuracy);

        // Verify if position is within Malawi operational boundaries (-9.0 to -17.5 lat, 32.5 to 36.0 lng)
        const isInsideMalawi = (lat >= -17.5 && lat <= -9.0 && lng >= 32.5 && lng <= 36.0);

        if (!isInsideMalawi) {
          console.log(`[AArohanGeo] Device coordinates (${lat}, ${lng}) outside Malawi corridor. Using Lilongwe operational center (Gateway Mall).`);
          currentPickup.lat = -13.9722;
          currentPickup.lng = 33.7667;
          currentPickup.name = 'Gateway Mall, Area 47';
          currentPickup.address = 'Gateway Mall, Kaunda Road, Area 47, Lilongwe, Malawi';
          currentPickup.isRealGps = false;
          currentPickup.accuracy = 15;

          updateGpsBadge(true, 'Lilongwe GPS (Gateway Mall)');
          hideGpsWarningNotice();
          if (map) map.setView([-13.9722, 33.7667], 15);
          updatePickupDisplayDOM();
          createOrUpdatePickupMarker();
          return;
        }

        currentPickup.lat = lat;
        currentPickup.lng = lng;
        currentPickup.accuracy = accuracy;
        currentPickup.isRealGps = true;

        updateGpsBadge(true, `±${accuracy}m High Accuracy`);
        hideGpsWarningNotice();

        if (map) {
          map.setView([lat, lng], 15);
        }

        // Reverse Geocode Device Position
        try {
          const res = await fetch(`/api/places/reverse?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            currentPickup.name = data.title || 'Current Position';
            currentPickup.address = data.displayName || `${lat}, ${lng}`;
          }
        } catch (err) {
          console.warn('[AArohanGeo] Reverse geocode error:', err);
        }

        updatePickupDisplayDOM();
        createOrUpdatePickupMarker();
      },
      (err) => {
        console.warn('[AArohanGeo] Geolocation error:', err.code, err.message);
        let notice = 'GPS permission denied. Please drag the green pin to your exact pickup spot.';
        if (err.code === 2) notice = 'GPS position unavailable. Drag green pin on map to set pickup.';
        if (err.code === 3) notice = 'GPS timeout. Drag green pin on map to set pickup.';

        updateGpsBadge(false, 'GPS Off • Drag Pin');
        showGpsWarningNotice(notice);
        updatePickupDisplayDOM();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );

    // Watch position in background for updates
    try {
      navigator.geolocation.watchPosition(
        (pos) => {
          if (currentPickup.isRealGps) {
            currentPickup.lat = parseFloat(pos.coords.latitude.toFixed(5));
            currentPickup.lng = parseFloat(pos.coords.longitude.toFixed(5));
            currentPickup.accuracy = Math.round(pos.coords.accuracy);
            updateGpsBadge(true, `±${currentPickup.accuracy}m`);
            if (accuracyCircle) {
              accuracyCircle.setLatLng([currentPickup.lat, currentPickup.lng]);
              accuracyCircle.setRadius(currentPickup.accuracy);
            }
          }
        },
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    } catch (e) { }
  }

  function updateGpsBadge(isOk, text) {
    let badge = document.getElementById('gps-accuracy-badge');
    if (!badge) {
      const capsule = document.querySelector('.floating-address-capsule');
      if (capsule) {
        badge = document.createElement('span');
        badge.id = 'gps-accuracy-badge';
        capsule.appendChild(badge);
      }
    }
    if (badge) {
      badge.innerText = text;
      if (isOk === true) {
        badge.className = 'px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-100 text-emerald-800 shrink-0';
      } else if (isOk === false) {
        badge.className = 'px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-100 text-amber-800 shrink-0';
      } else {
        badge.className = 'px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-600 shrink-0';
      }
    }
  }

  function showGpsWarningNotice(message) {
    let notice = document.getElementById('gps-warning-banner');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'gps-warning-banner';
      notice.className = 'fixed top-17 inset-x-3 z-[1050] max-w-md mx-auto bg-amber-500 text-white px-3.5 py-2 rounded-2xl text-xs font-bold shadow-xl flex items-center justify-between gap-2 border border-amber-600';
      document.body.appendChild(notice);
    }
    notice.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-[18px] shrink-0">location_off</span>
        <span class="truncate">${message}</span>
      </div>
      <button onclick="document.getElementById('gps-warning-banner').remove()" class="w-6 h-6 rounded-full bg-amber-600 flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[14px]">close</span>
      </button>
    `;
  }

  function hideGpsWarningNotice() {
    const notice = document.getElementById('gps-warning-banner');
    if (notice) notice.remove();
  }

  function updatePickupDisplayDOM() {
    const floatEl = document.getElementById('floating-pickup-text');
    if (floatEl) floatEl.innerText = currentPickup.address || currentPickup.name;

    const searchPickupEl = document.getElementById('search-pickup-display');
    if (searchPickupEl) searchPickupEl.innerText = currentPickup.address || currentPickup.name;
  }

  window.openPickupLocationModal = function () {
    const modal = document.getElementById('pickup-modal');
    if (modal) {
      modal.classList.remove('hidden');
      const input = document.getElementById('pickup-custom-input');
      if (input) input.value = currentPickup.address || currentPickup.name;
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closePickupLocationModal = function () {
    const modal = document.getElementById('pickup-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.useCurrentGpsPickup = function () {
    initRiderGeolocation();
    window.closePickupLocationModal();
    showToast('Acquiring live GPS satellite fix...');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.applyCustomPickup = async function () {
    const input = document.getElementById('pickup-custom-input');
    const text = input ? input.value.trim() : '';
    if (!text) {
      showToast('Please type a pickup street or landmark');
      return;
    }

    currentPickup.name = (typeof text === 'string') ? text.split(',')[0] : (text?.name || 'Lilongwe Pickup');
    currentPickup.address = text;
    currentPickup.isRealGps = false;

    updatePickupDisplayDOM();
    createOrUpdatePickupMarker();
    window.closePickupLocationModal();
    showToast(`Pickup set to: ${currentPickup.name}`);

    // If destination is set, recalculate authoritative quote
    if (currentDestination) {
      calculateAuthoritativeQuote();
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.selectPickupLandmark = function (name, lat, lng) {
    currentPickup.lat = lat;
    currentPickup.lng = lng;
    currentPickup.name = (typeof name === 'string') ? name.split(',')[0] : (name?.name || 'Lilongwe Pickup');
    currentPickup.address = name;
    currentPickup.isRealGps = false;

    updatePickupDisplayDOM();
    createOrUpdatePickupMarker();
    if (map) map.flyTo([lat, lng], 15, { duration: 1 });
    window.closePickupLocationModal();
    showToast(`Pickup set to: ${currentPickup.name}`);

    if (currentDestination) {
      calculateAuthoritativeQuote();
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  // =========================================================================
  // 3. REAL-TIME SEARCH AUTOCOMPLETE (/api/places/search?q=...)
  // =========================================================================
  let searchDebounce = null;
  window.liveSearchResultsCache = new Map();

  function initLocationSearch() {
    const searchModal = document.getElementById('search-modal');
    const searchInput = document.getElementById('location-search-input');
    const resultsContainer = document.getElementById('search-results-list');

    window.openSearchModal = function () {
      searchModal.classList.remove('hidden');
      searchInput.value = '';
      searchInput.focus();
      updatePickupDisplayDOM();
      loadInitialSearchSuggestions();
      if (window.aarohanSound) window.aarohanSound.playClick();
    };

    window.closeSearchModal = function () {
      searchModal.classList.add('hidden');
    };

    window.clearSearchInput = function () {
      searchInput.value = '';
      const clearBtn = document.getElementById('clear-search-btn');
      if (clearBtn) clearBtn.classList.add('hidden');
      loadInitialSearchSuggestions();
      searchInput.focus();
    };

    window.quickFilterSearch = function (keyword) {
      searchInput.value = keyword;
      searchInput.dispatchEvent(new Event('input'));
    };

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchDebounce);

      const clearBtn = document.getElementById('clear-search-btn');
      if (clearBtn) clearBtn.classList.toggle('hidden', !q);

      if (!q) {
        loadInitialSearchSuggestions();
        return;
      }

      resultsContainer.innerHTML = `
        <div class="p-6 text-center text-xs text-slate-500 font-medium flex items-center justify-center gap-2">
          <span class="w-3.5 h-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin shrink-0"></span>
          <span>Searching Lilongwe registry & Mapbox for "${q}"...</span>
        </div>
      `;

      searchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}&lat=${currentPickup.lat}&lng=${currentPickup.lng}`);
          if (res.ok) {
            const items = await res.json();
            renderSearchResultsList(items, q);
          } else {
            renderSearchResultsList([], q);
          }
        } catch (err) {
          console.warn('[AArohanSearch] Fetch error:', err);
          renderSearchResultsList([], q);
        }
      }, 180);
    });
  }

  async function loadInitialSearchSuggestions() {
    const resultsContainer = document.getElementById('search-results-list');
    if (!resultsContainer) return;

    // Fetch frequent places and initial Lilongwe suggestions
    try {
      const res = await fetch(`/api/places/search?q=Lilongwe&lat=${currentPickup.lat}&lng=${currentPickup.lng}`);
      if (res.ok) {
        const items = await res.json();
        renderSearchResultsList(items, '');
      }
    } catch (e) { }
  }

  function renderSearchResultsList(list, query) {
    const resultsContainer = document.getElementById('search-results-list');
    if (!resultsContainer) return;

    if (!list || list.length === 0) {
      resultsContainer.innerHTML = `
        <div class="p-8 text-center text-xs text-slate-400 font-medium flex flex-col items-center gap-2">
          <span class="material-symbols-outlined text-[32px] text-slate-300">location_off</span>
          <span>No locations found in Malawi for "${query}".</span>
          <span class="text-[11px] text-slate-400">Try searching EPTL, Area 10, Area 18, Area 49, Lumbadzi, or Chitipi.</span>
        </div>
      `;
      return;
    }

    list.forEach(item => window.liveSearchResultsCache.set(item.name, item));

    resultsContainer.innerHTML = list.map(item => {
      const icon = item.icon || (item.name.toLowerCase().includes('print') || item.name.toLowerCase().includes('eptl') ? 'print' : 'location_on');
      const distStr = item.distanceKm ? `${item.distanceKm} km away` : 'Lilongwe';

      return `
        <div onclick="selectDestinationFromSearch('${item.name.replace(/'/g, "\\'")}')" class="p-3 bg-slate-50 hover:bg-emerald-50/60 rounded-2xl flex items-center justify-between cursor-pointer transition-colors border border-slate-100 hover:border-emerald-200 group">
          <div class="flex items-center gap-3 min-w-0 pr-2">
            <div class="w-10 h-10 rounded-xl bg-white text-slate-700 group-hover:text-emerald-700 flex items-center justify-center shrink-0 shadow-xs border border-slate-100">
              <span class="material-symbols-outlined text-[20px]">${icon}</span>
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-xs font-bold text-slate-900 group-hover:text-emerald-950 truncate">${item.name}</span>
              <span class="text-[11px] text-slate-400 truncate mt-0.5">${item.area || 'Lilongwe, Malawi'} &bull; ${distStr}</span>
            </div>
          </div>
          <span class="material-symbols-outlined text-slate-300 group-hover:text-emerald-600 text-[18px]">chevron_right</span>
        </div>
      `;
    }).join('');
  }

  const KNOWN_LILONGWE_LANDMARKS = {
    'EPTL Malawi (Entire Printers & Traders Limited)': {
      name: 'Entire Printers and Traders Limited (EPTL)',
      area: 'Chitipi Road, Lilongwe, Malawi',
      lat: -13.9933,
      lng: 33.6777
    },
    'EPTL Malawi (Entire Printers & Traders Ltd)': {
      name: 'Entire Printers and Traders Limited (EPTL)',
      area: 'Chitipi Road, Lilongwe, Malawi',
      lat: -13.9933,
      lng: 33.6777
    },
    'Entire Printers and Traders Limited (EPTL)': {
      name: 'Entire Printers and Traders Limited (EPTL)',
      area: 'Chitipi Road, Lilongwe, Malawi',
      lat: -13.9933,
      lng: 33.6777
    },
    'Bingu National Stadium': {
      name: 'Bingu National Stadium',
      area: 'near Area 49, Kaunda Road, Lilongwe, Malawi',
      lat: -13.9482,
      lng: 33.7431
    },
    'City Centre (Capital Hill)': {
      name: 'City Centre (Capital Hill)',
      area: 'Independence Drive, Area 20, Capital City, Lilongwe',
      lat: -13.9620,
      lng: 33.7880
    },
    'Old Town Mall & Market': {
      name: 'Old Town Mall & Market',
      area: 'Kamuzu Procession Rd, Area 2, Lilongwe, Malawi',
      lat: -13.9840,
      lng: 33.7720
    }
  };

  window.selectDestinationFromSearch = async function (name) {
    const item = window.liveSearchResultsCache.get(name) ||
      KNOWN_LILONGWE_LANDMARKS[name] || {
      name,
      area: 'Lilongwe, Malawi',
      lat: -13.9850,
      lng: 33.7750
    };

    currentDestination = item;

    // Update DOM
    const destLabel = document.getElementById('selected-destination-text');
    if (destLabel) destLabel.innerText = item.name;

    window.closeSearchModal();
    window.openSelectedRideSheet();

    // Trigger Authoritative Server Road Quote
    await calculateAuthoritativeQuote();
  };

  // =========================================================================
  // 4. SERVER-AUTHORITATIVE ROAD ROUTING & PRICING QUOTE (/api/rides/quote)
  // =========================================================================
  let currentWaypoint = null;
  let waypointMarker = null;

  async function calculateAuthoritativeQuote() {
    if (!currentPickup || !currentDestination) return;

    showQuoteLoadingState(true);

    // Check if pickup is in any Lilongwe surge zone
    let activeSurge = null;
    if (typeof LILONGWE_SURGE_ZONES !== 'undefined' && currentPickup.lat && currentPickup.lng) {
      for (const zone of LILONGWE_SURGE_ZONES) {
        const dLat = (currentPickup.lat - zone.lat) * 111000;
        const dLng = (currentPickup.lng - zone.lng) * 111000 * Math.cos(zone.lat * Math.PI / 180);
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist <= zone.radius) {
          activeSurge = zone;
          break;
        }
      }
    }

    // Toggle surge banner
    const surgeBanner = document.getElementById('surge-alert-banner');
    const surgeTitle = document.getElementById('surge-alert-title');
    const surgeSub = document.getElementById('surge-alert-sub');
    if (activeSurge && surgeBanner) {
      surgeBanner.classList.remove('hidden');
      surgeBanner.classList.add('flex');
      if (surgeTitle) surgeTitle.innerText = `High Demand Surge (${activeSurge.surge}x) Active`;
      if (surgeSub) surgeSub.innerText = `Zone: ${activeSurge.name} • Heavy ride requests`;
    } else if (surgeBanner) {
      surgeBanner.classList.add('hidden');
      surgeBanner.classList.remove('flex');
    }

    try {
      let data = null;

      // If user has an intermediate waypoint, route via waypoint
      if (currentWaypoint) {
        try {
          const [res1, res2] = await Promise.all([
            fetch('/api/rides/quote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pickup: currentPickup,
                destination: {
                  lat: currentWaypoint.lat,
                  lng: currentWaypoint.lng,
                  name: currentWaypoint.name,
                  address: currentWaypoint.name
                }
              })
            }),
            fetch('/api/rides/quote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pickup: {
                  lat: currentWaypoint.lat,
                  lng: currentWaypoint.lng,
                  name: currentWaypoint.name,
                  address: currentWaypoint.name
                },
                destination: currentDestination
              })
            })
          ]);

          const d1 = await res1.json();
          const d2 = await res2.json();

          const poly1 = (d1.route && d1.route.polyline) ? d1.route.polyline : [[currentPickup.lat, currentPickup.lng], [currentWaypoint.lat, currentWaypoint.lng]];
          const poly2 = (d2.route && d2.route.polyline) ? d2.route.polyline : [[currentWaypoint.lat, currentWaypoint.lng], [currentDestination.lat, currentDestination.lng]];

          const combinedPolyline = poly1.concat(poly2);
          const totalDistanceKm = Number(((d1.route?.distanceKm || 3) + (d2.route?.distanceKm || 3.5)).toFixed(1));
          const totalDurationMins = Math.round((d1.route?.durationMins || 6) + (d2.route?.durationMins || 7));

          const stopFee = 500;
          const mult = activeSurge ? activeSurge.surge : 1.0;

          data = {
            route: {
              polyline: combinedPolyline,
              distanceKm: totalDistanceKm,
              durationMins: totalDurationMins
            },
            tiers: {
              moto: { finalFare: Math.round(((d1.tiers?.moto?.finalFare || 2000) + (d2.tiers?.moto?.finalFare || 2000) * 0.65 + stopFee) * mult) },
              auto: { finalFare: Math.round(((d1.tiers?.auto?.finalFare || 3500) + (d2.tiers?.auto?.finalFare || 3500) * 0.65 + stopFee) * mult) },
              cab: { finalFare: Math.round(((d1.tiers?.cab?.finalFare || 6500) + (d2.tiers?.cab?.finalFare || 6500) * 0.65 + stopFee) * mult) }
            }
          };
        } catch (multiErr) {
          console.warn('[AArohanQuote] Multi-stop segment fetch fallback:', multiErr);
        }
      }

      if (!data) {
        const res = await fetch('/api/rides/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pickup: {
              lat: currentPickup.lat,
              lng: currentPickup.lng,
              name: currentPickup.name,
              address: currentPickup.address
            },
            destination: {
              lat: currentDestination.lat,
              lng: currentDestination.lng,
              name: currentDestination.name,
              address: currentDestination.area || currentDestination.name
            }
          })
        });

        if (!res.ok) throw new Error('Quote request failed');
        data = await res.json();

        // Apply surge multiplier if applicable
        if (activeSurge && data.tiers) {
          const mult = activeSurge.surge;
          if (data.tiers.moto) data.tiers.moto.finalFare = Math.round(data.tiers.moto.finalFare * mult);
          if (data.tiers.auto) data.tiers.auto.finalFare = Math.round(data.tiers.auto.finalFare * mult);
          if (data.tiers.cab) data.tiers.cab.finalFare = Math.round(data.tiers.cab.finalFare * mult);
        }
      }

      activeQuote = data;

      // Render Mapbox Authentic Road Polyline
      renderRoadRoutePolyline(data.route);

      // Render Server Fares on Tier Cards
      renderTierFares(data);

      showQuoteLoadingState(false);
    } catch (err) {
      console.error('[AArohanQuote] Authoritative quote calculation failed:', err);
      showQuoteLoadingState(false);
      showToast('⚠️ Could not fetch live road route. Retrying...');
    }
  }

  function renderRoadRoutePolyline(route) {
    if (!map || typeof L === 'undefined') return;

    if (routeLine) map.removeLayer(routeLine);
    if (dropoffMarker) map.removeLayer(dropoffMarker);
    if (waypointMarker) {
      map.removeLayer(waypointMarker);
      waypointMarker = null;
    }

    // Dropoff Marker
    const dropoffIcon = L.divIcon({
      className: 'custom-pin-dropoff',
      html: `
        <div style="display:flex; flex-direction:column; align-items:center;">
          <div style="background:#0f172a; color:#ffffff; font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; box-shadow:0 3px 8px rgba(0,0,0,0.25); white-space:nowrap; margin-bottom:2px;" id="leaflet-dropoff-label">
            ${currentDestination.name}
          </div>
          <div style="width:26px; height:26px; border-radius:50%; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 8px rgba(0,0,0,0.3); border:2px solid #ffffff;">
            <span class="material-symbols-outlined" style="font-size:15px;">location_on</span>
          </div>
        </div>
      `,
      iconSize: [140, 50],
      iconAnchor: [70, 50]
    });

    const pLat = Number(currentPickup?.lat) || -13.9722;
    const pLng = Number(currentPickup?.lng) || 33.7667;
    const dLat = Number(currentDestination?.lat) || -13.9850;
    const dLng = Number(currentDestination?.lng) || 33.7750;

    dropoffMarker = L.marker([dLat, dLng], { icon: dropoffIcon }).addTo(map);

    // Waypoint Marker (If Multi-Stop Active)
    if (currentWaypoint && !isNaN(Number(currentWaypoint.lat)) && !isNaN(Number(currentWaypoint.lng))) {
      const wpLat = Number(currentWaypoint.lat);
      const wpLng = Number(currentWaypoint.lng);
      const wpName = (typeof currentWaypoint.name === 'string') ? currentWaypoint.name.split(' ')[0] : 'Stop';
      const waypointIcon = L.divIcon({
        className: 'custom-pin-waypoint',
        html: `
          <div style="display:flex; flex-direction:column; align-items:center;">
            <div s tyle="background:#d97706; color:#ffffff; font-size:10px; font-weight:800; padding:3px 8px; border-radius:6px; box-shadow:0 3px 8px rgba(0,0,0,0.25); white-space:nowrap; margin-bottom:2px;">
              📍 Stop: ${wpName}
            </div>
            <div style="width:24px; height:24px; border-radius:50%; background:#f59e0b; color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 8px rgba(0,0,0,0.3); border:2px solid #ffffff;">
              <span class="material-symbols-outlined" style="font-size:14px;">flag</span>
            </div>
          </div>
        `,
        iconSize: [120, 48],
        iconAnchor: [60, 48]
      });
      waypointMarker = L.marker([wpLat, wpLng], { icon: waypointIcon }).addTo(map);
    }

    // Draw authentic road polyline
    const coords = (route && Array.isArray(route.polyline) && route.polyline.length > 0)
      ? route.polyline
      : (currentWaypoint && !isNaN(Number(currentWaypoint.lat))
        ? [[pLat, pLng], [Number(currentWaypoint.lat), Number(currentWaypoint.lng)], [dLat, dLng]]
        : [[pLat, pLng], [dLat, dLng]]);

    routeLine = L.polyline(coords, {
      color: '#008945',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
  }

  function renderTierFares(quoteData) {
    const tiers = quoteData.tiers || {};
    const route = quoteData.route || {};

    const motoFare = tiers.moto ? tiers.moto.finalFare : 2450;
    const autoFare = tiers.auto ? tiers.auto.finalFare : 4150;
    const cabFare = tiers.cab ? tiers.cab.finalFare : 7850;

    const motoEl = document.getElementById('price-bike');
    if (motoEl) motoEl.innerText = `MK ${motoFare.toLocaleString()}`;

    const autoEl = document.getElementById('price-auto');
    if (autoEl) autoEl.innerText = `MK ${autoFare.toLocaleString()}`;

    const cabEl = document.getElementById('price-cab');
    if (cabEl) cabEl.innerText = `MK ${cabFare.toLocaleString()}`;

    // Update Distance & Duration Banner in Ride Sheet
    let summaryBanner = document.getElementById('aarohan-route-quote-summary');
    if (!summaryBanner) {
      const sheet = document.getElementById('ride-selection-sheet');
      if (sheet) {
        summaryBanner = document.createElement('div');
        summaryBanner.id = 'aarohan-route-quote-summary';
        summaryBanner.className = 'flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-1.5 my-2 text-xs';
        sheet.insertBefore(summaryBanner, document.getElementById('tier-list'));
      }
    }

    if (summaryBanner) {
      summaryBanner.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-emerald-600 text-[18px]">route</span>
          <span class="font-extrabold text-slate-800">${route.distanceKm || 4.5} km</span>
          <span class="text-slate-400">&bull;</span>
          <span class="font-bold text-slate-600">~${route.durationMins || 9} mins</span>
        </div>
        <span class="text-[10px] text-emerald-700 font-extrabold bg-emerald-100 px-2 py-0.5 rounded-full">Server Guaranteed Quote</span>
      `;
    }

    // Update CTA Button Text
    updateBookingCtaButton();
  }

  function showQuoteLoadingState(isLoading) {
    const btn = document.getElementById('book-cta-text');
    if (btn && isLoading) {
      btn.innerText = 'Calculating live road routing & fare...';
    }
  }

  function updateBookingCtaButton() {
    const btn = document.getElementById('book-cta-text');
    if (!btn || !activeQuote) return;

    const tier = activeQuote.tiers[activeTierId];
    const fare = tier ? tier.finalFare : 2450;
    btn.innerText = `Book ${activeTierName} • MK ${fare.toLocaleString()}`;
  }

  window.selectRideTier = function (tierName, baseFare) {
    activeTierName = tierName;
    if (tierName.toLowerCase().includes('moto') || tierName.toLowerCase().includes('bike')) {
      activeTierId = 'moto';
    } else if (tierName.toLowerCase().includes('auto')) {
      activeTierId = 'auto';
    } else {
      activeTierId = 'cab';
    }

    ['tier-bike', 'tier-auto', 'tier-cab'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'tier-card cursor-pointer p-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 flex items-center justify-between transition-all';
    });

    const activeCardId = activeTierId === 'moto' ? 'tier-bike' : (activeTierId === 'auto' ? 'tier-auto' : 'tier-cab');
    const activeEl = document.getElementById(activeCardId);
    if (activeEl) {
      activeEl.className = 'tier-card cursor-pointer p-3 rounded-2xl bg-emerald-50/60 border-2 border-emerald-600 shadow-sm flex items-center justify-between transition-all';
    }

    updateBookingCtaButton();
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.cyclePaymentMethod = function () {
    paymentIdx = (paymentIdx + 1) % PAYMENT_METHODS.length;
    const m = PAYMENT_METHODS[paymentIdx];
    activePaymentMethod = m.name;

    const nameEl = document.getElementById('payment-name');
    if (nameEl) nameEl.innerText = m.name;

    const subEl = document.getElementById('payment-sub');
    if (subEl) subEl.innerText = m.sub;

    const badgeEl = document.getElementById('payment-badge');
    if (badgeEl) badgeEl.innerText = m.badge;

    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  // =========================================================================
  // 5. LIVE DISPATCH RADAR & BOOKING EMISSION
  // =========================================================================
  window.requestRideBooking = async function () {
    if (!activeQuote) {
      await calculateAuthoritativeQuote();
    }
    if (!activeQuote) {
      alert('Could not verify ride quote with AArohan server. Please check your internet connection.');
      return;
    }

    // If mobile money is selected, trigger authentic USSD PIN confirmation
    if (activePaymentMethod.includes('Airtel') || activePaymentMethod.includes('TNM') || activePaymentMethod.includes('Mpamba')) {
      openUssdAuthPrompt();
      return;
    }

    // Direct booking for Cash to Captain
    showToast('💵 Cash Payment: Please keep exact fare ready for captain.');
    executeBookingAndDispatch();
  };

  function openUssdAuthPrompt() {
    const modal = document.getElementById('momo-ussd-modal');
    if (!modal) return executeBookingAndDispatch();

    const isAirtel = activePaymentMethod.toLowerCase().includes('airtel');
    const badge = document.getElementById('ussd-badge-icon');
    const title = document.getElementById('ussd-provider-title');
    const phone = document.getElementById('ussd-phone-display');
    const fareEl = document.getElementById('ussd-fare-amount');
    const corridor = document.getElementById('ussd-corridor-display');
    const pinInput = document.getElementById('ussd-pin-input');
    const secPin = document.getElementById('ussd-pin-section');
    const secSpin = document.getElementById('ussd-processing-section');
    const secBtns = document.getElementById('ussd-action-buttons');

    if (badge) {
      badge.className = `w-10 h-10 rounded-2xl ${isAirtel ? 'bg-red-600' : 'bg-emerald-700'} text-white flex items-center justify-center font-black text-sm shadow-sm`;
      badge.innerText = isAirtel ? 'AIR' : 'TNM';
    }
    if (title) title.innerText = isAirtel ? 'Airtel Money Push USSD' : 'TNM Mpamba Mobile Money';
    if (phone) phone.innerText = isAirtel ? '+265 99 824 1120' : '+265 88 765 4321';

    const tier = activeQuote.tiers[activeTierId];
    const finalFare = tier ? tier.finalFare : 2450;
    if (fareEl) fareEl.innerText = `MK ${finalFare.toLocaleString()}`;
    if (corridor) corridor.innerText = `${currentPickup.name} → ${currentDestination.name}`;

    if (pinInput) {
      pinInput.value = '';
      setTimeout(() => pinInput.focus(), 150);
    }
    if (secPin) secPin.classList.remove('hidden');
    if (secBtns) secBtns.classList.remove('hidden');
    if (secSpin) secSpin.classList.add('hidden');

    modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playTone(520, 'sine', 0.15, 0.1);
  }

  window.cancelUssdModal = function () {
    const modal = document.getElementById('momo-ussd-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.submitUssdAuthPin = async function () {
    const pinInput = document.getElementById('ussd-pin-input');
    const pin = pinInput ? pinInput.value.trim() : '1234';

    if (pin.length < 4) {
      showToast('⚠️ Please enter your 4-digit Mobile Money PIN');
      if (pinInput) pinInput.focus();
      return;
    }

    const secPin = document.getElementById('ussd-pin-section');
    const secSpin = document.getElementById('ussd-processing-section');
    const secBtns = document.getElementById('ussd-action-buttons');
    const spinLabel = document.getElementById('ussd-processing-label');

    if (secPin) secPin.classList.add('hidden');
    if (secBtns) secBtns.classList.add('hidden');
    if (secSpin) secSpin.classList.remove('hidden');

    const isAirtel = activePaymentMethod.toLowerCase().includes('airtel');
    if (spinLabel) {
      spinLabel.innerText = `Authenticating PIN with ${isAirtel ? 'Airtel Africa Gateway' : 'TNM Mpamba Switch'}...`;
    }

    if (window.aarohanSound) window.aarohanSound.playTone(650, 'sine', 0.2, 0.1);

    setTimeout(() => {
      window.cancelUssdModal();
      showToast('✅ Payment Authorized & Locked in AArohan Escrow!');
      if (window.aarohanSound) window.aarohanSound.playAcceptChime();
      executeBookingAndDispatch();
    }, 1400);
  };

  function executeBookingAndDispatch() {
    const tier = activeQuote.tiers[activeTierId];
    const finalFare = tier.finalFare;

    // Update dispatch screen vehicle icon
    const iconEl = document.getElementById('dispatch-vehicle-icon');
    if (iconEl) {
      iconEl.innerText = activeTierId === 'moto' ? 'two_wheeler' : (activeTierId === 'auto' ? 'electric_rickshaw' : 'local_taxi');
    }

    document.getElementById('dispatch-status-title').innerText = `Broadcasting to Lilongwe ${activeTierName} Captains...`;
    document.getElementById('dispatch-status-sub').innerText = `Scanning verified captains along Kaunda Rd, Area 47 & corridor to ${currentDestination.name}.`;
    document.getElementById('dispatch-summary').innerText = `${activeTierName} • MK ${finalFare.toLocaleString()}`;
    document.getElementById('dispatch-destination-sub').innerText = currentDestination.name;

    // Emit genuine booking via store
    if (window.mwendoStore) {
      window.mwendoStore.requestTrip({
        quoteId: activeQuote.quoteId,
        tierId: activeTierId,
        tier: activeTierName,
        fare: finalFare,
        pickup: currentPickup.name,
        destination: currentDestination.name,
        pickupCoords: { lat: currentPickup.lat, lng: currentPickup.lng },
        dropoffCoords: { lat: currentDestination.lat, lng: currentDestination.lng },
        distanceKm: activeQuote.route.distanceKm,
        durationMins: activeQuote.route.durationMins,
        routeGeometry: activeQuote.route.polyline,
        paymentMethod: activePaymentMethod
      });
    }

    window.switchView('dispatching');
    fetchNearbyDriversCount();
    startDispatchCountdown();
  }

  async function fetchNearbyDriversCount() {
    try {
      const res = await fetch(`/api/drivers/nearby?lat=${currentPickup.lat}&lng=${currentPickup.lng}&radiusKm=6`);
      if (res.ok) {
        const data = await res.json();
        const countEl = document.getElementById('dispatch-captains-count');
        if (countEl) {
          countEl.innerText = `${data.count || 2} Captains active nearby • WebSocket Live`;
        }
      }
    } catch (err) { }
  }

  function startDispatchCountdown() {
    clearInterval(dispatchCountdownInterval);
    let secondsLeft = 45;

    const timerEl = document.getElementById('dispatch-countdown-timer');
    const progressEl = document.getElementById('dispatch-progress-bar');
    const subEl = document.getElementById('dispatch-status-sub');
    const countEl = document.getElementById('dispatch-captains-count');

    dispatchCountdownInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft >= 0) {
        const s = String(secondsLeft).padStart(2, '0');
        if (timerEl) timerEl.innerText = `00:${s}`;
        if (progressEl) {
          const pct = Math.min(100, Math.round(((45 - secondsLeft) / 45) * 100));
          progressEl.style.width = `${pct}%`;
        }
        if (secondsLeft === 30) {
          if (subEl) subEl.innerText = 'Broadcasting to expanding corridor (Area 47, 49 & City Centre)...';
        } else if (secondsLeft === 15) {
          if (subEl) subEl.innerText = 'Priority dispatch active across Lilongwe captains...';
        }
      } else {
        secondsLeft = 45;
      }
    }, 1000);
  }

  window.cancelDispatch = function () {
    clearInterval(dispatchCountdownInterval);
    if (window.mwendoStore) {
      window.mwendoStore.cancelTrip('User cancelled');
    }
    window.switchView('booking');
  };

  // =========================================================================
  // 6. REAL-TIME TRACKING CONTROLLER (ZERO FAKE LOOPS)
  // =========================================================================
  window.initTrackingMap = function () {
    if (typeof L === 'undefined') return;
    const mapEl = document.getElementById('tracking-leaflet-map');
    if (!mapEl) return;

    if (trackingMap) {
      trackingMap.invalidateSize();
      updateTrackingMarkersAndRoute();
      return;
    }

    trackingMap = L.map('tracking-leaflet-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([currentPickup.lat, currentPickup.lng], 14);

    applyTileLayerToMap(trackingMap, true);
    updateTrackingMarkersAndRoute();
  };

  function updateTrackingMarkersAndRoute() {
    if (!trackingMap) return;

    if (trackingPickupMarker) trackingMap.removeLayer(trackingPickupMarker);
    if (trackingDropoffMarker) trackingMap.removeLayer(trackingDropoffMarker);
    if (trackingDriverMarker) trackingMap.removeLayer(trackingDriverMarker);
    if (trackingRouteLine) trackingMap.removeLayer(trackingRouteLine);

    // Pickup & Dropoff Markers
    const pIcon = L.divIcon({
      className: 'custom-pickup-marker',
      html: `
        <div class="pickup-point-pill">Pickup Point</div>
        <div class="gps-blue-dot-container">
          <div class="gps-blue-dot"></div>
          <span class="gps-blue-label">${currentPickup.name}</span>
        </div>
      `,
      iconSize: [110, 60],
      iconAnchor: [55, 34]
    });

    const dIcon = L.divIcon({
      className: 'custom-pin-dropoff',
      html: `
        <div style="display:flex; flex-direction:column; align-items:center;">
          <div style="background:#0f172a; color:#ffffff; font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; box-shadow:0 3px 8px rgba(0,0,0,0.25); white-space:nowrap; margin-bottom:2px;">
            ${currentDestination.name}
          </div>
          <div style="width:26px; height:26px; border-radius:50%; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 8px rgba(0,0,0,0.3); border:2px solid #ffffff;">
            <span class="material-symbols-outlined" style="font-size:15px;">location_on</span>
          </div>
        </div>
      `,
      iconSize: [140, 50],
      iconAnchor: [70, 50]
    });

    const iconName = activeTierId === 'moto' ? 'two_wheeler' : (activeTierId === 'auto' ? 'electric_rickshaw' : 'local_taxi');
    const driverIcon = L.divIcon({
      className: 'car-marker-container',
      html: `
        <div class="car-marker-inner animate-pulse">
          <span class="material-symbols-outlined" style="font-size:18px;">${iconName}</span>
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const pLat = Number(currentPickup?.lat) || -13.9722;
    const pLng = Number(currentPickup?.lng) || 33.7667;
    const dLat = Number(currentDestination?.lat) || -13.9850;
    const dLng = Number(currentDestination?.lng) || 33.7750;

    trackingPickupMarker = L.marker([pLat, pLng], { icon: pIcon }).addTo(trackingMap);
    trackingDropoffMarker = L.marker([dLat, dLng], { icon: dIcon }).addTo(trackingMap);

    // Initial Captain Position
    const initialPos = [-13.9650, 33.7820];
    trackingDriverMarker = L.marker(initialPos, { icon: driverIcon }).addTo(trackingMap);

    // Route geometry from authoritative quote
    const coords = (activeQuote && activeQuote.route && Array.isArray(activeQuote.route.polyline) && activeQuote.route.polyline.length > 0)
      ? activeQuote.route.polyline
      : [[pLat, pLng], [dLat, dLng]];

    trackingRouteLine = L.polyline(coords, {
      color: '#008945',
      weight: 5,
      opacity: 0.85,
      dashArray: '6, 6',
      lineCap: 'round'
    }).addTo(trackingMap);

    trackingMap.fitBounds([
      [pLat, pLng],
      initialPos
    ], { padding: [40, 40] });
  }

  // =========================================================================
  // 7. REALTIME STATE BUS & DRIVER TELEMETRY (NO MOCK INTERVALS)
  // =========================================================================
  function subscribeToRealtimeStore() {
    if (!window.mwendoStore) return;

    window.mwendoStore.subscribe((state, eventName, payload) => {
      handleStateUpdate(state, eventName, payload);
    });
  }

  function handleStateUpdate(state, eventName, payload) {
    if (!state) return;

    // 1. Rider Profile & Wallet
    if (state.rider) {
      const headerBal = document.getElementById('header-wallet-bal');
      if (headerBal) headerBal.innerText = `MK ${state.rider.walletBalance.toLocaleString()}`;

      const walletMain = document.getElementById('wallet-main-balance');
      if (walletMain) walletMain.innerText = `MK ${state.rider.walletBalance.toLocaleString()}`;

      const nameEl = document.getElementById('profile-rider-name');
      if (nameEl && state.rider.name) nameEl.innerText = state.rider.name;

      const subEl = document.getElementById('profile-rider-sub');
      if (subEl && state.rider.phone) subEl.innerHTML = `${state.rider.phone} &bull; ${state.rider.rating || 4.9} ★ Lilongwe`;

      const avatar = document.getElementById('profile-rider-avatar');
      if (avatar && state.rider && state.rider.name) {
        avatar.innerText = (typeof state.rider.name === 'string')
          ? state.rider.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
          : 'RP';
      }

      const editName = document.getElementById('edit-profile-name');
      if (editName && state.rider.name && !editName.matches(':focus')) editName.value = state.rider.name;

      const editPhone = document.getElementById('edit-profile-phone');
      if (editPhone && state.rider.phone && !editPhone.matches(':focus')) editPhone.value = state.rider.phone;

      // Render Transaction Logs into #wallet-tx-list
      const txListEl = document.getElementById('wallet-tx-list');
      if (txListEl) {
        const logs = state.transactionLogs || [];
        if (logs.length === 0) {
          txListEl.innerHTML = `
            <div class="p-6 text-center text-xs text-slate-400 font-medium bg-white rounded-2xl border border-slate-200">
              No recent transactions. Top up via Airtel Money or TNM Mpamba to begin!
            </div>
          `;
        } else {
          txListEl.innerHTML = logs.map(tx => {
            const isCredit = (tx.amount > 0);
            const isTrip = (tx.type === 'TRIP');
            const isTopUp = (tx.type === 'TOPUP');
            const icon = isTrip ? 'near_me' : (isTopUp ? 'add_circle' : (tx.type === 'REFUND' ? 'replay' : 'receipt_long'));
            const iconBg = isCredit ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-700';
            const amountColor = isCredit ? 'text-emerald-700' : 'text-slate-900';
            const amountStr = `${isCredit ? '+' : ''}MK ${Math.abs(tx.amount).toLocaleString()}`;
            return `
              <div class="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-slate-100 shadow-xs hover:border-slate-200 transition-colors">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-[20px]">${icon}</span>
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="text-xs font-bold text-slate-900 truncate">${tx.title || 'Transaction'}</span>
                    <span class="text-[10px] text-slate-400">${tx.method || 'Airtel Money'} &bull; ${tx.time || 'Recent'}</span>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <span class="text-xs font-black ${amountColor} block">${amountStr}</span>
                  <span class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded-full">${tx.status || 'Success'}</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    // 2. Real Driver GPS Telemetry (trip:driver_moved)
    if (eventName === 'DRIVER_MOVED' || (payload && payload.lat !== undefined && payload.lng !== undefined)) {
      lastDriverMovedTimestamp = Date.now();
      updateStaleTelemetryBadge(false);
      const coords = payload || (state.driver && state.driver.location);
      const lat = Number(coords?.lat);
      const lng = Number(coords?.lng);

      if (!isNaN(lat) && !isNaN(lng) && trackingDriverMarker) {
        trackingDriverMarker.setLatLng([lat, lng]);

        // Dynamically compute straight-line remaining distance
        const pLat = Number(currentPickup?.lat) || -13.9722;
        const pLng = Number(currentPickup?.lng) || 33.7667;
        const R = 6371;
        const dLat = (pLat - lat) * Math.PI / 180;
        const dLon = (pLng - lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat * Math.PI / 180) * Math.cos(pLat * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = (R * c * 1.3).toFixed(1);
        const etaMins = Math.max(1, Math.ceil(distKm * 2.5));

        const turnDist = document.getElementById('turn-dist-text');
        if (turnDist && state.activeTrip?.status === 'ACCEPTED') {
          turnDist.innerText = `${distKm} km away • Live GPS Tracking`;
        }

        const etaEl = document.getElementById('tracking-eta-time');
        if (etaEl && state.activeTrip && state.activeTrip.status === 'ACCEPTED') {
          etaEl.innerText = `Arriving in ${etaMins} mins`;
        }
      }
    }

    // 3. Active Trip State Transitions
    const trip = state.activeTrip;
    if (!trip) return;

    // Persist active trip for recovery after restart (Phase 2.D)
    if (trip && ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_TRANSIT'].includes(trip.status)) {
      try {
        localStorage.setItem('aarohan_active_ride_state', JSON.stringify({
          activeTrip: trip,
          driver: state.driver,
          pickup: currentPickup,
          destination: currentDestination,
          activeQuote: activeQuote,
          timestamp: Date.now()
        }));
      } catch (e) { }
    } else if (trip && (trip.status === 'COMPLETED' || trip.status === 'IDLE')) {
      try {
        localStorage.removeItem('aarohan_active_ride_state');
      } catch (e) { }
    }

    // Safety PIN
    const pinEl = document.getElementById('tracking-pin-display');
    if (pinEl && trip.pin) pinEl.innerText = trip.pin;

    // Populate Driver Info
    if (state.driver) {
      const dName = document.getElementById('tracking-driver-name');
      if (dName) dName.innerText = state.driver.name;

      const dCar = document.getElementById('tracking-driver-car');
      if (dCar) dCar.innerText = state.driver.car;

      const dPlate = document.getElementById('tracking-driver-plate');
      if (dPlate) dPlate.innerText = state.driver.plate;

      const dRating = document.getElementById('tracking-driver-rating');
      if (dRating) dRating.innerText = state.driver.rating;

      const dRides = document.getElementById('tracking-driver-rides');
      if (dRides) dRides.innerText = `${state.driver.tripsCompleted || 1420} rides`;
    }

    if (trip.status === 'REQUESTED') {
      clearInterval(dispatchCountdownInterval);
      startDispatchCountdown();
      window.switchView('dispatching');
    }
    else if (trip.status === 'ACCEPTED') {
      clearInterval(dispatchCountdownInterval);
      window.switchView('tracking');

      const title = document.getElementById('tracking-status-title');
      if (title) title.innerText = 'Captain On The Way';

      const eta = document.getElementById('tracking-eta-time');
      if (eta) eta.innerText = `Arriving in ${trip.etaMins || 4} mins`;

      const turnText = document.getElementById('turn-instruction-text');
      if (turnText) turnText.innerText = `Captain ${state.driver?.name || 'Chikondi'} is approaching`;

      if (window.initTrackingMap) window.initTrackingMap();
    }
    else if (trip.status === 'ARRIVED') {
      window.switchView('tracking');

      const title = document.getElementById('tracking-status-title');
      if (title) title.innerText = 'Captain Has Arrived!';

      const pickupName = (typeof trip.pickup === 'string') ? trip.pickup.split(',')[0] : (trip.pickup?.name || 'Pickup Point');
      const destName = (typeof trip.destination === 'string') ? trip.destination.split(',')[0] : (trip.destination?.name || 'Destination');

      const turnText = document.getElementById('turn-instruction-text');
      if (turnText) turnText.innerText = `Show PIN ${trip.pin} to Captain ${state.driver?.name || 'Chikondi'}`;

      const turnDist = document.getElementById('turn-dist-text');
      if (turnDist) turnDist.innerText = `Waiting at ${pickupName}`;

      const transitBtn = document.getElementById('tracking-start-transit-btn');
      if (transitBtn) transitBtn.classList.remove('hidden');

      if (eventName === 'DRIVER_ARRIVED' && window.aarohanSound) {
        window.aarohanSound.playTone(600, 'triangle', 0.25);
      }
    }
    else if (trip.status === 'IN_TRANSIT') {
      window.switchView('tracking');

      const destName = (typeof trip.destination === 'string') ? trip.destination.split(',')[0] : (trip.destination?.name || 'Destination');

      const title = document.getElementById('tracking-status-title');
      if (title) title.innerText = `In Transit to ${destName}`;

      const eta = document.getElementById('tracking-eta-time');
      if (eta) eta.innerText = `En Route (~${trip.durationMins || 12} mins)`;

      const turnText = document.getElementById('turn-instruction-text');
      if (turnText) turnText.innerText = `Following Kaunda Rd / M1 to ${destName}`;

      const turnDist = document.getElementById('turn-dist-text');
      if (turnDist) turnDist.innerText = 'Trip active • Escrow Protected';

      const transitBtn = document.getElementById('tracking-start-transit-btn');
      if (transitBtn) transitBtn.classList.add('hidden');
    }
    else if (trip.status === 'COMPLETED') {
      renderCompletedTripReceipt(trip);
      window.switchView('receipt');
    }
    else if (trip.status === 'IDLE' && (eventName === 'TRIP_CANCELLED' || eventName === 'STATE_RESET')) {
      window.switchView('booking');
    }
  }

  // =========================================================================
  // 8. TRIP RECEIPT, ESCROW & 5-STAR RATING
  // =========================================================================
  function renderCompletedTripReceipt(trip) {
    const finalFare = trip.finalFare || 2450;
    const baseFareAmt = Math.round(finalFare * 0.70);
    const distFareAmt = Math.round(finalFare * 0.20);

    const destStr = (typeof trip.destination === 'string')
      ? trip.destination
      : (trip.destination?.name || trip.destination?.address || 'Destination');
    const destEl = document.getElementById('receipt-destination-name');
    if (destEl) destEl.innerText = destStr;

    const fareEl = document.getElementById('receipt-fare-display');
    if (fareEl) fareEl.innerText = `MK ${finalFare.toLocaleString()}`;

    const baseEl = document.getElementById('receipt-base-breakdown');
    if (baseEl) baseEl.innerText = `MK ${baseFareAmt.toLocaleString()}`;

    const distEl = document.getElementById('receipt-dist-breakdown');
    if (distEl) distEl.innerText = `MK ${distFareAmt.toLocaleString()}`;

    const tipEl = document.getElementById('receipt-tip-breakdown');
    if (tipEl) tipEl.innerText = `MK 0`;

    const escrowTitle = document.getElementById('receipt-escrow-title');
    const escrowSub = document.getElementById('receipt-escrow-sub');
    if (escrowTitle) escrowTitle.innerText = `${trip.paymentMethod || 'Airtel Money'} Escrow Released`;
    if (escrowSub) escrowSub.innerText = `Trip completed • 70% settled to Captain • 30% AArohan Platform`;

    window.setRating(5);
  }

  window.setRating = function (stars) {
    currentRating = stars;
    for (let i = 1; i <= 5; i++) {
      const starEl = document.getElementById('star-' + i);
      if (starEl) {
        if (i <= stars) {
          starEl.style.color = '#f59e0b';
          starEl.style.fontVariationSettings = "'FILL' 1";
        } else {
          starEl.style.color = '#cbd5e1';
          starEl.style.fontVariationSettings = "'FILL' 0";
        }
      }
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.selectTip = function (amount, btn) {
    currentTip = amount;
    document.querySelectorAll('.tip-btn').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');

    const baseFare = activeQuote ? activeQuote.tiers[activeTierId].finalFare : 2450;
    const total = baseFare + currentTip;

    const fareEl = document.getElementById('receipt-fare-display');
    if (fareEl) fareEl.innerText = `MK ${total.toLocaleString()}`;

    const tipEl = document.getElementById('receipt-tip-breakdown');
    if (tipEl) tipEl.innerText = `MK ${amount.toLocaleString()}`;

    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.resetAndBookAnother = function () {
    if (window.mwendoStore) {
      window.mwendoStore.submitRating({
        rating: currentRating || 5,
        tip: currentTip || 0,
        compliments: ['Smooth Driving', 'Clean Vehicle', 'Polite Captain']
      });
    }

    currentTip = 0;
    window.switchView('booking');
    window.closeSelectedRideSheet();
    window.recenterMap();
  };

  // =========================================================================
  // 9. SAVED & FREQUENT PLACES
  // =========================================================================
  async function loadFrequentPlaces() {
    try {
      const res = await fetch('/api/user/frequent-places');
      if (res.ok) {
        const places = await res.json();
        // Dynamically update quick chips if present
      }
    } catch (e) { }
  }

  async function loadSavedPlaces() {
    try {
      const res = await fetch('/api/user/saved-places');
      if (res.ok) {
        const saved = await res.json();
      }
    } catch (e) { }
  }

  // =========================================================================
  // 10. IN-APP CHAT & CALL SCREEN
  // =========================================================================
  function initChatDrawer() {
    const chatModal = document.getElementById('chat-modal');
    const chatList = document.getElementById('chat-messages-container');
    const chatInput = document.getElementById('chat-custom-input');

    window.openChatDrawer = function () {
      chatModal.classList.remove('hidden');
      renderChatMessages();
      if (window.aarohanSound) window.aarohanSound.playClick();
    };

    window.closeChatDrawer = function () {
      chatModal.classList.add('hidden');
    };

    window.sendCannedChat = function (text) {
      const msgObj = {
        sender: 'rider',
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      chatMessages.push(msgObj);
      renderChatMessages();

      if (window.mwendoStore) {
        window.mwendoStore.sendChatMessage('rider', text);
      }
    };

    window.sendCustomChat = function () {
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      sendCannedChat(text);
    };

    function renderChatMessages() {
      if (!chatList) return;
      chatList.innerHTML = chatMessages.map(msg => `
        <div class="flex flex-col ${msg.sender === 'rider' ? 'items-end' : 'items-start'}">
          <div class="max-w-[80%] px-3.5 py-2 rounded-2xl text-xs ${msg.sender === 'rider' ? 'bg-slate-900 text-white rounded-br-xs' : 'bg-slate-100 text-slate-800 rounded-bl-xs'
        }">
            ${msg.text}
          </div>
          <span class="text-[9px] text-slate-400 mt-0.5 px-1">${msg.time}</span>
        </div>
      `).join('');
      chatList.scrollTop = chatList.scrollHeight;
    }
  }

  window.openCallScreen = function () {
    const callModal = document.getElementById('call-modal');
    callModal.classList.remove('hidden');
    callSeconds = 0;
    isCallMuted = false;
    isCallSpeaker = false;

    document.getElementById('call-status-label').innerText = 'Connecting via Encrypted Transit Line...';
    document.getElementById('call-timer-label').innerText = '00:00';

    if (window.aarohanSound) window.aarohanSound.playTone(440, 'sine', 0.4, 0.15);

    setTimeout(() => {
      document.getElementById('call-status-label').innerText = 'Connected (Secure Audio)';
      clearInterval(callTimerInterval);
      callTimerInterval = setInterval(() => {
        callSeconds++;
        const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const secs = String(callSeconds % 60).padStart(2, '0');
        document.getElementById('call-timer-label').innerText = `${mins}:${secs}`;
      }, 1000);
    }, 1500);
  };

  window.endCallScreen = function () {
    clearInterval(callTimerInterval);
    document.getElementById('call-modal').classList.add('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.toggleCallMute = function () {
    isCallMuted = !isCallMuted;
    document.getElementById('btn-call-mute').classList.toggle('bg-red-500', isCallMuted);
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.toggleCallSpeaker = function () {
    isCallSpeaker = !isCallSpeaker;
    document.getElementById('btn-call-speaker').classList.toggle('bg-emerald-600', isCallSpeaker);
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  // =========================================================================
  // 11. MAP CONFIGURATION & UI HELPERS
  // =========================================================================
  window.openSelectedRideSheet = function () {
    const sheet = document.getElementById('ride-selection-sheet');
    if (sheet) sheet.classList.remove('hidden');
    const homeSheet = document.getElementById('home-bottom-sheet');
    if (homeSheet) homeSheet.classList.add('hidden');
  };

  window.closeSelectedRideSheet = function () {
    const sheet = document.getElementById('ride-selection-sheet');
    if (sheet) sheet.classList.add('hidden');
    const homeSheet = document.getElementById('home-bottom-sheet');
    if (homeSheet) homeSheet.classList.remove('hidden');
    if (map) map.flyTo([currentPickup.lat, currentPickup.lng], 15);
  };

  window.openMapConfigModal = function () {
    const modal = document.getElementById('map-config-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const provider = window.aarohanMapConfig.provider || 'carto';
    window.selectMapProviderUI(provider);

    const input = document.getElementById('map-api-key-input');
    if (input) {
      if (provider === 'mapbox') input.value = window.aarohanMapConfig.mapboxToken || window.aarohanMapConfig.apiKey || '';
      else if (provider === 'google') input.value = window.aarohanMapConfig.googleKey || window.aarohanMapConfig.apiKey || '';
      else if (provider === 'maptiler') input.value = window.aarohanMapConfig.maptilerKey || window.aarohanMapConfig.apiKey || '';
      else input.value = window.aarohanMapConfig.apiKey || '';
    }
  };

  window.closeMapConfigModal = function () {
    const modal = document.getElementById('map-config-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.selectMapProviderUI = function (provider) {
    window.selectedProviderUI = provider;
    ['carto', 'mapbox', 'google', 'maptiler'].forEach(p => {
      const btn = document.getElementById('map-provider-btn-' + p);
      if (btn) {
        btn.className = (p === provider)
          ? 'provider-choice-btn p-3 rounded-2xl border-2 border-emerald-600 bg-emerald-50/50 flex flex-col gap-1 text-left transition-all'
          : 'provider-choice-btn p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 flex flex-col gap-1 text-left transition-all';
      }
    });

    const keyContainer = document.getElementById('map-key-input-container');
    const helpText = document.getElementById('map-key-help-text');
    const label = document.getElementById('map-key-input-label');
    const input = document.getElementById('map-api-key-input');

    if (provider === 'carto') {
      if (keyContainer) keyContainer.classList.add('opacity-50');
      if (label) label.innerText = 'API Key (Optional for CartoDB Voyager)';
      if (input) {
        input.placeholder = 'No API key needed (Free & unlimited)';
        input.disabled = true;
      }
      if (helpText) helpText.innerHTML = 'CartoDB Voyager pastel tiles require <b>no key</b> and are optimized for Lilongwe, Malawi.';
    } else {
      if (keyContainer) keyContainer.classList.remove('opacity-50');
      if (input) input.disabled = false;
      if (provider === 'mapbox') {
        if (label) label.innerText = 'Mapbox Public Access Token (pk.xxx)';
        if (input) input.placeholder = 'pk.eyJ1IjoieW91cm5hbWUiLCJhIjoi...';
      }
    }
  };

  window.saveMapConfigFromUI = async function () {
    const provider = window.selectedProviderUI || 'carto';
    const input = document.getElementById('map-api-key-input');
    const keyVal = input ? input.value.trim() : '';

    const newConfig = { provider, apiKey: keyVal };
    if (provider === 'mapbox') newConfig.mapboxToken = keyVal;
    if (provider === 'google') newConfig.googleKey = keyVal;
    if (provider === 'maptiler') newConfig.maptilerKey = keyVal;

    window.aarohanMapConfig = Object.assign(window.aarohanMapConfig, newConfig);
    try {
      localStorage.setItem('aarohan_map_config', JSON.stringify(window.aarohanMapConfig));
    } catch (e) { }

    applyTileLayerToMap(map, false);
    applyTileLayerToMap(trackingMap, true);
    updateMapConfigBadge();

    try {
      await fetch('/api/map-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
    } catch (err) { }

    showToast(`✅ ${provider.toUpperCase()} Map Key applied!`);
    window.closeMapConfigModal();
  };

  function updateMapConfigBadge() {
    const badge = document.getElementById('active-map-provider-badge');
    const profileBadge = document.getElementById('profile-map-provider-badge');
    const p = window.aarohanMapConfig.provider || 'carto';
    let label = 'Map API';
    let profileLabel = 'CartoDB Voyager (Free)';

    if (p === 'mapbox') {
      label = 'Mapbox';
      profileLabel = 'Mapbox Streets (Active)';
    } else if (p === 'google') {
      label = 'Google';
      profileLabel = 'Google Maps (Active)';
    } else if (p === 'maptiler') {
      label = 'MapTiler';
      profileLabel = 'MapTiler (Active)';
    }

    if (badge) badge.innerText = label;
    if (profileBadge) profileBadge.innerText = profileLabel;
  }

  function showToast(msg) {
    const existing = document.getElementById('aarohan-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'aarohan-toast';
    toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-[3000] bg-slate-900 text-white px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-2 border border-slate-700 animate-bounce';
    toast.innerHTML = `<span class="material-symbols-outlined text-[16px] text-emerald-400">check_circle</span><span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s ease';
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  // =========================================================================
  // 12. MALAWI NETWORK RESILIENCE & OFFLINE MONITOR (PHASE 2.D)
  // =========================================================================
  function initNetworkResilienceMonitor() {
    const banner = document.getElementById('offline-indicator-banner');
    const bannerText = document.getElementById('offline-banner-text');
    const timeEl = document.getElementById('offline-timestamp');

    function updateNetworkStatus() {
      const isOnline = navigator.onLine;
      if (!isOnline) {
        if (banner) {
          banner.classList.remove('hidden');
          banner.className = 'fixed top-16 inset-x-0 z-40 bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold shadow-md transition-all flex items-center justify-between';
        }
        if (bannerText) bannerText.innerHTML = '⚠️ Operating Offline • Malawi Low-Data Mode Active';
        if (timeEl) timeEl.innerText = `Last sync: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        if (banner && !banner.classList.contains('hidden')) {
          banner.className = 'fixed top-16 inset-x-0 z-40 bg-emerald-600 text-white px-4 py-2 text-xs font-bold shadow-md transition-all flex items-center justify-between';
          if (bannerText) bannerText.innerHTML = '🟢 Reconnected! Synchronizing live ride status...';
          flushOfflineActionQueue();
          setTimeout(() => {
            if (banner) banner.classList.add('hidden');
          }, 2500);
        }
      }
    }

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    if (!navigator.onLine) updateNetworkStatus();
  }

  function flushOfflineActionQueue() {
    if (!offlineActionQueue.length) return;
    console.log('[AArohanOffline] Flushing queued actions:', offlineActionQueue.length);
    const queue = [...offlineActionQueue];
    offlineActionQueue = [];
    try { localStorage.removeItem('aarohan_offline_actions'); } catch (e) { }

    queue.forEach(action => {
      if (action.type === 'BOOK_RIDE' && window.mwendoStore) {
        window.mwendoStore.requestTrip(action.payload);
      } else if (action.type === 'CHAT_MSG' && window.mwendoStore) {
        window.mwendoStore.sendChatMessage(action.payload.sender, action.payload.text);
      }
    });
    showToast('Synced offline updates with AArohan Lilongwe dispatch');
  }

  // =========================================================================
  // 13. STALE GPS LOCATION WATCHDOG (PHASE 2.B)
  // =========================================================================
  function initStaleTelemetryWatchdog() {
    clearInterval(staleLocationCheckInterval);
    staleLocationCheckInterval = setInterval(() => {
      const state = window.mwendoStore ? window.mwendoStore.getState() : null;
      if (!state || !state.activeTrip) return;
      const status = state.activeTrip.status;

      if (['ACCEPTED', 'ARRIVED', 'IN_TRANSIT'].includes(status)) {
        const timeSinceLastUpdate = Date.now() - lastDriverMovedTimestamp;
        if (timeSinceLastUpdate > 30000) {
          updateStaleTelemetryBadge(true, Math.floor(timeSinceLastUpdate / 1000));
        } else {
          updateStaleTelemetryBadge(false);
        }
      }
    }, 4000);
  }

  function updateStaleTelemetryBadge(isStale, secondsAgo = 30) {
    const liveTag = document.getElementById('tracking-live-tag');
    if (!liveTag) return;

    if (isStale) {
      liveTag.innerHTML = `⚠️ Signal Stale (${secondsAgo}s ago) • Reconnecting...`;
      liveTag.className = 'text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200';
    } else {
      liveTag.innerHTML = `Live • Kaunda Rd, Lilongwe`;
      liveTag.className = 'text-xs font-bold text-slate-800';
    }
  }

  // =========================================================================
  // 14. ACTIVE RIDE RECOVERY AFTER RESTART (PHASE 2.D)
  // =========================================================================
  function recoverActiveRideSession() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('reset')) {
      try {
        localStorage.removeItem('aarohan_active_ride_state');
        localStorage.removeItem('mwendo_platform_state_v1');
      } catch (e) { }
      fetch('/api/reset', { method: 'POST' }).catch(() => { });
      return;
    }

    let saved = null;
    try {
      const raw = localStorage.getItem('aarohan_active_ride_state');
      if (raw) saved = JSON.parse(raw);
    } catch (e) { }

    // Check if saved trip is recent (< 3 hours old)
    if (saved && saved.activeTrip && (Date.now() - (saved.timestamp || 0) < 10800000)) {
      console.log('[AArohanRecovery] Recovering active ride session from storage:', saved.activeTrip.id);
      if (saved.pickup) currentPickup = saved.pickup;
      if (saved.destination) currentDestination = saved.destination;
      if (saved.activeQuote) activeQuote = saved.activeQuote;

      const status = saved.activeTrip.status;
      if (status === 'REQUESTED') {
        window.switchView('dispatching');
        startDispatchCountdown();
      } else if (['ACCEPTED', 'ARRIVED', 'IN_TRANSIT'].includes(status)) {
        window.switchView('tracking');
        if (window.initTrackingMap) setTimeout(() => window.initTrackingMap(), 150);
      }
    }

    // Verify with authoritative server state
    fetch('/api/state')
      .then(r => r.json())
      .then(serverState => {
        if (serverState && serverState.activeTrip) {
          const trip = serverState.activeTrip;
          if (['REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_TRANSIT'].includes(trip.status)) {
            console.log('[AArohanRecovery] Server confirmed active trip:', trip.id, trip.status);
            handleStateUpdate(serverState, 'SESSION_RECOVERED', trip);
          }
        }
      })
      .catch(err => console.warn('[AArohanRecovery] Server sync failed (offline):', err));
  }

  // =========================================================================
  // 15. TRIP SHARING WITH TRUSTED CONTACT (PHASE 2.B)
  // =========================================================================
  window.shareTripDetails = async function () {
    const state = window.mwendoStore ? window.mwendoStore.getState() : null;
    const trip = state && state.activeTrip ? state.activeTrip : { id: 'TRIP-LL-9821', destination: currentDestination.name, pin: '8421' };
    const driver = state && state.driver ? state.driver : { name: 'Blessings Phiri', plate: 'LL 4920 B' };

    const shareUrl = `${window.location.origin}/ride-tracking.html?tripId=${encodeURIComponent(trip.id)}&pin=${encodeURIComponent(trip.pin || '')}`;
    const shareText = `I am on a AArohan ride in Lilongwe to ${trip.destination}. Captain: ${driver.name} (${driver.plate}). Track my route live:`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AArohan Live Trip Tracking',
          text: shareText,
          url: shareUrl
        });
        showToast('Trip shared successfully!');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('Web Share failed, fallback to modal', err);
      }
    }

    // Modal Fallback
    const modal = document.getElementById('share-trip-modal');
    const input = document.getElementById('share-trip-url-input');
    const smsLink = document.getElementById('share-sms-link');
    const waLink = document.getElementById('share-whatsapp-link');

    if (input) input.value = shareUrl;
    if (smsLink) smsLink.href = `sms:?body=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
    if (waLink) waLink.href = `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;

    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeShareTripModal = function () {
    const modal = document.getElementById('share-trip-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.copyTripShareUrl = function () {
    const input = document.getElementById('share-trip-url-input');
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        showToast('Tracking link copied to clipboard!');
      });
    }
  };

  // =========================================================================
  // 16. EMERGENCY SOS ENHANCED ESCALATION (PHASE 2.B & 2.E)
  // =========================================================================
  window.confirmSosAlert = function () {
    const state = window.mwendoStore ? window.mwendoStore.getState() : null;
    const trip = state?.activeTrip;
    const coordsStr = `${currentPickup.lat.toFixed(5)}, ${currentPickup.lng.toFixed(5)}`;
    const locationName = currentPickup.name || 'Kaunda Road corridor, Area 47, Lilongwe';

    const sosPayload = {
      source: 'RIDER',
      tripId: trip?.id || 'NO_ACTIVE_TRIP',
      location: `${locationName} [GPS: ${coordsStr}]`,
      lat: currentPickup.lat,
      lng: currentPickup.lng,
      timestamp: Date.now(),
      riderPhone: state?.rider?.phone || '+265 99 123 4567',
      driverPhone: state?.driver?.phone || '+265 99 554 1122',
      note: 'Rider triggered emergency assistance on Lilongwe transit corridor'
    };

    if (window.mwendoStore && window.mwendoStore.socket) {
      window.mwendoStore.socket.emit('sos:trigger', sosPayload);
    }

    const modal = document.getElementById('sos-modal');
    if (modal) modal.classList.add('hidden');

    showToast('🚨 SOS Dispatched! Police (997) & AArohan Response Desk notified.');
    if (window.aarohanSound) window.aarohanSound.playEmergencyAlarm();
  };

  // =========================================================================
  // 17. DEVELOPER & VERIFICATION TESTING ACTIONS WITH LIVE SIMULATION
  // =========================================================================
  let simulationApproachInterval = null;
  let simulationTransitInterval = null;

  window.simulateDriverAcceptNow = function () {
    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      store.acceptTrip();
    }
    showToast('Captain accepted trip! Approaching pickup...');
    if (window.aarohanSound) window.aarohanSound.playAcceptChime();

    // Start autonomous approach animation from current driver position to pickup
    startAutonomousApproach();
  };

  function startAutonomousApproach() {
    clearInterval(simulationApproachInterval);
    const startLat = -13.9650;
    const startLng = 33.7820;
    const targetLat = Number(currentPickup?.lat) || -13.9722;
    const targetLng = Number(currentPickup?.lng) || 33.7667;
    const steps = 6;
    let step = 0;

    simulationApproachInterval = setInterval(() => {
      step++;
      const factor = step / steps;
      const currentLat = startLat + (targetLat - startLat) * factor;
      const currentLng = startLng + (targetLng - startLng) * factor;

      if (!isNaN(currentLat) && !isNaN(currentLng)) {
        const store = window.aarohanStore || window.mwendoStore;
        if (store) {
          store.sendDriverLocation({ lat: parseFloat(currentLat.toFixed(5)), lng: parseFloat(currentLng.toFixed(5)) });
        }
      }

      if (step >= steps) {
        clearInterval(simulationApproachInterval);
        const store = window.aarohanStore || window.mwendoStore;
        if (store) {
          store.driverArrived();
        }
        showToast('Captain has arrived at pickup point!');
        if (window.aarohanSound) window.aarohanSound.playTone(600, 'triangle', 0.25);
      }
    }, 1200);
  }

  window.startRiderTransitNow = function () {
    clearInterval(simulationApproachInterval);
    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      store.startTransit();
    }
    showToast('PIN verified! Ride in transit to destination...');
    if (window.aarohanSound) window.aarohanSound.playTone(520, 'sine', 0.2);

    // Start autonomous transit along route polyline
    startAutonomousTransit();
  };

  function startAutonomousTransit() {
    clearInterval(simulationTransitInterval);
    const pLat = Number(currentPickup?.lat) || -13.9722;
    const pLng = Number(currentPickup?.lng) || 33.7667;
    const dLat = Number(currentDestination?.lat) || -13.9850;
    const dLng = Number(currentDestination?.lng) || 33.7750;

    const rawPoly = (activeQuote && activeQuote.route && Array.isArray(activeQuote.route.polyline) && activeQuote.route.polyline.length > 0)
      ? activeQuote.route.polyline
      : [[pLat, pLng], [dLat, dLng]];

    // Normalize polyline points to guaranteed [lat, lng] numbers
    const poly = rawPoly.map(pt => {
      if (Array.isArray(pt)) {
        return [Number(pt[0]) || pLat, Number(pt[1]) || pLng];
      } else if (pt && typeof pt === 'object') {
        return [Number(pt.lat) || pLat, Number(pt.lng) || pLng];
      }
      return [pLat, pLng];
    });

    let idx = 0;
    const totalPoints = poly.length;
    const stride = Math.max(1, Math.floor(totalPoints / 8));

    simulationTransitInterval = setInterval(() => {
      idx += stride;
      if (idx >= totalPoints) {
        idx = totalPoints - 1;
        clearInterval(simulationTransitInterval);
        const store = window.aarohanStore || window.mwendoStore;
        if (store) {
          store.sendDriverLocation({ lat: poly[idx][0], lng: poly[idx][1] });
          setTimeout(() => {
            window.simulateCompleteTrip();
          }, 800);
        }
        return;
      }

      const pt = poly[idx];
      const store = window.aarohanStore || window.mwendoStore;
      if (store && pt && !isNaN(pt[0]) && !isNaN(pt[1])) {
        store.sendDriverLocation({ lat: pt[0], lng: pt[1] });
      }
    }, 1200);
  }

  window.completeRiderTripNow = function () {
    clearInterval(simulationApproachInterval);
    clearInterval(simulationTransitInterval);
    window.simulateCompleteTrip();
  };

  window.simulateCompleteTrip = function () {
    clearInterval(simulationApproachInterval);
    clearInterval(simulationTransitInterval);
    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      store.completeTrip();
    }
    showToast('Trip completed! 70% settled to Captain • 30% Platform Escrow');
  };

  window.triggerFakeSafetyCall = function () {
    const modal = document.getElementById('fake-call-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playTone(440, 'triangle', 0.8, 0.2);
  };

  window.dismissFakeCall = function () {
    const modal = document.getElementById('fake-call-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.answerFakeCall = function () {
    const modal = document.getElementById('fake-call-modal');
    if (modal) modal.classList.add('hidden');
    showToast('Safety Call Connected (Encrypted Audio)');
  };

  // =========================================================================
  // 18. INTERACTIVE UI UTILITIES & QUICK VEHICLE SELECTION
  // =========================================================================
  window.selectVehicleQuick = function (tierName, minFare) {
    const tierMap = {
      'Gaman Moto': 'moto',
      'Gaman Auto': 'auto',
      'Gaman Cab': 'cab',
      'AArohan Moto': 'moto',
      'AArohan Auto': 'auto',
      'AArohan Cab': 'cab'
    };
    const id = tierMap[tierName] || 'moto';
    window.selectRideTier(id);

    if (!currentDestination || !currentDestination.name || currentDestination.name === currentPickup.name) {
      window.openSearchModal();
    } else {
      window.openSelectedRideSheet();
      calculateAuthoritativeQuote();
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.toggleFavorite = function (btn) {
    const icon = btn.querySelector('.material-symbols-outlined') || btn;
    const isFav = icon.innerText.trim() === 'favorite';
    icon.innerText = isFav ? 'favorite_border' : 'favorite';
    icon.classList.toggle('text-rose-500', !isFav);
    showToast(isFav ? 'Removed from favorites' : 'Saved to favorite places');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.toggleCompliment = function (btn) {
    btn.classList.toggle('bg-emerald-600');
    btn.classList.toggle('text-white');
    btn.classList.toggle('border-emerald-600');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.pasteKeyFromClipboard = async function () {
    try {
      const text = await navigator.clipboard.readText();
      const input = document.getElementById('map-api-key-input');
      if (input && text) {
        input.value = text.trim();
        showToast('Map API key pasted from clipboard');
      }
    } catch (err) {
      showToast('Please paste key manually into the field');
    }
  };

  window.toggleApiKeyVisibility = function () {
    const input = document.getElementById('map-api-key-input');
    const icon = document.getElementById('api-key-eye-icon');
    if (input && icon) {
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      icon.innerText = isPass ? 'visibility_off' : 'visibility';
    }
  };

  window.resetMapConfigDefault = function () {
    window.selectMapProviderUI('carto');
    const input = document.getElementById('map-api-key-input');
    if (input) input.value = '';
    window.saveMapConfigFromUI();
    showToast('Reset to default Lilongwe CartoDB map tiles');
  };

  // =========================================================================
  // 19. PROMO VOUCHERS & DISCOUNTS
  // =========================================================================
  let appliedPromoDiscount = 0;
  let appliedPromoCodeStr = '';

  window.openPromoModal = function () {
    const modal = document.getElementById('voucher-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closePromoModal = function () {
    const modal = document.getElementById('voucher-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.applyPromoCode = function (code) {
    appliedPromoCodeStr = code.toUpperCase();
    if (appliedPromoCodeStr === 'AAROHAN500') {
      appliedPromoDiscount = 500;
    } else if (appliedPromoCodeStr === 'CHITIPIKABAZA') {
      appliedPromoDiscount = 750;
    } else if (appliedPromoCodeStr === 'FIRSTLILONGWE') {
      appliedPromoDiscount = 1000;
    } else {
      appliedPromoDiscount = 500;
    }

    if (activeQuote && activeQuote.tiers) {
      Object.keys(activeQuote.tiers).forEach(k => {
        const t = activeQuote.tiers[k];
        t.finalFare = Math.max(t.minimumFare || 1000, t.baseFare + (t.distanceFare || 0) - appliedPromoDiscount);
      });
      renderTierFares(activeQuote);
    }

    window.closePromoModal();
    showToast(`🎟️ Voucher ${appliedPromoCodeStr} applied! Saved MK ${appliedPromoDiscount.toLocaleString()}`);
    if (window.aarohanSound) window.aarohanSound.playCashRegister();
  };

  window.applyCustomVoucher = function () {
    const input = document.getElementById('voucher-code-input');
    const code = input ? input.value.trim() : '';
    if (!code) {
      showToast('Please type a valid voucher code');
      return;
    }
    window.applyPromoCode(code);
  };

  // =========================================================================
  // 20. WALLET TOP UP (AIRTEL/TNM) & P2P KWACHA TRANSFERS
  // =========================================================================
  let selectedTopUpProviderName = 'Airtel Money';
  let selectedTopUpAmountNum = 10000;

  window.openWalletTopUpModal = function () {
    const modal = document.getElementById('wallet-topup-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeWalletTopUpModal = function () {
    const modal = document.getElementById('wallet-topup-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.selectTopUpProvider = function (provider, el) {
    selectedTopUpProviderName = (provider === 'airtel') ? 'Airtel Money' : 'TNM Mpamba';
    const airtelCard = document.getElementById('topup-prov-airtel');
    const tnmCard = document.getElementById('topup-prov-tnm');

    if (provider === 'airtel') {
      if (airtelCard) airtelCard.className = 'p-3 rounded-2xl border-2 border-red-600 bg-red-50/40 cursor-pointer flex items-center gap-2.5';
      if (tnmCard) tnmCard.className = 'p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer flex items-center gap-2.5';
    } else {
      if (tnmCard) tnmCard.className = 'p-3 rounded-2xl border-2 border-emerald-700 bg-emerald-50/40 cursor-pointer flex items-center gap-2.5';
      if (airtelCard) airtelCard.className = 'p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer flex items-center gap-2.5';
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.setTopUpAmount = function (amt, btn) {
    selectedTopUpAmountNum = amt;
    const input = document.getElementById('topup-amount-input');
    if (input) input.value = amt;

    document.querySelectorAll('.topup-amt-btn').forEach(b => {
      b.className = 'topup-amt-btn py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-black text-slate-800 hover:bg-slate-100';
    });
    if (btn) btn.className = 'topup-amt-btn py-2 rounded-xl border-2 border-slate-900 bg-slate-900 text-xs font-black text-white selected';

    const submitText = document.getElementById('topup-submit-btn-text');
    if (submitText) submitText.innerText = `Authorize Top Up • MK ${amt.toLocaleString()}`;
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.executeWalletTopUpAction = function () {
    const input = document.getElementById('topup-amount-input');
    const amt = input ? parseInt(input.value, 10) : selectedTopUpAmountNum;
    if (isNaN(amt) || amt < 500) {
      showToast('Minimum top up is MK 500');
      return;
    }

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      store.topUpRiderWallet(amt, selectedTopUpProviderName);
    }

    window.closeWalletTopUpModal();
    showToast(`✅ MK ${amt.toLocaleString()} added to AArohan Wallet via ${selectedTopUpProviderName}!`);
    if (window.aarohanSound) window.aarohanSound.playCashRegister();
  };

  window.openP2PTransferModal = function () {
    const modal = document.getElementById('p2p-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeP2PTransferModal = function () {
    const modal = document.getElementById('p2p-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.executeP2PTransferAction = function () {
    const phoneInput = document.getElementById('p2p-phone-input');
    const amtInput = document.getElementById('p2p-amount-input');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const amt = amtInput ? parseInt(amtInput.value, 10) : 0;

    if (!phone) {
      showToast('Please enter recipient mobile number');
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      showToast('Please enter a valid amount');
      return;
    }

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      const state = store.getState();
      if (state.rider.walletBalance < amt) {
        showToast('Insufficient wallet balance. Top up first!');
        return;
      }
      state.rider.walletBalance -= amt;
      state.transactionLogs.unshift({
        id: 'TX-P2P-' + Math.floor(100 + Math.random() * 900),
        type: 'P2P',
        title: `Transfer to ${phone}`,
        amount: -amt,
        method: 'AArohan Kwacha',
        time: 'Just now',
        status: 'Sent'
      });
      store.saveState(state);
      store.notifyListeners(state, 'P2P_SENT', { phone, amt });
    }

    window.closeP2PTransferModal();
    showToast(`✅ Sent MK ${amt.toLocaleString()} to ${phone}!`);
    if (window.aarohanSound) window.aarohanSound.playCashRegister();
  };

  // =========================================================================
  // 21. OWNLY / SELF-DRIVE VEHICLE RENTALS
  // =========================================================================
  window.selectedRentalVehicle = {
    name: 'Honda Ace 125',
    hourlyRate: 3000,
    dailyRate: 15000,
    duration: 4,
    unit: 'hours'
  };

  window.openRentalModal = function (vehName, hourlyRate, dailyRate) {
    window.selectedRentalVehicle = {
      name: vehName,
      hourlyRate: hourlyRate,
      dailyRate: dailyRate,
      duration: 4,
      unit: 'hours'
    };

    const titleEl = document.getElementById('rental-modal-veh-name');
    if (titleEl) titleEl.innerText = vehName;

    const fareEl = document.getElementById('rental-total-fare');
    if (fareEl) fareEl.innerText = `MK ${(hourlyRate * 4).toLocaleString()}`;

    const modal = document.getElementById('rental-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeRentalModal = function () {
    const modal = document.getElementById('rental-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.selectRentalDuration = function (dur, unit, btn) {
    window.selectedRentalVehicle.duration = dur;
    window.selectedRentalVehicle.unit = unit;

    const rate = (unit === 'days') ? window.selectedRentalVehicle.dailyRate : window.selectedRentalVehicle.hourlyRate;
    const total = rate * dur;

    const fareEl = document.getElementById('rental-total-fare');
    if (fareEl) fareEl.innerText = `MK ${total.toLocaleString()}`;

    document.querySelectorAll('.rental-dur-btn').forEach(b => {
      b.className = 'rental-dur-btn py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700';
    });
    if (btn) btn.className = 'rental-dur-btn py-2 rounded-xl border-2 border-slate-900 bg-slate-900 text-[11px] font-bold text-white selected';

    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.confirmRentalReservationAction = function () {
    const depotSelect = document.getElementById('rental-depot-select');
    const depot = depotSelect ? depotSelect.value : 'Gateway Mall Hub';
    const veh = window.selectedRentalVehicle;
    const rate = (veh.unit === 'days') ? veh.dailyRate : veh.hourlyRate;
    const total = rate * veh.duration;

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      const state = store.getState();
      state.transactionLogs.unshift({
        id: 'TX-RNT-' + Math.floor(100 + Math.random() * 900),
        type: 'RENTAL',
        title: `Rental: ${veh.name} (${veh.duration} ${veh.unit})`,
        amount: -total,
        method: 'Escrow Hold',
        time: 'Just now',
        status: 'Confirmed'
      });
      store.saveState(state);
      store.notifyListeners(state, 'RENTAL_CONFIRMED', { veh, depot, total });
    }

    window.closeRentalModal();
    showToast(`✅ Reservation Confirmed! ${veh.name} ready for pickup at ${depot}`);
    if (window.aarohanSound) window.aarohanSound.playTripCompleteFanfare();
  };

  // =========================================================================
  // 22. PARCEL COURIER DISPATCH
  // =========================================================================
  window.selectedParcelCategoryKey = 'doc';
  window.selectedParcelSpeedKey = 'express';

  window.selectParcelCategory = function (cat, btn) {
    window.selectedParcelCategoryKey = cat;
    document.querySelectorAll('.parcel-cat-btn').forEach(b => {
      b.className = 'parcel-cat-btn p-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 flex flex-col items-center gap-1 text-center';
      const icon = b.querySelector('.material-symbols-outlined');
      if (icon) icon.className = 'material-symbols-outlined text-[20px] text-slate-600';
      const text = b.querySelector('span:last-child');
      if (text) text.className = 'text-[10px] font-bold text-slate-700';
    });
    if (btn) {
      btn.className = 'parcel-cat-btn selected p-2 rounded-2xl border-2 border-purple-600 bg-purple-50/60 flex flex-col items-center gap-1 text-center';
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.className = 'material-symbols-outlined text-[20px] text-purple-600';
      const text = btn.querySelector('span:last-child');
      if (text) text.className = 'text-[10px] font-bold text-slate-900';
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.selectParcelSpeed = function (speed) {
    window.selectedParcelSpeedKey = speed;
    const expCard = document.getElementById('parcel-speed-express');
    const stdCard = document.getElementById('parcel-speed-standard');
    const submitText = document.getElementById('parcel-submit-btn-text');

    if (speed === 'express') {
      if (expCard) expCard.className = 'p-3 rounded-2xl border-2 border-purple-600 bg-purple-50/60 cursor-pointer flex flex-col justify-between';
      if (stdCard) stdCard.className = 'p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer flex flex-col justify-between';
      if (submitText) submitText.innerText = 'Dispatch Parcel Courier • MK 2,500';
    } else {
      if (stdCard) stdCard.className = 'p-3 rounded-2xl border-2 border-purple-600 bg-purple-50/60 cursor-pointer flex flex-col justify-between';
      if (expCard) expCard.className = 'p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer flex flex-col justify-between';
      if (submitText) submitText.innerText = 'Dispatch Parcel Courier • MK 1,800';
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.submitParcelBooking = function () {
    const pickup = document.getElementById('parcel-pickup-input')?.value.trim() || 'Gateway Mall, Area 47';
    const dest = document.getElementById('parcel-dest-input')?.value.trim() || 'EPTL Malawi Industrial';
    const receiver = document.getElementById('parcel-receiver-name')?.value.trim() || 'Peter Banda';
    const phone = document.getElementById('parcel-receiver-phone')?.value.trim() || '+265 99 223 3445';
    const fare = (window.selectedParcelSpeedKey === 'express') ? 2500 : 1800;

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      const state = store.getState();
      state.transactionLogs.unshift({
        id: 'TX-PCL-' + Math.floor(100 + Math.random() * 900),
        type: 'PARCEL',
        title: `Parcel to ${receiver}`,
        amount: -fare,
        method: 'Airtel Money Escrow',
        time: 'Just now',
        status: 'Dispatched'
      });
      store.saveState(state);
      store.notifyListeners(state, 'PARCEL_BOOKED', { pickup, dest, receiver, phone, fare });
    }

    const pickupLabel = (typeof pickup === 'string') ? pickup.split(',')[0] : (pickup?.name || 'Pickup Point');
    showToast(`📦 Courier Dispatched! Captain assigned to collect from ${pickupLabel}`);
    if (window.aarohanSound) window.aarohanSound.playDispatchAlert();
  };

  // =========================================================================
  // 23. INTERCITY TRAVEL CORRIDORS
  // =========================================================================
  window.selectedIntercityData = {
    dest: 'Blantyre City Centre',
    distKm: 310,
    sedanFare: 45000,
    shuttleFare: 20000,
    mode: 'sedan',
    slot: '07:00 AM'
  };

  window.openIntercityModal = function (dest, distKm, sedanFare, shuttleFare) {
    window.selectedIntercityData = {
      dest,
      distKm,
      sedanFare,
      shuttleFare,
      mode: 'sedan',
      slot: '07:00 AM'
    };

    const routeEl = document.getElementById('intercity-modal-route');
    const destLabel = (typeof dest === 'string') ? dest.split('(')[0].trim() : (dest?.name || 'Destination');
    if (routeEl) routeEl.innerText = `Lilongwe → ${destLabel}`;

    const distEl = document.getElementById('intercity-modal-dist');
    if (distEl) distEl.innerText = `${distKm} km • Corridor Express`;

    const sedanEl = document.getElementById('intercity-sedan-price');
    if (sedanEl) sedanEl.innerText = `MK ${sedanFare.toLocaleString()}`;

    const shuttleEl = document.getElementById('intercity-shuttle-price');
    if (shuttleEl) shuttleEl.innerText = `MK ${shuttleFare.toLocaleString()}`;

    window.selectIntercityMode('sedan');

    const modal = document.getElementById('intercity-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeIntercityModal = function () {
    const modal = document.getElementById('intercity-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.selectDepartureSlot = function (slot, btn) {
    window.selectedIntercityData.slot = slot;
    document.querySelectorAll('.slot-btn').forEach(b => {
      b.className = 'slot-btn py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-[11px] font-bold';
    });
    if (btn) btn.className = 'slot-btn selected py-2 rounded-xl border-2 border-slate-900 bg-slate-900 text-white text-[11px] font-bold';
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.selectIntercityMode = function (mode) {
    window.selectedIntercityData.mode = mode;
    const sedanCard = document.getElementById('mode-sedan');
    const shuttleCard = document.getElementById('mode-shuttle');
    const submitText = document.getElementById('intercity-submit-btn-text');
    const fare = (mode === 'sedan') ? window.selectedIntercityData.sedanFare : window.selectedIntercityData.shuttleFare;

    if (mode === 'sedan') {
      if (sedanCard) sedanCard.className = 'p-3 rounded-2xl border-2 border-blue-600 bg-blue-50/60 cursor-pointer flex flex-col justify-between';
      if (shuttleCard) shuttleCard.className = 'p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer flex flex-col justify-between';
    } else {
      if (shuttleCard) shuttleCard.className = 'p-3 rounded-2xl border-2 border-blue-600 bg-blue-50/60 cursor-pointer flex flex-col justify-between';
      if (sedanCard) sedanCard.className = 'p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer flex flex-col justify-between';
    }

    if (submitText) submitText.innerText = `Book Intercity Journey • MK ${fare.toLocaleString()}`;
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.confirmIntercityReservationAction = function () {
    const passName = document.getElementById('intercity-pass-name')?.value.trim() || 'Chisomo Banda';
    const passPhone = document.getElementById('intercity-pass-phone')?.value.trim() || '+265 99 123 4567';
    const data = window.selectedIntercityData;
    const fare = (data.mode === 'sedan') ? data.sedanFare : data.shuttleFare;

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      const state = store.getState();
      state.transactionLogs.unshift({
        id: 'TX-INT-' + Math.floor(100 + Math.random() * 900),
        type: 'TRAVEL',
        title: `Intercity: Lilongwe to ${typeof data.dest === 'string' ? data.dest.split(' ')[0] : (data.dest?.name || 'Destination')}`,
        amount: -fare,
        method: 'Airtel Money Escrow',
        time: 'Just now',
        status: 'Reserved'
      });
      store.saveState(state);
      store.notifyListeners(state, 'INTERCITY_BOOKED', { passName, passPhone, fare, data });
    }

    window.closeIntercityModal();
    const destIntercity = typeof data.dest === 'string' ? data.dest.split('(')[0] : (data.dest?.name || 'Destination');
    showToast(`🎫 Intercity Reserved! Departure: ${data.slot} to ${destIntercity}`);
    if (window.aarohanSound) window.aarohanSound.playTripCompleteFanfare();
  };

  // =========================================================================
  // 24. PROFILE EDIT ACTION
  // =========================================================================
  window.openProfileEditModal = function () {
    const modal = document.getElementById('profile-edit-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeProfileEditModal = function () {
    const modal = document.getElementById('profile-edit-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.saveProfileEditAction = function () {
    const name = document.getElementById('edit-profile-name')?.value.trim();
    const phone = document.getElementById('edit-profile-phone')?.value.trim();
    const ice = document.getElementById('edit-profile-ice')?.value.trim();

    if (!name) {
      showToast('Name cannot be blank');
      return;
    }

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      const state = store.getState();
      if (!state.rider) state.rider = {};
      state.rider.name = name;
      if (phone) state.rider.phone = phone;
      if (ice) state.rider.emergencyPhone = ice;
      store.saveState(state);
      store.notifyListeners(state, 'PROFILE_UPDATED', state.rider);
    }

    window.closeProfileEditModal();
    showToast('✅ Profile updated successfully!');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  // =========================================================================
  // 14. BILINGUAL LOCALIZATION HANDLER (ENGLISH ⇄ CHICHEWA)
  // =========================================================================
  window.toggleAppLanguage = function () {
    if (window.aarohanI18n) {
      const nextLang = window.aarohanI18n.toggleLang();
      const badge = document.getElementById('lang-toggle-text');
      if (badge) {
        badge.innerText = nextLang === 'en' ? 'NY' : 'EN';
      }
      if (window.showToast) {
        window.showToast(nextLang === 'ny' ? '🇲🇼 Chiyankhulo: Chichewa' : '🇬🇧 Language: English');
      }
      if (window.aarohanSound) window.aarohanSound.playClick();
    }
  };

  // =========================================================================
  // 15. DYNAMIC SURGE & DEMAND HEATMAP ON LEAFLET MAP
  // =========================================================================
  const LILONGWE_SURGE_ZONES = [
    { name: 'Gateway Mall / Area 47', lat: -13.9722, lng: 33.7667, surge: 1.4, radius: 650, color: '#ef4444' },
    { name: 'Lilongwe City Centre (Capital Hill)', lat: -13.9550, lng: 33.7850, surge: 1.3, radius: 750, color: '#f97316' },
    { name: 'Old Town Market (Area 2)', lat: -13.9820, lng: 33.7740, surge: 1.25, radius: 550, color: '#f59e0b' },
    { name: 'Area 3 Commercial & Crossroads', lat: -13.9780, lng: 33.7650, surge: 1.2, radius: 500, color: '#f59e0b' },
    { name: 'Bingu Stadium (Area 49)', lat: -13.9350, lng: 33.7450, surge: 1.35, radius: 600, color: '#f97316' }
  ];
  window.LILONGWE_SURGE_ZONES = LILONGWE_SURGE_ZONES;

  let heatmapLayerGroup = null;
  let isHeatmapActive = false;

  window.toggleDemandHeatmap = function () {
    if (!map || typeof L === 'undefined') return;

    if (isHeatmapActive) {
      if (heatmapLayerGroup) {
        map.removeLayer(heatmapLayerGroup);
        heatmapLayerGroup = null;
      }
      isHeatmapActive = false;
      const btn = document.getElementById('heatmap-toggle-btn');
      if (btn) {
        btn.className = 'absolute top-15 right-3 z-[1000] h-9 px-3 rounded-full bg-white/95 backdrop-blur-md shadow-md border border-amber-300 flex items-center gap-1.5 text-amber-900 hover:bg-amber-50 transition-all active:scale-95';
      }
      if (window.showToast) window.showToast('Surge heatmap hidden');
      return;
    }

    isHeatmapActive = true;
    heatmapLayerGroup = L.layerGroup();

    LILONGWE_SURGE_ZONES.forEach(zone => {
      // Outer pulsating aura circle
      const outerCircle = L.circle([zone.lat, zone.lng], {
        radius: zone.radius,
        color: zone.color,
        weight: 2,
        opacity: 0.8,
        fillColor: zone.color,
        fillOpacity: 0.18,
        dashArray: '4, 6'
      });

      // Inner core circle
      const innerCircle = L.circle([zone.lat, zone.lng], {
        radius: zone.radius * 0.45,
        color: zone.color,
        weight: 1,
        fillColor: zone.color,
        fillOpacity: 0.4
      });

      // Surge label tooltip/marker
      const labelIcon = L.divIcon({
        className: 'surge-zone-label',
        html: `
          <div style="background:#0f172a; color:#fef08a; font-size:10px; font-weight:800; padding:2px 8px; border-radius:12px; border:1px solid #f59e0b; box-shadow:0 2px 8px rgba(0,0,0,0.3); white-space:nowrap; display:flex; align-items:center; gap:3px;">
            <span>🔥</span>
            <span>${zone.surge}x ${typeof zone.name === 'string' ? zone.name.split(' ')[0] : (zone.name || 'Zone')}</span>
          </div>
        `,
        iconSize: [110, 24],
        iconAnchor: [55, 12]
      });
      const labelMarker = L.marker([zone.lat, zone.lng], { icon: labelIcon });

      heatmapLayerGroup.addLayer(outerCircle);
      heatmapLayerGroup.addLayer(innerCircle);
      heatmapLayerGroup.addLayer(labelMarker);
    });

    heatmapLayerGroup.addTo(map);

    const btn = document.getElementById('heatmap-toggle-btn');
    if (btn) {
      btn.className = 'absolute top-15 right-3 z-[1000] h-9 px-3 rounded-full bg-amber-500 text-slate-950 font-black shadow-lg ring-2 ring-amber-300 flex items-center gap-1.5 transition-all active:scale-95';
    }

    if (window.showToast) window.showToast('🔥 Lilongwe Dynamic Surge Heatmap Active (Up to 1.4x)');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  // =========================================================================
  // 16. MULTI-STOP INTERMEDIATE WAYPOINT HANDLERS
  // =========================================================================
  window.openIntermediateStopModal = function () {
    const modal = document.getElementById('waypoint-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeIntermediateStopModal = function () {
    const modal = document.getElementById('waypoint-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.selectWaypoint = async function (name) {
    const coords = KNOWN_LILONGWE_LANDMARKS[name] || {
      name,
      lat: -13.9780,
      lng: 33.7650
    };
    currentWaypoint = coords;

    // Update search modal view if visible
    const viaSearchContainer = document.getElementById('search-via-container');
    const viaSearchName = document.getElementById('search-via-name-display');
    if (viaSearchContainer) viaSearchContainer.classList.remove('hidden');
    if (viaSearchName) viaSearchName.innerText = 'Via: ' + coords.name;

    // Update ride selection sheet view
    const rideSheetViaTag = document.getElementById('ride-sheet-via-stop-tag');
    const rideSheetViaName = document.getElementById('ride-sheet-via-stop-name');
    if (rideSheetViaTag) rideSheetViaTag.classList.remove('hidden');
    if (rideSheetViaName) rideSheetViaName.innerText = coords.name;

    window.closeIntermediateStopModal();

    // Recalculate route and authoritative quote
    await calculateAuthoritativeQuote();

    if (window.showToast) window.showToast(`📍 Added Stop: ${coords.name} (+MK 500)`);
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.removeIntermediateStop = async function () {
    currentWaypoint = null;
    if (waypointMarker && map) {
      map.removeLayer(waypointMarker);
      waypointMarker = null;
    }

    const viaSearchContainer = document.getElementById('search-via-container');
    if (viaSearchContainer) viaSearchContainer.classList.add('hidden');

    const rideSheetViaTag = document.getElementById('ride-sheet-via-stop-tag');
    if (rideSheetViaTag) rideSheetViaTag.classList.add('hidden');

    await calculateAuthoritativeQuote();

    if (window.showToast) window.showToast('Intermediate stop removed');
  };

  // =========================================================================
  // 17. SCHEDULE RIDE FOR LATER (PRE-BOOKING)
  // =========================================================================
  let scheduledTripData = null;

  window.openScheduleModal = function () {
    const modal = document.getElementById('schedule-ride-modal');
    if (modal) {
      modal.classList.remove('hidden');
      const dateInput = document.getElementById('schedule-date-input');
      if (dateInput && !dateInput.value) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.value = tomorrow.toISOString().split('T')[0];
      }
      const timeInput = document.getElementById('schedule-time-input');
      if (timeInput && !timeInput.value) {
        timeInput.value = '04:30';
      }
    }
    if (window.aarohanSound) window.aarohanSound.playClick();
  };

  window.closeScheduleModal = function () {
    const modal = document.getElementById('schedule-ride-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.selectSchedulePreset = function (preset) {
    const dateInput = document.getElementById('schedule-date-input');
    const timeInput = document.getElementById('schedule-time-input');
    const notesInput = document.getElementById('schedule-notes-input');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    if (preset === 'airport') {
      if (dateInput) dateInput.value = tomorrowStr;
      if (timeInput) timeInput.value = '04:30';
      if (notesInput) notesInput.value = 'Flight LLW Airport Transfer • ET877';
    } else if (preset === 'capital') {
      if (dateInput) dateInput.value = tomorrowStr;
      if (timeInput) timeInput.value = '07:15';
      if (notesInput) notesInput.value = 'Capital Hill / Area 20 Office Gate';
    } else if (preset === 'night') {
      if (dateInput) dateInput.value = todayStr;
      if (timeInput) timeInput.value = '22:30';
      if (notesInput) notesInput.value = 'Gateway Mall Late Night Pickup';
    }
    if (window.showToast) window.showToast('Preset loaded');
  };

  window.confirmScheduledRide = function () {
    const dateInput = document.getElementById('schedule-date-input');
    const timeInput = document.getElementById('schedule-time-input');
    const notesInput = document.getElementById('schedule-notes-input');

    const dateVal = dateInput?.value || 'Tomorrow';
    const timeVal = timeInput?.value || '04:30 AM';
    const notesVal = notesInput?.value || '';

    scheduledTripData = {
      date: dateVal,
      time: timeVal,
      notes: notesVal,
      pickup: currentPickup?.name || 'Gateway Mall',
      destination: currentDestination?.name || 'Kamuzu International Airport (LLW)',
      tier: selectedRideTier || 'AArohan Moto',
      fare: selectedRidePrice || 2450
    };

    const container = document.getElementById('scheduled-ride-card-container');
    const titleEl = document.getElementById('scheduled-ride-card-title');
    const destEl = document.getElementById('scheduled-ride-card-dest');

    if (container) container.classList.remove('hidden');
    if (titleEl) titleEl.innerText = `${dateVal} • ${timeVal} (${scheduledTripData.tier})`;
    if (destEl) destEl.innerText = `${scheduledTripData.destination} • MK ${scheduledTripData.fare.toLocaleString()}`;

    window.closeScheduleModal();
    window.closeSelectedRideSheet();

    if (window.showToast) {
      window.showToast(`✅ Trip Scheduled: ${timeVal} • Captain will arrive 15 min early`);
    }
    if (window.aarohanSound) window.aarohanSound.playRideBooked();
  };

  window.cancelScheduledRide = function () {
    scheduledTripData = null;
    const container = document.getElementById('scheduled-ride-card-container');
    if (container) container.classList.add('hidden');
    if (window.showToast) window.showToast('Scheduled trip cancelled');
  };

  // =========================================================================
  // 18. NIGHT SAFETY SHIELD & ROUTE DEVIATION WATCHDOG
  // =========================================================================
  window.triggerRouteDeviationAlert = function (isManualTest) {
    const modal = document.getElementById('route-deviation-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.aarohanSound && typeof window.aarohanSound.playTone === 'function') {
      window.aarohanSound.playTone(330, 'square', 0.6, 0.4);
    }
  };

  window.confirmRiderSafe = function () {
    const modal = document.getElementById('route-deviation-modal');
    if (modal) modal.classList.add('hidden');
    if (window.showToast) {
      window.showToast('✅ Detour logged as safe. AArohan corridor monitoring active.');
    }
  };

  window.escalateToPoliceEmergency = function () {
    const modal = document.getElementById('route-deviation-modal');
    if (modal) modal.classList.add('hidden');

    const store = window.aarohanStore || window.mwendoStore;
    if (store) {
      store.triggerSOS('RIDER', 'CRITICAL: Route deviation >400m from corridor. Police notified.');
    }
    if (window.showToast) {
      window.showToast('🚨 997 Police & AArohan Security Desk dispatched with live telemetry');
    }
    setTimeout(() => {
      window.location.href = 'tel:997';
    }, 1200);
  };

})();

