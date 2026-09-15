import { useCallback, useEffect, useMemo, useState } from 'react'
import { ThumbsDown, ThumbsUp, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

type RatingRow = {
  id: string
  zone_id: string | null
  zone_name: string | null
  rating: 'up' | 'down'
  created_at: string
}

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year'

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

const dayWindow = (d: string) => {
  const start = new Date(d + 'T08:00:00+01:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

const addDays = (d: Date, days: number) => {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

const periodWindow = (period: Period, anchorDate: string) => {
  // anchorDate is YYYY-MM-DD in WAT session terms (08:00 boundary)
  if (period === 'day') return dayWindow(anchorDate)

  const anchor = new Date(anchorDate + 'T08:00:00+01:00')
  const start = new Date(anchor)

  if (period === 'week') {
    // Monday-based week in local time.
    const day = start.getDay() // 0=Sun ... 6=Sat
    const diff = day === 0 ? 6 : day - 1
    start.setDate(start.getDate() - diff)
    const end = addDays(start, 7)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  if (period === 'month') {
    start.setDate(1)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  if (period === 'quarter') {
    const m = start.getMonth()
    const qStartMonth = Math.floor(m / 3) * 3
    start.setMonth(qStartMonth, 1)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 3)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  // year
  start.setMonth(0, 1)
  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

const fmtRangeLabel = (period: Period, anchorDate: string) => {
  if (period === 'day') return anchorDate

  const { start, end } = periodWindow(period, anchorDate)
  const s = new Date(start).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const e = new Date(new Date(end).getTime() - 1).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const tag =
    period === 'week'
      ? 'Week'
      : period === 'month'
        ? 'Month'
        : period === 'quarter'
          ? 'Quarter'
          : 'Year'
  return `${tag}: ${s} – ${e}`
}

export default function ServiceRatingsTab() {
  const [date, setDate] = useState(todayWAT())
  const [period, setPeriod] = useState<Period>('day')
  const [rows, setRows] = useState<RatingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (p: Period, d: string) => {
    setLoading(true)
    setError(null)
    const { start, end } = periodWindow(p, d)
    try {
      const { data, error: fetchError } = await supabase
        .from('service_ratings')
        .select('id, zone_id, zone_name, rating, created_at')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (fetchError) throw fetchError
      setRows((data || []) as RatingRow[])
    } catch {
      setError('Could not load ratings (service_ratings table not found or access denied).')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(period, date)
  }, [date, fetchData, period])

  const summary = useMemo(() => {
    const up = rows.filter((r) => r.rating === 'up').length
    const down = rows.filter((r) => r.rating === 'down').length
    const total = rows.length
    const pct = total > 0 ? Math.round((up / total) * 100) : 0
    return { up, down, total, pct }
  }, [rows])

  const byZone = useMemo(() => {
    const map = new Map<string, { zone: string; up: number; down: number }>()
    for (const row of rows) {
      const key = row.zone_id || row.zone_name || 'Unknown'
      const label = row.zone_name || 'Unknown'
      const entry = map.get(key) || { zone: label, up: 0, down: 0 }
      if (row.rating === 'up') entry.up += 1
      else entry.down += 1
      map.set(key, entry)
    }
    return Array.from(map.values()).sort((a, b) => b.up + b.down - (a.up + a.down))
  }, [rows])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayWAT()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => {
            setPeriod('day')
            setDate(todayWAT())
          }}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            period === 'day' && date === todayWAT()
              ? 'bg-amber-500 text-black'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => {
            setPeriod('day')
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Previous Day
        </button>
        <button
          onClick={() => setPeriod('week')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            period === 'week'
              ? 'bg-amber-500 text-black'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Weekly
        </button>
        <button
          onClick={() => setPeriod('month')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            period === 'month'
              ? 'bg-amber-500 text-black'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setPeriod('quarter')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            period === 'quarter'
              ? 'bg-amber-500 text-black'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Quarterly
        </button>
        <button
          onClick={() => setPeriod('year')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            period === 'year'
              ? 'bg-amber-500 text-black'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Annual
        </button>
        <button
          onClick={() => fetchData(period, date)}
          className="p-2 text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-500 text-xs">Total</p>
          <p className="text-white text-2xl font-bold">{summary.total}</p>
          <p className="text-gray-600 text-xs mt-1">{fmtRangeLabel(period, date)}</p>
        </div>
        <div className="bg-gray-900 border border-green-500/20 rounded-2xl p-4">
          <p className="text-green-400 text-xs flex items-center gap-1">
            <ThumbsUp size={12} /> Good
          </p>
          <p className="text-green-300 text-2xl font-bold">{summary.up}</p>
          <p className="text-gray-600 text-xs mt-1">{summary.pct}% positive</p>
        </div>
        <div className="bg-gray-900 border border-red-500/20 rounded-2xl p-4">
          <p className="text-red-400 text-xs flex items-center gap-1">
            <ThumbsDown size={12} /> Bad
          </p>
          <p className="text-red-300 text-2xl font-bold">{summary.down}</p>
          <p className="text-gray-600 text-xs mt-1">
            {summary.total ? 100 - summary.pct : 0}% not positive
          </p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-white font-semibold text-sm mb-3">By Zone</p>
        {loading ? (
          <div className="text-amber-500 text-sm">Loading…</div>
        ) : byZone.length === 0 ? (
          <div className="text-gray-500 text-sm">No ratings for this date.</div>
        ) : (
          <div className="space-y-2">
            {byZone.map((z) => (
              <div
                key={z.zone}
                className="flex items-center justify-between bg-gray-800/40 border border-gray-800 rounded-xl px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">{z.zone}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-green-400 text-xs inline-flex items-center gap-1">
                    <ThumbsUp size={12} /> {z.up}
                  </span>
                  <span className="text-red-400 text-xs inline-flex items-center gap-1">
                    <ThumbsDown size={12} /> {z.down}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
