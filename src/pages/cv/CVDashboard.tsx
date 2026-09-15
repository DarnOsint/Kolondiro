import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'
import {
  ArrowLeft,
  Camera,
  Users,
  AlertTriangle,
  Activity,
  CheckCircle,
  Clock,
  MapPin,
  Zap,
  RefreshCw,
} from 'lucide-react'

interface PeopleCount {
  id: string
  camera_id: string
  camera_name: string
  zone: string
  count: number
  captured_at: string
}

interface CVAlert {
  id: string
  camera_id: string
  zone: string
  alert_type: string
  details: Record<string, unknown>
  resolved: boolean
  created_at: string
}

interface ZoneStats {
  zone: string
  count: number
  camera_id: string
  camera_name: string
  last_updated: string
}

const ZONE_COLORS: Record<string, string> = {
  indoor: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
  outdoor: 'bg-green-500/20 border-green-500/30 text-green-400',
  vip: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
  nook: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
  bar: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
  entrance: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
}

const ALERT_COLORS: Record<string, string> = {
  crowd: 'bg-red-500/20 border-red-500/30 text-red-400',
  altercation: 'bg-red-600/20 border-red-600/30 text-red-300',
  unattended_zone: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
  license_plate: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
}

const ALERT_ICONS: Record<string, string> = {
  crowd: '👥',
  altercation: '⚠️',
  unattended_zone: '🔕',
  license_plate: '🚗',
}

export default function CVDashboard() {
  const navigate = useNavigate()
  const [zoneStats, setZoneStats] = useState<ZoneStats[]>([])
  const [alerts, setAlerts] = useState<CVAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [totalPeople, setTotalPeople] = useState(0)

  const fetchData = useCallback(async () => {
    // Fetch latest count per zone
    const { data: counts } = await supabase
      .from('cv_people_counts')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(100)

    if (counts) {
      // Get latest reading per camera
      const latestPerCamera = new Map<string, PeopleCount>()
      for (const row of counts as PeopleCount[]) {
        if (!latestPerCamera.has(row.camera_id)) {
          latestPerCamera.set(row.camera_id, row)
        }
      }

      // Aggregate by zone
      const zoneMap = new Map<string, ZoneStats>()
      for (const [, reading] of latestPerCamera) {
        const existing = zoneMap.get(reading.zone)
        if (existing) {
          existing.count += reading.count
        } else {
          zoneMap.set(reading.zone, {
            zone: reading.zone,
            count: reading.count,
            camera_id: reading.camera_id,
            camera_name: reading.camera_name,
            last_updated: reading.captured_at,
          })
        }
      }

      const stats = Array.from(zoneMap.values())
      setZoneStats(stats)
      setTotalPeople(stats.reduce((s, z) => s + z.count, 0))
    }

    // Fetch unresolved alerts
    const { data: alertData } = await supabase
      .from('cv_alerts')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20)

    if (alertData) setAlerts(alertData as CVAlert[])
    setLoading(false)
    setLastRefresh(new Date())
  }, [])

  useEffect(() => {
    fetchData()
    // Poll only while tab is active; realtime also updates alerts.
  }, [fetchData])

  useVisibilityInterval(fetchData, 30_000, [fetchData])

  // Realtime subscription for new alerts
  useEffect(() => {
    const ch = supabase
      .channel('cv-alerts-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cv_alerts' }, () => {
        fetchData()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const resolveAlert = async (alertId: string) => {
    await supabase
      .from('cv_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', alertId)
    setAlerts((prev) => prev.filter((a) => a.id !== alertId))
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
  }

  const formatAlertType = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="min-h-full bg-gray-950">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold">CV Dashboard</h1>
            <p className="text-gray-400 text-xs">Live camera intelligence</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">
            {lastRefresh.toLocaleTimeString('en-NG', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          <button
            onClick={fetchData}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Total occupancy banner */}
        <div className="bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
              <Users size={20} className="text-amber-400" />
            </div>
            <div>
              <p className="text-gray-400 text-xs">Total Venue Occupancy</p>
              <p className="text-white text-2xl font-bold">{totalPeople} people</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-medium">LIVE</span>
          </div>
        </div>

        {/* Zone breakdown */}
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3 flex items-center gap-2">
            <MapPin size={12} /> Zone Occupancy
          </p>
          {loading ? (
            <div className="text-amber-500 text-center py-8">Loading...</div>
          ) : zoneStats.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
              <Camera size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm font-medium">No camera data yet</p>
              <p className="text-gray-600 text-xs mt-1">
                Configure camera IPs in config.py to start receiving data
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {zoneStats.map((zone) => (
                <div
                  key={zone.zone}
                  className={`rounded-2xl border p-4 ${ZONE_COLORS[zone.zone] || 'bg-gray-800 border-gray-700 text-gray-400'}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-xs font-medium capitalize">{zone.zone}</p>
                    <Activity size={12} className="opacity-60" />
                  </div>
                  <p className="text-2xl font-bold text-white">{zone.count}</p>
                  <p className="text-xs opacity-60 mt-1">{zone.camera_name}</p>
                  <p className="text-xs opacity-40 mt-0.5">{formatTime(zone.last_updated)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active alerts */}
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3 flex items-center gap-2">
            <AlertTriangle size={12} /> Active Alerts
            {alerts.length > 0 && (
              <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full">
                {alerts.length}
              </span>
            )}
          </p>
          {alerts.length === 0 ? (
            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 flex items-center gap-3">
              <CheckCircle size={18} className="text-green-400" />
              <p className="text-green-400 text-sm">No active alerts — all clear</p>
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-xl border p-3 ${ALERT_COLORS[alert.alert_type] || 'bg-gray-800 border-gray-700 text-gray-400'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      <span className="text-base">{ALERT_ICONS[alert.alert_type] || '🔔'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold">
                          {formatAlertType(alert.alert_type)}
                        </p>
                        <p className="text-xs opacity-70 capitalize">{alert.zone} zone</p>
                        {alert.details?.message && (
                          <p className="text-xs opacity-60 mt-1 truncate">
                            {alert.details.message as string}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-1">
                          <Clock size={10} className="opacity-50" />
                          <span className="text-xs opacity-50">{formatTime(alert.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => resolveAlert(alert.id)}
                      className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white whitespace-nowrap transition-colors"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick stats footer */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3 flex items-center gap-2">
            <Zap size={12} /> System Status
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-white font-bold text-lg">{zoneStats.length}</p>
              <p className="text-gray-500 text-xs">Active Zones</p>
            </div>
            <div>
              <p className="text-white font-bold text-lg">{alerts.length}</p>
              <p className="text-gray-500 text-xs">Active Alerts</p>
            </div>
            <div>
              <p className="text-white font-bold text-lg">10s</p>
              <p className="text-gray-500 text-xs">Refresh Rate</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
