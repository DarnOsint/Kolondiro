import { useEffect, useState } from 'react'
import { startSyncListener, replayQueue } from '../lib/sync'
import { getPendingCount } from '../lib/db'
import type { SyncStatus } from '../lib/sync'

type Snapshot = {
  status: SyncStatus
  pendingCount: number
  lastSynced: Date | null
}

let initialized = false
let snapshot: Snapshot = {
  status: navigator.onLine ? 'online' : 'offline',
  pendingCount: 0,
  lastSynced: null,
}
const listeners = new Set<() => void>()

async function refreshPendingCount(): Promise<void> {
  snapshot = { ...snapshot, pendingCount: await getPendingCount() }
  listeners.forEach((l) => l())
}

function initOnce(): void {
  if (initialized) return
  initialized = true

  startSyncListener((s) => {
    snapshot = {
      ...snapshot,
      status: s,
      lastSynced: s === 'online' ? new Date() : snapshot.lastSynced,
    }
    listeners.forEach((l) => l())
    void refreshPendingCount()
  })

  void refreshPendingCount()
  window.setInterval(() => {
    void refreshPendingCount()
  }, 15_000)
}

export function useSyncStatus() {
  initOnce()
  const [state, setState] = useState<Snapshot>(snapshot)

  useEffect(() => {
    const onChange = () => setState(snapshot)
    listeners.add(onChange)
    void refreshPendingCount()
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  const manualSync = async (): Promise<void> => {
    if (!navigator.onLine) return
    snapshot = { ...snapshot, status: 'syncing' }
    listeners.forEach((l) => l())
    const result = await replayQueue()
    snapshot = {
      ...snapshot,
      status: result.failed > 0 ? 'partial' : 'online',
      lastSynced: new Date(),
      pendingCount: await getPendingCount(),
    }
    listeners.forEach((l) => l())
  }

  return { ...state, manualSync }
}
