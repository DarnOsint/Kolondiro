import { Monitor, CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { TimesheetEntry } from './types'
import type { Order } from '../../types'
import { getNetOrderAmount } from './orderAmounts'

interface Props {
  timesheet: TimesheetEntry[]
  orders: Order[]
  dateLabel: string
}

interface POSMachineSummary {
  machine: string
  waitrons: WaitronEntry[]
  totalSales: number
  cashSales: number
  cardSales: number
  transferSales: number
  creditSales: number
  orderCount: number
}

interface WaitronEntry {
  staffId: string
  staffName: string
  role: string
  clockIn: string
  clockOut: string | null
  durationMinutes: number | null
  orders: number
  sales: number
  cash: number
  card: number
  transfer: number
  credit: number
}

const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
const fmtTime = (ts?: string | null) =>
  ts
    ? new Date(ts).toLocaleTimeString('en-NG', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : '—'
const fmtDur = (min: number | null) => {
  if (!min) return '—'
  const h = Math.floor(min / 60),
    m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function POSReconciliationTab({ timesheet, orders, dateLabel }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Build POS machine summaries
  const machineMap: Record<string, POSMachineSummary> = {}
  const unassigned: WaitronEntry[] = []

  timesheet.forEach((entry) => {
    const machine = (entry as TimesheetEntry & { pos_machine?: string | null }).pos_machine
    const staffId = (entry as TimesheetEntry & { staff_id?: string }).staff_id || ''
    // Filter orders to this specific shift window only
    const shiftClockIn = new Date(
      (entry as TimesheetEntry & { clock_in?: string }).clock_in || 0
    ).getTime()
    const shiftClockOut = (entry as TimesheetEntry & { clock_out?: string | null }).clock_out
      ? new Date((entry as TimesheetEntry & { clock_out?: string }).clock_out!).getTime()
      : new Date().getTime()

    const staffOrders = orders.filter((o) => {
      if ((o as Order & { staff_id?: string }).staff_id !== staffId) return false
      if (o.status !== 'paid') return false
      // Use closed_at if available, fall back to created_at
      const orderTime = new Date(
        (o as Order & { closed_at?: string | null }).closed_at || o.created_at
      ).getTime()
      return orderTime >= shiftClockIn && orderTime <= shiftClockOut
    })

    const waitronEntry: WaitronEntry = {
      staffId,
      staffName: entry.staff_name || 'Unknown',
      role: entry.role || '',
      clockIn: (entry as TimesheetEntry & { clock_in?: string }).clock_in || '',
      clockOut: (entry as TimesheetEntry & { clock_out?: string | null }).clock_out || null,
      durationMinutes: entry.duration_minutes || null,
      orders: staffOrders.length,
      sales: staffOrders.reduce((s, o) => s + getNetOrderAmount(o), 0),
      cash: staffOrders
        .filter((o) => o.payment_method === 'cash')
        .reduce((s, o) => s + getNetOrderAmount(o), 0),
      card: staffOrders
        .filter((o) => o.payment_method === 'card')
        .reduce((s, o) => s + getNetOrderAmount(o), 0),
      transfer: staffOrders
        .filter((o) => o.payment_method === 'transfer')
        .reduce((s, o) => s + getNetOrderAmount(o), 0),
      credit: staffOrders
        .filter((o) => o.payment_method === 'credit')
        .reduce((s, o) => s + getNetOrderAmount(o), 0),
    }

    if (!machine) {
      unassigned.push(waitronEntry)
      return
    }

    if (!machineMap[machine]) {
      machineMap[machine] = {
        machine,
        waitrons: [],
        totalSales: 0,
        cashSales: 0,
        cardSales: 0,
        transferSales: 0,
        creditSales: 0,
        orderCount: 0,
      }
    }

    machineMap[machine].waitrons.push(waitronEntry)
    machineMap[machine].totalSales += waitronEntry.sales
    machineMap[machine].cashSales += waitronEntry.cash
    machineMap[machine].cardSales += waitronEntry.card
    machineMap[machine].transferSales += waitronEntry.transfer
    machineMap[machine].creditSales += waitronEntry.credit
    machineMap[machine].orderCount += waitronEntry.orders
  })

  const machines = Object.values(machineMap).sort((a, b) => b.totalSales - a.totalSales)
  const grandTotal =
    machines.reduce((s, m) => s + m.totalSales, 0) + unassigned.reduce((s, w) => s + w.sales, 0)

  if (timesheet.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <Monitor size={32} className="mb-3 opacity-40" />
        <p className="font-medium">No attendance records for this period</p>
        <p className="text-xs mt-1">
          Clock in staff with POS machines assigned to see reconciliation
        </p>
      </div>
    )
  }

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Period: {dateLabel}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-gray-500 text-xs">Total Revenue</p>
            <p className="text-amber-400 font-bold text-lg">{fmt(grandTotal)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">POS Terminals</p>
            <p className="text-white font-bold text-lg">{machines.length}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Staff On Shift</p>
            <p className="text-white font-bold text-lg">{timesheet.length}</p>
          </div>
        </div>
      </div>

      {/* Per-machine cards */}
      {machines.map((m) => (
        <div
          key={m.machine}
          className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
        >
          {/* Machine header */}
          <button
            onClick={() => toggle(m.machine)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Monitor size={16} className="text-cyan-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-bold">{m.machine}</p>
                <p className="text-gray-500 text-xs">
                  {m.waitrons.length} waitron{m.waitrons.length !== 1 ? 's' : ''} · {m.orderCount}{' '}
                  orders
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-amber-400 font-bold">{fmt(m.totalSales)}</p>
                <p className="text-gray-500 text-xs">total sales</p>
              </div>
              {expanded[m.machine] ? (
                <ChevronUp size={16} className="text-gray-400" />
              ) : (
                <ChevronDown size={16} className="text-gray-400" />
              )}
            </div>
          </button>

          {expanded[m.machine] && (
            <div className="border-t border-gray-800">
              {/* Payment breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border-b border-gray-800">
                {[
                  { label: 'Cash', value: m.cashSales, color: 'text-green-400' },
                  { label: 'Card/POS', value: m.cardSales, color: 'text-blue-400' },
                  { label: 'Transfer', value: m.transferSales, color: 'text-purple-400' },
                  { label: 'Credit', value: m.creditSales, color: 'text-orange-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="p-3 border-r border-gray-800 last:border-0">
                    <p className="text-gray-500 text-xs">{label}</p>
                    <p className={`font-semibold text-sm ${color}`}>{fmt(value)}</p>
                  </div>
                ))}
              </div>

              {/* Per-waitron rows */}
              <div className="divide-y divide-gray-800">
                {m.waitrons.map((w) => (
                  <div key={w.staffId} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-white font-medium">{w.staffName}</p>
                        <p className="text-gray-500 text-xs capitalize">
                          {w.role} · {fmtTime(w.clockIn)} →{' '}
                          {w.clockOut ? (
                            fmtTime(w.clockOut)
                          ) : (
                            <span className="text-amber-400">Still on shift</span>
                          )}{' '}
                          · {fmtDur(w.durationMinutes)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-bold">{fmt(w.sales)}</p>
                        <p className="text-gray-500 text-xs">{w.orders} orders</p>
                      </div>
                    </div>
                    {/* Reconciliation status */}
                    <div className="flex items-center gap-2 mt-2">
                      {w.cash > 0 && (
                        <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-lg px-2 py-1">
                          <AlertTriangle size={10} className="text-green-400" />
                          <span className="text-green-400 text-xs font-medium">
                            Cash to collect: {fmt(w.cash)}
                          </span>
                        </div>
                      )}
                      {w.transfer > 0 && (
                        <div className="flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1">
                          <CheckCircle size={10} className="text-purple-400" />
                          <span className="text-purple-400 text-xs">
                            Transfer: {fmt(w.transfer)}
                          </span>
                        </div>
                      )}
                      {w.credit > 0 && (
                        <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 rounded-lg px-2 py-1">
                          <AlertTriangle size={10} className="text-orange-400" />
                          <span className="text-orange-400 text-xs">
                            Credit tab: {fmt(w.credit)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Unassigned (no POS machine) */}
      {unassigned.length > 0 && (
        <div className="bg-gray-900 border border-amber-500/20 rounded-2xl overflow-hidden">
          <button
            onClick={() => toggle('__unassigned')}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <AlertTriangle size={16} className="text-amber-400" />
              </div>
              <div className="text-left">
                <p className="text-amber-400 font-bold">No POS Machine Assigned</p>
                <p className="text-gray-500 text-xs">
                  {unassigned.length} staff · sales cannot be traced to a terminal
                </p>
              </div>
            </div>
            {expanded['__unassigned'] ? (
              <ChevronUp size={16} className="text-gray-400" />
            ) : (
              <ChevronDown size={16} className="text-gray-400" />
            )}
          </button>

          {expanded['__unassigned'] && (
            <div className="border-t border-gray-800 divide-y divide-gray-800">
              {unassigned.map((w) => (
                <div key={w.staffId} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{w.staffName}</p>
                    <p className="text-gray-500 text-xs capitalize">
                      {w.role} · {fmtTime(w.clockIn)} →{' '}
                      {w.clockOut ? (
                        fmtTime(w.clockOut)
                      ) : (
                        <span className="text-amber-400">Still on shift</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold">{fmt(w.sales)}</p>
                    <p className="text-gray-500 text-xs">{w.orders} orders</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
