import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, RefreshCw, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

type Row = {
  id: string
  item_name: string
  quantity: number
  unit: string
  requested_by_name: string | null
  approved_by_name: string | null
  status: string
  created_at: string
  resolved_at: string | null
}

export default function StoreToChillerTab() {
  const [date, setDate] = useState(todayWAT())
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async (d: string) => {
    setLoading(true)
    const dayStart = new Date(d + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const { data } = await supabase
      .from('store_requests')
      .select(
        'id, item_name, quantity, unit, requested_by_name, approved_by_name, status, created_at, resolved_at'
      )
      .eq('status', 'approved')
      // Prefer resolved_at when available (actual approval time), otherwise fall back to created_at.
      // Some older rows/functions may not populate resolved_at on approval.
      .or(
        `and(resolved_at.gte.${dayStart.toISOString()},resolved_at.lt.${dayEnd.toISOString()}),and(resolved_at.is.null,created_at.gte.${dayStart.toISOString()},created_at.lt.${dayEnd.toISOString()})`
      )
      .order('created_at', { ascending: false })

    setRows((data || []) as Row[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(date)
  }, [date, fetchData])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const s =
        `${r.item_name} ${r.unit} ${r.requested_by_name || ''} ${r.approved_by_name || ''}`.toLowerCase()
      return s.includes(q)
    })
  }, [rows, search])

  const summary = useMemo(() => {
    const map = new Map<string, { item_name: string; unit: string; qty: number }>()
    for (const r of filtered) {
      const key = `${r.item_name}__${r.unit}`
      const cur = map.get(key) || { item_name: r.item_name, unit: r.unit, qty: 0 }
      cur.qty += r.quantity || 0
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty)
  }, [filtered])

  const totalMoved = filtered.reduce((s, r) => s + (r.quantity || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayWAT()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setDate(todayWAT())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === todayWAT() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toLocaleDateString('en-CA'))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
        <button onClick={() => fetchData(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Approved Moves', value: rows.length, color: 'text-white' },
          { label: 'Total Qty', value: totalMoved, color: 'text-emerald-400' },
          { label: 'Unique Items', value: summary.length, color: 'text-amber-400' },
          { label: 'Date', value: date, color: 'text-cyan-400' },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
          >
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search item / staff..."
          className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        />
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10">
          <Package size={34} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No approved store releases for this date</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-white font-bold text-sm">Summary (Approved)</p>
              <p className="text-gray-500 text-xs">Total moved: {totalMoved}</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {summary.map((s) => (
                <div
                  key={`${s.item_name}-${s.unit}`}
                  className="flex items-center justify-between px-4 py-2 border-b border-gray-800 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-gray-200 text-sm font-medium truncate">{s.item_name}</p>
                    <p className="text-gray-500 text-[10px] uppercase tracking-wider">{s.unit}</p>
                  </div>
                  <p className="text-emerald-400 font-black text-lg">{s.qty}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-white font-bold text-sm">Details</p>
              <p className="text-gray-500 text-xs">{filtered.length} rows</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-800">
              {filtered.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{r.item_name}</p>
                      <p className="text-gray-500 text-xs">
                        {r.quantity} {r.unit}
                      </p>
                      <p className="text-gray-600 text-[10px] mt-1">
                        Requested: {r.requested_by_name || '—'} · Approved:{' '}
                        {r.approved_by_name || '—'}
                      </p>
                    </div>
                    <p className="text-gray-500 text-[10px] shrink-0">
                      {new Date(r.resolved_at || r.created_at).toLocaleString('en-NG', {
                        timeZone: 'Africa/Lagos',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
