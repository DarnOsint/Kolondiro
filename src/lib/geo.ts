/**
 * geo.ts — pure geofence distance calculation.
 * Extracted from useGeofence.js for testability.
 */

/**
 * Haversine formula — returns distance in metres between two GPS coordinates.
 */
export function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000 // Earth radius in metres
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function isInsideGeofence(
  userLat: number,
  userLng: number,
  targetLat: number,
  targetLng: number,
  radiusMetres: number
): boolean {
  return getDistance(userLat, userLng, targetLat, targetLng) <= radiusMetres
}
