import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  Banknote,
  Calendar,
  CheckCircle,
  Printer,
  RefreshCw,
  Save,
  Users,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import { getNetOrderAmount } from '../accounting/orderAmounts'

interface WaitronStat {
  name: string
  orders: number
  revenue: number
  cashExpected: number
  transferExpected: number
}

interface ReconOrder {
  id: string
  status: string
  payment_method: string | null
  closed_at: string | null
  profiles?: { full_name: string } | null
  order_items?: Array<{
    total_price?: number
    extra_charge?: number
    status?: string
    return_requested?: boolean
    return_accepted?: boolean
  }>
}

interface Reconciliation {
  cashCollected: Record<string, number>
  transferReceipts: Record<string, number>
  outstanding: Record<string, number>
  excess: Record<string, number>
}

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

export default function SupervisorReconTab() {
  const { profile } = useAuth()
  const toast = useToast()

  const sessionTodayKey = (() => {
    const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
    return wat.toLocaleDateString('en-CA')
  })()

  const [reconDate, setReconDate] = useState(sessionTodayKey)
  const canSaveThisDay = reconDate === sessionTodayKey
  const [waitronStats, setWaitronStats] = useState<WaitronStat[]>([])
  const [recon, setRecon] = useState<Reconciliation>({
    cashCollected: {},
    transferReceipts: {},
    outstanding: {},
    excess: {},
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const sessionBounds = useCallback((date: string) => {
    const start = new Date(`${date}T08:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    const { start, end } = sessionBounds(reconDate)

    const [orderRes, reconRes] = await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, status, payment_method, closed_at, profiles(full_name), order_items(total_price, extra_charge, status, return_requested, return_accepted)'
        )
        .or(
          `and(status.eq.paid,closed_at.gte.${start},closed_at.lt.${end}),and(status.neq.paid,created_at.gte.${start},created_at.lt.${end})`
        )
        .order('created_at', { ascending: true }),
      supabase.from('settings').select('value').eq('id', `recon_${reconDate}`).single(),
    ])

    const orders = (orderRes.data || []) as unknown as ReconOrder[]
    const paidOrders = orders.filter((o) => o.status === 'paid')

    const wMap: Record<string, WaitronStat> = {}
    paidOrders.forEach((o) => {
      const name = o.profiles?.full_name || 'Unknown'
      if (!wMap[name]) {
        wMap[name] = { name, orders: 0, revenue: 0, cashExpected: 0, transferExpected: 0 }
      }
      const netAmount = getNetOrderAmount(o)
      const remittance = getWaitronRemittance(o.payment_method, netAmount)
      wMap[name].orders++
      wMap[name].revenue += netAmount
      wMap[name].cashExpected += remittance.cash
      wMap[name].transferExpected += remittance.transfer
    })
    setWaitronStats(Object.values(wMap).sort((a, b) => b.revenue - a.revenue))

    if (reconRes.data?.value) {
      try {
        const parsed = JSON.parse(reconRes.data.value) as Partial<Reconciliation>
        setRecon({
          cashCollected: parsed.cashCollected || {},
          transferReceipts: parsed.transferReceipts || {},
          outstanding: parsed.outstanding || {},
          excess: parsed.excess || {},
        })
      } catch {
        setRecon({ cashCollected: {}, transferReceipts: {}, outstanding: {}, excess: {} })
      }
    } else {
      setRecon({ cashCollected: {}, transferReceipts: {}, outstanding: {}, excess: {} })
    }
    setLoading(false)
  }, [reconDate, sessionBounds])

  useEffect(() => {
    loadData()
  }, [loadData])

  const activeWaitrons = waitronStats

  const autoShortage = activeWaitrons.reduce(
    (acc, w) => {
      const expectedTotal = w.cashExpected + w.transferExpected
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
      const expectedTotal = w.cashExpected + w.transferExpected
      const remittedTotal =
        (recon.cashCollected[w.name] || 0) + (recon.transferReceipts[w.name] || 0)
      const excess = Math.max(0, remittedTotal - expectedTotal)
      if (excess > 0) acc[w.name] = excess
      return acc
    },
    {} as Record<string, number>
  )

  const totalCashCollected = Object.values(recon.cashCollected).reduce((s, v) => s + (v || 0), 0)
  const totalTransferReceipts = Object.values(recon.transferReceipts).reduce(
    (s, v) => s + (v || 0),
    0
  )
  const totalOutstanding = Object.values(autoShortage).reduce((s, v) => s + (v || 0), 0)
  const totalExcess = Object.values(autoExcess).reduce((s, v) => s + (v || 0), 0)
  const totalReceived = totalCashCollected + totalTransferReceipts
  const expectedRevenue = waitronStats.reduce((s, w) => s + w.revenue, 0)
  const gap = expectedRevenue - totalReceived

  const saveRecon = async () => {
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
        totalTransferReceipts,
        shortfall: gap > 0 ? gap : totalOutstanding,
        enteredBy: 'supervisor',
      },
      performer: profile as any,
    })
    setSaving(false)
    toast.success('Saved', 'Reconciliation data saved')
  }

  const printRecon = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(`${reconDate}T12:00:00`).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('WAITRON DAILY SUBMISSION'),
      div,
      row('Date:', fmtDate),
      row('Entered By:', profile?.full_name || 'Supervisor'),
      div,
      ctr('WAITRON REMITTANCE'),
      div,
      ...activeWaitrons.flatMap((w) => {
        const cash = recon.cashCollected[w.name] || 0
        const transfer = recon.transferReceipts[w.name] || 0
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
      ...Object.entries(autoShortage)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL OUTSTANDING:', `N${totalOutstanding.toLocaleString()}`),
      div,
      sol,
      row('Total Sales (POS):', `N${expectedRevenue.toLocaleString()}`),
      row('Total Received:', `N${totalReceived.toLocaleString()}`),
      row('Outstanding (Waitrons):', `N${totalOutstanding.toLocaleString()}`),
      row('Excess (Waitrons):', `N${totalExcess.toLocaleString()}`),
      sol,
      row(
        gap > 0 ? 'SHORTFALL:' : gap < 0 ? 'SURPLUS:' : 'BALANCED:',
        `N${Math.abs(gap).toLocaleString()}`
      ),
      sol,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Waitron Submission — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=800')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    setTimeout(() => {
      try {
        w.print()
      } catch {
        /* */
      }
    }, 200)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16 text-gray-500">
        <RefreshCw size={18} className="animate-spin text-amber-500" />
        <span className="ml-2 text-sm">Loading submissions…</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-white font-bold text-sm flex items-center gap-1.5">
              <Calendar size={14} className="text-amber-400" /> Waitron Daily Submission
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              Enter cash collected and POS/transfer receipt submitted by each waitron
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={reconDate}
              max={sessionTodayKey}
              onChange={(e) => e.target.value && setReconDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={loadData}
              className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              <RefreshCw size={12} /> Reload
            </button>
            <button
              onClick={saveRecon}
              disabled={saving || !canSaveThisDay}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              <Save size={12} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        {!canSaveThisDay && (
          <p className="text-gray-500 text-[11px] mt-2">
            Read-only — only today's session can be recorded by a supervisor.
          </p>
        )}
      </div>

      {waitronStats.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-gray-600">
          <Users size={36} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No paid sales for this day</p>
          <p className="text-xs mt-1">Nothing to reconcile yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h4 className="text-gray-300 text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Banknote size={13} className="text-emerald-400" /> Remittance per Waitron
            </h4>
            <div className="space-y-2">
              {activeWaitrons.map((w) => (
                <div key={w.name} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm font-semibold">{w.name}</span>
                    <span className="text-gray-500 text-[11px]">
                      {w.orders} order{w.orders === 1 ? '' : 's'} · ₦{w.revenue.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1">
                      <label className="text-gray-500 text-[10px] uppercase tracking-wide">
                        Cash collected · expected ₦{w.cashExpected.toLocaleString()}
                      </label>
                      <input
                        type="number"
                        placeholder="₦ cash"
                        value={recon.cashCollected[w.name] || ''}
                        disabled={!canSaveThisDay}
                        onChange={(e) =>
                          setRecon((prev) => ({
                            ...prev,
                            cashCollected: {
                              ...prev.cashCollected,
                              [w.name]: parseFloat(e.target.value) || 0,
                            },
                          }))
                        }
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-gray-500 text-[10px] uppercase tracking-wide">
                        POS/transfer submitted · expected ₦{w.transferExpected.toLocaleString()}
                      </label>
                      <input
                        type="number"
                        placeholder="₦ POS/transfer"
                        value={recon.transferReceipts[w.name] || ''}
                        disabled={!canSaveThisDay}
                        onChange={(e) =>
                          setRecon((prev) => ({
                            ...prev,
                            transferReceipts: {
                              ...prev.transferReceipts,
                              [w.name]: parseFloat(e.target.value) || 0,
                            },
                          }))
                        }
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-gray-500 text-xs">
                      remitted ₦
                      {(
                        (recon.cashCollected[w.name] || 0) + (recon.transferReceipts[w.name] || 0)
                      ).toLocaleString()}
                    </span>
                    <span className="text-gray-500 text-xs">
                      expected ₦{(w.cashExpected + w.transferExpected).toLocaleString()}
                    </span>
                    {(autoShortage[w.name] || 0) > 0 && (
                      <span className="text-red-400 text-xs">
                        shortage: ₦{autoShortage[w.name].toLocaleString()}
                      </span>
                    )}
                    {(autoExcess[w.name] || 0) > 0 && (
                      <span className="text-green-400 text-xs">
                        excess: ₦{autoExcess[w.name].toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap justify-between pt-2 border-t border-gray-700 gap-2">
                <span className="text-gray-400 text-sm font-medium">Total Cash Collected</span>
                <span className="text-emerald-400 font-bold">
                  ₦{totalCashCollected.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap justify-between">
                <span className="text-gray-400 text-sm font-medium">Total POS and Transfer</span>
                <span className="text-purple-400 font-bold">
                  ₦{totalTransferReceipts.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h4 className="text-gray-300 text-sm font-semibold mb-3 flex items-center gap-1.5">
              <AlertTriangle size={13} className="text-red-400" /> Outstanding / Shortage per
              Waitron
            </h4>
            <p className="text-gray-600 text-xs mb-2">
              Shortage is calculated automatically as expected minus remitted.
            </p>
            <div className="space-y-1.5">
              {activeWaitrons.map((w) => {
                const shortage = autoShortage[w.name] || 0
                const excess = autoExcess[w.name] || 0
                if (shortage <= 0 && excess <= 0) return null
                return (
                  <div key={w.name} className="flex items-center justify-between">
                    <span className="text-gray-300 text-sm">{w.name}</span>
                    <span className="text-xs">
                      {shortage > 0 && (
                        <span className="text-red-400 font-medium">
                          shortage: ₦{shortage.toLocaleString()}
                        </span>
                      )}
                      {shortage > 0 && excess > 0 && <span className="text-gray-600"> · </span>}
                      {excess > 0 && (
                        <span className="text-green-400 font-medium">
                          excess: ₦{excess.toLocaleString()}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
              {totalOutstanding === 0 && totalExcess === 0 && (
                <p className="text-green-400 text-sm flex items-center gap-1.5">
                  <CheckCircle size={14} /> Balanced — no shortages or excess
                </p>
              )}
            </div>
            <div className="flex justify-between mt-3 pt-2 border-t border-gray-700">
              <span className="text-gray-400 text-sm font-medium">Total Outstanding</span>
              <span className="text-red-400 font-semibold">
                ₦{totalOutstanding.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-white font-bold text-sm">End of Day Summary</h4>
              <button
                onClick={printRecon}
                className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
              >
                <Printer size={12} /> Print
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Sales (POS)</span>
                <span className="text-white font-bold">₦{expectedRevenue.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Cash Collected</span>
                <span className="text-emerald-400">₦{totalCashCollected.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">POS and Transfer Receipts</span>
                <span className="text-purple-400">₦{totalTransferReceipts.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Outstanding / Shortage (Waitrons)</span>
                <span className="text-red-400">₦{totalOutstanding.toLocaleString()}</span>
              </div>
              <div className="border-t-2 border-gray-700 pt-2 mt-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Accounted For</span>
                  <span className="text-white font-bold">₦{totalReceived.toLocaleString()}</span>
                </div>
              </div>
              <div className="border-t-2 border-gray-600 pt-2 flex items-center justify-between">
                <span className={`font-bold ${gap > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {gap > 0 ? 'SHORTFALL' : gap < 0 ? 'SURPLUS' : 'BALANCED'}
                </span>
                <span
                  className={`text-xl font-bold ${gap > 0 ? 'text-red-400' : 'text-green-400'}`}
                >
                  ₦{Math.abs(gap).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
      <p className="text-gray-600 text-[10px] text-center pb-2">
        Record is saved to the same daily reconciliation used by the accountant ({reconDate}).
      </p>
    </div>
  )
}
