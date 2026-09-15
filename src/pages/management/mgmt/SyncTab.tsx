interface SyncEntry {
  operation: string
  table_name: string
  record_id: string
  retries: number
}

interface Props {
  syncStatus: string
  pendingCount: number
  lastSynced: Date | null
  syncQueue: SyncEntry[]
  onManualSync: () => void
}

export default function SyncTab({
  syncStatus,
  pendingCount,
  lastSynced,
  syncQueue,
  onManualSync,
}: Props) {
  return (
    <div className="p-4 space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-sm">Offline Sync Queue</p>
          <p className="text-gray-500 text-xs mt-0.5">
            {pendingCount === 0
              ? 'All changes synced'
              : `${pendingCount} change${pendingCount > 1 ? 's' : ''} pending`}
            {lastSynced &&
              ` · Last synced ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium ${
              syncStatus === 'online'
                ? 'bg-green-500/20 text-green-400'
                : syncStatus === 'offline'
                  ? 'bg-red-500/20 text-red-400'
                  : syncStatus === 'syncing'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-orange-500/20 text-orange-400'
            }`}
          >
            {syncStatus}
          </span>
          <button
            onClick={onManualSync}
            disabled={syncStatus === 'offline' || pendingCount === 0}
            className="text-xs bg-amber-500 text-black px-3 py-1.5 rounded-xl font-medium disabled:opacity-40"
          >
            Sync Now
          </button>
        </div>
      </div>

      {syncQueue.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
          <p className="text-green-400 text-sm font-medium">✓ All clear</p>
          <p className="text-gray-500 text-xs mt-1">No pending writes in the offline queue</p>
        </div>
      ) : (
        <div className="space-y-2">
          {syncQueue.map((entry, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
            >
              <div>
                <p className="text-white text-xs font-medium capitalize">
                  {entry.operation?.toLowerCase()} · {entry.table_name?.replace(/_/g, ' ')}
                </p>
                <p className="text-gray-500 text-xs mt-0.5 font-mono">
                  {entry.record_id?.slice(0, 16)}…
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  entry.retries > 3
                    ? 'bg-red-500/20 text-red-400'
                    : entry.retries > 0
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-gray-700 text-gray-400'
                }`}
              >
                {entry.retries > 0 ? `${entry.retries} retries` : 'pending'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
