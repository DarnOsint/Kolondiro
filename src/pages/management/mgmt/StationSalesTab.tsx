import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Printer } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface SaleRow {
  item_name: string
  qty: number
  revenue: number
  zone: string
  waitron: string
  time: string
}

const inferDestination = (row: any): string => {
  const normalize = (d: string) => {
    const v = (d || '').toString().trim().toLowerCase()
    if (!v) return ''
    if (v === 'kitchen') return 'kitchen'
    if (v === 'griller' || v === 'grill' || v === 'grilling') return 'griller'
    if (v === 'bar') return 'bar'
    if (v === 'shisha' || v === 'hookah') return 'shisha'
    if (v === 'games' || v === 'game' || v === 'games_master' || v === 'gamesmaster') return 'games'
    if (
      v === 'mixologist' ||
      v === 'cocktail' ||
      v === 'cocktails' ||
      v === 'mocktail' ||
      v === 'mocktails'
    )
      return 'mixologist'
    return v
  }

  const raw = normalize(row?.destination || row?.menu_items?.menu_categories?.destination || '')
  if (raw) return raw
  const name = (row?.menu_items?.name || '').toLowerCase()
  const catName = (row?.menu_items?.menu_categories?.name || '').toLowerCase()
  if (catName.includes('kitchen') || name.includes('kitchen')) return 'kitchen'
  if (catName.includes('grill') || name.includes('grill')) return 'griller'
  if (catName.includes('shisha') || name.includes('shisha') || name.includes('hookah'))
    return 'shisha'
  if (catName.includes('game') || name.includes('game')) return 'games'
  const looksMixo =
    name.includes('cocktail') ||
    name.includes('mocktail') ||
    name.includes('chapman') ||
    name.includes('sunrise') ||
    name.includes('colada') ||
    name.includes('mojito') ||
    name.includes('milkshake') ||
    name.includes('shake') ||
    name.includes('smoothie') ||
    name.includes('fruit punch') ||
    name.includes('punch') ||
    catName.includes('cocktail') ||
    catName.includes('mocktail') ||
    catName.includes('chapman') ||
    catName.includes('sunrise') ||
    catName.includes('colada') ||
    catName.includes('mojito') ||
    catName.includes('milkshake') ||
    catName.includes('shake') ||
    catName.includes('smoothie') ||
    catName.includes('punch')
  if (looksMixo) return 'mixologist'
  return 'bar'
}

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

interface Props {
  destination: string
  label: string
}

