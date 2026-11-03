// Master Malawi Gazetteer (Specific local businesses, printing companies, industrial areas & landmarks)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

const MALAWI_LOCATIONS = [
  {
    name: 'EPTL Malawi (Entire Printers & Traders Limited)',
    area: 'Plot 4/122, Murray Rd, Area 4 Industrial, Lilongwe, Malawi',
    category: 'Printing, Packaging & Corporate Branding',
    icon: 'print',
    lat: -13.9812,
    lng: 33.7745,
    tags: ['eptl', 'printing', 'printers', 'entire printers', 'packaging', 'traders', 'promotional', 'branding', 'area 4', 'murray', 'offset', 'dtf']
  },
  {
    name: 'Bingu National Stadium',
    area: 'near Area 49, Kaunda Rd, Lilongwe, Malawi',
    category: 'Sports & Concert Arena',
    icon: 'stadium',
    lat: -13.9482,
    lng: 33.7431,
    tags: ['bingu', 'stadium', 'sports', 'area 49', 'kaunda']
  },
  {
    name: 'City Centre (Capital Hill)',
    area: 'Independence Drive, Area 20, Lilongwe, Malawi',
    category: 'Government Ministries & Diplomatic Zone',
    icon: 'account_balance',
    lat: -13.9554,
    lng: 33.7872,
    tags: ['city centre', 'capital hill', 'government', 'ministries', 'area 20']
  },
  {
    name: 'Old Town Mall & Market',
    area: 'Kamuzu Procession Rd, Area 2, Lilongwe, Malawi',
    category: 'Shopping & Local Markets',
    icon: 'storefront',
    lat: -13.9856,
    lng: 33.7745,
    tags: ['old town', 'market', 'area 2', 'kamuzu procession']
  },
  {
    name: 'Kamuzu Central Hospital',
    area: 'Area 33, Mzimba St, Lilongwe, Malawi',
    category: 'Central Referral Hospital',
    icon: 'local_hospital',
    lat: -13.9790,
    lng: 33.7840,
    tags: ['kamuzu hospital', 'hospital', 'medical', 'kch', 'area 33']
  },
  {
    name: 'Crossroads Hotel & Complex',
    area: 'M1 / Chilambula Rd, Area 3, Lilongwe, Malawi',
    category: 'Hotels & Business Centre',
    icon: 'hotel',
    lat: -13.9760,
    lng: 33.7710,
    tags: ['crossroads', 'hotel', 'area 3', 'chilambula']
  },
  {
    name: 'Kanengo Industrial Area',
    area: 'Tobacco Auction Floors, M1 North, Lilongwe, Malawi',
    category: 'Factories & Freight Terminals',
    icon: 'factory',
    lat: -13.8820,
    lng: 33.7950,
    tags: ['kanengo', 'industrial', 'tobacco', 'auction floors', 'm1']
  },
  {
    name: 'Four Seasons Nursery & Garden',
    area: 'Presidential Way, Area 12, Lilongwe, Malawi',
    category: 'Dining & Botanical Centre',
    icon: 'park',
    lat: -13.9610,
    lng: 33.7930,
    tags: ['four seasons', 'area 12', 'garden', 'presidential way']
  },
  {
    name: 'Game Stores & Shoprite Mall',
    area: 'Kamuzu Procession Rd, Area 4, Lilongwe, Malawi',
    category: 'Hypermarket & Retail Center',
    icon: 'shopping_bag',
    lat: -13.9830,
    lng: 33.7720,
    tags: ['game', 'shoprite', 'mall', 'area 4']
  },
  {
    name: 'Kamuzu International Airport (LLW)',
    area: 'Lumbadzi, M1 North, Lilongwe, Malawi',
    category: 'International Airport Terminal',
    icon: 'flight_takeoff',
    lat: -13.7894,
    lng: 33.7810,
    tags: ['airport', 'llw', 'flight', 'kamuzu airport', 'lumbadzi']
  },
  {
    name: 'Area 10 (Residential & Diplomatic Quarter)',
    area: 'Presidential Way / Kenyatta Rd, Area 10, Lilongwe, Malawi',
    category: 'Diplomatic Enclave & Residences',
    icon: 'nature_people',
    lat: -13.9520,
    lng: 33.7950,
    tags: ['area 10', 'area10', 'diplomatic', 'kenyatta', 'embassies', 'sanctuary']
  },
  {
    name: 'Area 18 (Commercial Hub & Filling Station)',
    area: 'Kaunda Rd / M1 Bypass, Area 18A / 18B, Lilongwe, Malawi',
    category: 'Marketplace & Transit Hub',
    icon: 'local_gas_station',
    lat: -13.9350,
    lng: 33.7850,
    tags: ['area 18', 'area18', 'area 18a', 'area 18b', 'market', 'filling station', 'kaunda']
  },
  {
    name: 'Area 49 (Gulliver & Shire Urban Hub)',
    area: 'Kaunda Road / Shire St, Area 49, Lilongwe, Malawi',
    category: 'Residential & Stadium Commercial Corridor',
    icon: 'location_city',
    lat: -13.9400,
    lng: 33.7400,
    tags: ['area 49', 'area49', 'gulliver', 'shire', 'bingu', 'kaunda']
  },
  {
    name: 'Lumbadzi Trading Centre & Airport Junction',
    area: 'M1 North Highway, Lumbadzi, Lilongwe, Malawi',
    category: 'Northern Commercial Hub & LLW Junction',
    icon: 'traffic',
    lat: -13.7850,
    lng: 33.7800,
    tags: ['lumbadzi', 'airport', 'llw', 'm1 north', 'trading centre']
  },
  {
    name: 'Area 25 Shopping Centre',
    area: 'Sector C, Area 25, Lilongwe, Malawi',
    category: 'Community Marketplace',
    icon: 'store',
    lat: -13.8990,
    lng: 33.7650,
    tags: ['area 25', 'market']
  },
  {
    name: 'Area 47 Sector 3 (Green Pharmacy)',
    area: 'Kaunda Road, Area 47, Lilongwe, Malawi',
    category: 'Pharmacy & Residential Hub',
    icon: 'medication',
    lat: -13.9710,
    lng: 33.7630,
    tags: ['area 47', 'pharmacy', 'green pharmacy', 'kaunda']
  },
  {
    name: 'Lilongwe Wildlife Centre',
    area: 'Kenyatta Drive, Area 11, Lilongwe, Malawi',
    category: 'Wildlife Sanctuary & Eco Park',
    icon: 'pets',
    lat: -13.9680,
    lng: 33.7820,
    tags: ['wildlife', 'animals', 'area 11', 'kenyatta']
  },
  {
    name: 'Blantyre City Centre (Victoria Ave)',
    area: 'Victoria Avenue, Blantyre, Southern Region, Malawi',
    category: 'Intercity Commercial Hub',
    icon: 'domain',
    lat: -15.7861,
    lng: 35.0058,
    tags: ['blantyre', 'victoria', 'southern', 'chichiri']
  },
  {
    name: 'Mzuzu Clock Tower',
    area: 'M1 Highway, Mzuzu, Northern Region, Malawi',
    category: 'Northern Hub & Regional Market',
    icon: 'schedule',
    lat: -11.4583,
    lng: 34.0167,
    tags: ['mzuzu', 'clock tower', 'northern']
  },
  {
    name: 'Salima Lakeshore (Senga Bay)',
    area: 'Beach Road, Senga Bay, Salima, Lake Malawi',
    category: 'Lakeside Tourism & Lodges',
    icon: 'beach_access',
    lat: -13.7250,
    lng: 34.6150,
    tags: ['salima', 'senga bay', 'lake malawi']
  }
];

const DEFAULT_ORIGIN = { lat: -13.9722, lng: 33.7667 };

function formatLocationResult(loc, originLat, originLng) {
  const km = calculateDistanceKm(originLat, originLng, loc.lat, loc.lng);
  const fareBike = Math.max(1200, Math.round(1200 + km * 380));
  const fareAuto = Math.max(2200, Math.round(2200 + km * 550));
  const fareCab = Math.max(4500, Math.round(4500 + km * 900));
  const mins = Math.max(3, Math.round(km * 2.2));

  return {
    name: loc.name,
    area: loc.area,
    category: loc.category || 'Malawi Transit Location',
    icon: loc.icon || 'location_on',
    lat: loc.lat,
    lng: loc.lng,
    km: km,
    mins: mins,
    fare: fareBike,
    fares: {
      bike: fareBike,
      auto: fareAuto,
      cab: fareCab
    }
  };
}

module.exports = {
  calculateDistanceKm,
  MALAWI_LOCATIONS,
  DEFAULT_ORIGIN,
  formatLocationResult
};
