import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditParams } from '../types'

/**
 * We test the audit() function logic:
 * - it calls supabase.from('audit_log').insert(...)
 * - it maps params to the correct DB columns
 * - it never throws (errors are swallowed — audit must not crash the app)
 */

// ─── Mock Supabase ────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ insert: mockInsert })),
  },
}))

// Import audit AFTER mock is set up
const { audit } = await import('../lib/audit')

// ─── Tests ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockResolvedValue({ data: null, error: null })
})

describe('audit()', () => {
  it('inserts a row into audit_log', async () => {
    const params: AuditParams = {
      action: 'ORDER_CREATED',
      entity: 'order',
      entityId: 'order-123',
      entityName: 'Table 5',
      newValue: { total: 1500 },
      performer: { id: 'staff-1', full_name: 'Tunde Adeyemi', role: 'waitron' },
    }
    await audit(params)
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })

  it('maps params to the correct column names', async () => {
    await audit({
      action: 'VOID_ITEM',
      entity: 'order_item',
      entityId: 'item-999',
      entityName: 'Heineken 600ml',
      oldValue: { quantity: 2 },
      newValue: { quantity: 0 },
      performer: { id: 'mgr-1', full_name: 'Ade Bello', role: 'manager' },
    })

    const insertArg = mockInsert.mock.calls[0][0]
    expect(insertArg).toMatchObject({
      action: 'VOID_ITEM',
      entity: 'order_item',
      entity_id: 'item-999',
      entity_name: 'Heineken 600ml',
      old_value: { quantity: 2 },
      new_value: { quantity: 0 },
      performed_by: 'mgr-1',
      performed_by_name: 'Ade Bello',
      performed_by_role: 'manager',
    })
  })

  it('handles missing optional fields gracefully', async () => {
    await audit({ action: 'LOGIN', entity: 'session' })
    const insertArg = mockInsert.mock.calls[0][0]
    expect(insertArg.entity_id).toBeNull()
    expect(insertArg.entity_name).toBeNull()
    expect(insertArg.old_value).toBeNull()
    expect(insertArg.new_value).toBeNull()
    expect(insertArg.performed_by).toBeNull()
    expect(insertArg.performed_by_name).toBeNull()
    expect(insertArg.performed_by_role).toBeNull()
  })

  it('handles null performer without crashing', async () => {
    await expect(
      audit({ action: 'SYSTEM_EVENT', entity: 'system', performer: null })
    ).resolves.not.toThrow()
  })

  it('never throws even when supabase insert fails', async () => {
    mockInsert.mockRejectedValueOnce(new Error('Network error'))
    await expect(
      audit({ action: 'ORDER_PAID', entity: 'order', entityId: 'x' })
    ).resolves.not.toThrow()
  })

  it('never throws even when supabase returns an error object', async () => {
    mockInsert.mockResolvedValueOnce({ data: null, error: { message: 'RLS violation' } })
    await expect(
      audit({ action: 'ORDER_PAID', entity: 'order', entityId: 'x' })
    ).resolves.not.toThrow()
  })
})
