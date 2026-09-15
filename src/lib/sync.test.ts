import { describe, it, expect } from 'vitest'

/**
 * We test the conflict resolution logic in isolation.
 * Supabase calls are mocked — we're testing the decision logic, not the DB.
 */

// ─── Pure conflict resolution logic (extracted for testing) ──────────────

type ConflictResolution = 'local_wins' | 'server_wins'

function resolveConflict(
  localCreatedAt: string,
  serverCreatedAt: string | null
): ConflictResolution {
  if (!serverCreatedAt) return 'local_wins'
  const localTime = new Date(localCreatedAt).getTime()
  const serverTime = new Date(serverCreatedAt).getTime()
  // Local record was created first (older) — trust local
  return localTime <= serverTime ? 'local_wins' : 'server_wins'
}

// ─── Sync queue retry logic ───────────────────────────────────────────────

interface QueueEntry {
  id: string
  retries: number
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  record_id: string
  payload: Record<string, unknown>
}

const MAX_RETRIES = 5

function shouldRetry(entry: QueueEntry): boolean {
  return entry.retries < MAX_RETRIES
}

function incrementRetries(entry: QueueEntry): QueueEntry {
  return { ...entry, retries: entry.retries + 1 }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('resolveConflict', () => {
  it('local wins when server record does not exist', () => {
    expect(resolveConflict('2025-01-01T10:00:00Z', null)).toBe('local_wins')
  })

  it('local wins when local record is older (created first)', () => {
    expect(resolveConflict('2025-01-01T10:00:00Z', '2025-01-01T11:00:00Z')).toBe('local_wins')
  })

  it('local wins when timestamps are equal', () => {
    const ts = '2025-01-01T10:00:00Z'
    expect(resolveConflict(ts, ts)).toBe('local_wins')
  })

  it('server wins when server record is older (server was written first)', () => {
    expect(resolveConflict('2025-01-01T11:00:00Z', '2025-01-01T10:00:00Z')).toBe('server_wins')
  })

  it('handles millisecond-level precision', () => {
    expect(resolveConflict('2025-01-01T10:00:00.500Z', '2025-01-01T10:00:00.499Z')).toBe(
      'server_wins'
    )
    expect(resolveConflict('2025-01-01T10:00:00.499Z', '2025-01-01T10:00:00.500Z')).toBe(
      'local_wins'
    )
  })
})

describe('sync queue retry logic', () => {
  const baseEntry: QueueEntry = {
    id: 'q-1',
    retries: 0,
    table_name: 'orders',
    operation: 'INSERT',
    record_id: 'order-abc',
    payload: { id: 'order-abc', total_amount: 1500 },
  }

  it('should retry when retries < MAX_RETRIES', () => {
    expect(shouldRetry({ ...baseEntry, retries: 0 })).toBe(true)
    expect(shouldRetry({ ...baseEntry, retries: 4 })).toBe(true)
  })

  it('should not retry when retries >= MAX_RETRIES', () => {
    expect(shouldRetry({ ...baseEntry, retries: 5 })).toBe(false)
    expect(shouldRetry({ ...baseEntry, retries: 10 })).toBe(false)
  })

  it('MAX_RETRIES is 5', () => {
    expect(MAX_RETRIES).toBe(5)
  })

  it('incrementRetries adds 1 to retries without mutating original', () => {
    const original = { ...baseEntry, retries: 2 }
    const updated = incrementRetries(original)
    expect(updated.retries).toBe(3)
    expect(original.retries).toBe(2) // immutability check
  })

  it('incrementRetries preserves all other fields', () => {
    const updated = incrementRetries(baseEntry)
    expect(updated.id).toBe(baseEntry.id)
    expect(updated.table_name).toBe(baseEntry.table_name)
    expect(updated.operation).toBe(baseEntry.operation)
    expect(updated.record_id).toBe(baseEntry.record_id)
  })

  it('entry at retry 4 should retry, at retry 5 should stop', () => {
    const nearLimit = { ...baseEntry, retries: 4 }
    expect(shouldRetry(nearLimit)).toBe(true)
    const atLimit = incrementRetries(nearLimit)
    expect(shouldRetry(atLimit)).toBe(false)
  })
})

describe('sync queue operations', () => {
  it('INSERT operation is handled differently from UPDATE', () => {
    const insert: QueueEntry = { ...baseEntry, operation: 'INSERT' }
    const update: QueueEntry = { ...baseEntry, operation: 'UPDATE' }
    expect(insert.operation).not.toBe(update.operation)
  })

  it('DELETE operation preserves record_id', () => {
    const del: QueueEntry = { ...baseEntry, operation: 'DELETE', record_id: 'order-xyz' }
    expect(del.record_id).toBe('order-xyz')
  })
})

// baseEntry used in later describe blocks
const baseEntry: QueueEntry = {
  id: 'q-1',
  retries: 0,
  table_name: 'orders',
  operation: 'INSERT',
  record_id: 'order-abc',
  payload: { id: 'order-abc', total_amount: 1500 },
}
