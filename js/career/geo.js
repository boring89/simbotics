// Rough locations of teams and events (a US state, Canadian province or country) for travel
// distances, and which landmass each is on (trucks can't cross oceans).

const P = {
  // US states: [lat, lon] near the main FRC area.
  AL: [33.5, -86.8], AK: [61.2, -149.9], AZ: [33.4, -112.0], AR: [34.7, -92.3], CA: [36.0, -119.5], CO: [39.7, -105.0],
  CT: [41.6, -72.7], DE: [39.7, -75.6], DC: [38.9, -77.0], FL: [28.5, -81.4], GA: [33.7, -84.4], HI: [21.3, -157.8],
  ID: [43.6, -116.2], IL: [41.8, -87.7], IN: [39.8, -86.2], IA: [41.6, -93.6], KS: [38.9, -95.7], KY: [38.2, -85.7],
  LA: [30.0, -90.1], ME: [43.7, -70.3], MD: [39.0, -76.7], MA: [42.3, -71.4], MI: [42.7, -84.5], MN: [44.98, -93.3],
  MS: [32.3, -90.2], MO: [38.6, -92.0], MT: [45.8, -108.5], NE: [41.3, -96.0], NV: [36.2, -115.1], NH: [43.0, -71.5],
  NJ: [40.2, -74.6], NM: [35.1, -106.6], NY: [42.0, -75.5], NC: [35.6, -79.4], ND: [46.9, -97.0], OH: [40.0, -82.9],
  OK: [35.5, -97.5], OR: [45.4, -122.7], PA: [40.3, -76.9], RI: [41.8, -71.4], SC: [33.9, -80.9], SD: [43.5, -96.7],
  TN: [36.0, -86.4], TX: [30.5, -97.0], UT: [40.7, -111.9], VT: [44.4, -73.0], VA: [37.5, -77.4], WA: [47.4, -122.2],
  WV: [38.4, -81.6], WI: [43.6, -88.5], WY: [41.1, -104.8],
  // Canada.
  ON: [43.7, -79.6], QC: [45.5, -73.6], BC: [49.2, -123.0], AB: [51.0, -114.1], MB: [49.9, -97.1],
  // Countries.
  'Türkiye': [41.0, 29.0], Mexico: [25.7, -100.3], Israel: [32.1, 34.8], Brazil: [-23.5, -46.6], China: [31.2, 121.5],
  Australia: [-33.9, 151.2], 'Chinese Taipei': [25.0, 121.5], 'Dominican Republic': [18.5, -69.9], India: [19.1, 72.9],
  Poland: [52.2, 21.0], France: [48.9, 2.35], Japan: [35.7, 139.7], Panama: [9.0, -79.5], Netherlands: [52.4, 4.9],
  'Czech Republic': [50.1, 14.4], Romania: [44.4, 26.1], 'South Korea': [37.6, 127.0], 'United Kingdom': [51.5, -0.1],
  Switzerland: [47.4, 8.5], Croatia: [45.8, 16.0], Colombia: [4.7, -74.1], Azerbaijan: [40.4, 49.9], Bulgaria: [42.7, 23.3],
  Belize: [17.5, -88.2], Philippines: [14.6, 121.0], Canada: [45.4, -75.7], USA: [39.8, -98.6],
};

// Landmasses a truck can drive across.
const LAND = {
  na: ['Mexico', 'Panama', 'Belize', 'Canada', 'USA', 'ON', 'QC', 'BC', 'AB', 'MB'],
  eu: ['Türkiye', 'Poland', 'France', 'Netherlands', 'Czech Republic', 'Romania', 'Switzerland', 'Croatia', 'Bulgaria', 'Azerbaijan', 'United Kingdom', 'China', 'India'],
};
export function landmass(place) {
  if (place === 'HI' || place === 'AK') return place;
  if (P[place] && /^[A-Z]{2}$/.test(place) && !['ON', 'QC', 'BC', 'AB', 'MB'].includes(place)) return 'na';
  for (const [k, list] of Object.entries(LAND)) if (list.includes(place)) return k;
  return place;   // islands and the rest: on their own
}

export const known = (place) => !!P[place];
export const PLACES = Object.keys(P).filter((k) => k !== 'USA' && k !== 'Canada');

// Great-circle distance in km.
export function distance(a, b) {
  const p = P[a] || P.USA, q = P[b] || P.USA, r = Math.PI / 180;
  const dLat = (q[0] - p[0]) * r, dLon = (q[1] - p[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

// An event's location key: its state/province, else its country.
export const eventPlace = (e) => (e.state && P[e.state] ? e.state : e.country);
