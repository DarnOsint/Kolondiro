import { useState, useEffect, useCallback } from 'react'
import {
  Calendar,
  Lock,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Package,
  Users,
  FileText,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

interface PeriodClose {
  id: string
  period_type: 'month' | 'year'
  period_label: string
  period_start: string
  period_end: string
  status: 'draft' | 'locked'
  gross_revenue: number
  total_voids: number
  total_payouts: number
  net_revenue: number
  cash_revenue: number
  card_revenue: number
  transfer_revenue: number
  credit_revenue: number
  order_count: number
  opening_debtors: number
  closing_debtors: number
  new_credit_issued: number
  credit_recovered: number
  closed_by_name: string | null
  closed_at: string | null
  notes: string | null
  created_at: string
}

interface StockCount {
  id: string
  period_close_id: string
  item_name: string
  unit: string
  system_qty: number
  physical_qty: number | null
  variance: number
  variance_value: number
  cost_per_unit: number
  note: string | null
  counted_by: string | null
}

interface RevenuePreview {
  gross: number
  voids: number
  payouts: number
  net: number
  cash: number
  card: number
  transfer: number
  credit: number
  orders: number
}

interface DebtorPreview {
  closingBalance: number
  newCredit: number
  recovered: number
}

const fmt = (n: number) => `₦${(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export default function MonthEnd() {
  const { profile } = useAuth()
  const isReadOnly = profile?.role === 'auditor'
  const toast = useToast()
  const [periods, setPeriods] = useState<PeriodClose[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [stockCounts, setStockCounts] = useState<Record<string, StockCount[]>>({})
  const [showNewPeriod, setShowNewPeriod] = useState(false)
  const [periodType, setPeriodType] = useState<'month' | 'year'>('month')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [revenuePreview, setRevenuePreview] = useState<RevenuePreview | null>(null)
  const [debtorPreview, setDebtorPreview] = useState<DebtorPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [locking, setLocking] = useState<string | null>(null)

  const fetchPeriods = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('period_closes')
      .select('*')
      .order('period_start', { ascending: false })
    setPeriods((data || []) as PeriodClose[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchPeriods()
  }, [fetchPeriods])

  const fetchStockCounts = async (periodId: string) => {
    if (stockCounts[periodId]) return
    const { data } = await supabase
      .from('period_stock_counts')
      .select('*')
      .eq('period_close_id', periodId)
      .order('item_name')
    setStockCounts((prev) => ({ ...prev, [periodId]: (data || []) as StockCount[] }))
  }

  const fetchPreview = async () => {
    setPreviewLoading(true)
    const year = selectedYear
    const month = selectedMonth

    let startDate: string
    let endDate: string

    if (periodType === 'month') {
      startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const lastDay = new Date(year, month + 1, 0).getDate()
      endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`
    } else {
      startDate = `${year}-01-01`
      endDate = `${year}-12-31`
    }

    const startISO = new Date(startDate + 'T08:00:00+01:00').toISOString()
    const endD = new Date(endDate + 'T08:00:00+01:00')
    endD.setDate(endD.getDate() + 1)
    const endISO = endD.toISOString()

    const [ordersRes, voidsRes, payoutsRes, debtorsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total_amount, payment_method, status')
        .eq('status', 'paid')
        .gte('closed_at', startISO)
        .lte('closed_at', endISO),
      supabase
        .from('void_log')
        .select('total_value')
        .gte('created_at', startISO)
        .lte('created_at', endISO),
      supabase
        .from('payouts')
        .select('amount')
        .gte('created_at', startISO)
        .lte('created_at', endISO),
      supabase.from('debtors').select('current_balance, amount_paid').eq('is_active', true),
    ])

    const orders = ordersRes.data || []
    const gross = orders.reduce((s, o) => s + (o.total_amount || 0), 0)
    const voids = (voidsRes.data || []).reduce((s, v) => s + (v.total_value || 0), 0)
    const payouts = (payoutsRes.data || []).reduce((s, p) => s + (p.amount || 0), 0)

    // New credit orders in this period
    const creditOrders = await supabase
      .from('orders')
      .select('total_amount')
      .eq('payment_method', 'credit')
      .gte('closed_at', startISO)
      .lte('closed_at', endISO)

    // Payments received against debtors in this period
    const debtorPayments = await supabase
      .from('debtor_payments')
      .select('amount')
      .gte('created_at', startISO)
      .lte('created_at', endISO)

    const newCredit = (creditOrders.data || []).reduce((s, o) => s + (o.total_amount || 0), 0)
    const recovered = (debtorPayments.data || []).reduce((s, p) => s + (p.amount || 0), 0)
    const closingDebtors = (debtorsRes.data || []).reduce((s, d) => s + (d.current_balance || 0), 0)

    setRevenuePreview({
      gross,
      voids,
      payouts,
      net: gross - voids - payouts,
      cash: orders
        .filter((o) => o.payment_method === 'cash')
        .reduce((s, o) => s + o.total_amount, 0),
      card: orders
        .filter((o) => o.payment_method === 'card')
        .reduce((s, o) => s + o.total_amount, 0),
      transfer: orders
        .filter((o) => o.payment_method === 'transfer')
        .reduce((s, o) => s + o.total_amount, 0),
      credit: orders
        .filter((o) => o.payment_method === 'credit')
        .reduce((s, o) => s + o.total_amount, 0),
      orders: orders.length,
    })
    setDebtorPreview({ closingBalance: closingDebtors, newCredit, recovered })
    setPreviewLoading(false)
  }

  const loadSystemStock = async (periodId: string, startDate: string, endDate: string) => {
    // Get the most recent closing stock entry per item up to period end
    const { data } = await supabase
      .from('kitchen_stock_entries')
      .select('item_name, unit, closing_qty, date')
      .lte('date', endDate)
      .order('date', { ascending: false })

    if (!data) return

    // Take latest entry per item
    const latest = new Map<string, { qty: number; unit: string }>()
    for (const row of data) {
      if (!latest.has(row.item_name)) {
        latest.set(row.item_name, { qty: row.closing_qty || 0, unit: row.unit })
      }
    }

    // Insert stock count rows
    const rows = Array.from(latest.entries()).map(([item_name, { qty, unit }]) => ({
      period_close_id: periodId,
      item_name,
      unit,
      system_qty: qty,
      physical_qty: null,
      cost_per_unit: 0,
      variance_value: 0,
    }))

    if (rows.length > 0) {
      await supabase.from('period_stock_counts').insert(rows)
    }

    await fetchStockCounts(periodId)
  }

  const createPeriod = async () => {
    if (!revenuePreview) return
    setCreating(true)

    const year = selectedYear
    const month = selectedMonth
    let startDate: string, endDate: string, label: string

    if (periodType === 'month') {
      startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const lastDay = new Date(year, month + 1, 0).getDate()
      endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`
      label = `${MONTHS[month]} ${year}`
    } else {
      startDate = `${year}-01-01`
      endDate = `${year}-12-31`
      label = `Year ${year}`
    }

    // Check if period already exists
    const { data: existing } = await supabase
      .from('period_closes')
      .select('id')
      .eq('period_label', label)
      .limit(1)

    if (existing && existing.length > 0) {
      toast.warning('Already exists', `A period close for ${label} already exists`)
      setCreating(false)
      return
    }

    const { data: period, error } = await supabase
      .from('period_closes')
      .insert({
        period_type: periodType,
        period_label: label,
        period_start: startDate,
        period_end: endDate,
        status: 'draft',
        gross_revenue: revenuePreview.gross,
        total_voids: revenuePreview.voids,
        total_payouts: revenuePreview.payouts,
        net_revenue: revenuePreview.net,
        cash_revenue: revenuePreview.cash,
        card_revenue: revenuePreview.card,
        transfer_revenue: revenuePreview.transfer,
        credit_revenue: revenuePreview.credit,
        order_count: revenuePreview.orders,
        opening_debtors: 0,
        closing_debtors: debtorPreview?.closingBalance || 0,
        new_credit_issued: debtorPreview?.newCredit || 0,
        credit_recovered: debtorPreview?.recovered || 0,
        notes,
      })
      .select()
      .single()

    if (error || !period) {
      toast.error('Error', error?.message || 'Failed to create period')
      setCreating(false)
      return
    }

    // Load system stock counts
    await loadSystemStock(period.id, startDate, endDate)

    toast.success('Period Created', `${label} draft created — enter physical stock counts below`)
    setShowNewPeriod(false)
    setNotes('')
    setRevenuePreview(null)
    setDebtorPreview(null)
    await fetchPeriods()
    setExpanded(period.id)
    setCreating(false)
  }

  const updatePhysicalCount = async (count: StockCount, value: string, periodId: string) => {
    const qty = value === '' ? null : parseFloat(value)
    await supabase.from('period_stock_counts').update({ physical_qty: qty }).eq('id', count.id)
    setStockCounts((prev) => ({
      ...prev,
      [periodId]: (prev[periodId] || []).map((c) =>
        c.id === count.id
          ? { ...c, physical_qty: qty, variance: (qty ?? c.system_qty) - c.system_qty }
          : c
      ),
    }))
  }

  const lockPeriod = async (period: PeriodClose) => {
    const counts = stockCounts[period.id] || []
    const uncounted = counts.filter((c) => c.physical_qty === null).length
    if (uncounted > 0) {
      if (
        !window.confirm(
          `${uncounted} item(s) have no physical count entered — they will use the system figure. Lock anyway?`
        )
      )
        return
    }
    if (!window.confirm(`Lock ${period.period_label}? This cannot be undone.`)) return
    setLocking(period.id)
    await supabase
      .from('period_closes')
      .update({
        status: 'locked',
        closed_by: profile?.id,
        closed_by_name: profile?.full_name,
        closed_at: new Date().toISOString(),
      })
      .eq('id', period.id)
    toast.success('Period Locked', `${period.period_label} has been locked and archived`)
    setLocking(null)
    await fetchPeriods()
  }

  const toggle = (id: string) => {
    if (expanded === id) {
      setExpanded(null)
    } else {
      setExpanded(id)
      void fetchStockCounts(id)
    }
  }

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <div className="min-h-full bg-gray-950 p-4 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl">Period Close</h1>
          <p className="text-gray-500 text-sm">Month & Year End accounting</p>
        </div>
        <button
          onClick={() => {
            setShowNewPeriod(!showNewPeriod)
            setRevenuePreview(null)
            setDebtorPreview(null)
          }}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> New Period
        </button>
      </div>

      {/* New Period Form */}
      {showNewPeriod && (
        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Calendar size={16} className="text-amber-400" /> Create Period Close
          </h3>

          {/* Period type */}
          <div className="flex gap-2">
            {(['month', 'year'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPeriodType(t)}
                className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${periodType === t ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {t === 'month' ? 'Monthly Close' : 'Year End'}
              </button>
            ))}
          </div>

          {/* Period selection */}
          <div className="flex gap-3 flex-wrap">
            {periodType === 'month' && (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              onClick={fetchPreview}
              disabled={previewLoading}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm transition-colors"
            >
              <RefreshCw size={14} className={previewLoading ? 'animate-spin' : ''} />
              {previewLoading ? 'Loading...' : 'Load Figures'}
            </button>
          </div>

          {/* Revenue preview */}
          {revenuePreview && (
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-amber-400 text-xs uppercase tracking-wide mb-3 font-medium">
                  Revenue Summary
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    {
                      label: 'Gross Revenue',
                      value: revenuePreview.gross,
                      color: 'text-white font-bold',
                    },
                    { label: 'Total Voids', value: revenuePreview.voids, color: 'text-red-400' },
                    {
                      label: 'Total Payouts',
                      value: revenuePreview.payouts,
                      color: 'text-orange-400',
                    },
                    {
                      label: 'Net Revenue',
                      value: revenuePreview.net,
                      color: 'text-green-400 font-bold',
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <p className="text-gray-500 text-xs">{label}</p>
                      <p className={`text-sm ${color}`}>{fmt(value)}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-gray-700">
                  {[
                    { label: 'Cash', value: revenuePreview.cash },
                    { label: 'Card', value: revenuePreview.card },
                    { label: 'Transfer', value: revenuePreview.transfer },
                    { label: 'Credit', value: revenuePreview.credit },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <p className="text-gray-600 text-xs">{label}</p>
                      <p className="text-gray-300 text-xs font-medium">{fmt(value)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-gray-500 text-xs mt-2 pt-2 border-t border-gray-700">
                  {revenuePreview.orders} paid orders in this period
                </p>
              </div>

              {debtorPreview && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-amber-400 text-xs uppercase tracking-wide mb-3 font-medium">
                    Debtors
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    {[
                      { label: 'Closing Balance', value: debtorPreview.closingBalance },
                      { label: 'New Credit', value: debtorPreview.newCredit },
                      { label: 'Recovered', value: debtorPreview.recovered },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-gray-500 text-xs">{label}</p>
                        <p className="text-white text-sm font-medium">{fmt(value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isReadOnly && (
                <>
                  <textarea
                    placeholder="Notes for this period close (optional)..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500 resize-none"
                  />

                  <button
                    onClick={createPeriod}
                    disabled={creating}
                    className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors"
                  >
                    {creating
                      ? 'Creating...'
                      : `Create ${periodType === 'month' ? MONTHS[selectedMonth] + ' ' + selectedYear : 'Year ' + selectedYear} Close`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Period list */}
      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading periods...</div>
      ) : periods.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Calendar size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No period closes yet</p>
          <p className="text-xs mt-1">Create your first period close using the button above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {periods.map((period) => {
            const counts = stockCounts[period.id] || []
            const countedItems = counts.filter((c) => c.physical_qty !== null).length
            const totalVariance = counts.reduce((s, c) => s + (c.variance || 0), 0)

            return (
              <div
                key={period.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
              >
                {/* Period header */}
                <button
                  onClick={() => toggle(period.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${period.status === 'locked' ? 'bg-green-500/10 border border-green-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}
                    >
                      {period.status === 'locked' ? (
                        <Lock size={16} className="text-green-400" />
                      ) : (
                        <FileText size={16} className="text-amber-400" />
                      )}
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-bold">{period.period_label}</p>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${period.status === 'locked' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}
                        >
                          {period.status === 'locked' ? '✓ Locked' : 'Draft'}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs">
                        {fmtDate(period.period_start)} – {fmtDate(period.period_end)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-green-400 font-bold text-sm">{fmt(period.net_revenue)}</p>
                      <p className="text-gray-500 text-xs">net revenue</p>
                    </div>
                    {expanded === period.id ? (
                      <ChevronUp size={16} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400" />
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {expanded === period.id && (
                  <div className="border-t border-gray-800 p-4 space-y-4">
                    {/* Revenue breakdown */}
                    <div>
                      <p className="text-gray-500 text-xs uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <TrendingUp size={11} /> Revenue
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Gross', value: period.gross_revenue, color: 'text-white' },
                          { label: 'Voids', value: -period.total_voids, color: 'text-red-400' },
                          {
                            label: 'Payouts',
                            value: -period.total_payouts,
                            color: 'text-orange-400',
                          },
                          {
                            label: 'Net',
                            value: period.net_revenue,
                            color: 'text-green-400 font-bold',
                          },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-gray-800 rounded-xl p-3">
                            <p className="text-gray-500 text-xs">{label}</p>
                            <p className={`text-sm ${color}`}>{fmt(Math.abs(value))}</p>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                        {[
                          { label: 'Cash', value: period.cash_revenue },
                          { label: 'Card', value: period.card_revenue },
                          { label: 'Transfer', value: period.transfer_revenue },
                          { label: 'Credit', value: period.credit_revenue },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-gray-800/50 rounded-lg p-2 text-center">
                            <p className="text-gray-600 text-xs">{label}</p>
                            <p className="text-gray-300 text-xs font-medium">{fmt(value)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Debtors */}
                    <div>
                      <p className="text-gray-500 text-xs uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Users size={11} /> Debtors
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[
                          { label: 'Closing Balance', value: period.closing_debtors },
                          { label: 'New Credit', value: period.new_credit_issued },
                          { label: 'Recovered', value: period.credit_recovered },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-gray-800 rounded-xl p-3">
                            <p className="text-gray-500 text-xs">{label}</p>
                            <p className="text-white text-sm font-medium">{fmt(value)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Stock counts */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-gray-500 text-xs uppercase tracking-wide flex items-center gap-1.5">
                          <Package size={11} /> Physical Stock Count
                          {counts.length > 0 && (
                            <span className="text-gray-600 normal-case">
                              — {countedItems}/{counts.length} items counted
                            </span>
                          )}
                        </p>
                        {totalVariance !== 0 && (
                          <span
                            className={`text-xs flex items-center gap-1 ${totalVariance < 0 ? 'text-red-400' : 'text-green-400'}`}
                          >
                            <AlertTriangle size={11} />
                            {totalVariance < 0 ? '' : '+'}
                            {totalVariance.toFixed(1)} total variance
                          </span>
                        )}
                      </div>

                      {counts.length === 0 ? (
                        <p className="text-gray-600 text-sm text-center py-4">
                          No stock items recorded
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[400px] text-sm">
                            <thead>
                              <tr className="border-b border-gray-800">
                                <th className="text-left text-gray-500 text-xs px-2 py-1.5">
                                  Item
                                </th>
                                <th className="text-right text-gray-500 text-xs px-2 py-1.5">
                                  System
                                </th>
                                <th className="text-right text-gray-500 text-xs px-2 py-1.5">
                                  Physical Count
                                </th>
                                <th className="text-right text-gray-500 text-xs px-2 py-1.5">
                                  Variance
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {counts.map((count) => (
                                <tr
                                  key={count.id}
                                  className="border-b border-gray-800/50 last:border-0"
                                >
                                  <td className="px-2 py-1.5 text-white">
                                    {count.item_name}
                                    <span className="text-gray-600 text-xs ml-1">{count.unit}</span>
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-gray-400">
                                    {count.system_qty.toFixed(2)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {period.status === 'locked' || isReadOnly ? (
                                      <span className="text-white">
                                        {count.physical_qty?.toFixed(2) ?? '—'}
                                      </span>
                                    ) : (
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        defaultValue={count.physical_qty ?? ''}
                                        placeholder={count.system_qty.toFixed(2)}
                                        onBlur={(e) =>
                                          void updatePhysicalCount(count, e.target.value, period.id)
                                        }
                                        className="w-24 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:border-amber-500"
                                      />
                                    )}
                                  </td>
                                  <td
                                    className={`px-2 py-1.5 text-right text-xs font-medium ${
                                      count.variance === 0
                                        ? 'text-gray-600'
                                        : count.variance < 0
                                          ? 'text-red-400'
                                          : 'text-green-400'
                                    }`}
                                  >
                                    {count.variance === 0
                                      ? '—'
                                      : count.physical_qty === null
                                        ? '—'
                                        : `${count.variance > 0 ? '+' : ''}${count.variance.toFixed(2)}`}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Notes */}
                    {period.notes && (
                      <div className="bg-gray-800 rounded-xl p-3">
                        <p className="text-gray-500 text-xs mb-1">Notes</p>
                        <p className="text-gray-300 text-sm">{period.notes}</p>
                      </div>
                    )}

                    {/* Lock / meta */}
                    {period.status === 'locked' ? (
                      <div className="flex items-center gap-2 text-green-400 text-sm bg-green-500/10 rounded-xl p-3">
                        <CheckCircle size={16} />
                        <span>
                          Locked by {period.closed_by_name} on{' '}
                          {period.closed_at ? fmtDate(period.closed_at) : '—'}
                        </span>
                      </div>
                    ) : isReadOnly ? (
                      <div className="text-gray-500 text-xs text-center py-3">
                        Draft — view only
                      </div>
                    ) : (
                      <button
                        onClick={() => void lockPeriod(period)}
                        disabled={locking === period.id}
                        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
                      >
                        <Lock size={16} />
                        {locking === period.id
                          ? 'Locking...'
                          : `Lock & Archive ${period.period_label}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
