import { Camera, Activity, AlertTriangle, Eye, CheckCircle } from 'lucide-react'
import type { CvData } from './types'

interface Props {
  cvData: CvData
  onResolve: (id: string) => void
}

export default function CctvPanel({ cvData, onResolve }: Props) {
  const { occupancy, todayAlerts, zoneHeatmaps, tillEvents, shelfAlerts } = cvData
  const noData = todayAlerts.length === 0 && zoneHeatmaps.length === 0 && tillEvents.length === 0

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Camera size={16} className="text-purple-400" />
        <h3 className="text-white font-semibold text-sm md:text-base">CCTV Intelligence</h3>
        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full border border-purple-500/30">
          Live
        </span>
      </div>

      {/* Occupancy strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="inline-flex p-2 rounded-lg bg-purple-400/10 mb-2">
            <Activity size={16} className="text-purple-400" />
          </div>
          <p className="text-gray-400 text-xs">Live Occupancy</p>
          <p className="text-white text-2xl font-bold mt-0.5">{occupancy}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div
            className={`inline-flex p-2 rounded-lg mb-2 ${todayAlerts.length > 0 ? 'bg-red-400/10' : 'bg-gray-400/10'}`}
          >
            <AlertTriangle
              size={16}
              className={todayAlerts.length > 0 ? 'text-red-400' : 'text-gray-400'}
            />
          </div>
          <p className="text-gray-400 text-xs">Active Alerts</p>
          <p
            className={`text-2xl font-bold mt-0.5 ${todayAlerts.length > 0 ? 'text-red-400' : 'text-white'}`}
          >
            {todayAlerts.length}
          </p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="inline-flex p-2 rounded-lg bg-amber-400/10 mb-2">
            <Eye size={16} className="text-amber-400" />
          </div>
          <p className="text-gray-400 text-xs">Cameras</p>
          <p className="text-white text-2xl font-bold mt-0.5">9</p>
        </div>
      </div>

      {/* Active alerts */}
      {todayAlerts.length > 0 && (
        <div className="bg-gray-900 border border-red-500/20 rounded-2xl p-4 mb-4">
          <p className="text-red-400 font-semibold text-sm mb-3 flex items-center gap-2">
            <AlertTriangle size={14} /> Active Alerts
          </p>
          <div className="space-y-2">
            {todayAlerts.slice(0, 5).map((alert, i) => {
              const a = alert as Record<string, string>
              return (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 bg-gray-800 rounded-xl px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium">
                      {a.camera_id} — {a.alert_type?.replace(/_/g, ' ')}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">{a.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        a.severity === 'critical'
                          ? 'bg-red-500/20 text-red-400'
                          : a.severity === 'high'
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {a.severity}
                    </span>
                    <button
                      onClick={() => onResolve(a.id)}
                      className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 px-2 py-0.5 rounded-full transition-colors"
                    >
                      <CheckCircle size={11} /> Resolve
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Zone activity */}
      {zoneHeatmaps.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
          <p className="text-white font-semibold text-sm mb-3">Zone Activity Today</p>
          <div className="space-y-2">
            {zoneHeatmaps.map((zone, i) => {
              const z = zone as Record<string, unknown>
              return (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-400 text-xs">{z.zone_label as string}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-white text-xs font-medium">
                      {z.person_count as number} visits
                    </span>
                    <span className="text-gray-500 text-xs">
                      {Math.round(((z.avg_dwell_seconds as number) || 0) / 60)}m avg
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Till anomalies */}
      {tillEvents.length > 0 && (
        <div className="bg-gray-900 border border-orange-500/20 rounded-2xl p-4 mb-4">
          <p className="text-orange-400 font-semibold text-sm mb-3">Till Anomalies</p>
          <div className="space-y-2">
            {tillEvents.slice(0, 3).map((e, i) => {
              const ev = e as Record<string, string>
              return (
                <div
                  key={i}
                  className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                >
                  <p className="text-white text-xs">{ev.alert_type?.replace(/_/g, ' ')}</p>
                  <p className="text-gray-500 text-xs">
                    {new Date(ev.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Shelf alerts */}
      {shelfAlerts.length > 0 && (
        <div className="bg-gray-900 border border-amber-500/20 rounded-2xl p-4">
          <p className="text-amber-400 font-semibold text-sm mb-3">Bar Shelf Alerts</p>
          <div className="space-y-2">
            {shelfAlerts.slice(0, 5).map((e, i) => {
              const ev = e as Record<string, string>
              return (
                <div
                  key={i}
                  className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                >
                  <p className="text-white text-xs capitalize">
                    {ev.drink_name?.replace(/_/g, ' ')}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      ev.alert_level === 'missing'
                        ? 'bg-red-500/20 text-red-400'
                        : ev.alert_level === 'critical'
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                    }`}
                  >
                    {ev.alert_level}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {noData && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <Camera size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            No CV data yet — start the CV modules on your server
          </p>
        </div>
      )}
    </div>
  )
}
