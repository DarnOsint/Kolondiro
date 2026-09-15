import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { RefreshCw, Download } from 'lucide-react'
import React from 'react'

type Dest = 'bar' | 'kitchen' | 'griller' | 'mixologist' | 'shisha' | 'games'

interface Row {
  waitron: string
  count: number
  total: number
}
interface Item {
  name: string
  qty: number
  total: number
  at: string
  dest: string
}

const dayWindow = (dateStr: string) => {
  // 8am–8am WAT window for a given YYYY-MM-DD; if date is today and time < 8am, use yesterday
  const lagosNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const base = new Date(`${dateStr}T08:00:00+01:00`)
  const todayStr = lagosNow.toISOString().slice(0, 10)
  if (dateStr === todayStr && lagosNow.getHours() < 8) {
    base.setDate(base.getDate() - 1)
  }
  const start = base
  const end = new Date(base)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export default function OrdersByWaitronTab({
  destinations,
  title,
}: {
  destinations: Dest[]
  title: string
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [itemsByWaitron, setItemsByWaitron] = useState<Record<string, Item[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modalWaitron, setModalWaitron] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  )
  const [endDate, setEndDate] = useState<string>(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  )

  const { start, end } = useMemo(() => {
    // if range spans multiple days, end is endDate+1 at 08:00
    const { start: s } = dayWindow(startDate)
    const { end: e } = dayWindow(endDate)
    return { start: s, end: e }
  }, [startDate, endDate])

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          'quantity, total_price, destination, created_at, status, return_requested, return_accepted, menu_items(name, menu_categories(destination)), orders(profiles(full_name))'
        )
        .gte('created_at', start)
        .lte('created_at', end)
      if (error) throw error

      const map: Record<string, Row> = {}
      const itemsMap: Record<string, Item[]> = {}
      ;(data || []).forEach((oi: any) => {
        const dest = (
          oi.destination ||
          oi.menu_items?.menu_categories?.destination ||
          ''
        ).toLowerCase()
        // Exclude anything returned or pending return, and cancelled items
        if (oi.return_accepted || oi.return_requested) return
        if ((oi.status || '').toLowerCase() === 'cancelled') return
        if (!destinations.includes(dest as Dest)) return
        const name = oi.orders?.profiles?.full_name || 'Unknown'
        if (!map[name]) map[name] = { waitron: name, count: 0, total: 0 }
        map[name].count += oi.quantity || 0
        map[name].total += oi.total_price || 0

        const arr = itemsMap[name] || []
        arr.push({
          name: oi.menu_items?.name || 'Item',
          qty: oi.quantity || 0,
          total: oi.total_price || 0,
          at: oi.created_at || '',
          dest,
        })
        itemsMap[name] = arr
      })
      setRows(Object.values(map).sort((a, b) => b.total - a.total))
      setItemsByWaitron(itemsMap)
    } catch (e) {
      console.warn('Load waitron orders failed:', e)
      setRows([])
      setItemsByWaitron({})
      setErrorMsg('Could not load data. Check connection and retry.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.join(','), start, end])

  useEffect(() => {
    void load()
  }, [load])

  const exportCsv = () => {
    const lines = [
      ['Waitron', 'Items', 'Value'],
      ...rows.map((r) => [r.waitron, String(r.count), String(r.total)]),
    ]
    const csv = lines
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}_${start.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-white font-bold text-lg">{title}</h3>
        <button
          onClick={load}
          className="p-2 text-gray-400 hover:text-white bg-gray-900 rounded-xl border border-gray-800"
        >
          <RefreshCw size={15} />
        </button>
        <button
          onClick={exportCsv}
          className="p-2 text-gray-400 hover:text-white bg-gray-900 rounded-xl border border-gray-800"
        >
          <Download size={15} />
        </button>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1"
          />
          <span className="text-gray-500 text-xs">to</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1"
          />
          <button
            onClick={() => {
              const d = new Date(startDate)
              d.setDate(d.getDate() - 1)
              const prev = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
              setStartDate(prev)
              setEndDate(prev)
            }}
            className="px-2 py-1 text-xs bg-gray-900 border border-gray-800 text-gray-300 rounded-lg hover:text-white"
          >
            Prev Day
          </button>
          <button
            onClick={() => {
              const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
              setStartDate(today)
              setEndDate(today)
            }}
            className="px-2 py-1 text-xs bg-amber-500 text-black rounded-lg"
          >
            Today
          </button>
        </div>
      </div>
      {loading ? (
        <div className="text-amber-500">Loading…</div>
      ) : errorMsg ? (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">
          {errorMsg}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500">No orders in this session.</div>
      ) : (
        <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-xl">
          <table className="min-w-full text-sm text-white">
            <thead className="bg-gray-800 text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Waitron</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.waitron}>
                  <tr
                    className="border-t border-gray-800 hover:bg-gray-800/60 cursor-pointer"
                    onClick={() => {
                      setExpanded(expanded === r.waitron ? null : r.waitron)
                      setModalWaitron(r.waitron)
                    }}
                  >
                    <td className="px-3 py-2">{r.waitron}</td>
                    <td className="px-3 py-2 text-right">{r.count}</td>
                    <td className="px-3 py-2 text-right">₦{r.total.toLocaleString()}</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modalWaitron && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div>
                <p className="text-white font-bold">{modalWaitron}</p>
                <p className="text-xs text-gray-500">
                  {start.slice(0, 10)} to {end.slice(0, 10)} (8am–8am WAT)
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const items = itemsByWaitron[modalWaitron] || []
                    const html = `
                      <html><head><style>
                        body{font-family:Inter,Arial,sans-serif;font-size:12px;margin:16px;}
                        h2{margin:0 0 8px;}
                        table{width:100%;border-collapse:collapse;}
                        th,td{padding:6px;border:1px solid #ddd;text-align:left;}
                      </style></head><body>
                        <h2>${modalWaitron} — Orders</h2>
                        <p>Window: ${start} to ${end} (8am–8am WAT)</p>
                        <table>
                          <thead><tr><th>Time</th><th>Item</th><th>Qty</th><th>Value</th></tr></thead>
                          <tbody>
                            ${items
                              .map(
                                (it) =>
                                  `<tr><td>${new Date(it.at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</td><td>${it.name}</td><td>${it.qty}</td><td>₦${it.total.toLocaleString()}</td></tr>`
                              )
                              .join('')}
                          </tbody>
                        </table>
                      </body></html>`
                    const w = window.open('', '_blank')
                    if (w) {
                      w.document.write(html)
                      w.document.close()
                      w.focus()
                      w.print()
                    }
                  }}
                  className="px-3 py-1.5 text-xs bg-amber-500 text-black font-semibold rounded-lg"
                >
                  Print
                </button>
                <button
                  onClick={() => setModalWaitron(null)}
                  className="px-3 py-1.5 text-xs bg-gray-800 text-gray-200 rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {(itemsByWaitron[modalWaitron] || []).length === 0 ? (
                <div className="p-4 text-gray-500 text-sm">No items</div>
              ) : (
                <table className="w-full text-sm text-white">
                  <thead className="bg-gray-900 text-gray-300 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Time</th>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const aggregated: {
                        [name: string]: { qty: number; total: number; at: string }
                      } = {}
                      ;(itemsByWaitron[modalWaitron] || []).forEach((it) => {
                        const key = it.name
                        if (!aggregated[key]) aggregated[key] = { qty: 0, total: 0, at: it.at }
                        aggregated[key].qty += it.qty
                        aggregated[key].total += it.total
                        // keep earliest time for display
                        if (it.at < aggregated[key].at) aggregated[key].at = it.at
                      })
                      return Object.entries(aggregated)
                        .sort((a, b) => (a[0] > b[0] ? 1 : -1))
                        .map(([name, v], idx) => (
                          <tr key={idx} className="border-t border-gray-800">
                            <td className="px-3 py-2 text-gray-300">
                              {new Date(v.at).toLocaleTimeString('en-NG', {
                                timeZone: 'Africa/Lagos',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="px-3 py-2">{name}</td>
                            <td className="px-3 py-2 text-right">{v.qty}</td>
                            <td className="px-3 py-2 text-right">₦{v.total.toLocaleString()}</td>
                          </tr>
                        ))
                    })()}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
