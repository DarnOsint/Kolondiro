import { Camera, Activity, CheckCircle } from 'lucide-react'

interface CvAlert {
  id: string
  camera_id: string
  alert_type: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  created_at: string
}

interface ShelfAlert {
  drink_name: string
  detected_count: number
  alert_level: 'missing' | 'critical' | 'low'
}

interface Props {
  occupancy: number
  alerts: CvAlert[]
  shelfAlerts: ShelfAlert[]
  onResolve: (id: string) => void
}

export default function CctvTab({ occupancy, alerts, shelfAlerts, onResolve }: Props) {
  return (
    <div className="space-y-4">
      {/* Occupancy + alert count */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="inline-flex p-2 rounded-lg bg-purple-400/10 mb-2">
            <Activity size={16} className="text-purple-400" />
          </div>
          <p className="text-gray-400 text-xs">Live Occupancy</p>
          <p className="text-white text-2xl font-bold mt-0.5">{occupancy}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div
            className={`inline-flex p-2 rounded-lg mb-2 ${alerts.length > 0 ? 'bg-red-400/10' : 'bg-gray-400/10'}`}
          >
            <Camera size={16} className={alerts.length > 0 ? 'text-red-400' : 'text-gray-400'} />
          </div>
          <p className="text-gray-400 text-xs">Unresolved Alerts</p>
          <p
            className={`text-2xl font-bold mt-0.5 ${alerts.length > 0 ? 'text-red-400' : 'text-white'}`}
          >
            {alerts.length}
          </p>
        </div>
      </div>

      {/* Active alerts */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Camera size={14} className="text-purple-400" /> Active Alerts
        </p>
        {alerts.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">No active alerts</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="bg-gray-800 rounded-xl px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium">
                      {alert.camera_id} — {alert.alert_type?.replace(/_/g, ' ')}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">{alert.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        alert.severity === 'critical'
                          ? 'bg-red-500/20 text-red-400'
                          : alert.severity === 'high'
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {alert.severity}
                    </span>
                    <p className="text-gray-600 text-xs">
                      {new Date(alert.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    <button
                      onClick={() => onResolve(alert.id)}
                      className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 px-2 py-0.5 rounded-full transition-colors"
                    >
                      <CheckCircle size={11} /> Resolve
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shelf alerts */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-white font-semibold text-sm mb-3">Bar Shelf Stock</p>
        {shelfAlerts.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No shelf alerts today</p>
        ) : (
          <div className="space-y-2">
            {shelfAlerts.map((e, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
              >
                <div>
                  <p className="text-white text-xs capitalize">
                    {e.drink_name?.replace(/_/g, ' ')}
                  </p>
                  <p className="text-gray-500 text-xs">{e.detected_count} bottles detected</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    e.alert_level === 'missing'
                      ? 'bg-red-500/20 text-red-400'
                      : e.alert_level === 'critical'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                  }`}
                >
                  {e.alert_level}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
