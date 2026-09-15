import { describe, it, expect } from 'vitest'
import { getDistance, isInsideGeofence } from '../lib/geo'

// Known coordinates for Kolondiro area (Osogbo, Osun State)
const VENUE = { lat: 7.350834, lng: 3.84078 }
const APARTMENT = { lat: 7.349545, lng: 3.83969 }

describe('getDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(getDistance(VENUE.lat, VENUE.lng, VENUE.lat, VENUE.lng)).toBe(0)
  })

  it('returns approximate distance between venue and apartment', () => {
    const dist = getDistance(VENUE.lat, VENUE.lng, APARTMENT.lat, APARTMENT.lng)
    // They are roughly 160–200m apart based on coordinates
    expect(dist).toBeGreaterThan(100)
    expect(dist).toBeLessThan(400)
  })

  it('is symmetric — A→B equals B→A', () => {
    const d1 = getDistance(VENUE.lat, VENUE.lng, APARTMENT.lat, APARTMENT.lng)
    const d2 = getDistance(APARTMENT.lat, APARTMENT.lng, VENUE.lat, VENUE.lng)
    expect(d1).toBeCloseTo(d2, 5)
  })

  it('returns positive for any two distinct coordinates', () => {
    expect(getDistance(0, 0, 1, 0)).toBeGreaterThan(0)
    expect(getDistance(51.5074, -0.1278, 48.8566, 2.3522)).toBeGreaterThan(0)
  })

  it('returns a plausible metre value for London→Paris (~340km)', () => {
    const dist = getDistance(51.5074, -0.1278, 48.8566, 2.3522)
    expect(dist).toBeGreaterThan(330_000)
    expect(dist).toBeLessThan(350_000)
  })
})

describe('isInsideGeofence', () => {
  it('returns true when user is at exact venue location', () => {
    expect(isInsideGeofence(VENUE.lat, VENUE.lng, VENUE.lat, VENUE.lng, 400)).toBe(true)
  })

  it('returns true when user is within radius', () => {
    // Apartment is ~160–200m from venue; 400m radius should include it
    expect(isInsideGeofence(APARTMENT.lat, APARTMENT.lng, VENUE.lat, VENUE.lng, 400)).toBe(true)
  })

  it('returns false when user is outside radius', () => {
    // A point ~1km away from the venue
    const farLat = VENUE.lat + 0.009 // ~1km north
    expect(isInsideGeofence(farLat, VENUE.lng, VENUE.lat, VENUE.lng, 400)).toBe(false)
  })

  it('returns false with a very small radius even for nearby point', () => {
    expect(isInsideGeofence(APARTMENT.lat, APARTMENT.lng, VENUE.lat, VENUE.lng, 10)).toBe(false)
  })

  it('handles equator and prime meridian', () => {
    expect(isInsideGeofence(0, 0, 0, 0, 1)).toBe(true)
  })
})
