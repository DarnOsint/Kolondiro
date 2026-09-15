import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, Printer, RefreshCw, Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { createPDF, addTable, savePDF } from '../../lib/pdfExport'
import ReceiptModal from '../pos/ReceiptModal'
import type { LedgerEntry, PayoutRow } from './types'
import type { Order, OrderItem, Table } from '../../types'
import { getNetOrderAmount, getValidOrderItemCount, getValidOrderItems } from './orderAmounts'

type LedgerFilterMode = 'prev-day' | 'single' | 'range'

type LedgerOrder = Order & {
  profiles?: { full_name: string } | null
  tables?: Table | { id?: string; name: string } | null
  order_items?: OrderItem[]
}

type LedgerOrderEntry = LedgerEntry & {
  source: 'order'
  order: LedgerOrder
}

type LedgerPayoutEntry = LedgerEntry & {
  source: 'payout'
}

type LedgerRecord = LedgerOrderEntry | LedgerPayoutEntry

const formatMoney = (amount: number) => `₦${Number(amount || 0).toLocaleString()}`
const toDateInput = (value: Date) => value.toISOString().slice(0, 10)
const sessionStart = (value: string) => {
  const date = new Date(`${value}T08:00:00`)
  return date.toISOString()
}
const sessionEnd = (value: string) => {
  const date = new Date(`${value}T08:00:00`)
  date.setDate(date.getDate() + 1)
  date.setMilliseconds(date.getMilliseconds() - 1)
  return date.toISOString()
}
const previousDayString = () => {
  const value = new Date()
  value.setDate(value.getDate() - 1)
  return toDateInput(value)
}

interface Props {
  dateRange: string
}

function buildReceiptLikeRef(orderId: string) {
  return `BSP-${String(orderId).slice(0, 8).toUpperCase()}`
}

function buildEntryDescription(order: LedgerOrder) {
  const base = order.tables?.name || order.order_type || 'Sale'
  return (order.payment_method === 'credit' ? '[Pay Later] ' : '') + base
}

