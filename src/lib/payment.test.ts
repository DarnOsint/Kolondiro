import { describe, it, expect } from 'vitest'
import {
  VAT_RATE,
  calcVat,
  calcTotal,
  calcChange,
  canProcess,
  getPersonItems,
  getPersonTotal,
  getUnassignedItems,
  allItemsAssigned,
  calcExpectedCash,
  calcShortfall,
  calcSurplus,
} from '../lib/payment'
import type { OrderItem } from '../types'

// ─── helpers ─────────────────────────────────────────────────────────────

function makeItem(id: string, total_price: number, extra_charge = 0): OrderItem {
  return {
    id,
    order_id: 'order-1',
    menu_item_id: 'menu-1',
    quantity: 1,
    unit_price: total_price,
    total_price,
    extra_charge,
    status: 'pending',
    destination: 'bar',
    created_at: new Date().toISOString(),
  }
}

// ─── VAT & totals ─────────────────────────────────────────────────────────

describe('calcVat', () => {
  it('calculates 7.5% of subtotal', () => {
    expect(calcVat(1000)).toBeCloseTo(75)
    expect(calcVat(0)).toBe(0)
    expect(calcVat(200)).toBeCloseTo(15)
  })

  it('uses VAT_RATE constant', () => {
    expect(VAT_RATE).toBe(0.075)
    expect(calcVat(100)).toBe(100 * VAT_RATE)
  })
})

describe('calcTotal', () => {
  it('adds VAT to subtotal', () => {
    expect(calcTotal(1000)).toBeCloseTo(1075)
    expect(calcTotal(0)).toBe(0)
  })

  it('is always greater than subtotal for positive amounts', () => {
    const sub = 5000
    expect(calcTotal(sub)).toBeGreaterThan(sub)
  })
})

describe('calcChange', () => {
  it('returns difference between tendered and total', () => {
    expect(calcChange(2000, 1075)).toBeCloseTo(925)
  })

  it('returns negative when under-tendered', () => {
    expect(calcChange(500, 1000)).toBe(-500)
  })

  it('returns zero for exact amount', () => {
    expect(calcChange(1075, 1075)).toBe(0)
  })
})

// ─── Payment validation ───────────────────────────────────────────────────

describe('canProcess', () => {
  it('cash — allows when tendered >= total', () => {
    expect(canProcess({ method: 'cash', total: 1075, cashTendered: 1075 })).toBe(true)
    expect(canProcess({ method: 'cash', total: 1075, cashTendered: 2000 })).toBe(true)
  })

  it('cash — blocks when tendered < total', () => {
    expect(canProcess({ method: 'cash', total: 1075, cashTendered: 500 })).toBe(false)
  })

  it('cash — blocks when tendered undefined', () => {
    expect(canProcess({ method: 'cash', total: 1075 })).toBe(false)
  })

  it('bank_pos — always valid', () => {
    expect(canProcess({ method: 'bank_pos', total: 1075 })).toBe(true)
  })

  it('bank_transfer — always valid', () => {
    expect(canProcess({ method: 'bank_transfer', total: 1075 })).toBe(true)
  })

  it('credit — valid when debtor name provided', () => {
    expect(canProcess({ method: 'credit', total: 1075, debtorName: 'Acme Corp' })).toBe(true)
  })

  it('credit — blocks when debtor name blank', () => {
    expect(canProcess({ method: 'credit', total: 1075, debtorName: '' })).toBe(false)
    expect(canProcess({ method: 'credit', total: 1075, debtorName: '   ' })).toBe(false)
    expect(canProcess({ method: 'credit', total: 1075 })).toBe(false)
  })
})

// ─── Split bill ───────────────────────────────────────────────────────────

describe('split bill helpers', () => {
  const items = [
    makeItem('item-1', 500),
    makeItem('item-2', 1000),
    makeItem('item-3', 750, 100),
    makeItem('item-4', 300),
  ]

  const assignments: Record<string, number> = {
    'item-1': 0,
    'item-2': 0,
    'item-3': 1,
    // item-4 unassigned
  }

  it('getPersonItems returns correct items per person', () => {
    const person0 = getPersonItems(items, assignments, 0)
    expect(person0).toHaveLength(2)
    expect(person0.map((i) => i.id)).toEqual(['item-1', 'item-2'])

    const person1 = getPersonItems(items, assignments, 1)
    expect(person1).toHaveLength(1)
    expect(person1[0].id).toBe('item-3')
  })

  it('getPersonTotal sums total_price + extra_charge', () => {
    expect(getPersonTotal(items, assignments, 0)).toBe(1500)
    // item-3: 750 + 100 = 850
    expect(getPersonTotal(items, assignments, 1)).toBe(850)
  })

  it('getPersonTotal returns 0 for empty person', () => {
    expect(getPersonTotal(items, assignments, 2)).toBe(0)
  })

  it('getUnassignedItems returns only unassigned', () => {
    const unassigned = getUnassignedItems(items, assignments)
    expect(unassigned).toHaveLength(1)
    expect(unassigned[0].id).toBe('item-4')
  })

  it('allItemsAssigned returns false when items unassigned', () => {
    expect(allItemsAssigned(items, assignments)).toBe(false)
  })

  it('allItemsAssigned returns true when all assigned', () => {
    const full = { 'item-1': 0, 'item-2': 0, 'item-3': 1, 'item-4': 1 }
    expect(allItemsAssigned(items, full)).toBe(true)
  })

  it('allItemsAssigned returns true for empty order', () => {
    expect(allItemsAssigned([], {})).toBe(true)
  })
})

// ─── Till session ─────────────────────────────────────────────────────────

describe('till session calculations', () => {
  it('calcExpectedCash = float + sales - payouts', () => {
    expect(calcExpectedCash(5000, 20000, 1500)).toBe(23500)
    expect(calcExpectedCash(0, 0, 0)).toBe(0)
  })

  it('calcShortfall returns positive when expected > actual', () => {
    expect(calcShortfall(23500, 22000)).toBe(1500)
  })

  it('calcShortfall returns 0 when no shortfall', () => {
    expect(calcShortfall(23500, 23500)).toBe(0)
    expect(calcShortfall(23500, 25000)).toBe(0)
  })

  it('calcSurplus returns positive when actual > expected', () => {
    expect(calcSurplus(23500, 25000)).toBe(1500)
  })

  it('calcSurplus returns 0 when no surplus', () => {
    expect(calcSurplus(23500, 23500)).toBe(0)
    expect(calcSurplus(23500, 22000)).toBe(0)
  })

  it('shortfall and surplus are mutually exclusive', () => {
    const expected = 10000
    const actual = 8500
    expect(calcShortfall(expected, actual)).toBeGreaterThan(0)
    expect(calcSurplus(expected, actual)).toBe(0)
  })
})
