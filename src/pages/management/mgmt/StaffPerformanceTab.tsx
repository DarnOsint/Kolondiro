import { useState, useEffect, useCallback } from 'react'
import { Trophy, RefreshCw, Download, Printer } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

type Period = 'today' | 'week' | 'month' | 'quarter'

interface WaitronRow {
  name: string
  orders: number
  revenue: number
  items: number
  avgOrder: number
}

function getRange(period: Period) {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const start = new Date(wat)
  start.setHours(8, 0, 0, 0)
  if (wat.getHours() < 8) start.setDate(start.getDate() - 1)

  if (period === 'today') {
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start: start.toISOString(), end: end.toISOString(), label: 'Today' }
  }
  if (period === 'week') {
    const s = new Date(start)
    s.setDate(s.getDate() - s.getDay()) // Sunday
    s.setHours(8, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start: s.toISOString(), end: end.toISOString(), label: 'This Week' }
  }
  if (period === 'month') {
    const s = new Date(start.getFullYear(), start.getMonth(), 1)
    s.setHours(8, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start: s.toISOString(), end: end.toISOString(), label: 'This Month' }
  }
  // quarter
  const qMonth = Math.floor(start.getMonth() / 3) * 3
  const s = new Date(start.getFullYear(), qMonth, 1)
  s.setHours(8, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: s.toISOString(), end: end.toISOString(), label: 'This Quarter' }
}