export default function StationSalesTab({ destination, label }: Props) {
  const [date, setDate] = useState(todayWAT())
  const [sales, setSales] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState({
    revenue: 0,
    qty: 0,
    byZone: {} as Record<string, number>,
    byWaitron: {} as Record<string, { qty: number; rev: number }>,
  })

  const fetchData = useCallback(
    async (d: string) => {
      setLoading(true)
      const dayStart = new Date(d + 'T08:00:00+01:00')
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      const { data } = await supabase
        .from('order_items')
        .select(
          'quantity, unit_price, total_price, status, return_accepted, created_at, destination, menu_items(name, menu_categories(name, destination)), orders(status, profiles(full_name), tables(name, table_categories(name)))'
        )
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false })

      const rows: SaleRow[] = []
      let totalRev = 0,
        totalQty = 0
      const byZone: Record<string, number> = {}
      const byWaitron: Record<string, { qty: number; rev: number }> = {}

      for (const item of (data || []) as any[]) {
        if (item.return_accepted) continue
        if (item.orders?.status === 'cancelled') continue
        if (item.status === 'cancelled') continue
        if (inferDestination(item) !== destination) continue
        const name = item.menu_items?.name || 'Item'
        const rev = item.total_price || (item.unit_price || 0) * (item.quantity || 0)
        const zone = item.orders?.tables?.table_categories?.name || 'Takeaway'
        const waitron = item.orders?.profiles?.full_name || 'Unknown'
        const time = new Date(item.created_at).toLocaleTimeString('en-SS', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Africa/Lagos',
        })

        rows.push({ item_name: name, qty: item.quantity, revenue: rev, zone, waitron, time })
        totalRev += rev
        totalQty += item.quantity
        byZone[zone] = (byZone[zone] || 0) + rev
        if (!byWaitron[waitron]) byWaitron[waitron] = { qty: 0, rev: 0 }
        byWaitron[waitron].qty += item.quantity
        byWaitron[waitron].rev += rev
      }

      setSales(rows)
      setTotals({ revenue: totalRev, qty: totalQty, byZone, byWaitron })
      setLoading(false)
    },
    [destination]
  )

  useEffect(() => {
    fetchData(date)
  }, [date, fetchData])

  const printReport = () => {
    const W = 44
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const r = (l: string, rv: string) => {
      const left = l.substring(0, W - rv.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - rv.length)) + rv
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr(`${label.toUpperCase()} SALES`),
      div,
      r(
        'Date:',
        new Date(date).toLocaleDateString('en-SS', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      ),
      r('Total Items:', String(totals.qty)),
      r('Total Revenue:', `N${totals.revenue.toLocaleString()}`),
      div,
      ctr('BY WAITRON'),
      div,
      ...Object.entries(totals.byWaitron)
        .sort((a, b) => b[1].rev - a[1].rev)
        .map(([name, v]) => r(name, `${v.qty} items N${v.rev.toLocaleString()}`)),
      div,
      ctr('BY ZONE'),
      div,
      ...Object.entries(totals.byZone)
        .sort((a, b) => b[1] - a[1])
        .map(([zone, rev]) => r(zone, `N${rev.toLocaleString()}`)),
      sol,
      r('TOTAL:', `N${totals.revenue.toLocaleString()}`),
      sol,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${label} Sales</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayWAT()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm"
        />
        <button
          onClick={() => setDate(todayWAT())}
          className={`px-3 py-2 rounded-xl text-xs font-medium ${date === todayWAT() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toLocaleDateString('en-CA'))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white"
        >
          Prev Day
        </button>
        <button onClick={() => fetchData(date)} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
        {sales.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {/* Revenue Banner */}
      {totals.revenue > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <p className="text-amber-400 text-xs font-bold uppercase tracking-wider">
            {label} Sales Revenue
          </p>
          <p className="text-white text-2xl font-black mt-1">SSP{totals.revenue.toLocaleString()}</p>
          <p className="text-gray-400 text-xs">{totals.qty} items given out</p>
          {Object.keys(totals.byZone).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-amber-500/20">
              {Object.entries(totals.byZone)
                .sort((a, b) => b[1] - a[1])
                .map(([zone, rev]) => (
                  <div key={zone} className="text-center">
                    <p className="text-amber-400 font-bold text-sm">SSP{rev.toLocaleString()}</p>
                    <p className="text-gray-500 text-[9px] uppercase tracking-wider">{zone}</p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* By Waitron */}
      {Object.keys(totals.byWaitron).length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-white text-sm font-bold mb-2">Given to Waitrons</p>
          {Object.entries(totals.byWaitron)
            .sort((a, b) => b[1].rev - a[1].rev)
            .map(([name, v]) => (
              <div
                key={name}
                className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0"
              >
                <span className="text-gray-300 text-sm">{name}</span>
                <span className="text-amber-400 text-sm font-bold">
                  {v.qty} items · SSP{v.rev.toLocaleString()}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Item list */}
      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : sales.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No {label.toLowerCase()} orders for {date === todayWAT() ? 'today' : date}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-2 py-2">Qty</th>
                <th className="text-right px-2 py-2">Revenue</th>
                <th className="text-left px-2 py-2">Zone</th>
                <th className="text-left px-2 py-2">Waitron</th>
                <th className="text-left px-2 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/50">
                  <td className="text-white px-3 py-2 font-medium">{s.item_name}</td>
                  <td className="text-blue-400 text-right px-2 py-2">{s.qty}</td>
                  <td className="text-amber-400 text-right px-2 py-2">
                    SSP{s.revenue.toLocaleString()}
                  </td>
                  <td className="text-gray-400 px-2 py-2">{s.zone}</td>
                  <td className="text-gray-300 px-2 py-2">{s.waitron}</td>
                  <td className="text-gray-500 px-2 py-2">{s.time}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold">
                <td className="text-white px-3 py-2">TOTAL</td>
                <td className="text-blue-400 text-right px-2 py-2">{totals.qty}</td>
                <td className="text-amber-400 text-right px-2 py-2">
                  SSP{totals.revenue.toLocaleString()}
                </td>
                <td colSpan={3} className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
