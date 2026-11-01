// Gaman Location, Geocoding & Routing Service • Lilongwe, Malawi
// Uses Mapbox Directions & Geocoding with OpenStreetMap Nominatim / Photon fallback.

const geocodeCache = new Map();
const routeCache = new Map();

// Malawi Geographic Bounding Box
const MALAWI_BBOX = {
  minLng: 32.5,
  minLat: -17.5,
  maxLng: 36.0,
  maxLat: -9.0
};

// Lilongwe City Center Proximity Anchor
const LILONGWE_CENTER = { lat: -13.9626, lng: 33.7873 };

function isWithinMalawi(lat, lng) {
  return lat >= MALAWI_BBOX.minLat && lat <= MALAWI_BBOX.maxLat &&
         lng >= MALAWI_BBOX.minLng && lng <= MALAWI_BBOX.maxLng;
}

// Haversine straight-line distance in km
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class LocationService {
  constructor() {
    this.mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAP_API_KEY || '';
  }

  setMapboxToken(token) {
    if (token) this.mapboxToken = token;
  }

  // 1. Reverse Geocode: (lat, lng) -> Real Street Address in Lilongwe
  async reverseGeocode(lat, lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new Error('Invalid coordinates for reverse geocoding');
    }

    const cacheKey = `rev_${latNum.toFixed(4)}_${lngNum.toFixed(4)}`;
    if (geocodeCache.has(cacheKey)) {
      return geocodeCache.get(cacheKey);
    }

    // Try Nominatim first for detailed street-level Malawi landmarks
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lngNum}&zoom=18&addressdetails=1`;
      const res = await fetch(nomUrl, {
        headers: { 'User-Agent': 'GamanMobility/1.0 (support@gaman.mw)' },
        signal: AbortSignal.timeout(2500)
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          const addr = data.address || {};
          const title = addr.building || addr.amenity || addr.road || addr.suburb || 'Lilongwe Landmark';
          const subtitle = [addr.suburb || addr.quarter, addr.city || 'Lilongwe', 'Malawi'].filter(Boolean).join(', ');

          const result = {
            displayName: data.display_name,
            title,
            subtitle,
            lat: latNum,
            lng: lngNum,
            provider: 'nominatim'
          };
          geocodeCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (e) {
      // Fall through to Mapbox
    }

    // Fallback to Mapbox Geocoding if token available
    if (this.mapboxToken) {
      try {
        const mbUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lngNum},${latNum}.json?access_token=${this.mapboxToken}`;
        const res = await fetch(mbUrl, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          const data = await res.json();
          if (data && data.features && data.features.length) {
            const f = data.features[0];
            const result = {
              displayName: f.place_name,
              title: f.text || f.place_name.split(',')[0],
              subtitle: f.place_name,
              lat: latNum,
              lng: lngNum,
              provider: 'mapbox'
            };
            geocodeCache.set(cacheKey, result);
            return result;
          }
        }
      } catch (e) {}
    }

    // Return coordinate fallback if offline or service unreachable
    const fallback = {
      displayName: `Location (${latNum.toFixed(4)}, ${lngNum.toFixed(4)})`,
      title: 'Current Position',
      subtitle: `${latNum.toFixed(4)}, ${lngNum.toFixed(4)} • Lilongwe`,
      lat: latNum,
      lng: lngNum,
      provider: 'coordinate_fallback'
    };
    return fallback;
  }

  // 2. Real-Time Road Routing: Pickup -> (Waypoints) -> Destination
  async getRoadRoute(pickup, destination, waypoints = []) {
    if (!pickup || !destination) {
      throw new Error('Both pickup and destination coordinates are required for routing.');
    }

    const pLat = parseFloat(pickup.lat);
    const pLng = parseFloat(pickup.lng);
    const dLat = parseFloat(destination.lat);
    const dLng = parseFloat(destination.lng);

    if (isNaN(pLat) || isNaN(pLng) || isNaN(dLat) || isNaN(dLng)) {
      throw new Error('Invalid route endpoints');
    }

    // Format intermediate waypoints for Mapbox/OSRM
    const validWaypoints = Array.isArray(waypoints) ? waypoints.filter(wp => {
      const lat = parseFloat(wp.lat);
      const lng = parseFloat(wp.lng);
      return !isNaN(lat) && !isNaN(lng);
    }) : [];

    const wpKey = validWaypoints.map(w => `${parseFloat(w.lat).toFixed(4)},${parseFloat(w.lng).toFixed(4)}`).join('_');
    const cacheKey = `route_${pLat.toFixed(4)}_${pLng.toFixed(4)}_wp_${wpKey}_to_${dLat.toFixed(4)}_${dLng.toFixed(4)}`;
    if (routeCache.has(cacheKey)) {
      return routeCache.get(cacheKey);
    }

    // Prevent unbounded memory growth in long-running production server
    if (routeCache.size > 500) {
      const firstKeys = Array.from(routeCache.keys()).slice(0, 100);
      firstKeys.forEach(k => routeCache.delete(k));
    }

    // Coordinates path string: lng1,lat1;lngW1,latW1;lng2,lat2
    const coordSegments = [
      `${pLng},${pLat}`,
      ...validWaypoints.map(w => `${parseFloat(w.lng)},${parseFloat(w.lat)}`),
      `${dLng},${dLat}`
    ];
    const coordsPath = coordSegments.join(';');

    // Attempt Mapbox Directions API for authentic road routing
    if (this.mapboxToken) {
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsPath}?geometries=geojson&overview=full&access_token=${this.mapboxToken}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3500) });

        if (res.ok) {
          const data = await res.json();
          if (data && data.routes && data.routes.length) {
            const r = data.routes[0];
            const distanceKm = parseFloat((r.distance / 1000).toFixed(2));
            const durationMins = Math.max(2, Math.ceil(r.duration / 60));

            // GeoJSON coordinates are [lng, lat] -> convert to Leaflet [lat, lng]
            const polylineCoordinates = (r.geometry && r.geometry.coordinates) 
              ? r.geometry.coordinates.map(coord => [coord[1], coord[0]])
              : [[pLat, pLng], ...validWaypoints.map(w => [parseFloat(w.lat), parseFloat(w.lng)]), [dLat, dLng]];

            const result = {
              distanceKm,
              durationMins,
              polyline: polylineCoordinates,
              waypoints: validWaypoints,
              summary: r.legs && r.legs[0] && r.legs[0].summary ? r.legs[0].summary : 'Via Lilongwe Road Network',
              provider: 'mapbox_directions'
            };

            routeCache.set(cacheKey, result);
            return result;
          }
        }
      } catch (err) {
        console.warn('[LocationService] Mapbox directions failed, falling back to OSRM:', err.message);
      }
    }

    // Fallback: Public OSRM driving service
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsPath}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.routes && data.routes.length) {
          const r = data.routes[0];
          const distanceKm = parseFloat((r.distance / 1000).toFixed(2));
          const durationMins = Math.max(2, Math.ceil(r.duration / 60));

          const polylineCoordinates = (r.geometry && r.geometry.coordinates)
            ? r.geometry.coordinates.map(coord => [coord[1], coord[0]])
            : [[pLat, pLng], ...validWaypoints.map(w => [parseFloat(w.lat), parseFloat(w.lng)]), [dLat, dLng]];

          const result = {
            distanceKm,
            durationMins,
            polyline: polylineCoordinates,
            waypoints: validWaypoints,
            summary: 'Via OpenStreetMap Route',
            provider: 'osrm'
          };
          routeCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (e) {}

    // Fallback with straight-line distance * 1.35 road factor if completely offline
    const straightKm = haversineDistanceKm(pLat, pLng, dLat, dLng);
    const estimatedRoadKm = parseFloat((straightKm * 1.35).toFixed(2));
    const estimatedMins = Math.max(3, Math.ceil(estimatedRoadKm * 2.2));

    return {
      distanceKm: estimatedRoadKm,
      durationMins: estimatedMins,
      polyline: [[pLat, pLng], [dLat, dLng]],
      summary: 'Straight Line Road Estimate',
      provider: 'road_factor_estimate'
    };
  }

  // 3. Forward Geocoding Autocomplete for Lilongwe, Malawi
  async searchPlaces(query, originLat, originLng) {
    const q = (query || '').trim();
    if (!q) return [];

    const lat = parseFloat(originLat) || LILONGWE_CENTER.lat;
    const lng = parseFloat(originLng) || LILONGWE_CENTER.lng;

    const results = [];
    const lowerQ = q.toLowerCase();

    // 3a. Curated Lilongwe Landmarks, Areas & Commercial Enterprises (including EPTL Malawi)
    const LILONGWE_POIS = [
      {
        name: 'Entire Printers and Traders Limited (EPTL)',
        area: 'Chitipi Road, Lilongwe, Malawi',
        category: 'Printing & Commercial Enterprise',
        keywords: ['eptl', 'entire printers', 'printers', 'printing', 'traders', 'chitipi'],
        icon: 'print',
        lat: -13.9933,
        lng: 33.6777
      },
      {
        name: 'Chitipi Trading Centre',
        area: 'Mchinji Road, Chitipi, Lilongwe',
        category: 'Trading Centre',
        keywords: ['chitipi', 'trading centre', 'market'],
        icon: 'storefront',
        lat: -13.9933182,
        lng: 33.6776826
      },
      {
        name: 'Gateway Mall',
        area: 'Kaunda Road, Area 47, Lilongwe',
        category: 'Shopping Mall',
        keywords: ['gateway', 'gateway mall', 'area 47', 'kaunda road'],
        icon: 'shopping_bag',
        lat: -13.9722,
        lng: 33.7667
      },
      {
        name: 'Old Town Mall & Market',
        area: 'Paul Kagame Road, Area 4, Lilongwe',
        category: 'Commercial Hub',
        keywords: ['old town', 'old town mall', 'market', 'paul kagame'],
        icon: 'storefront',
        lat: -13.9850,
        lng: 33.7750
      },
      {
        name: 'Capital Hill (Government Complex)',
        area: 'Presidential Way, Area 20, Lilongwe',
        category: 'Government Headquarters',
        keywords: ['capital hill', 'government', 'ministries', 'presidential way'],
        icon: 'account_balance',
        lat: -13.9500,
        lng: 33.7900
      },
      {
        name: 'Bingu National Stadium',
        area: 'M1 Highway, Area 48, Lilongwe',
        category: 'Sports & Events Arena',
        keywords: ['bns', 'bingu stadium', 'bingu national stadium', 'area 48'],
        icon: 'stadium',
        lat: -13.9350,
        lng: 33.7500
      },
      {
        name: 'Kamuzu Central Hospital (KCH)',
        area: 'Area 33, Mzimba Street, Lilongwe',
        category: 'Hospital & Healthcare',
        keywords: ['kch', 'kamuzu central hospital', 'hospital', 'area 33'],
        icon: 'local_hospital',
        lat: -13.9780,
        lng: 33.7850
      },
      {
        name: 'City Centre Business Park',
        area: 'Independence Drive, Area 13, Lilongwe',
        category: 'Business District',
        keywords: ['city centre', 'area 13', 'banks', 'business'],
        icon: 'domain',
        lat: -13.9550,
        lng: 33.7880
      },
      {
        name: 'Crossroads Complex',
        area: 'M1 / Kaunda Road, Area 9, Lilongwe',
        category: 'Shopping & Dining',
        keywords: ['crossroads', 'area 9', 'kaunda'],
        icon: 'restaurant',
        lat: -13.9800,
        lng: 33.7700
      },
      {
        name: 'Pacific Mall',
        area: 'Area 2, Lilongwe',
        category: 'Shopping Mall',
        keywords: ['pacific', 'pacific mall', 'area 2'],
        icon: 'shopping_bag',
        lat: -13.9820,
        lng: 33.7720
      },
      {
        name: 'Kanengo Industrial Area',
        area: 'M1 North Highway, Lilongwe',
        category: 'Industrial & Warehousing',
        keywords: ['kanengo', 'industrial', 'tobacco auction', 'factories'],
        icon: 'factory',
        lat: -13.8800,
        lng: 33.8050
      },
      {
        name: 'Area 10 Residential & Embassies',
        area: 'Area 10, Lilongwe, Malawi',
        category: 'Diplomatic & Residential',
        keywords: ['area 10', 'embassies'],
        icon: 'home',
        lat: -13.9450,
        lng: 33.8050
      },
      {
        name: 'Area 18 Residential Complex',
        area: 'Area 18 (A & B), Lilongwe',
        category: 'Residential District',
        keywords: ['area 18', 'area 18a', 'area 18b'],
        icon: 'home',
        lat: -13.9250,
        lng: 33.7950
      },
      {
        name: 'Area 49 (Gulliver / New Shire)',
        area: 'Area 49, Lilongwe',
        category: 'Residential District',
        keywords: ['area 49', 'gulliver', 'new shire'],
        icon: 'home',
        lat: -13.9400,
        lng: 33.7300
      },
      {
        name: 'Area 25 Sector A-C',
        area: 'Area 25, Lilongwe',
        category: 'Residential & Markets',
        keywords: ['area 25', 'area 25 hospital'],
        icon: 'home',
        lat: -13.8900,
        lng: 33.7700
      },
      {
        name: 'Area 3 Old Town Residential',
        area: 'Area 3, Lilongwe',
        category: 'Residential & Lodges',
        keywords: ['area 3', 'woodlands'],
        icon: 'home',
        lat: -13.9820,
        lng: 33.7650
      },
      {
        name: 'Lumbadzi Trading Centre & Airport Junction',
        area: 'M1 North, Lumbadzi, Lilongwe',
        category: 'Township & Transit',
        keywords: ['lumbadzi', 'airport', 'kamuzu international airport', 'kia'],
        icon: 'flight',
        lat: -13.7800,
        lng: 33.7800
      },
      {
        name: 'Kawale Market & Bus Terminal',
        area: 'Area 7 / Kawale, Lilongwe',
        category: 'Market & Transit Hub',
        keywords: ['kawale', 'kawale market'],
        icon: 'directions_bus',
        lat: -13.9950,
        lng: 33.7900
      }
    ];

    // Check POI matches first
    for (const poi of LILONGWE_POIS) {
      const match = poi.name.toLowerCase().includes(lowerQ) ||
                    poi.area.toLowerCase().includes(lowerQ) ||
                    poi.keywords.some(k => lowerQ.includes(k) || k.includes(lowerQ));
      if (match) {
        const dist = haversineDistanceKm(lat, lng, poi.lat, poi.lng);
        results.push({
          id: 'poi_' + poi.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
          name: poi.name,
          area: poi.area,
          category: poi.category,
          icon: poi.icon,
          lat: poi.lat,
          lng: poi.lng,
          distanceKm: parseFloat(dist.toFixed(1))
        });
      }
    }

    // Mapbox Places Search
    if (this.mapboxToken) {
      try {
        const mbUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?proximity=${lng},${lat}&bbox=${MALAWI_BBOX.minLng},${MALAWI_BBOX.minLat},${MALAWI_BBOX.maxLng},${MALAWI_BBOX.maxLat}&access_token=${this.mapboxToken}&limit=6`;
        const res = await fetch(mbUrl, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          const data = await res.json();
          if (data && data.features) {
            data.features.forEach(f => {
              const [fLng, fLat] = f.center || f.geometry.coordinates;
              const dist = haversineDistanceKm(lat, lng, fLat, fLng);
              const exists = results.some(r => Math.abs(r.lat - fLat) < 0.002 && Math.abs(r.lng - fLng) < 0.002);
              if (!exists) {
                results.push({
                  id: f.id,
                  name: f.text || f.place_name.split(',')[0],
                  area: f.place_name,
                  category: f.properties?.category || 'Malawi Place',
                  icon: 'location_on',
                  lat: fLat,
                  lng: fLng,
                  distanceKm: parseFloat(dist.toFixed(1))
                });
              }
            });
          }
        }
      } catch (e) {}
    }

    // Photon OpenStreetMap Search for Malawi POIs
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q + ' Lilongwe')}&lat=${lat}&lon=${lng}&limit=6`;
      const res = await fetch(photonUrl, {
        headers: { 'User-Agent': 'GamanMobility/1.0' },
        signal: AbortSignal.timeout(2500)
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.features) {
          data.features.forEach(f => {
            const p = f.properties;
            const [fLng, fLat] = f.geometry.coordinates;
            if (isWithinMalawi(fLat, fLng) || p.countrycode === 'MW' || p.country === 'Malawi') {
              const name = p.name || p.street || 'Malawi Transit Point';
              const area = [p.street, p.city || p.district || 'Lilongwe', 'Malawi'].filter(Boolean).join(', ');
              const dist = haversineDistanceKm(lat, lng, fLat, fLng);

              const exists = results.some(r => Math.abs(r.lat - fLat) < 0.002 && Math.abs(r.lng - fLng) < 0.002);
              if (!exists) {
                results.push({
                  id: 'osm_' + (p.osm_id || Math.random()),
                  name,
                  area,
                  category: p.osm_value || 'Landmark',
                  icon: 'pin_drop',
                  lat: fLat,
                  lng: fLng,
                  distanceKm: parseFloat(dist.toFixed(1))
                });
              }
            }
          });
        }
      }
    } catch (e) {}

    // Sort by proximity to rider
    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results.slice(0, 8);
  }
}

module.exports = new LocationService();
