import { useSyncStatus } from '../hooks/useSyncStatus'
import { RefreshCw, Wifi, WifiOff, AlertCircle } from 'lucide-react'

interface Props {
  compact?: boolean
}

const CONFIGS = {
  online: { color: 'bg-green-500', icon: Wifi, label: 'Online', text: 'text-green-400' },
  offline: { color: 'bg-red-500', icon: WifiOff, label: 'Offline', text: 'text-red-400' },
  syncing: {
    color: 'bg-blue-500 animate-pulse',
    icon: RefreshCw,
    label: 'Syncing',
    text: 'text-blue-400',
  },
  partial: {
    color: 'bg-amber-500',
    icon: AlertCircle,
    label: 'Sync issue',
    text: 'text-amber-400',
  },
}

export default function SyncIndicator({ compact = false }: Props) {
  const { status, pendingCount, manualSync } = useSyncStatus()
  const cfg = CONFIGS[status as keyof typeof CONFIGS] ?? CONFIGS.online
  const Icon = cfg.icon
  const hasPending = pendingCount > 0
  if (compact)
    return (
      <button
        onClick={manualSync}
        className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
        title={hasPending ? `${pendingCount} unsynced changes` : cfg.label}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${hasPending ? 'bg-amber-500' : cfg.color}`}
        />
        {hasPending && <span className="text-amber-400 text-xs font-medium">{pendingCount}</span>}
      </button>
    )
  return (
    <button
      onClick={manualSync}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${hasPending ? 'bg-amber-500 animate-pulse' : cfg.color}`}
      />
      <Icon size={14} className={cfg.text} />
      <span className={`text-xs ${cfg.text}`}>
        {hasPending ? `${pendingCount} pending` : cfg.label}
      </span>
    </button>
  )
}
