import { useState, useEffect, useCallback } from 'react'
import { Beer, ChefHat, Printer, RefreshCw, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchZoneUnitsPerSale, chillerQty } from '../../lib/zoneUnits'

const todayStr = () => {
  const now = new Date()
  const wat = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

interface StockRow {
  id: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  void_qty: number
  note?: string
}

interface DisplayRow extends StockRow {
  sold: number
  closing: number
}

interface Props {
  type: 'bar' | 'kitchen'
}

export default function StockSummaryTab({ type }: Props) {
  const [date, setDate] = useState(todayStr())
  const [rows, setRows] = useState<DisplayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stationSales, setStationSales] = useState<{
    revenue: number
    qty: number
    byZone: Record<string, number>
  }>({ revenue: 0, qty: 0, byZone: {} })

  const tableName = type === 'bar' ? 'bar_chiller_stock' : 'kitchen_stock'
  const destination = type === 'bar' ? 'bar' : 'kitchen'
  const label = type === 'bar' ? 'Bar Chiller' : 'Kitchen'
  const Icon = type === 'bar' ? Beer : ChefHat

  const fetchData = useCallback(
    async (d: string) => {
      setLoading(true)

      // 8am-8am window for POS sold data
      const dayStart = new Date(d + 'T08:00:00+01:00')
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      const [entriesRes, soldRes, zoneUnits] = await Promise.all([
        supabase
          .from(tableName)
          .select('id, item_name, unit, opening_qty, received_qty, void_qty, note')
          .eq('date', d)
          .order('item_name'),
        supabase
          .from('order_items')
          .select(
            'quantity, unit_price, total_price, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(table_categories(name), category_id))'
          )
          .eq('destination', destination)
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
        fetchZoneUnitsPerSale(),
      ])

      // Build sold map + revenue from live POS data
      const soldMap: Record<string, number> = {}
      let salesRev = 0,
        salesQty = 0
      const zoneRev: Record<string, number> = {}
      if (soldRes.data) {
        for (const item of soldRes.data as unknown as Array<{
          quantity: number
          unit_price: number
          total_price: number
          status: string
          return_accepted?: boolean
          menu_item_id?: string | null
          menu_items: { name: string } | null
          orders: {
            status: string
            tables?: {
              table_categories?: { name: string } | null
              category_id?: string | null
            } | null
          } | null
        }>) {
          if (item.return_accepted) continue
          if (item.orders?.status === 'cancelled') continue
          if (item.status === 'cancelled') continue
          const name = item.menu_items?.name
          const rev = item.total_price || (item.unit_price || 0) * (item.quantity || 0)
          const zone = item.orders?.tables?.table_categories?.name || 'Takeaway'
          const categoryId = item.orders?.tables?.category_id ?? null
          if (name) {
            const units = chillerQty(item.quantity, zoneUnits, item.menu_item_id, categoryId)
            soldMap[name] = (soldMap[name] || 0) + units
            salesRev += rev
            salesQty += units
            zoneRev[zone] = (zoneRev[zone] || 0) + rev
          }
        }
      }
      setStationSales({ revenue: salesRev, qty: salesQty, byZone: zoneRev })

      // Build display rows — use DB entries directly, overlay live sold
      const entries = (entriesRes.data || []) as StockRow[]
      const display: DisplayRow[] = entries.map((e) => {
        const sold = soldMap[e.item_name] || 0
        const closing = Math.max(0, e.opening_qty + e.received_qty - sold - e.void_qty)
        return { ...e, sold, closing }
      })

      // Add synthetic rows for items sold but not in stock register
      const entryNames = new Set(entries.map((e) => e.item_name))
      for (const [name, qty] of Object.entries(soldMap)) {
        if (!entryNames.has(name)) {
          display.push({
            id: `sold-${name}`,
            item_name: name,
            unit: '',
            opening_qty: 0,
            received_qty: 0,
            void_qty: 0,
            sold: qty,
            closing: 0,
            note: 'Sold without stock entry',
          })
        }
      }

      display.sort((a, b) => a.item_name.localeCompare(b.item_name))
      setRows(display)
      setLoading(false)
    },
    [tableName, destination]
  )

  useEffect(() => {
    fetchData(date)
  }, [date, fetchData])

  const totalOpening = rows.reduce((s, r) => s + r.opening_qty, 0)
  const totalReceived = rows.reduce((s, r) => s + r.received_qty, 0)
  const totalSold = rows.reduce((s, r) => s + r.sold, 0)
  const totalVoid = rows.reduce((s, r) => s + r.void_qty, 0)
  const totalClosing = rows.reduce((s, r) => s + r.closing, 0)

  const filtered = rows.filter((r) => r.item_name.toLowerCase().includes(search.toLowerCase()))

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(date).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr(`${label.toUpperCase()} STOCK REPORT`),
      div,
      row('Date:', fmtDate),
      row('Items:', String(rows.length)),
      div,
      row('Opening:', String(totalOpening)),
      row('Received:', String(totalReceived)),
      row('Sold (POS):', String(totalSold)),
      row('Void:', String(totalVoid)),
      row('Closing:', String(totalClosing)),
      sol,
      div,
      ctr('ITEM BREAKDOWN'),
      div,
      ...rows.map((r) =>
        [
          row(r.item_name, `(${r.unit || '—'})`),
          row(
            `  O:${r.opening_qty} R:${r.received_qty}`,
            `S:${r.sold} V:${r.void_qty} C:${r.closing}`
          ),
          r.note ? `  ${r.note}` : '',
          '',
        ]
          .filter(Boolean)
          .join('\n')
      ),
      div,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${label} Stock — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
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
          /* */
        }
      }, 200)
  }

  return (
    <div>
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
        <button onClick={() => fetchData(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        {rows.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <Icon size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            No {label.toLowerCase()} stock data for {date}
          </p>
        </div>
      ) : (
        <>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()} items...`}
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          {stationSales.revenue > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-amber-400 text-xs font-bold uppercase tracking-wider">
                    {label} Sales Revenue
                  </p>
                  <p className="text-white text-2xl font-black mt-1">
                    ₦{stationSales.revenue.toLocaleString()}
                  </p>
                  <p className="text-gray-400 text-xs">{stationSales.qty} items sold</p>
                </div>
              </div>
              {Object.keys(stationSales.byZone).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-amber-500/20">
                  {Object.entries(stationSales.byZone)
                    .sort((a, b) => b[1] - a[1])
                    .map(([zone, rev]) => (
                      <div key={zone} className="text-center">
                        <p className="text-amber-400 font-bold text-sm">₦{rev.toLocaleString()}</p>
                        <p className="text-gray-500 text-[9px] uppercase tracking-wider">{zone}</p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              { label: 'Opening', value: totalOpening, color: 'text-white' },
              { label: 'Received', value: totalReceived, color: 'text-green-400' },
              { label: 'Sold', value: totalSold, color: 'text-blue-400' },
              { label: 'Void', value: totalVoid, color: 'text-red-400' },
              { label: 'Closing', value: totalClosing, color: 'text-cyan-400' },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-2 text-center"
              >
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-gray-500 text-[9px] uppercase tracking-wider">{k.label}</p>
              </div>
            ))}
          </div>

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
                  <th className="text-left px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="text-white px-3 py-2 font-medium">{r.item_name}</td>
                    <td className="text-gray-300 text-right px-2 py-2">{r.opening_qty}</td>
                    <td className="text-green-400 text-right px-2 py-2">{r.received_qty || '–'}</td>
                    <td className="text-blue-400 text-right px-2 py-2">{r.sold || '–'}</td>
                    <td className="text-red-400 text-right px-2 py-2">{r.void_qty || '–'}</td>
                    <td
                      className={`text-right px-2 py-2 font-bold ${r.sold > 0 ? 'text-amber-400' : 'text-cyan-400'}`}
                    >
                      {r.closing}
                    </td>
                    <td
                      className="text-gray-500 px-2 py-2 max-w-[120px] truncate"
                      title={r.note || ''}
                    >
                      {r.note || '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                  <td className="text-white px-3 py-2">TOTAL</td>
                  <td className="text-white text-right px-2 py-2">{totalOpening}</td>
                  <td className="text-green-400 text-right px-2 py-2">{totalReceived}</td>
                  <td className="text-blue-400 text-right px-2 py-2">{totalSold}</td>
                  <td className="text-red-400 text-right px-2 py-2">{totalVoid}</td>
                  <td className="text-cyan-400 text-right px-2 py-2">{totalClosing}</td>
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