export default function StaffPerformanceTab() {
  const [period, setPeriod] = useState<Period>('today')
  const [rows, setRows] = useState<WaitronRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { start, end } = getRange(period)

    const { data: orders } = await supabase
      .from('orders')
      .select(
        'id, total_amount, staff_id, profiles(full_name), order_items(quantity, total_price, return_requested, return_accepted, status)'
      )
      .eq('status', 'paid')
      .gte('closed_at', start)
      .lt('closed_at', end)

    const map: Record<string, WaitronRow> = {}
    for (const o of (orders || []) as any[]) {
      const name = o.profiles?.full_name || 'Unknown'
      if (!map[name]) map[name] = { name, orders: 0, revenue: 0, items: 0, avgOrder: 0 }
      map[name].orders++
      const validItems = (o.order_items || []).filter(
        (i: any) =>
          !i.return_requested &&
          !i.return_accepted &&
          (i.status || '').toLowerCase() !== 'cancelled'
      )
      const orderRev = validItems.reduce((s: number, i: any) => s + (i.total_price || 0), 0)
      map[name].revenue += orderRev
      map[name].items += validItems.reduce((s: number, i: any) => s + (i.quantity || 0), 0)
    }
    const sorted = Object.values(map)
      .map((r) => ({ ...r, avgOrder: r.orders > 0 ? Math.round(r.revenue / r.orders) : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
    setRows(sorted)
    setLoading(false)
  }, [period])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0)
  const totalItems = rows.reduce((s, r) => s + r.items, 0)

  const exportCsv = () => {
    const { label } = getRange(period)
    const lines = [
      ['Rank', 'Waitron', 'Orders', 'Items', 'Revenue', 'Avg Order', '% of Total'],
      ...rows.map((r, i) => [
        String(i + 1),
        r.name,
        String(r.orders),
        String(r.items),
        String(r.revenue),
        String(r.avgOrder),
        totalRevenue ? String(Math.round((r.revenue / totalRevenue) * 100)) + '%' : '0%',
      ]),
    ]
    const csv = lines.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `staff_performance_${label.replace(/\s+/g, '_').toLowerCase()}.csv`
    a.click()
  }

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
      ctr('STAFF PERFORMANCE'),
      div,
      r('Period:', label),
      r('Staff Count:', String(rows.length)),
      r('Total Revenue:', `N${totalRevenue.toLocaleString()}`),
      r('Total Orders:', String(totalOrders)),
      div,
      '',
      ...rows.map((row, i) => {
        const pct = totalRevenue ? Math.round((row.revenue / totalRevenue) * 100) : 0
        return [
          r(`${i + 1}. ${row.name}`, `N${row.revenue.toLocaleString()}`),
          r(
            `   ${row.orders} orders · ${row.items} items`,
            `avg N${row.avgOrder.toLocaleString()} · ${pct}%`
          ),
          '',
        ].join('\n')
      }),
      sol,
      r('TOTAL:', `N${totalRevenue.toLocaleString()}`),
      sol,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Staff Performance — ${label}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
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

  const { label } = getRange(period)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-white font-bold text-lg flex items-center gap-2">
          <Trophy size={18} className="text-amber-400" /> Staff Performance
        </h3>
        {(['today', 'week', 'month', 'quarter'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors capitalize ${period === p ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
          >
            {p === 'today'
              ? 'Today'
              : p === 'week'
                ? 'This Week'
                : p === 'month'
                  ? 'This Month'
                  : 'Quarter'}
          </button>
        ))}
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
        {rows.length > 0 && (
          <>
            <button
              onClick={printReport}
              className="flex items-center gap-1 px-3 py-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-xl text-xs ml-auto"
            >
              <Printer size={13} /> Print
            </button>
            <button
              onClick={exportCsv}
              className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-xl"
            >
              <Download size={14} />
            </button>
          </>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: 'Total Revenue',
            value: `₦${totalRevenue.toLocaleString()}`,
            color: 'text-amber-400',
          },
          { label: 'Total Orders', value: totalOrders, color: 'text-white' },
          { label: 'Total Items', value: totalItems, color: 'text-blue-400' },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
          >
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
            <p className="text-gray-500 text-[9px] uppercase tracking-wider">{k.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <Trophy size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No sales data for {label}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider text-xs">
                <th className="text-center px-2 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">Waitron</th>
                <th className="text-right px-2 py-2">Orders</th>
                <th className="text-right px-2 py-2">Items</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-2 py-2">Avg</th>
                <th className="text-right px-2 py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = totalRevenue ? Math.round((r.revenue / totalRevenue) * 100) : 0
                return (
                  <tr
                    key={r.name}
                    className={`border-t border-gray-800 ${i < 3 ? 'bg-amber-500/5' : 'hover:bg-gray-800/50'}`}
                  >
                    <td className="text-center px-2 py-2.5">
                      {i === 0 ? (
                        '🥇'
                      ) : i === 1 ? (
                        '🥈'
                      ) : i === 2 ? (
                        '🥉'
                      ) : (
                        <span className="text-gray-500 text-xs">{i + 1}</span>
                      )}
                    </td>
                    <td className="text-white px-3 py-2.5 font-medium">{r.name}</td>
                    <td className="text-gray-300 text-right px-2 py-2.5">{r.orders}</td>
                    <td className="text-blue-400 text-right px-2 py-2.5">{r.items}</td>
                    <td className="text-amber-400 text-right px-3 py-2.5 font-bold">
                      ₦{r.revenue.toLocaleString()}
                    </td>
                    <td className="text-gray-400 text-right px-2 py-2.5 text-xs">
                      ₦{r.avgOrder.toLocaleString()}
                    </td>
                    <td className="text-right px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-gray-400 text-xs w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold">
                <td className="px-2 py-2"></td>
                <td className="text-white px-3 py-2">TOTAL</td>
                <td className="text-white text-right px-2 py-2">{totalOrders}</td>
                <td className="text-blue-400 text-right px-2 py-2">{totalItems}</td>
                <td className="text-amber-400 text-right px-3 py-2">
                  ₦{totalRevenue.toLocaleString()}
                </td>
                <td className="text-gray-400 text-right px-2 py-2 text-xs">
                  ₦{totalOrders ? Math.round(totalRevenue / totalOrders).toLocaleString() : 0}
                </td>
                <td className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
