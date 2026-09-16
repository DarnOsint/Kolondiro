import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  DollarSign,
  Banknote,
  CreditCard,
  Smartphone,
  Receipt,
  Plus,
  Save,
  Users,
  AlertTriangle,
  CheckCircle,
  Printer,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import type { AccountingSummary, TrendPoint, WaitronStat } from './types'

interface Props {
  summary: AccountingSummary
  trendData: TrendPoint[]
  totalPayouts: number
  netRevenue: number
  waitronStats: WaitronStat[]
  dateLabel: string
  sessionDate?: string
  sessionEndDate?: string
  dateRangeType?: string
  creditByWaitron?: Record<string, number>
  creditDetails?: Array<{
    name: string
    amount: number
    notes: string
    date: string
    by: string
    items?: string
  }>
  onRecordPayout: () => void
}

interface Reconciliation {
  cashCollected: Record<string, number> // waitron name → cash collected
  transferReceipts: Record<string, number> // waitron name → transfer receipt handed in
  outstanding: Record<string, number> // waitron name → outstanding/shortage for the day
  excess: Record<string, number> // waitron name → excess/surplus for the day
}

export default function OverviewTab({
  summary,
  trendData,
  totalPayouts,
  netRevenue,
  waitronStats,
  dateLabel,
  sessionDate,
  sessionEndDate,
  dateRangeType,
  creditByWaitron = {},
  creditDetails = [],
  onRecordPayout,
}: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [recon, setRecon] = useState<Reconciliation>({
    cashCollected: {},
    transferReceipts: {},
    outstanding: {},
    excess: {},
  })
  const [saving, setSaving] = useState(false)
  const [manifestNotes, setManifestNotes] = useState('')
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestSaving, setManifestSaving] = useState(false)
  const [reconDate, setReconDate] = useState(() => {
    if (sessionDate) return sessionDate
    const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
    return wat.toLocaleDateString('en-CA')
  })
  // Sync reconDate when parent session date changes
  useEffect(() => {
    if (sessionDate) setReconDate(sessionDate)
  }, [sessionDate])
  const isSingleDay =
    !dateRangeType ||
    dateRangeType === 'Today' ||
    dateRangeType === 'Prev Day' ||
    dateRangeType === 'Date'
  const activeWaitrons =
    waitronStats.filter((w) => (w.revenue || 0) > 0 || (w.orders || 0) > 0) || waitronStats

  const sessionTodayKey = (() => {
    const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
    return wat.toLocaleDateString('en-CA')
  })()

  const role = profile?.role || ''
  const isAccountant = role === 'accountant'
  const isManagement = role === 'owner' || role === 'manager'

  // Accountants can only save for the current trading session day (8am WAT boundary).
  // Management/owners can save for any day.
  const canSaveThisDay =
    isSingleDay && (isManagement || (isAccountant && reconDate === sessionTodayKey))
  const canEditThisDay = canSaveThisDay

  const normalizeRecon = (value: Partial<Reconciliation> | null | undefined): Reconciliation => ({
    cashCollected: value?.cashCollected || {},
    transferReceipts: value?.transferReceipts || {},
    outstanding: value?.outstanding || {},
    excess: value?.excess || {},
  })

  // Load saved reconciliation — single day or aggregate for range
  const loadRecon = useCallback(async () => {
    const isSingleDay =
      !dateRangeType ||
      dateRangeType === 'Today' ||
      dateRangeType === 'Prev Day' ||
      dateRangeType === 'Date'

    if (isSingleDay) {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('id', `recon_${reconDate}`)
        .single()
      if (data?.value) {
        try {
          setRecon(normalizeRecon(JSON.parse(data.value)))
        } catch {
          /* */
        }
      } else {
        setRecon({
          cashCollected: {},
          transferReceipts: {},
          outstanding: {},
          excess: {},
        })
      }
    } else {
      // Aggregate all recon entries between sessionDate and sessionEndDate
      const startDate = sessionDate || reconDate
      const endDate = sessionEndDate || reconDate
      const { data: allRecons } = await supabase
        .from('settings')
        .select('id, value')
        .gte('id', `recon_${startDate}`)
        .lte('id', `recon_${endDate}`)
      const merged: Reconciliation = {
        cashCollected: {},
        transferReceipts: {},
        outstanding: {},
        excess: {},
      }
      for (const entry of allRecons || []) {
        if (!entry.id.startsWith('recon_')) continue
        try {
          const r = normalizeRecon(JSON.parse(entry.value) as Reconciliation)
          for (const [k, v] of Object.entries(r.cashCollected || {}))
            merged.cashCollected[k] = (merged.cashCollected[k] || 0) + (v || 0)
          for (const [k, v] of Object.entries(r.transferReceipts || {}))
            merged.transferReceipts[k] = (merged.transferReceipts[k] || 0) + (v || 0)
          for (const [k, v] of Object.entries(r.outstanding || {}))
            merged.outstanding[k] = (merged.outstanding[k] || 0) + (v || 0)
          for (const [k, v] of Object.entries(r.excess || {}))
            merged.excess[k] = (merged.excess[k] || 0) + (v || 0)
        } catch {
          /* */
        }
      }
      setRecon(merged)
    }
  }, [reconDate, dateRangeType, sessionDate, sessionEndDate])

  useEffect(() => {
    loadRecon()
  }, [loadRecon])

  const loadManifest = useCallback(async () => {
    const isSingleDay =
      !dateRangeType ||
      dateRangeType === 'Today' ||
      dateRangeType === 'Prev Day' ||
      dateRangeType === 'Date'
    if (!isSingleDay) {
      setManifestNotes('')
      return
    }
    setManifestLoading(true)
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('id', `manifest_${reconDate}`)
      .single()
    setManifestNotes(data?.value || '')
    setManifestLoading(false)
  }, [reconDate, dateRangeType])

  useEffect(() => {
    void loadManifest()
  }, [loadManifest])

  const saveManifest = async () => {
    if (!isSingleDay || !canSaveThisDay) return
    setManifestSaving(true)
    await supabase.from('settings').upsert(
      {
        id: `manifest_${reconDate}`,
        value: manifestNotes || '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    audit({
      action: 'ACCOUNTING_MANIFEST_SAVED',
      entity: 'settings',
      entityName: `manifest_${reconDate}`,
      newValue: { notes: manifestNotes },
      performer: profile as any,
    })
    setManifestSaving(false)
    toast.success('Saved', 'Accounting notes saved')
  }

  // Shortages:
  // - Single day: computed from expected vs remitted (and saved into recon_<date>.outstanding on save)
  // - Range: use locked-in saved shortages per day (summed into recon.outstanding via loadRecon)
  const autoShortage = activeWaitrons.reduce(
    (acc, w) => {
      const expectedTotal = (w.cashExpected || 0) + (w.transferExpected || 0)
      const remittedTotal =
        (recon.cashCollected[w.name] || 0) + (recon.transferReceipts[w.name] || 0)
      const shortage = Math.max(0, expectedTotal - remittedTotal)
      if (shortage > 0) acc[w.name] = shortage
      return acc
    },
    {} as Record<string, number>
  )

  const autoExcess = activeWaitrons.reduce(
    (acc, w) => {
      const expectedTotal = (w.cashExpected || 0) + (w.transferExpected || 0)
      const remittedTotal =
        (recon.cashCollected[w.name] || 0) + (recon.transferReceipts[w.name] || 0)
      const excess = Math.max(0, remittedTotal - expectedTotal)
      if (excess > 0) acc[w.name] = excess
      return acc
    },
    {} as Record<string, number>
  )

  const saveRecon = async () => {
    if (!canSaveThisDay) return
    setSaving(true)
    const payload: Reconciliation = {
      ...recon,
      outstanding: autoShortage,
      excess: autoExcess,
    }
    await supabase.from('settings').upsert(
      {
        id: `recon_${reconDate}`,
        value: JSON.stringify(payload),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    setRecon(payload)
    audit({
      action: 'RECONCILIATION_SAVED',
      entity: 'settings',
      entityName: `recon_${reconDate}`,
      newValue: {
        totalCash: totalCashCollected,
        totalTransferReceipts: totalTransferReceipts,
        shortfall,
      },
      performer: profile as any,
    })
    setSaving(false)
    toast.success('Saved', 'Reconciliation data saved')
  }

  // Calculations
  const totalCashCollected = Object.values(recon.cashCollected).reduce((s, v) => s + (v || 0), 0)
  const totalTransferReceipts = Object.values(recon.transferReceipts).reduce(
    (s, v) => s + (v || 0),
    0
  )
  const shortagesForView: Record<string, number> = isSingleDay
    ? autoShortage
    : ((recon.outstanding || {}) as Record<string, number>)

  // Merge shortages + credit (pay later) per waitron
  const mergedOutstanding: Record<string, number> = { ...shortagesForView }
  for (const [name, amt] of Object.entries(creditByWaitron)) {
    mergedOutstanding[name] = (mergedOutstanding[name] || 0) + amt
  }
  const totalOutstanding = Object.values(mergedOutstanding).reduce((s, v) => s + (v || 0), 0)
  const totalExcess = Object.values(autoExcess).reduce((s, v) => s + (v || 0), 0)
  const totalReceived = totalCashCollected + totalTransferReceipts
  const expectedRevenue = summary.total
  const revenueGap = expectedRevenue - totalReceived - totalPayouts
  const shortfall = totalOutstanding > 0 ? totalOutstanding : revenueGap

  const printDailySummary = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(reconDate).toLocaleDateString('en-SS', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('DAILY RECONCILIATION'),
      div,
      row('Date:', fmtDate),
      row('Printed:', new Date().toLocaleString('en-SS')),
      div,
      ctr('SALES SUMMARY'),
      div,
      row('Gross Revenue:', `N${summary.total.toLocaleString()}`),
      row('Net Revenue:', `N${netRevenue.toLocaleString()}`),
      row('Total Orders:', String(summary.orders)),
      row('Avg Order Value:', `N${summary.avgOrder.toLocaleString()}`),
      div,
      ctr('PAYMENT BREAKDOWN'),
      div,
      ...Object.entries(summary.byMethod || {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => row(k + ':', `N${v.toLocaleString()}`)),
      div,
      ctr('STAFF SALES'),
      div,
      ...waitronStats.map((w) => row(w.name, `N${w.revenue.toLocaleString()} (${w.orders})`)),
      div,
      ctr('WAITRON REMITTANCE'),
      div,
      ...activeWaitrons.flatMap((w) => {
        const cash = recon.cashCollected[w.name] || 0
        const transfer = recon.transferReceipts[w.name] || 0
        if (cash <= 0 && transfer <= 0) return []
        return [
          row(`${w.name} Cash:`, `N${cash.toLocaleString()}`),
          row(`${w.name} Transfer:`, `N${transfer.toLocaleString()}`),
        ]
      }),
      row('TOTAL CASH:', `N${totalCashCollected.toLocaleString()}`),
      row('TOTAL TRANSFER:', `N${totalTransferReceipts.toLocaleString()}`),
      div,
      ctr('OUTSTANDING PER WAITRON'),
      div,
      ...Object.entries(mergedOutstanding)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL OUTSTANDING:', `N${totalOutstanding.toLocaleString()}`),
      div,
      ctr('EXCESS PER WAITRON'),
      div,
      ...Object.entries(autoExcess)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL EXCESS:', `N${totalExcess.toLocaleString()}`),
      div,
      ctr('EXPENSES & PAYOUTS'),
      div,
      row('Total Payouts:', `N${totalPayouts.toLocaleString()}`),
      div,
      sol,
      ctr('END OF DAY RECONCILIATION'),
      sol,
      row('Total Sales (POS):', `N${expectedRevenue.toLocaleString()}`),
      row('Total Received:', `N${totalReceived.toLocaleString()}`),
      row('Payouts:', `N${totalPayouts.toLocaleString()}`),
      row('Outstanding (Waitrons):', `N${totalOutstanding.toLocaleString()}`),
      row('Excess (Waitrons):', `N${totalExcess.toLocaleString()}`),
      row('Accounted For:', `N${totalReceived.toLocaleString()}`),
      sol,
      row(
        shortfall > 0 ? 'SHORTFALL:' : shortfall < 0 ? 'SURPLUS:' : 'BALANCED:',
        `N${Math.abs(shortfall).toLocaleString()}`
      ),
      sol,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Daily Recon — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=800')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    w.onload = () =>
      setTimeout(() => {
        try {
          w.print()
        } catch {
          /* */
        }
      }, 200)
  }

  const cards = [
    {
      label: 'Gross Revenue',
      value: `SSP${summary.total.toLocaleString()}`,
      icon: TrendingUp,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
    },
    {
      label: 'Net Revenue',
      value: `SSP${netRevenue.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-green-400',
      bg: 'bg-green-400/10',
    },
    {
      label: 'Cash',
      value: `SSP${(summary.byMethod?.['Cash'] || 0).toLocaleString()}`,
      icon: Banknote,
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10',
    },
    {
      label: 'Bank POS',
      value: `SSP${(summary.byMethod?.['Bank POS'] || 0).toLocaleString()}`,
      icon: CreditCard,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      label: 'Transfer',
      value: `SSP${(summary.byMethod?.['Transfer'] || 0).toLocaleString()}`,
      icon: Smartphone,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
    },
    {
      label: 'Avg Order',
      value: `SSP${summary.avgOrder.toLocaleString()}`,
      icon: Receipt,
      color: 'text-pink-400',
      bg: 'bg-pink-400/10',
    },
  ]

  const barColors = [
    'bg-emerald-500',
    'bg-blue-500',
    'bg-purple-500',
    'bg-amber-500',
    'bg-cyan-500',
    'bg-pink-500',
    'bg-red-500',
    'bg-indigo-500',
  ]
  const paymentBars = Object.entries(summary.byMethod || {})
    .sort(([, a], [, b]) => b - a)
    .map(([label, value], i) => ({ label, value, color: barColors[i % barColors.length] }))

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-2`}>
              <card.icon size={16} className={card.color} />
            </div>
            <p className="text-gray-400 text-xs">{card.label}</p>
            <p className="text-white font-bold text-lg mt-0.5 leading-tight">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Staff Sales Summary */}
      {waitronStats.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Users size={16} className="text-amber-400" /> Staff Sales — {dateLabel}
          </h3>
          <div className="space-y-2">
            {waitronStats.map((w) => (
              <div
                key={w.name}
                className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0"
              >
                <div>
                  <span className="text-white text-sm font-medium">{w.name}</span>
                  <span className="text-gray-500 text-xs ml-2">{w.orders} orders</span>
                </div>
                <span className="text-amber-400 font-bold">SSP{w.revenue.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">Payment Method Breakdown</h3>
        <div className="space-y-3">
          {paymentBars.map((item) => (
            <div key={item.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">{item.label}</span>
                <span className="text-white font-medium">
                  SSP{item.value.toLocaleString()} (
                  {summary.total ? Math.round((item.value / summary.total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color} rounded-full transition-all`}
                  style={{ width: `${summary.total ? (item.value / summary.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════ DAILY RECONCILIATION ═══════════════ */}
      <div className="bg-gray-900 border border-amber-500/20 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-amber-400 font-bold flex items-center gap-2">
            <DollarSign size={16} />{' '}
            {isSingleDay ? 'Daily Reconciliation' : 'Reconciliation Summary'}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs">
              {isSingleDay
                ? new Date(reconDate).toLocaleDateString('en-SS', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : dateLabel}
            </span>
            {isSingleDay && !canSaveThisDay && (
              <span className="text-gray-500 text-[11px]">
                Read-only (managers can save past days)
              </span>
            )}
            {canSaveThisDay && (
              <button
                onClick={saveRecon}
                disabled={saving || !canSaveThisDay}
                className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-1.5 rounded-lg transition-colors"
              >
                <Save size={12} /> {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            <button
              onClick={printDailySummary}
              className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              <Printer size={12} /> Print
            </button>
          </div>
        </div>

        {/* Daily Notes / Manifest */}
        <div className="mb-4 bg-gray-950/40 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h4 className="text-gray-200 text-sm font-semibold flex items-center gap-1.5">
              <Receipt size={13} className="text-amber-400" /> Daily Notes / Manifest
            </h4>
            {canSaveThisDay && (
              <button
                onClick={saveManifest}
                disabled={manifestSaving || manifestLoading || !canSaveThisDay}
                className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
              >
                <Save size={12} /> {manifestSaving ? 'Saving...' : 'Save Notes'}
              </button>
            )}
          </div>
          {!isSingleDay ? (
            <p className="text-gray-500 text-xs">
              Notes are saved per day. Switch to <span className="text-gray-200">Today</span> or{' '}
              <span className="text-gray-200">Prev Day</span> to write a manifest.
            </p>
          ) : (
            <textarea
              value={manifestNotes}
              onChange={(e) => setManifestNotes(e.target.value)}
              placeholder="Write a short explanation of what happened today (issues, shortages, notes, special events, etc.)"
              rows={4}
              disabled={!canEditThisDay}
              className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          )}
        </div>

        {/* Waitron Remittance Per Waitron (single-day only) */}
        {isSingleDay && (
          <div className="mb-5">
            <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Banknote size={13} className="text-emerald-400" /> Waitron Remittance
            </h4>
            <p className="text-gray-600 text-xs mb-2">
              Enter cash collected and POS/transfer receipt submitted by each waitron
            </p>
            <div className="space-y-1.5">
              {activeWaitrons.map((w) => (
                <div key={w.name} className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm w-32 truncate">{w.name}</span>
                  <span className="text-gray-600 text-xs w-32">
                    exp cash SSP{(w.cashExpected || 0).toLocaleString()}
                  </span>
                  <input
                    type="number"
                    placeholder="SSP cash"
                    value={recon.cashCollected[w.name] || ''}
                    onChange={(e) =>
                      setRecon((prev) => ({
                        ...prev,
                        cashCollected: {
                          ...prev.cashCollected,
                          [w.name]: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    disabled={!canEditThisDay}
                    className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-gray-600 text-xs w-36">
                    exp POS+transfer SSP{(w.transferExpected || 0).toLocaleString()}
                  </span>
                  <input
                    type="number"
                    placeholder="SSP POS/transfer"
                    value={recon.transferReceipts[w.name] || ''}
                    onChange={(e) =>
                      setRecon((prev) => ({
                        ...prev,
                        transferReceipts: {
                          ...prev.transferReceipts,
                          [w.name]: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    disabled={!canEditThisDay}
                    className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
              ))}
              <div className="flex justify-between pt-1 border-t border-gray-700">
                <span className="text-gray-400 text-sm font-medium">Total Cash Collected</span>
                <span className="text-emerald-400 font-bold">
                  SSP{totalCashCollected.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 text-sm font-medium">
                  Total POS and Transfer Receipts
                </span>
                <span className="text-purple-400 font-bold">
                  SSP{totalTransferReceipts.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Outstanding per Waitron */}
        <div className="mb-5">
          <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-red-400" /> Outstanding / Shortage per Waitron
          </h4>
          <p className="text-gray-600 text-xs mb-2">
            Shortages are calculated automatically from cash and POS/transfer remittance. Surplus is
            shown as excess. Credit and pay-later orders are added automatically.
          </p>
          <div className="space-y-1.5">
            {activeWaitrons.map((w) => {
              const shortage = shortagesForView[w.name] || 0
              const excess = autoExcess[w.name] || 0
              const credit = creditByWaitron[w.name] || 0
              return (
                <div key={w.name} className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm w-32 truncate">{w.name}</span>
                  <span className="text-gray-500 text-xs shrink-0">
                    remitted SSP
                    {(
                      (recon.cashCollected[w.name] || 0) + (recon.transferReceipts[w.name] || 0)
                    ).toLocaleString()}
                  </span>
                  <span className="text-gray-500 text-xs shrink-0">
                    expected SSP{((w.cashExpected || 0) + (w.transferExpected || 0)).toLocaleString()}
                  </span>
                  <span className="text-red-400 text-xs shrink-0">
                    shortage: SSP{shortage.toLocaleString()}
                  </span>
                  {isSingleDay && excess > 0 && (
                    <span className="text-green-400 text-xs shrink-0">
                      excess: SSP{excess.toLocaleString()}
                    </span>
                  )}
                  {credit > 0 && (
                    <span className="text-amber-400 text-xs shrink-0">
                      Credit: SSP{credit.toLocaleString()}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {/* Credit debt details */}
          {creditDetails.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-700">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">
                Credit / Pay Later Details
              </p>
              <div className="space-y-1.5">
                {creditDetails.map((d, i) => (
                  <div
                    key={i}
                    className="bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white text-xs font-medium">{d.name}</p>
                      <p className="text-gray-500 text-[10px]">
                        {new Date(d.date).toLocaleDateString('en-SS', {
                          day: '2-digit',
                          month: 'short',
                          timeZone: 'Africa/Lagos',
                        })}
                        {' · '}
                        {new Date(d.date).toLocaleTimeString('en-SS', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                          timeZone: 'Africa/Lagos',
                        })}
                        {d.notes ? ` · ${d.notes}` : ''}
                      </p>
                      {d.items && <p className="text-gray-400 text-[10px] mt-0.5">{d.items}</p>}
                    </div>
                    <span className="text-red-400 text-xs font-bold">
                      SSP{d.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="text-right text-sm text-gray-300 mt-2">
            Total Outstanding:{' '}
            <span className="text-red-400 font-semibold">SSP{totalOutstanding.toLocaleString()}</span>
          </div>
        </div>

        {/* ═══ RECONCILIATION SUMMARY ═══ */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-2">
          <h4 className="text-white font-bold text-sm mb-3">End of Day Summary</h4>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total Sales (POS)</span>
            <span className="text-white font-bold">SSP{expectedRevenue.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Cash Collected</span>
            <span className="text-emerald-400">SSP{totalCashCollected.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">POS and Transfer Receipts</span>
            <span className="text-purple-400">SSP{totalTransferReceipts.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Expenses/Payouts</span>
            <span className="text-red-400">SSP{totalPayouts.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Outstanding / Shortage (Waitrons)</span>
            <span className="text-red-400">SSP{totalOutstanding.toLocaleString()}</span>
          </div>
          <div className="border-t-2 border-gray-700 pt-2 mt-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Accounted For</span>
              <span className="text-white font-bold">SSP{totalReceived.toLocaleString()}</span>
            </div>
          </div>
          <div className="border-t-2 border-gray-600 pt-2">
            <div className="flex justify-between items-center">
              <span
                className={`font-bold ${shortfall > 0 ? 'text-red-400' : shortfall < 0 ? 'text-green-400' : 'text-green-400'}`}
              >
                {shortfall > 0 ? 'SHORTFALL' : shortfall < 0 ? 'SURPLUS' : 'BALANCED'}
              </span>
              <div className="flex items-center gap-2">
                {shortfall === 0 ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <AlertTriangle
                    size={16}
                    className={shortfall > 0 ? 'text-red-400' : 'text-green-400'}
                  />
                )}
                <span
                  className={`text-xl font-bold ${shortfall > 0 ? 'text-red-400' : shortfall < 0 ? 'text-green-400' : 'text-green-400'}`}
                >
                  SSP{Math.abs(shortfall).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mini trend */}
      {trendData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Revenue — Last 30 Days</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickFormatter={(v) => `SSP${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
                formatter={(v: number) => [`SSP${v.toLocaleString()}`, 'Revenue']}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Payouts summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Expenses & Payouts</h3>
          <button
            onClick={onRecordPayout}
            className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={13} /> Record
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Total expenses this period</span>
          <span className="text-red-400 font-bold text-xl">SSP{totalPayouts.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-gray-400">Net after expenses</span>
          <span className="text-green-400 font-bold text-xl">SSP{netRevenue.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
