import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useAuth } from '../../context/AuthContext'
import {
  ShoppingBag,
  AlertTriangle,
  Users,
  DollarSign,
  BarChart2,
  Clock,
  BookOpen,
  Shield,
  TrendingUp,
  Monitor,
  Heart,
  RotateCcw,
  Beer,
  ChefHat,
  ClipboardList,
  CalendarDays,
  Package,
} from 'lucide-react'

import WaitronOrdersTab from './WaitronOrdersTab'
import StockSummaryTab from './StockSummaryTab'
import AttendanceTab from './AttendanceTab'
import TimesheetTab from './TimesheetTab'
import Debtors from './Debtors'
import OverviewTab from './OverviewTab'
import OrdersTab from './OrdersTab'
import StaffTab from './StaffTab'
import TillTab from './TillTab'
import PayoutsTab from './PayoutsTab'
import TrendsTab from './TrendsTab'
import LedgerTab from './LedgerTab'
import AuditTab from './AuditTab'
import POSReconciliationTab from './POSReconciliationTab'
import TipsTab from './TipsTab'
import ReturnsTab from './ReturnsTab'
import MainStoreTab from './MainStoreTab'
import StoreToChillerTab from './StoreToChillerTab'
import { getNetOrderAmount } from './orderAmounts'

import type {
  AccountingSummary,
  WaitronStat,
  TrendPoint,
  PayoutRow,
  TillSession,
  TimesheetEntry,
  AuditEntry,
} from './types'
import type { Order } from '../../types'

const DATE_RANGES = ['Today', 'Prev Day', 'Date', 'This Week', 'This Month', 'Custom'] as const
type DateRange = (typeof DATE_RANGES)[number]

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart2 },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'staff', label: 'Staff Sales', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: CalendarDays },
  { id: 'timesheet', label: 'Timesheet', icon: Clock },
  { id: 'till', label: 'Till', icon: Clock },
  { id: 'payouts', label: 'Payouts', icon: DollarSign },
  { id: 'tips', label: 'Tips', icon: Heart },
  { id: 'returns', label: 'Returns', icon: RotateCcw },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'debtors', label: 'Outstanding', icon: AlertTriangle },
  { id: 'ledger', label: 'Ledger', icon: BookOpen },
  { id: 'audit', label: 'Audit', icon: Shield },
  { id: 'pos', label: 'POS Recon', icon: Monitor },
  { id: 'waitron_orders', label: 'Waitron Orders', icon: ClipboardList },
  { id: 'bar_stock', label: 'Bar Stock', icon: Beer },
  { id: 'kitchen_stock', label: 'Kitchen Stock', icon: ChefHat },
  { id: 'store_to_chiller', label: 'Store → Chiller', icon: Package },
  { id: 'main_store', label: 'Main Store', icon: Package },
] as const

const getWaitronRemittance = (paymentMethod: string | null | undefined, amount: number) => {
  const pm = (paymentMethod || '').toLowerCase()
  if (pm === 'cash') return { cash: amount, transfer: 0 }
  if (pm === 'card' || pm === 'bank_pos') return { cash: 0, transfer: amount }
  if (pm.startsWith('transfer') || pm === 'transfer') return { cash: 0, transfer: amount }
  if (pm.startsWith('cash+transfer')) {
    const payload = pm.split(':')[1] || ''
    const [cashPart, transferPart] = payload.split('+')
    return {
      cash: parseFloat(cashPart || '0') || 0,
      transfer: parseFloat(transferPart || '0') || 0,
    }
  }
  if (pm.startsWith('cash+card')) {
    const payload = pm.split(':')[1] || ''
    const [cashPart, cardPart] = payload.split('+')
    return {
      cash: parseFloat(cashPart || '0') || 0,
      transfer: parseFloat(cardPart || '0') || 0,
    }
  }
  return { cash: 0, transfer: 0 }
}