export default function LedgerTab({ dateRange }: Props) {
  const [filterMode, setFilterMode] = useState<LedgerFilterMode>('prev-day')
  const [selectedDate, setSelectedDate] = useState(previousDayString())
  const [rangeStart, setRangeStart] = useState(previousDayString())
  const [rangeEnd, setRangeEnd] = useState(previousDayString())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [records, setRecords] = useState<LedgerRecord[]>([])
  const [selectedEntry, setSelectedEntry] = useState<LedgerRecord | null>(null)
  const [receiptOrder, setReceiptOrder] = useState<LedgerOrder | null>(null)

  const activePeriod = useMemo(() => {
    if (filterMode === 'single') {
      return {
        label: selectedDate,
        start: sessionStart(selectedDate),
        end: sessionEnd(selectedDate),
      }
    }
    if (filterMode === 'range') {
      const normalizedStart = rangeStart <= rangeEnd ? rangeStart : rangeEnd
      const normalizedEnd = rangeEnd >= rangeStart ? rangeEnd : rangeStart
      return {
        label: `${normalizedStart} to ${normalizedEnd}`,
        start: sessionStart(normalizedStart),
        end: sessionEnd(normalizedEnd),
      }
    }
    const prev = previousDayString()
    return {
      label: `Previous Day (${prev})`,
      start: sessionStart(prev),
      end: sessionEnd(prev),
    }
  }, [filterMode, rangeEnd, rangeStart, selectedDate])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    const [ordersRes, payoutsRes] = await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, created_at, closed_at, status, payment_method, order_type, total_amount, staff_id, profiles(full_name), tables(id, name), order_items(id, quantity, total_price, extra_charge, status, destination, modifier_notes, return_requested, return_accepted, menu_items(name, price))'
        )
        .eq('status', 'paid')
        .gte('created_at', activePeriod.start)
        .lte('created_at', activePeriod.end)
        .order('created_at', { ascending: false }),
      supabase
        .from('payouts')
        .select('id, amount, reason, category, paid_to, created_at, profiles(full_name)')
        .gte('created_at', activePeriod.start)
        .lte('created_at', activePeriod.end)
        .order('created_at', { ascending: false }),
    ])

    const ledger: LedgerRecord[] = []

    for (const order of (ordersRes.data || []) as unknown as LedgerOrder[]) {
      ledger.push({
        id: order.id,
        date: order.created_at,
        type: 'credit',
        description: buildEntryDescription(order),
        ref: buildReceiptLikeRef(order.id),
        debit: 0,
        credit: getNetOrderAmount(order),
        balance: 0,
        method: order.payment_method ?? null,
        staff: order.profiles?.full_name ?? null,
        source: 'order',
        order,
      })
    }

    for (const payout of (payoutsRes.data || []) as unknown as Array<
      PayoutRow & { profiles?: { full_name: string } | null }
    >) {
      ledger.push({
        id: payout.id,
        date: payout.created_at,
        type: 'debit',
        description: payout.reason || 'Expense',
        ref: payout.id.slice(0, 8).toUpperCase(),
        debit: payout.amount || 0,
        credit: 0,
        balance: 0,
        method: payout.category,
        staff: payout.profiles?.full_name ?? null,
        source: 'payout',
      })
    }

    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    let runningBalance = 0
    for (const entry of ledger) {
      runningBalance += entry.credit - entry.debit
      entry.balance = runningBalance
    }

    setRecords(ledger.reverse())
    setLoading(false)
  }, [activePeriod.end, activePeriod.start])

  useEffect(() => {
    void fetchLedger()
  }, [fetchLedger])

  const filteredRecords = useMemo(
    () =>
      records.filter((entry) => {
        if (!search) return true
        const query = search.toLowerCase()
        const orderItems =
          entry.source === 'order'
            ? (entry.order.order_items || [])
                .map((item) => item.menu_items?.name || item.modifier_notes || '')
                .join(' ')
                .toLowerCase()
            : ''
        return (
          (entry.description || '').toLowerCase().includes(query) ||
          (entry.ref || '').toLowerCase().includes(query) ||
          (entry.staff || '').toLowerCase().includes(query) ||
          (entry.method || '').toLowerCase().includes(query) ||
          orderItems.includes(query)
        )
      }),
    [records, search]
  )

  const closingBalance = filteredRecords[0]?.balance ?? 0
  const orderCount = filteredRecords.filter((entry) => entry.source === 'order').length

  const exportPDF = () => {
    const doc = createPDF('General Ledger', activePeriod.label)
    const body = filteredRecords.map((entry) => [
      new Date(entry.date).toLocaleDateString('en-NG'),
      new Date(entry.date).toLocaleTimeString('en-NG', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      entry.ref ?? '',
      entry.description ?? '',
      entry.source === 'order' ? 'Order' : 'Payout',
      entry.staff ?? '',
      entry.method ?? '',
      entry.credit ? formatMoney(entry.credit) : '',
      entry.debit ? formatMoney(entry.debit) : '',
      formatMoney(entry.balance),
    ])
    addTable(
      doc,
      [
        'Date',
        'Time',
        'Ref',
        'Description',
        'Source',
        'Staff',
        'Method',
        'Credit',
        'Debit',
        'Balance',
      ],
      body
    )
    savePDF(doc, `ledger-${activePeriod.label}-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  const printSelectedOrder = () => {
    if (selectedEntry?.source !== 'order') return
    setReceiptOrder(selectedEntry.order)
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-gray-400 text-xs">Ledger period</p>
            <p className="text-white font-bold text-lg">{activePeriod.label}</p>
            <p className="text-gray-500 text-xs mt-1">
              {filteredRecords.length} entries · {orderCount} orders
            </p>
            <p className="text-gray-600 text-[11px] mt-1">Session window: 8:00am to 8:00am</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilterMode('prev-day')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${filterMode === 'prev-day' ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-300 border border-gray-700 hover:text-white'}`}
            >
              Previous Day
            </button>
            <button
              onClick={() => setFilterMode('single')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${filterMode === 'single' ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-300 border border-gray-700 hover:text-white'}`}
            >
              Single Date
            </button>
            <button
              onClick={() => setFilterMode('range')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${filterMode === 'range' ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-300 border border-gray-700 hover:text-white'}`}
            >
              Date Range
            </button>
            <button
              onClick={() => void fetchLedger()}
              className="flex items-center gap-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-200 hover:text-white px-3 py-2 rounded-xl transition-colors"
            >
              <RefreshCw size={12} /> Refresh
            </button>
            <button
              onClick={exportPDF}
              className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2 rounded-xl transition-colors"
            >
              <Download size={12} /> Export PDF
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {filterMode === 'single' && (
            <label className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-300">
              <CalendarDays size={14} className="text-gray-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="bg-transparent text-white focus:outline-none"
              />
            </label>
          )}
          {filterMode === 'range' && (
            <>
              <label className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-300">
                <CalendarDays size={14} className="text-gray-500" />
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className="bg-transparent text-white focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-300">
                <CalendarDays size={14} className="text-gray-500" />
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className="bg-transparent text-white focus:outline-none"
                />
              </label>
            </>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-[220px] bg-gray-950 border border-gray-800 rounded-xl px-3 py-2">
            <Search size={14} className="text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by ref, table, waiter, item, method..."
              className="w-full bg-transparent text-white text-sm focus:outline-none"
            />
          </div>
          <div className="ml-auto text-right min-w-[140px]">
            <p className="text-gray-500 text-xs">Closing Balance</p>
            <p
              className={`font-bold text-lg ${closingBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {formatMoney(closingBalance)}
            </p>
            <p className="text-[11px] text-gray-600 mt-1">Global accounting filter: {dateRange}</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/50">
                {[
                  'Date',
                  'Time',
                  'Ref',
                  'Source',
                  'Description',
                  'Orders / Recipient',
                  'Method',
                  'Credit',
                  'Debit',
                  'Balance',
                  'Action',
                ].map((heading) => (
                  <th
                    key={heading}
                    className="text-left text-gray-500 text-xs uppercase tracking-wide px-4 py-3 font-medium whitespace-nowrap"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-amber-500 text-sm">
                    Loading ledger...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-gray-600 text-sm">
                    No ledger entries for this selection
                  </td>
                </tr>
              ) : (
                filteredRecords.map((entry, index) => {
                  const itemCount =
                    entry.source === 'order' ? getValidOrderItemCount(entry.order) : 0

                  return (
                    <tr
                      key={`${entry.source}-${entry.id}-${index}`}
                      className={`border-b border-gray-800 last:border-0 ${index % 2 === 0 ? '' : 'bg-gray-800/20'}`}
                    >
                      <td className="px-4 py-3 text-gray-300 text-sm whitespace-nowrap">
                        {new Date(entry.date).toLocaleDateString('en-NG')}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">
                        {new Date(entry.date).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs font-mono whitespace-nowrap">
                        {entry.ref}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-lg ${entry.source === 'order' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}
                        >
                          {entry.source === 'order' ? 'Order' : 'Payout'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white text-sm">{entry.description}</td>
                      <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">
                        {entry.source === 'order'
                          ? `${itemCount} item${itemCount === 1 ? '' : 's'}`
                          : entry.staff || 'System'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap capitalize">
                        {entry.method || '—'}
                      </td>
                      <td className="px-4 py-3 text-green-400 font-semibold text-sm whitespace-nowrap">
                        {entry.credit > 0 ? formatMoney(entry.credit) : '—'}
                      </td>
                      <td className="px-4 py-3 text-red-400 font-semibold text-sm whitespace-nowrap">
                        {entry.debit > 0 ? formatMoney(entry.debit) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-200 text-sm whitespace-nowrap">
                        {formatMoney(entry.balance)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {entry.source === 'order' ? (
                          <button
                            onClick={() => setSelectedEntry(entry)}
                            className="text-xs bg-gray-800 border border-gray-700 hover:border-amber-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Inspect Order
                          </button>
                        ) : (
                          <button
                            onClick={() => setSelectedEntry(entry)}
                            className="text-xs bg-gray-800 border border-gray-700 hover:border-gray-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            View Entry
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEntry && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div>
                <h3 className="text-white font-bold">
                  {selectedEntry.source === 'order'
                    ? 'Ledger Order Details'
                    : 'Ledger Entry Details'}
                </h3>
                <p className="text-gray-500 text-xs mt-1">{selectedEntry.ref}</p>
              </div>
              <button
                onClick={() => setSelectedEntry(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    label: 'Date',
                    value: new Date(selectedEntry.date).toLocaleDateString('en-NG'),
                  },
                  {
                    label: 'Time',
                    value: new Date(selectedEntry.date).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }),
                  },
                  { label: 'Description', value: selectedEntry.description },
                  { label: 'Staff', value: selectedEntry.staff || 'System' },
                  { label: 'Method', value: selectedEntry.method || '—' },
                  { label: 'Balance', value: formatMoney(selectedEntry.balance) },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="bg-gray-950 border border-gray-800 rounded-xl px-4 py-3"
                  >
                    <p className="text-gray-500 text-xs">{row.label}</p>
                    <p className="text-white text-sm font-medium mt-1">{row.value}</p>
                  </div>
                ))}
              </div>

              {selectedEntry.source === 'order' ? (
                <>
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-gray-500 text-xs">Order Taken</p>
                        <p className="text-white text-sm font-medium">
                          {selectedEntry.order.tables?.name || selectedEntry.order.order_type}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs">Total</p>
                        <p className="text-amber-400 text-lg font-bold">
                          {formatMoney(selectedEntry.credit)}
                        </p>
                      </div>
                    </div>
                    <p className="text-gray-400 text-xs">
                      Order ID: {selectedEntry.order.id} · Status: {selectedEntry.order.status}
                    </p>
                  </div>

                  <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                      <p className="text-white font-semibold text-sm">Items Ordered</p>
                    </div>
                    <div className="divide-y divide-gray-800">
                      {getValidOrderItems(selectedEntry.order).map((item) => (
                        <div
                          key={item.id}
                          className="px-4 py-3 flex items-start justify-between gap-3"
                        >
                          <div>
                            <p className="text-white text-sm font-medium">
                              {item.quantity}x{' '}
                              {item.menu_items?.name || item.modifier_notes || 'Item'}
                            </p>
                            <p className="text-gray-500 text-xs mt-1">
                              {item.destination || 'station not set'}
                            </p>
                          </div>
                          <p className="text-amber-400 text-sm font-semibold">
                            {formatMoney(item.total_price || 0)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <p className="text-gray-500 text-xs">Payout / expense amount</p>
                  <p className="text-red-400 text-lg font-bold mt-1">
                    {formatMoney(selectedEntry.debit)}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-800 flex items-center justify-end gap-2">
              {selectedEntry.source === 'order' && (
                <button
                  onClick={printSelectedOrder}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-xl transition-colors"
                >
                  <Printer size={14} /> Print Receipt
                </button>
              )}
              <button
                onClick={() => setSelectedEntry(null)}
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptOrder && (
        <ReceiptModal
          order={receiptOrder}
          table={(receiptOrder.tables as Table | null) ?? null}
          items={receiptOrder.order_items || []}
          staffName={receiptOrder.profiles?.full_name || 'Staff'}
          autoPrint={false}
          onClose={() => setReceiptOrder(null)}
        />
      )}
    </div>
  )
}
