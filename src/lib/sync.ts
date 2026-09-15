import { supabase } from './supabase'
import { getPendingQueue, removeFromQueue, localBulkPut, localPut } from './db'
import type { SyncQueueEntry } from './db'

const SEED_TABLES = [
  'menu_items',
  'menu_categories',
  'menu_item_zone_prices',
  'tables',
  'profiles',
  'zone_assignments',
  'inventory',
] as const

export async function seedLocalDB(): Promise<void> {
  // NOTE: Seeding pulls a lot of data (high egress). It is currently disabled by default.
  // Enable by setting `VITE_ENABLE_OFFLINE_SEED=true` at build time.
  const enableSeed = String(import.meta.env.VITE_ENABLE_OFFLINE_SEED || '').toLowerCase() === 'true'
  if (!enableSeed) return
  try {
    await Promise.all(
      SEED_TABLES.map(async (table) => {
        const { data, error } = await supabase.from(table).select('*')
        if (!error && data) await localBulkPut(table, data as Array<{ id: string }>)
      })
    )

    const today = new Date()
    today.setHours(8, 0, 0, 0)
    if (new Date().getHours() < 8) today.setDate(today.getDate() - 1)

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', today.toISOString())
    if (orders)
      await localBulkPut(
        'orders',
        orders.map((o) => ({ ...o, synced: true }))
      )

    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .gte('created_at', today.toISOString())
    if (items)
      await localBulkPut(
        'order_items',
        items.map((i) => ({ ...i, synced: true }))
      )

    console.warn('[Sync] Local DB seeded')
  } catch (err) {
    console.warn('[Sync] Seed failed (offline):', (err as Error).message)
  }
}

async function resolveConflict(
  tableName: string,
  localRecord: Record<string, unknown>
): Promise<'local_wins' | 'server_wins'> {
  const { data: serverRecord } = await supabase
    .from(tableName)
    .select('*')
    .eq('id', localRecord['id'])
    .single()

  if (!serverRecord) return 'local_wins'

  const localCreatedAt = localRecord['created_at']
  if (typeof localCreatedAt !== 'string' || !localCreatedAt) return 'local_wins'
  const localTime = new Date(localCreatedAt).getTime()
  const serverTime = new Date(
    (serverRecord as Record<string, unknown>)['created_at'] as string
  ).getTime()

  if (!Number.isFinite(localTime) || localTime <= serverTime) {
    return 'local_wins'
  } else {
    await localPut(tableName as Parameters<typeof localPut>[0], {
      ...(serverRecord as { id: string }),
      synced: true,
    })
    return 'server_wins'
  }
}

async function mergeOrderItems(orderId: string): Promise<void> {
  const { data: serverItems } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
  if (serverItems) {
    await localBulkPut(
      'order_items',
      serverItems.map((i) => ({ ...i, synced: true }))
    )
  }
}

export interface ReplayResult {
  synced: number
  failed: number
}

export async function replayQueue(
  onProgress?: (p: { synced: number; total: number }) => void
): Promise<ReplayResult> {
  const queue = await getPendingQueue()
  if (!queue.length) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  for (const entry of queue) {
    try {
      const { table_name, operation, payload, record_id } = entry

      if (operation === 'INSERT') {
        const { data: existing } = await supabase
          .from(table_name)
          .select('id')
          .eq('id', record_id)
          .single()
        if (existing) {
          await removeFromQueue(entry.id)
          synced++
          continue
        }

        if (table_name === 'order_items') {
          await mergeOrderItems((payload as Record<string, unknown>)['order_id'] as string)
        }

        const { error } = await supabase.from(table_name).insert(payload)
        if (error) throw error
      } else if (operation === 'UPDATE') {
        const resolution = await resolveConflict(table_name, payload)
        if (resolution === 'local_wins') {
          const { error } = await supabase.from(table_name).update(payload).eq('id', record_id)
          if (error) throw error
        }
      } else if (operation === 'DELETE') {
        const { error } = await supabase.from(table_name).delete().eq('id', record_id)
        if (error && (error as { code?: string }).code !== 'PGRST116') throw error
      }

      await removeFromQueue(entry.id)
      synced++
      onProgress?.({ synced, total: queue.length })
    } catch (err) {
      console.error('[Sync] Failed:', (err as Error).message)
      failed++
      const e = entry as SyncQueueEntry
      if (e.retries >= 5) {
        await removeFromQueue(entry.id)
      } else {
        await localPut('sync_queue', { ...e, retries: e.retries + 1 })
      }
    }
  }

  return { synced, failed }
}

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'partial'

export function startSyncListener(onStatusChange?: (status: SyncStatus) => void): () => void {
  const handleOnline = async () => {
    onStatusChange?.('syncing')
    const result = await replayQueue()
    onStatusChange?.(result.failed > 0 ? 'partial' : 'online')
  }

  const handleOffline = () => onStatusChange?.('offline')

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  if (!navigator.onLine) {
    onStatusChange?.('offline')
  }

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
