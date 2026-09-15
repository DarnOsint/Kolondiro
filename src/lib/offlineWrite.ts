import { supabase } from './supabase'
import { localGet, localPut, localDelete, queueSync } from './db'
import type { StoreName } from './db'

export interface OfflineResult<T> {
  data: T
  error: null
  offline: boolean
}

function toQueuePayload(record: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...record }
  // local-only marker; not a DB column
  delete payload['synced']
  return payload
}

export async function offlineInsertNoReturn<T extends { id: string }>(
  tableName: StoreName,
  record: T
): Promise<{ error: null | { message?: string }; offline: boolean }> {
  const localRecord = { ...record, synced: false }
  if (localRecord.id) await localPut(tableName, localRecord)

  if (!navigator.onLine) {
    await queueSync(tableName, 'INSERT', record.id, record as Record<string, unknown>)
    return { error: null, offline: true }
  }

  const { error } = await supabase.from(tableName).insert(record)
  if (!error) {
    if (localRecord.id) await localPut(tableName, { ...record, synced: true })
    return { error: null, offline: false }
  }

  if (!navigator.onLine) {
    await queueSync(tableName, 'INSERT', record.id, record as Record<string, unknown>)
    return { error: null, offline: true }
  }

  return { error, offline: false }
}

export async function offlineUpdateNoReturn<T extends { id: string }>(
  tableName: StoreName,
  id: string,
  updates: Partial<T>
): Promise<{ error: null | { message?: string }; offline: boolean }> {
  const current = await localGet<T>(tableName, id)
  const updated = { ...current, id, ...updates, synced: false } as T
  await localPut(tableName, updated)

  if (!navigator.onLine) {
    await queueSync(tableName, 'UPDATE', id, toQueuePayload(updated as Record<string, unknown>))
    return { error: null, offline: true }
  }

  const { error } = await supabase.from(tableName).update(updates).eq('id', id)
  if (!error) {
    await localPut(tableName, {
      ...(updated as unknown as Record<string, unknown>),
      synced: true,
    } as unknown as T)
    return { error: null, offline: false }
  }

  if (!navigator.onLine) {
    await queueSync(tableName, 'UPDATE', id, toQueuePayload(updated as Record<string, unknown>))
    return { error: null, offline: true }
  }

  return { error, offline: false }
}

export async function offlineInsert<T extends { id: string }>(
  tableName: StoreName,
  record: T
): Promise<OfflineResult<T>> {
  const localRecord = { ...record, synced: false }
  // Guard: only write to IDB if record has a valid id
  if (localRecord.id) {
    await localPut(tableName, localRecord)
  }

  if (!navigator.onLine) {
    await queueSync(tableName, 'INSERT', record.id, record as Record<string, unknown>)
    return { data: localRecord, error: null, offline: true }
  }

  const { data, error } = await supabase.from(tableName).insert(record).select().single()
  if (!error && data) {
    const toStore = { ...(data as T), synced: true }
    if ((toStore as { id?: string }).id) {
      await localPut(tableName, toStore)
    }
    return { data: data as T, error: null, offline: false }
  }

  await queueSync(tableName, 'INSERT', record.id, record as Record<string, unknown>)
  return { data: localRecord, error: null, offline: true }
}

export async function offlineUpdate<T extends { id: string }>(
  tableName: StoreName,
  id: string,
  updates: Partial<T>
): Promise<OfflineResult<T>> {
  const current = await localGet<T>(tableName, id)
  const updated = { ...current, id, ...updates, synced: false } as T
  await localPut(tableName, updated)

  if (!navigator.onLine) {
    await queueSync(tableName, 'UPDATE', id, toQueuePayload(updated as Record<string, unknown>))
    return { data: updated, error: null, offline: true }
  }

  const { data, error } = await supabase
    .from(tableName)
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (!error && data) {
    const toStore = { ...(data as T), synced: true }
    if ((toStore as { id?: string }).id) {
      await localPut(tableName, toStore)
    }
    return { data: data as T, error: null, offline: false }
  }

  await queueSync(tableName, 'UPDATE', id, toQueuePayload(updated as Record<string, unknown>))
  return { data: updated, error: null, offline: true }
}

export async function offlineDelete(
  tableName: StoreName,
  id: string
): Promise<{ error: null; offline: boolean }> {
  await localDelete(tableName, id)

  if (!navigator.onLine) {
    await queueSync(tableName, 'DELETE', id, { id })
    return { error: null, offline: true }
  }

  const { error } = await supabase.from(tableName).delete().eq('id', id)
  if (!error) return { error: null, offline: false }

  await queueSync(tableName, 'DELETE', id, { id })
  return { error: null, offline: true }
}
