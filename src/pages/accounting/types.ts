// ── Accounting-local types ─────────────────────────────────────────────────
// (extends src/types/index.ts — import domain types from there)

import type { PaymentMethod } from '../../types'

export interface AccountingSummary {
  total: number
  byMethod: Record<string, number>
  orders: number
  avgOrder: number
}

export interface WaitronStat {
  name: string
  orders: number
  revenue: number
  cashExpected?: number
  transferExpected?: number
}

export interface TrendPoint {
  day: string
  revenue: number
  orders: number
}

export interface LedgerEntry {
  id: string
  date: string
  type: 'credit' | 'debit'
  description: string
  ref: string
  debit: number
  credit: number
  balance: number
  method: PaymentMethod | string | null
  staff: string | null
}

export interface PayoutRow {
  id: string
  amount: number
  reason: string
  category: string
  paid_to: string | null
  created_at: string
  profiles?: { full_name: string } | null
}

export interface TillSession {
  id: string
  opening_float: number
  closing_float: number | null
  expected_cash: number | null
  status: 'open' | 'closed'
  opened_at: string
  profiles?: { full_name: string } | null
}

export interface TimesheetEntry {
  id: string
  staff_id: string
  staff_name: string
  role: string
  date: string
  clock_in: string
  clock_out: string | null
  duration_minutes: number | null
  pos_machine?: string | null
}

export interface AuditEntry {
  id: string
  action: string
  entity: string
  entity_name?: string | null
  performed_by_name?: string | null
  performed_by_role?: string | null
  new_value?: Record<string, unknown> | null
  created_at: string
}

export interface PayoutForm {
  amount: string
  reason: string
  category: string
  paid_to: string
}

export interface Order {
  id: string
  status: string
  total_amount: number
  payment_method: string
  order_type: string
  created_at: string
  closed_at?: string | null
  staff_id?: string
  profiles?: { full_name: string } | null
  tables?: { name: string } | null
}
