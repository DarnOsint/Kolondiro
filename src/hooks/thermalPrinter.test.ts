/**
 * thermalPrinter.test.ts
 * Unit tests for the ESC/POS receipt builder (buildReceipt).
 * buildReceipt is a pure function → no mocks needed.
 */

import { describe, it, expect } from 'vitest'
import { buildReceipt } from './useThermalPrinter'
import type { ReceiptData } from './useThermalPrinter'

// ─── helpers ─────────────────────────────────────────────────────────────────

const decoder = new TextDecoder()

/** Convert a receipt Uint8Array to a readable ASCII string (strips ESC/POS control bytes) */
function toText(buf: Uint8Array): string {
  return decoder.decode(buf.filter((b) => b >= 0x20 || b === 0x0a))
}

function makeReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    order: {
      created_at: '2026-03-14T10:30:00.000Z',
      order_type: 'table',
      payment_method: 'cash',
    },
    items: [
      {
        quantity: 2,
        total_price: 4000,
        menu_items: { name: 'Grilled Chicken' },
      },
      {
        quantity: 1,
        total_price: 2500,
        menu_items: { name: 'Chapman' },
        modifier_notes: 'No ice',
      },
    ],
    table: { name: 'VIP-1' },
    staffName: 'Adaeze',
    orderRef: 'ORD-001',
    subtotal: 6500,
    vatAmount: 487.5,
    total: 6987.5,
    ...overrides,
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('buildReceipt', () => {
  it('returns a Uint8Array', () => {
    const buf = buildReceipt(makeReceipt())
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('contains the venue name', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain("KOLONDIRO")
  })

  it('contains the order reference', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('ORD-001')
  })

  it('contains the table name', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('VIP-1')
  })

  it('shows Takeaway when order_type is takeaway and no table', () => {
    const data = makeReceipt({
      order: {
        created_at: '2026-03-14T10:30:00.000Z',
        order_type: 'takeaway',
        payment_method: 'cash',
      },
      table: null,
    })
    const text = toText(buildReceipt(data))
    expect(text).toContain('Takeaway')
  })

  it('shows Counter when order_type is not takeaway and no table', () => {
    const data = makeReceipt({ table: null })
    const text = toText(buildReceipt(data))
    expect(text).toContain('Counter')
  })

  it('contains the staff name', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('Adaeze')
  })

  it('contains the payment method uppercased', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('CASH')
  })

  it('renders each item name (truncated to 16 chars)', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('Grilled Chicken')
    expect(text).toContain('Chapman')
  })

  it('renders modifier notes when present', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('No ice')
  })

  it('does not render modifier notes when absent', () => {
    const data = makeReceipt({
      items: [{ quantity: 1, total_price: 1000, menu_items: { name: 'Pepsi' } }],
    })
    const text = toText(buildReceipt(data))
    expect(text).not.toContain('>')
  })

  it('uses item.name fallback when menu_items is null', () => {
    const data = makeReceipt({
      items: [{ quantity: 1, total_price: 500, name: 'Water', menu_items: null }],
    })
    const text = toText(buildReceipt(data))
    expect(text).toContain('Water')
  })

  it('contains VAT label', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('VAT (7.5%)')
  })

  it('contains TOTAL label', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('TOTAL:')
  })

  it('contains thank-you footer', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('Thank you for visiting!')
  })

  it('contains RestaurantOS branding', () => {
    const text = toText(buildReceipt(makeReceipt()))
    expect(text).toContain('RestaurantOS')
  })

  it('ends with ESC/POS cut command bytes', () => {
    const buf = buildReceipt(makeReceipt())
    // cut command is GS 0x56 0x42 0x00 = [29, 86, 66, 0]
    const last8 = Array.from(buf.slice(-8))
    expect(last8).toContain(29) // GS
    expect(last8).toContain(86) // 0x56
    expect(last8).toContain(66) // 0x42
  })

  it('starts with ESC @ init command', () => {
    const buf = buildReceipt(makeReceipt())
    expect(buf[0]).toBe(0x1b) // ESC
    expect(buf[1]).toBe(0x40) // @
  })

  it('handles zero items gracefully', () => {
    const data = makeReceipt({ items: [], subtotal: 0, vatAmount: 0, total: 0 })
    const buf = buildReceipt(data)
    const text = toText(buf)
    expect(text).toContain('TOTAL:')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('truncates item names longer than 16 chars', () => {
    const data = makeReceipt({
      items: [
        { quantity: 1, total_price: 1000, menu_items: { name: 'SuperLongMenuItemNameHere' } },
      ],
    })
    const text = toText(buildReceipt(data))
    // truncated to 16: 'SuperLongMenuIte'
    expect(text).toContain('SuperLongMenuIte')
    expect(text).not.toContain('SuperLongMenuItemNameHere')
  })

  it('handles missing staffName gracefully', () => {
    const data = makeReceipt({ staffName: undefined })
    expect(() => buildReceipt(data)).not.toThrow()
    const text = toText(buildReceipt(data))
    expect(text).toContain('Served by:')
  })

  it('handles missing payment_method gracefully', () => {
    const data = makeReceipt({
      order: { created_at: '2026-03-14T10:30:00.000Z', order_type: 'table', payment_method: null },
    })
    expect(() => buildReceipt(data)).not.toThrow()
  })
})
