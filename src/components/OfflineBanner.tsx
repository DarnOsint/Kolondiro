import { useSyncStatus } from '../hooks/useSyncStatus'
import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'

export default function OfflineBanner() {
  const { status, pendingCount, manualSync } = useSyncStatus()
  if (status === 'online' && pendingCount === 0) return null
  const isOffline = status === 'offline'
  const isSyncing = status === 'syncing'
  const hasPending = pendingCount > 0
  return (
    <div
      className={`w-full px-4 py-2 flex items-center justify-between gap-3 text-sm z-[9999]
      ${isOffline ? 'bg-red-950/90 border-b border-red-800/50' : ''}
      ${hasPending && !isOffline ? 'bg-amber-950/90 border-b border-amber-800/50' : ''}
      ${isSyncing ? 'bg-blue-950/90 border-b border-blue-800/50' : ''}`}
    >
      <div className="flex items-center gap-2">
        {isOffline ? (
          <WifiOff size={14} className="text-red-400   flex-shrink-0" />
        ) : isSyncing ? (
          <RefreshCw size={14} className="text-blue-400  flex-shrink-0 animate-spin" />
        ) : (
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
        )}
        <span
          className={isOffline ? 'text-red-300' : isSyncing ? 'text-blue-300' : 'text-amber-300'}
        >
          {isOffline
            ? 'Working offline — changes saved locally'
            : isSyncing
              ? 'Syncing changes...'
              : `${pendingCount} change${pendingCount !== 1 ? 's' : ''} waiting to sync`}
        </span>
      </div>
      {!isOffline && !isSyncing && (
        <button
          onClick={manualSync}
          className="text-xs text-amber-400 hover:text-amber-300 font-medium flex-shrink-0"
        >
          Sync now
        </button>
      )}
    </div>
  )
}
