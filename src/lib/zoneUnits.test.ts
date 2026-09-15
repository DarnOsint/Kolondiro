import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { from: fromMock },
}))

import { zoneUnitsKey, lineUnits, chillerQty } from './zoneUnits'

describe('zoneUnitsKey', () => {
  it('builds composite key', () => {
    expect(zoneUnitsKey('item-1', 'zone-2')).toBe('item-1:zone-2')
  })

  it('handles missing parts', () => {
    expect(zoneUnitsKey(null, 'zone-2')).toBe(':zone-2')
    expect(zoneUnitsKey('item-1', undefined)).toBe('item-1:')
  })
})

describe('fetchZoneUnitsPerSale', () => {
  beforeEach(() => {
    vi.resetModules()
    fromMock.mockReset()
  })

  it('maps only entries with units greater than 1', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          { menu_item_id: 'beer', category_id: 'indoor', units_per_sale: 2 },
          { menu_item_id: 'water', category_id: 'indoor', units_per_sale: 1 },
          { menu_item_id: 'wine', category_id: 'garden', units_per_sale: null },
        ],
        error: null,
      }),
    })
    const { fetchZoneUnitsPerSale } = await import('./zoneUnits')
    const map = await fetchZoneUnitsPerSale()
    expect(map['beer:indoor']).toBe(2)
    expect(map['water:indoor']).toBeUndefined()
    expect(map['wine:garden']).toBeUndefined()
  })

  it('returns empty map on query error', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    })
    const { fetchZoneUnitsPerSale } = await import('./zoneUnits')
    const map = await fetchZoneUnitsPerSale()
    expect(map).toEqual({})
  })

  it('caches within TTL and serves stale cache if a later fetch fails', async () => {
    fromMock.mockReturnValue({
      select: vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ menu_item_id: 'beer', category_id: 'indoor', units_per_sale: 2 }],
          error: null,
        })
        .mockRejectedValueOnce(new Error('network down')),
    })
    const mod = await import('./zoneUnits')
    const first = await mod.fetchZoneUnitsPerSale()
    expect(first['beer:indoor']).toBe(2)
    const second = await mod.fetchZoneUnitsPerSale()
    expect(second).toEqual(first)
  })
})

describe('lineUnits / chillerQty', () => {
  const map = { 'beer:indoor': 2 }

  it('defaults to 1 when no config matches', () => {
    expect(lineUnits(map, 'beer', 'garden')).toBe(1)
    expect(lineUnits(null, 'beer', 'indoor')).toBe(1)
    expect(lineUnits(undefined, null, null)).toBe(1)
  })

  it('returns configured multiplier', () => {
    expect(lineUnits(map, 'beer', 'indoor')).toBe(2)
  })

  it('multiplies sold quantity by zone units for chiller deduction', () => {
    expect(chillerQty(1, map, 'beer', 'indoor')).toBe(2)
    expect(chillerQty(3, map, 'beer', 'indoor')).toBe(6)
    expect(chillerQty(3, map, 'beer', 'garden')).toBe(3)
    expect(chillerQty(0, map, 'beer', 'indoor')).toBe(0)
    expect(chillerQty(null, map, 'beer', 'indoor')).toBe(0)
  })
})
