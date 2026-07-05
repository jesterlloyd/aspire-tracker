// ASPIRE-POLISH-6A: bundled Southern California city centroid table + nearest-city lookup for the
// welcome-band weather label. Pure math, fully offline — NO API key, NO network request, NO
// third-party reverse geocoder, NO server endpoint. Coordinates passed in are the browser's
// (already rounded) geolocation; nothing here persists, logs, or transmits them.
//
// Covers the greater Los Angeles / Antelope Valley / Inland Empire / Ventura operating area. Centroids
// are approximate city centers (~4 decimals is plenty for a nearest-neighbor match). If a granted
// location is farther than the threshold from every listed city (user outside the region), the lookup
// returns null and the caller keeps the neutral "Current location" label.

// { name, lat, lon } — approximate city centroids.
export const SOCAL_CITIES = [
  // Core LA basin
  { name: 'Los Angeles',      lat: 34.0522, lon: -118.2437 },
  { name: 'Beverly Hills',    lat: 34.0736, lon: -118.4004 },
  { name: 'West Hollywood',   lat: 34.0900, lon: -118.3617 },
  { name: 'Santa Monica',     lat: 34.0195, lon: -118.4912 },
  { name: 'Culver City',      lat: 34.0211, lon: -118.3965 },
  { name: 'Inglewood',        lat: 33.9617, lon: -118.3531 },
  { name: 'Burbank',          lat: 34.1808, lon: -118.3090 },
  { name: 'Glendale',         lat: 34.1425, lon: -118.2551 },
  { name: 'Pasadena',         lat: 34.1478, lon: -118.1445 },
  { name: 'Alhambra',         lat: 34.0953, lon: -118.1270 },
  { name: 'Monterey Park',    lat: 34.0625, lon: -118.1228 },
  { name: 'East Los Angeles', lat: 34.0239, lon: -118.1720 },
  { name: 'Downey',           lat: 33.9401, lon: -118.1332 },
  { name: 'Whittier',         lat: 33.9792, lon: -118.0328 },
  { name: 'El Monte',         lat: 34.0686, lon: -118.0276 },
  { name: 'Santa Fe Springs', lat: 33.9472, lon: -118.0853 },
  // South Bay / Harbor
  { name: 'Torrance',         lat: 33.8358, lon: -118.3406 },
  { name: 'Long Beach',       lat: 33.7701, lon: -118.1937 },
  { name: 'Carson',           lat: 33.8317, lon: -118.2820 },
  { name: 'San Pedro',        lat: 33.7361, lon: -118.2922 },
  // Orange County
  { name: 'Anaheim',          lat: 33.8366, lon: -117.9143 },
  { name: 'Santa Ana',        lat: 33.7455, lon: -117.8677 },
  { name: 'Irvine',           lat: 33.6846, lon: -117.8265 },
  { name: 'Fullerton',        lat: 33.8704, lon: -117.9243 },
  // San Gabriel / Pomona valleys
  { name: 'West Covina',      lat: 34.0686, lon: -117.9390 },
  { name: 'Pomona',           lat: 34.0551, lon: -117.7500 },
  { name: 'Ontario',          lat: 34.0633, lon: -117.6509 },
  { name: 'Rancho Cucamonga', lat: 34.1064, lon: -117.5931 },
  // Inland Empire
  { name: 'San Bernardino',   lat: 34.1083, lon: -117.2898 },
  { name: 'Riverside',        lat: 33.9806, lon: -117.3755 },
  // High Desert
  { name: 'Victorville',      lat: 34.5362, lon: -117.2928 },
  // Santa Clarita / Antelope valleys
  { name: 'Santa Clarita',    lat: 34.3917, lon: -118.5426 },
  { name: 'Lancaster',        lat: 34.6868, lon: -118.1542 },
  { name: 'Palmdale',         lat: 34.5794, lon: -118.1165 },
  // Ventura County / Conejo Valley
  { name: 'Thousand Oaks',    lat: 34.1706, lon: -118.8376 },
  { name: 'Simi Valley',      lat: 34.2694, lon: -118.7815 },
  { name: 'Oxnard',           lat: 34.1975, lon: -119.1771 },
  { name: 'Ventura',          lat: 34.2746, lon: -119.2290 },
]

const R_KM = 6371 // mean earth radius
const toRad = (deg) => (deg * Math.PI) / 180

// Great-circle distance between two lat/lon points, in kilometers.
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Nearest listed city to (lat, lon). Returns the city NAME if within `maxKm` (default 40 km),
// otherwise null (caller falls back to a neutral label). Never returns coordinates.
export function findNearestSocalCity(lat, lon, { maxKm = 40 } = {}) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) {
    return null
  }
  let best = null
  let bestKm = Infinity
  for (const c of SOCAL_CITIES) {
    const km = haversineKm(lat, lon, c.lat, c.lon)
    if (km < bestKm) { bestKm = km; best = c }
  }
  return best && bestKm <= maxKm ? best.name : null
}
