import { useState, useEffect, useCallback } from 'react'
import { Beer, RefreshCw, Printer, Wrench } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { fetchZoneUnitsPerSale, chillerQty } from '../../../lib/zoneUnits'
import BarChillerStock from '../../backoffice/BarChillerStock'

const todayStr = () => {
  const now = new Date()
  const d = new Date(now)
  if (now.getHours() < 8) d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

interface ChillerEntry {
  id: string
  date: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold_qty: number
  void_qty: number
  closing_qty: number
  note?: string
  updated_at?: string
}

const buildAcceptedReturnsMap = (
  rows: Array<{ item_name: string | null; quantity: number | null; status: string | null }>
) => {
  const map: Record<string, number> = {}
  for (const row of rows) {
    if (row.status !== 'accepted') continue
    if (!row.item_name) continue
    map[row.item_name] = (map[row.item_name] || 0) + (row.quantity || 0)
  }
  return map
}

export default function ChillerSummaryTab() {
  const { profile } = useAuth()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [date, setDate] = useState(todayStr())
  const [entries, setEntries] = useState<ChillerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [editMode, setEditMode] = useState(false)

  const fetchData = useCallback(async (d: string) => {
    setLoading(true)
    let seededRows: ChillerEntry[] | null = null

    const todayIso = new Date().toISOString().slice(0, 10)
    const base = new Date(d)
    if (d === todayIso && new Date().getHours() < 8) base.setDate(base.getDate() - 1)
    base.setHours(8, 0, 0, 0)
    const dayStart = base
    const dayEnd = new Date(base)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const dateKey = base.toISOString().slice(0, 10)

    const [entriesRes, soldRes, acceptedRes, prevRes, zoneUnits] = await Promise.all([
      supabase
        .from('bar_chiller_stock')
        .select(
          'id, date, item_name, unit, opening_qty, received_qty, sold_qty, void_qty, closing_qty, note, updated_at'
        )
        .eq('date', dateKey)
        .order('item_name'),
      supabase
        .from('order_items')
        .select(
          'quantity, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(category_id))'
        )
        .eq('destination', 'bar')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString()),
      supabase
        .from('returns_log')
        .select('item_name, quantity, status')
        .eq('status', 'accepted')
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString()),
      supabase
        .from('bar_chiller_stock')
        .select('item_name, opening_qty, received_qty, sold_qty, void_qty, closing_qty')
        .lt('date', d)
        .order('date', { ascending: false }),
      fetchZoneUnitsPerSale(),
    ])

    // Carry over from latest available date if empty
    if (!entriesRes.data || entriesRes.data.length === 0) {
      const { data: latestRows } = await supabase
        .from('bar_chiller_stock')
        .select(
          'id, date, item_name, unit, opening_qty, received_qty, sold_qty, void_qty, closing_qty, note, updated_at'
        )
        .order('date', { ascending: false })
        .limit(400)
      if (latestRows && latestRows.length > 0) {
        const latestDate = (latestRows[0] as { date: string }).date
        const prevStart = new Date(latestDate)
        prevStart.setHours(8, 0, 0, 0)
        const prevEnd = new Date(prevStart)
        prevEnd.setDate(prevEnd.getDate() + 1)
        const [{ data: prevSold }, { data: prevAccepted }, prevZoneUnits] = await Promise.all([
          supabase
            .from('order_items')
            .select(
              'quantity, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(category_id))'
            )
            .eq('destination', 'bar')
            .gte('created_at', prevStart.toISOString())
            .lte('created_at', prevEnd.toISOString()),
          supabase
            .from('returns_log')
            .select('item_name, quantity, status')
            .eq('status', 'accepted')
            .gte('requested_at', prevStart.toISOString())
            .lte('requested_at', prevEnd.toISOString()),
          fetchZoneUnitsPerSale(),
        ])
        const prevSoldMap: Record<string, number> = {}
        if (prevSold) {
          for (const item of prevSold as unknown as Array<{
            quantity: number
            status: string
            return_accepted?: boolean
            menu_item_id?: string | null
            menu_items: { name: string } | null
            orders: { status: string; tables?: { category_id?: string | null } | null } | null
          }>) {
            if (item.return_accepted) continue
            if (item.orders?.status === 'cancelled') continue
            if (item.status === 'cancelled') continue
            const name = item.menu_items?.name
            if (name) {
              const units = chillerQty(
                item.quantity,
                prevZoneUnits,
                item.menu_item_id,
                item.orders?.tables?.category_id ?? null
              )
              prevSoldMap[name] = (prevSoldMap[name] || 0) + units
            }
          }
        }
        const prevAcceptedMap = buildAcceptedReturnsMap(
          (prevAccepted || []) as Array<{
            item_name: string | null
            quantity: number | null
            status: string | null
          }>
        )
        for (const [name, qty] of Object.entries(prevAcceptedMap)) {
          if (!(name in prevSoldMap)) continue
          prevSoldMap[name] = Math.max(0, (prevSoldMap[name] || 0) - qty)
        }
        const rowsForLatest = latestRows.filter((r: { date: string }) => r.date === latestDate)
        const seedRows = rowsForLatest.map((r: ChillerEntry) => {
          const soldPrev =
            prevSoldMap[r.item_name] != null ? prevSoldMap[r.item_name] : r.sold_qty || 0
          const carry =
            r.closing_qty > 0
              ? r.closing_qty
              : Math.max(
                  0,
                  (r.opening_qty || 0) + (r.received_qty || 0) - soldPrev - (r.void_qty || 0)
                )
          return {
            id:
              r.id ||
              (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : Math.random().toString(36).slice(2)),
            date: dateKey,
            item_name: r.item_name,
            unit: r.unit,
            opening_qty: carry,
            received_qty: 0,
            sold_qty: 0,
            void_qty: 0,
            closing_qty: carry,
            note: r.note,
            updated_at: new Date().toISOString(),
          }
        })
        if (seedRows.length > 0) {
          const { data: inserted, error } = await supabase
            .from('bar_chiller_stock')
            .insert(seedRows)
            .select(
              'id, date, item_name, unit, opening_qty, received_qty, sold_qty, void_qty, closing_qty, note, updated_at'
            )
          seededRows = (inserted || seedRows) as ChillerEntry[]
          if (error) console.warn('Carryover insert failed', error.message)
        }
      }
    }

    // Build carry-over map — last known closing for each item
    const carryOver: Record<string, number> = {}
    const seen = new Set<string>()
    if (prevRes.data) {
      for (const row of prevRes.data as Array<{
        item_name: string
        opening_qty: number
        received_qty: number
        sold_qty: number
        void_qty: number
        closing_qty: number
      }>) {
        if (seen.has(row.item_name)) continue
        seen.add(row.item_name)
        carryOver[row.item_name] =
          row.closing_qty > 0
            ? row.closing_qty
            : Math.max(0, row.opening_qty + row.received_qty - (row.sold_qty || 0) - row.void_qty)
      }
    }

    const map: Record<string, number> = {}
    if (soldRes.data) {
      for (const item of soldRes.data as unknown as Array<{
        quantity: number
        status: string
        return_accepted?: boolean
        menu_item_id?: string | null
        menu_items: { name: string } | null
        orders: { status: string; tables?: { category_id?: string | null } | null } | null
      }>) {
        if (item.return_accepted) continue
        if (item.orders?.status === 'cancelled') continue
        if (item.status === 'cancelled') continue
        const name = item.menu_items?.name
        if (name) {
          const units = chillerQty(
            item.quantity,
            zoneUnits,
            item.menu_item_id,
            item.orders?.tables?.category_id ?? null
          )
          map[name] = (map[name] || 0) + units
        }
      }
    }
    const acceptedMap = buildAcceptedReturnsMap(
      (acceptedRes.data || []) as Array<{
        item_name: string | null
        quantity: number | null
        status: string | null
      }>
    )
    for (const [name, qty] of Object.entries(acceptedMap)) {
      if (!(name in map)) continue
      map[name] = Math.max(0, (map[name] || 0) - qty)
    }
    setSoldMap(map)

    const rawEntries = (seededRows || entriesRes.data || []) as ChillerEntry[]
    const withCarry = rawEntries.map((e) => ({
      ...e,
      opening_qty:
        e.opening_qty === 0 && carryOver[e.item_name] != null
          ? carryOver[e.item_name]
          : e.opening_qty,
      sold_qty: map[e.item_name] ?? e.sold_qty ?? 0,
    }))

    // Add synthetic rows for items that sold but weren't in the register to surface variance
    const missingSold = Object.keys(map).filter(
      (name) => !withCarry.find((e) => e.item_name === name)
    )
    const synthetic: ChillerEntry[] = missingSold.map((name) => ({
      id: `synthetic-${name}`,
      date: dateKey,
      item_name: name,
      unit: '',
      opening_qty: 0,
      received_qty: 0,
      sold_qty: map[name],
      void_qty: 0,
      closing_qty: 0,
      note: 'Auto-added (sold without stock entry)',
      updated_at: new Date().toISOString(),
    }))

    setEntries([...withCarry, ...synthetic])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchData(date)
  }, [date, fetchData])

  const getEffectiveClosing = (e: ChillerEntry) => {
    // Prefer the recorded closing (even zero) to surface variance; only fall back if missing
    if (e.closing_qty !== null && e.closing_qty !== undefined) return e.closing_qty
    const sold = soldMap[e.item_name] || e.sold_qty || 0
    return Math.max(0, e.opening_qty + e.received_qty - sold - e.void_qty)
  }

  const carryTotal = entries.reduce((s, e) => s + e.opening_qty, 0)
  const totalOpening = carryTotal
  const totalReceived = entries.reduce((s, e) => s + e.received_qty, 0)
  const totalSold = entries.reduce((s, e) => s + (soldMap[e.item_name] || e.sold_qty || 0), 0)
  const totalVoid = entries.reduce((s, e) => s + e.void_qty, 0)
  const totalClosing = entries.reduce((s, e) => s + getEffectiveClosing(e), 0)
  const totalExpected = totalOpening + totalReceived - totalSold - totalVoid
  const totalVariance = totalExpected - totalClosing

  if (editMode && isManager) {
    return <BarChillerStock onBack={() => setEditMode(false)} embedded />
  }

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('BAR CHILLER REPORT'),
      div,
      row('Date:', date),
      row('Items:', String(entries.length)),
      div,
      row('Total Opening:', String(totalOpening)),
      row('Total Received:', String(totalReceived)),
      row('Total Sold (POS):', String(totalSold)),
      row('Total Void:', String(totalVoid)),
      row('Total Closing:', String(totalClosing)),
      sol,
      row('Expected:', String(totalExpected)),
      row('Variance:', String(totalVariance)),
      sol,
      div,
      ctr('ITEM BREAKDOWN'),
      div,
      ...entries.map((e) => {
        const sold = soldMap[e.item_name] || e.sold_qty || 0
        const expected = e.opening_qty + e.received_qty - sold - e.void_qty
        const variance = expected - e.closing_qty
        return [
          row(e.item_name, `(${e.unit})`),
          row(
            `  Open:${e.opening_qty} +Rcvd:${e.received_qty}`,
            `-Sold:${sold} -Void:${e.void_qty}`
          ),
          row(
            `  Expected:${expected}`,
            `Actual:${e.closing_qty} Var:${variance > 0 ? '-' : '+'}${Math.abs(variance)}`
          ),
          e.note ? `  Note: ${e.note}` : '',
          '',
        ]
          .filter(Boolean)
          .join('\n')
      }),
      div,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Chiller Report — ${date}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    w.onafterprint = () => w.close()
    w.onload = () =>
      setTimeout(() => {
        try {
          w.print()
        } catch {
          /* closed */
        }
      }, 200)
  }

  return (
    <div>
      {/* Date controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setDate(todayStr())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === todayStr() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() + 1)
            if (d <= new Date()) setDate(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Next Day
        </button>
        <button onClick={() => fetchData(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        {isManager && (
          <button
            onClick={() => setEditMode(true)}
            className="flex items-center gap-1 px-3 py-2 bg-gray-900 border border-gray-800 text-gray-300 hover:text-white rounded-xl text-xs transition-colors"
          >
            <Wrench size={12} /> Manage stock
          </button>
        )}
        {entries.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors ml-auto"
          >
            <Printer size={12} /> Print Report
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <Beer size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No chiller data for {date}</p>
          <p className="text-gray-600 text-xs mt-1">Barman hasn't entered stock for this date</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {[
              { label: 'Opening', value: totalOpening, color: 'text-white' },
              { label: 'Received', value: totalReceived, color: 'text-green-400' },
              { label: 'Sold', value: totalSold, color: 'text-blue-400' },
              { label: 'Void', value: totalVoid, color: 'text-red-400' },
              { label: 'Closing', value: totalClosing, color: 'text-cyan-400' },
              {
                label: 'Variance',
                value: totalVariance,
                color:
                  totalVariance > 0
                    ? 'text-red-400'
                    : totalVariance < 0
                      ? 'text-blue-400'
                      : 'text-green-400',
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-2 text-center"
              >
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>

          {/* Item table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-2 py-2">Open</th>
                  <th className="text-right px-2 py-2">Rcvd</th>
                  <th className="text-right px-2 py-2">Sold</th>
                  <th className="text-right px-2 py-2">Void</th>
                  <th className="text-right px-2 py-2">Close</th>
                  <th className="text-right px-2 py-2">Var</th>
                  <th className="text-left px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const sold = soldMap[e.item_name] || e.sold_qty || 0
                  const expected = e.opening_qty + e.received_qty - sold - e.void_qty
                  const effectiveClose = getEffectiveClosing(e)
                  const variance = expected - effectiveClose
                  return (
                    <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="text-white px-3 py-2 font-medium">{e.item_name}</td>
                      <td className="text-gray-300 text-right px-2 py-2">{e.opening_qty}</td>
                      <td className="text-green-400 text-right px-2 py-2">
                        {e.received_qty || '–'}
                      </td>
                      <td className="text-blue-400 text-right px-2 py-2">{sold || '–'}</td>
                      <td className="text-red-400 text-right px-2 py-2">{e.void_qty || '–'}</td>
                      <td className="text-cyan-400 text-right px-2 py-2 font-bold">
                        {effectiveClose}
                      </td>
                      <td
                        className={`text-right px-2 py-2 font-bold ${variance > 0 ? 'text-red-400' : variance < 0 ? 'text-blue-400' : 'text-green-400'}`}
                      >
                        {variance === 0
                          ? '✓'
                          : variance > 0
                            ? `−${variance}`
                            : `+${Math.abs(variance)}`}
                      </td>
                      <td
                        className="text-gray-500 px-2 py-2 max-w-[120px] truncate"
                        title={e.note || ''}
                      >
                        {e.note || '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                  <td className="text-white px-3 py-2">TOTAL</td>
                  <td className="text-white text-right px-2 py-2">{totalOpening}</td>
                  <td className="text-green-400 text-right px-2 py-2">{totalReceived}</td>
                  <td className="text-blue-400 text-right px-2 py-2">{totalSold}</td>
                  <td className="text-red-400 text-right px-2 py-2">{totalVoid}</td>
                  <td className="text-cyan-400 text-right px-2 py-2">{totalClosing}</td>
                  <td
                    className={`text-right px-2 py-2 ${totalVariance > 0 ? 'text-red-400' : totalVariance < 0 ? 'text-blue-400' : 'text-green-400'}`}
                  >
                    {totalVariance === 0
                      ? '✓'
                      : totalVariance > 0
                        ? `−${totalVariance}`
                        : `+${Math.abs(totalVariance)}`}
                  </td>
                  <td className="px-2 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