export default function Accounting() {
  useAuth()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview')
  const [dateRange, setDateRange] = useState<DateRange>('Today')
  const [pickedDate, setPickedDate] = useState(() => {
    const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
    return wat.toLocaleDateString('en-CA')
  })
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [orderFilter, setOrderFilter] = useState({ status: 'all', type: 'all' })

  // ── Void sub-state (date-specific fetch) ─────────────────────────────────

  // ── Data state ────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState<AccountingSummary>({
    total: 0,
    byMethod: {},
    orders: 0,
    avgOrder: 0,
  })
  const [orders, setOrders] = useState<Order[]>([])
  const [waitronStats, setWaitronStats] = useState<WaitronStat[]>([])
  const [creditByWaitron, setCreditByWaitron] = useState<Record<string, number>>({})
  const [creditDetailsList, setCreditDetailsList] = useState<
    Array<{ name: string; amount: number; notes: string; date: string; by: string }>
  >([])
  const [trendData, setTrendData] = useState<TrendPoint[]>([])
  const [tillSessions, setTillSessions] = useState<TillSession[]>([])
  const [timesheet, setTimesheet] = useState<TimesheetEntry[]>([])
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [payouts, setPayouts] = useState<PayoutRow[]>([])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getDateBounds = useCallback(() => {
    const now = new Date()
    let start: Date, end: Date

    // Session window: 08:00 previous day → 08:00 today (WAT), resets daily at 8am
    const sessionStart = () => {
      const lagosNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
      const s = new Date(lagosNow)
      s.setHours(8, 0, 0, 0)
      if (lagosNow.getHours() < 8) s.setDate(s.getDate() - 1)
      return s
    }

    if (dateRange === 'Today') {
      start = sessionStart()
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    } else if (dateRange === 'Prev Day') {
      start = sessionStart()
      start.setDate(start.getDate() - 1)
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    } else if (dateRange === 'Date' && pickedDate) {
      start = new Date(pickedDate)
      start.setHours(8, 0, 0, 0)
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    } else if (dateRange === 'This Week') {
      start = sessionStart()
      start.setDate(start.getDate() - start.getDay())
      end = new Date(start)
      end.setDate(end.getDate() + 7)
    } else if (dateRange === 'This Month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      start.setHours(8, 0, 0, 0)
      end = sessionStart()
    } else if (dateRange === 'Custom' && customStart && customEnd) {
      start = new Date(customStart)
      start.setHours(8, 0, 0, 0)
      end = new Date(customEnd)
      end.setHours(8, 0, 0, 0)
      end.setDate(end.getDate() + 1)
    } else {
      start = sessionStart()
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }, [dateRange, customStart, customEnd, pickedDate])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const { start, end } = getDateBounds()

    const [ordersRes, tillRes, payoutsRes, trendRes, timesheetRes, auditRes] = await Promise.all([
      // IMPORTANT:
      // - Paid sales must be filtered by `closed_at` so end-of-day reports tally with actual sales time.
      // - Open orders (not yet paid) can be filtered by `created_at` for visibility during the session.
      supabase
        .from('orders')
        .select(
          'id, status, total_amount, payment_method, order_type, created_at, closed_at, staff_id, profiles(full_name), tables(name), order_items(id, quantity, total_price, extra_charge, status, destination, modifier_notes, return_requested, return_accepted, menu_items(name))'
        )
        .or(
          `and(status.eq.paid,closed_at.gte.${start},closed_at.lt.${end}),and(status.neq.paid,created_at.gte.${start},created_at.lt.${end})`
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('till_sessions')
        .select(
          'id, opening_float, closing_float, expected_cash, status, opened_at, profiles(full_name)'
        )
        .gte('opened_at', start)
        .lte('opened_at', end)
        .order('opened_at', { ascending: false }),
      supabase
        .from('payouts')
        .select('id, amount, reason, category, paid_to, created_at')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select(
          'created_at, order_items(total_price, extra_charge, status, return_requested, return_accepted)'
        )
        .eq('status', 'paid')
        .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
        .order('created_at', { ascending: true }),
      supabase
        .from('attendance')
        .select(
          'id, staff_id, staff_name, role, date, clock_in, clock_out, duration_minutes, pos_machine'
        )
        .gte('clock_in', start)
        .lte('clock_in', end)
        .order('clock_in', { ascending: false }),
      supabase
        .from('audit_log')
        .select(
          'id, action, entity, entity_name, performed_by_name, performed_by_role, new_value, created_at'
        )
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    const allOrders = (ordersRes.data || []) as unknown as Order[]
    const paidOrders = allOrders.filter((o) => o.status === 'paid')

    const total = paidOrders.reduce((s, o) => s + getNetOrderAmount(o), 0)
    const byMethod: Record<string, number> = {}
    paidOrders.forEach((o) => {
      const pm = (o.payment_method || '').toLowerCase()
      let key = 'Transfer'
      if (pm === 'cash') key = 'Cash'
      else if (pm === 'card' || pm === 'bank_pos') key = 'Bank POS'
      else if (pm.startsWith('transfer') || !pm) key = 'Transfer'
      else if (pm === 'credit') key = 'Credit'
      else if (pm === 'split') key = 'Split'
      else if (pm.startsWith('cash+transfer')) key = 'Cash + Transfer'
      else if (pm.startsWith('cash+card')) key = 'Cash + POS'
      else if (pm === 'complimentary') key = 'Complimentary'
      byMethod[key] = (byMethod[key] || 0) + getNetOrderAmount(o)
    })

    setSummary({
      total,
      byMethod,
      orders: paidOrders.length,
      avgOrder: paidOrders.length ? Math.round(total / paidOrders.length) : 0,
    })
    setOrders(allOrders)

    const wMap: Record<string, WaitronStat> = {}
    paidOrders.forEach((o) => {
      const name =
        (o as Order & { profiles?: { full_name: string } }).profiles?.full_name || 'Unknown'
      if (!wMap[name]) {
        wMap[name] = { name, orders: 0, revenue: 0, cashExpected: 0, transferExpected: 0 }
      }
      const netAmount = getNetOrderAmount(o)
      const remittance = getWaitronRemittance(o.payment_method, netAmount)
      wMap[name].orders++
      wMap[name].revenue += netAmount
      wMap[name].cashExpected = (wMap[name].cashExpected || 0) + remittance.cash
      wMap[name].transferExpected = (wMap[name].transferExpected || 0) + remittance.transfer
    })
    setWaitronStats(Object.values(wMap).sort((a, b) => b.revenue - a.revenue))

    // Compute UNPAID credit debts per waitron (from debtors table, respects paid status)
    const { start: dStart, end: dEnd } = getDateBounds()
    const { data: unpaidDebts } = await supabase
      .from('debtors')
      .select('name, current_balance, notes, created_at, recorded_by_name, order_id')
      .in('status', ['outstanding', 'partial'])
      .in('debt_type', ['credit_order', 'table_order', 'fridge'])
      .gte('created_at', dStart)
      .lt('created_at', dEnd)
      .order('created_at', { ascending: false })
    // Fetch order items for each debt
    const orderIds = (unpaidDebts || []).map((d: any) => d.order_id).filter(Boolean)
    const { data: debtOrderItems } =
      orderIds.length > 0
        ? await supabase
            .from('order_items')
            .select('order_id, quantity, return_requested, return_accepted, menu_items(name)')
            .in('order_id', orderIds)
        : { data: [] }
    const itemsByOrder: Record<string, string[]> = {}
    for (const oi of (debtOrderItems || []) as any[]) {
      if (oi.return_requested || oi.return_accepted) continue
      if (!itemsByOrder[oi.order_id]) itemsByOrder[oi.order_id] = []
      itemsByOrder[oi.order_id].push(`${oi.quantity}x ${oi.menu_items?.name || 'Item'}`)
    }
    const creditMap: Record<string, number> = {}
    const creditDetails: Array<{
      name: string
      amount: number
      notes: string
      date: string
      by: string
      items: string
    }> = []
    for (const d of (unpaidDebts || []) as Array<{
      name: string
      current_balance: number
      notes: string
      created_at: string
      recorded_by_name: string
      order_id: string
    }>) {
      // "recorded_by_name" is the waitron/staff who recorded the debt (pay later).
      const waitronName = d.recorded_by_name || 'Unknown'
      creditMap[waitronName] = (creditMap[waitronName] || 0) + (d.current_balance || 0)
      const items = d.order_id ? (itemsByOrder[d.order_id] || []).join(', ') : ''
      // Keep the customer/debtor name in notes for traceability.
      const note = [d.name ? `Customer: ${d.name}` : '', d.notes || ''].filter(Boolean).join(' · ')
      creditDetails.push({
        name: waitronName,
        amount: d.current_balance,
        notes: note,
        date: d.created_at,
        by: d.recorded_by_name || '',
        items,
      })
    }
    setCreditByWaitron(creditMap)
    setCreditDetailsList(creditDetails)

    const dayMap: Record<string, TrendPoint> = {}
    ;(
      trendRes.data as unknown as
        | Array<{
            created_at: string
            order_items?: Order['order_items']
          }>
        | null
        | undefined
    )?.forEach((o) => {
      const day = new Date(o.created_at).toLocaleDateString('en-NG', {
        month: 'short',
        day: 'numeric',
      })
      if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
      dayMap[day].revenue += getNetOrderAmount(o)
      dayMap[day].orders++
    })
    setTrendData(Object.values(dayMap))

    setTillSessions((tillRes.data || []) as unknown as TillSession[])
    setTimesheet((timesheetRes.data || []) as TimesheetEntry[])
    setAuditLog((auditRes.data || []) as AuditEntry[])
    setPayouts((payoutsRes.data || []) as PayoutRow[])

    setLoading(false)
  }, [getDateBounds])

  // ── Scroll to top on tab change ───────────────────────────────────────────
  useEffect(() => {
    const _ms = document.getElementById('main-scroll')
    if (_ms) _ms.scrollTop = 0
  }, [activeTab])

  // ── Main data fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // ── Void log fetch (date-specific) ───────────────────────────────────────

  const totalPayouts = payouts.reduce((s, p) => s + (p.amount || 0), 0)
  const netRevenue = summary.total - totalPayouts
  const paidCount = orders.filter((o) => o.status === 'paid').length
  const bounds = getDateBounds()
  const sessionDate = bounds.start.slice(0, 10)
  const sessionEndDateInclusive = (() => {
    try {
      const end = new Date(bounds.end)
      end.setDate(end.getDate() - 1)
      return end.toISOString().slice(0, 10)
    } catch {
      return bounds.end.slice(0, 10)
    }
  })()

  return (
    <div className="min-h-full bg-gray-950">
      {/* Date Range Picker */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {DATE_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${dateRange === r ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}
            >
              {r}
            </button>
          ))}
        </div>
        {dateRange === 'Date' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>
        )}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            />
            <span className="text-gray-500 text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-gray-600 text-xs">
            {loading ? 'Loading...' : `${paidCount} paid orders`}
          </span>
          <HelpTooltip
            storageKey="accounting"
            tips={[
              {
                id: 'acc-daterange',
                title: 'Date Range Filter',
                description:
                  'All tabs respect the date range at the top — Today, This Week, This Month, or Custom. Set the range before reading any figures. The Overview, Orders, Voids, Ledger, and Staff tabs all filter to that period.',
              },
              {
                id: 'acc-overview',
                title: 'Overview Tab',
                description:
                  'Gross revenue, net revenue (after payouts), breakdown by payment method (Cash, Bank POS, Transfer, Credit), order count, average order value, and a per-waitron performance table.',
              },
              {
                id: 'acc-orders',
                title: 'Orders Tab',
                description:
                  'Full order list for the period. Filter by status and type. Expand any order to see every item, the waitron, table, payment method, and exact timestamp. Search by table name or waitron.',
              },
              {
                id: 'acc-staff',
                title: 'Staff Tab',
                description:
                  "Per-waitron breakdown — total revenue, orders closed, average order value, and POS machine assigned. Use this at shift close to verify each waitron's sales against their POS terminal's expected total.",
              },
              {
                id: 'acc-till',
                title: 'Till Tab',
                description:
                  'Full log of all till sessions — opening float, total sales collected, payout deductions, expected vs actual closing cash, and any shortfall or surplus. Each session is tied to the manager who opened it.',
              },
              {
                id: 'acc-payouts',
                title: 'Payouts Tab',
                description:
                  'Record cash paid out of the till — expenses, petty cash, advances, or refunds. Each payout requires amount, reason, and category. Search by recipient, reason, or category. Refunds are also logged here.',
              },
              {
                id: 'acc-trends',
                title: 'Trends Tab',
                description:
                  'Revenue and order count charts over the selected period. Identifies peak days, slow periods, and week-on-week patterns.',
              },
              {
                id: 'acc-debtors',
                title: 'Outstanding',
                description:
                  'All outstanding credit sales. Shows who recorded each debt, payments received, and lets you send statements or mark paid.',
              },
              {
                id: 'acc-voids',
                title: 'Voids Tab',
                description:
                  'Date-filtered void log — item name, quantity, value, and which manager PIN authorised it. Each void also deletes the order_items DB row and reduces the order total automatically.',
              },
              {
                id: 'acc-ledger',
                title: 'Ledger Tab',
                description:
                  'Double-entry general ledger — every sale, payout, debtor payment, and room charge recorded as credit or debit with a running balance. Search by description, reference, or type. Exportable to PDF.',
              },
              {
                id: 'acc-audit',
                title: 'Audit Log Tab',
                description:
                  'Tamper-evident log of every system action — logins, order changes, voids, menu edits, staff changes, clock-ins, and settings updates. For the full activity log with filters and CSV export, see Management → Activity tab.',
              },
            ]}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto items-center">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4 md:p-6">
        {activeTab === 'overview' && (
          <OverviewTab
            summary={summary}
            trendData={trendData}
            totalPayouts={totalPayouts}
            netRevenue={netRevenue}
            waitronStats={waitronStats}
            dateLabel={
              dateRange === 'Custom'
                ? `${customStart} – ${customEnd}`
                : dateRange === 'Date'
                  ? pickedDate
                  : dateRange
            }
            sessionDate={sessionDate}
            sessionEndDate={sessionEndDateInclusive}
            dateRangeType={dateRange}
            creditByWaitron={creditByWaitron}
            creditDetails={creditDetailsList}
            onRecordPayout={() => setActiveTab('payouts')}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersTab orders={orders} orderFilter={orderFilter} onFilterChange={setOrderFilter} />
        )}
        {activeTab === 'staff' && <StaffTab waitronStats={waitronStats} />}
        {activeTab === 'attendance' && <AttendanceTab />}
        {activeTab === 'timesheet' && <TimesheetTab />}
        {activeTab === 'till' && <TillTab tillSessions={tillSessions} />}
        {activeTab === 'payouts' && (
          <PayoutsTab payouts={payouts} totalPayouts={totalPayouts} onRefresh={fetchAll} />
        )}
        {activeTab === 'trends' && <TrendsTab trendData={trendData} />}
        {activeTab === 'debtors' && (
          <Debtors onBack={() => setActiveTab('overview')} embedded={true} />
        )}

        {activeTab === 'ledger' && <LedgerTab dateRange={dateRange} />}
        {activeTab === 'audit' && <AuditTab auditLog={auditLog} dateRange={dateRange} />}
        {activeTab === 'pos' && (
          <POSReconciliationTab
            timesheet={timesheet}
            orders={orders}
            dateLabel={dateRange === 'Custom' ? `${customStart} – ${customEnd}` : dateRange}
          />
        )}
        {activeTab === 'tips' &&
          (() => {
            const { start, end } = getDateBounds()
            return (
              <TipsTab
                dateRange={{
                  from: start.slice(0, 10),
                  to: end.slice(0, 10),
                }}
              />
            )
          })()}
        {activeTab === 'returns' &&
          (() => {
            const { start, end } = getDateBounds()
            return (
              <ReturnsTab
                dateRange={{
                  start: start.slice(0, 10),
                  end: end.slice(0, 10),
                }}
              />
            )
          })()}
        {activeTab === 'waitron_orders' && <WaitronOrdersTab />}
        {activeTab === 'bar_stock' && <StockSummaryTab type="bar" />}
        {activeTab === 'kitchen_stock' && <StockSummaryTab type="kitchen" />}
        {activeTab === 'store_to_chiller' && <StoreToChillerTab />}
        {activeTab === 'main_store' && <MainStoreTab />}
      </div>
    </div>
  )
}
