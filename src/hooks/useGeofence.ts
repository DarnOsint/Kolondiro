import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type LocKey = 'main' | 'apartment'
type GeofenceStatus = 'checking' | 'inside' | 'outside' | 'error' | 'unsupported'

interface TargetCoords {
  lat: number
  lng: number
  latitude: number
  longitude: number
}

const FALLBACK: Record<LocKey, TargetCoords> = {
  main: { lat: 7.350834, lng: 3.84078, latitude: 7.350834, longitude: 3.84078 },
  apartment: { lat: 7.349545, lng: 3.83969, latitude: 7.349545, longitude: 3.83969 },
}
const DEFAULT_RADIUS: Record<LocKey, number> = { main: 400, apartment: 200 }

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function useGeofence(locKey: LocKey = 'main') {
  const [status, setStatus] = useState<GeofenceStatus>('checking')
  const [distance, setDistance] = useState<number | null>(null)
  const [location, setLocation] = useState<TargetCoords | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [radius, setRadius] = useState<number | null>(null)
  const [target, setTarget] = useState<TargetCoords | null>(null)

  useEffect(() => {
    Promise.resolve(
      supabase
        .from('settings')
        .select('id, value')
        .in('id', [
          'geofence_enabled',
          'geofence_radius_main',
          'geofence_radius_apartment',
          'geofence_lat_main',
          'geofence_lng_main',
          'geofence_lat_apartment',
          'geofence_lng_apartment',
        ])
        .then(({ data }) => {
          const fallback = FALLBACK[locKey]
          if (!data) {
            setEnabled(true)
            setRadius(DEFAULT_RADIUS[locKey])
            setTarget(fallback)
            return
          }
          const map = Object.fromEntries(data.map((r) => [r.id, r.value]))
          setEnabled(map['geofence_enabled'] === 'true')

          const r =
            locKey === 'apartment'
              ? parseInt(map['geofence_radius_apartment'] ?? String(DEFAULT_RADIUS.apartment))
              : parseInt(map['geofence_radius_main'] ?? String(DEFAULT_RADIUS.main))
          setRadius(r)

          const lat = parseFloat(
            locKey === 'apartment'
              ? (map['geofence_lat_apartment'] ?? String(fallback.lat))
              : (map['geofence_lat_main'] ?? String(fallback.lat))
          )
          const lng = parseFloat(
            locKey === 'apartment'
              ? (map['geofence_lng_apartment'] ?? String(fallback.lng))
              : (map['geofence_lng_main'] ?? String(fallback.lng))
          )
          setTarget({ lat, lng, latitude: lat, longitude: lng })
        })
    ).catch(() => {
      setEnabled(false)
      setRadius(DEFAULT_RADIUS[locKey])
      setTarget(FALLBACK[locKey])
    })
  }, [locKey])

  useEffect(() => {
    if (enabled === null || radius === null || !target) return

    if (!enabled) {
      setStatus('inside')

      setDistance(0)
      return
    }

    if (!navigator.geolocation) {
      setStatus('unsupported')
      return
    }

    const check = (pos: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = pos.coords
      setLocation({ lat, lng, latitude: lat, longitude: lng })
      const dist = getDistance(lat, lng, target.lat, target.lng)
      setDistance(Math.round(dist))
      setStatus(dist <= radius ? 'inside' : 'outside')
    }

    const onError = (err: GeolocationPositionError) => {
      // On GPS error, keep the last known status rather than blocking access
      // TIMEOUT and POSITION_UNAVAILABLE are transient — don't punish staff for them
      if (err.code === err.PERMISSION_DENIED) {
        setStatus('error') // Only block on explicit permission denial
      }
      // For timeout/unavailable, silently keep previous status
      console.warn('Geofence GPS error:', err.message)
    }

    navigator.geolocation.getCurrentPosition(check, onError, { enableHighAccuracy: true })
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(check, onError, { enableHighAccuracy: true })
    }, 60_000)

    return () => clearInterval(interval)
  }, [locKey, enabled, radius, target])

  return { status, distance, location }
}
