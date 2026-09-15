/**
 * payment.ts — pure functions for all payment calculations.
 * No React, no Supabase. Fully testable.
 */

import type { OrderItem } from '../types'

export const VAT_RATE = 0.075 // 7.5% Nigerian VAT

// ─── Basic totals ─────────────────────────────────────────────────────────

export function calcSubtotal(totalAmount: number): number {
  return totalAmount
}

export function calcVat(subtotal: number): number {
  return subtotal * VAT_RATE
}

export function calcTotal(subtotal: number): number {
  return subtotal + calcVat(subtotal)
}

export function calcChange(tendered: number, total: number): number {
  return tendered - total
}

// ─── Payment validation ───────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'bank_pos' | 'bank_transfer' | 'credit'

export interface PaymentValidationInput {
  method: PaymentMethod
  total: number
  cashTendered?: number
  debtorName?: string
}

export function canProcess(input: PaymentValidationInput): boolean {
  const { method, total, cashTendered, debtorName } = input
  if (method === 'cash') {
    return typeof cashTendered === 'number' && cashTendered >= total
  }
  if (method === 'credit') {
    return typeof debtorName === 'string' && debtorName.trim().length > 0
  }
  // bank_pos and bank_transfer — no extra validation needed client-side
  return true
}

// ─── Split bill ───────────────────────────────────────────────────────────

export function getPersonItems(
  orderItems: OrderItem[],
  assignments: Record<string, number>,
  personIdx: number
): OrderItem[] {
  return orderItems.filter((item) => assignments[item.id] === personIdx)
}

export function getPersonTotal(
  orderItems: OrderItem[],
  assignments: Record<string, number>,
  personIdx: number
): number {
  return getPersonItems(orderItems, assignments, personIdx).reduce(
    (sum, item) => sum + (item.total_price || 0) + (item.extra_charge || 0),
    0
  )
}

export function getUnassignedItems(
  orderItems: OrderItem[],
  assignments: Record<string, number>
): OrderItem[] {
  return orderItems.filter((item) => assignments[item.id] === undefined)
}

export function allItemsAssigned(
  orderItems: OrderItem[],
  assignments: Record<string, number>
): boolean {
  return getUnassignedItems(orderItems, assignments).length === 0
}

// ─── Till session helpers ─────────────────────────────────────────────────

export function calcExpectedCash(openingFloat: number, cashSales: number, payouts: number): number {
  return openingFloat + cashSales - payouts
}

export function calcShortfall(expected: number, actual: number): number {
  return expected > actual ? expected - actual : 0
}

export function calcSurplus(expected: number, actual: number): number {
  return actual > expected ? actual - expected : 0
}
