import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface ReturnEntry {
  id: string
  order_id: string
  order_item_id: string
  item_name: string
  quantity: number
  item_total: number
  table_name: string | null
  waitron_name: string | null
  barman_name: string | null
  return_reason: string | null
  status: string
  requested_at: string
  resolved_at: string | null
  shift_date: string
}

const watToday = (): string => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

const statusStyle = (s: string) => {
  if (s === 'bar_accepted') return { text: 'Bar Accepted', color: 'bg-amber-500/20 text-amber-400' }
  if (s === 'kitchen_accepted')
    return { text: 'Kitchen Accepted', color: 'bg-blue-500/20 text-blue-300' }
  if (s === 'griller_accepted')
    return { text: 'Grill Accepted', color: 'bg-orange-500/20 text-orange-300' }
  if (s === 'accepted') return { text: 'Approved', color: 'bg-green-500/20 text-green-400' }
  if (s === 'rejected') return { text: 'Bar Rejected', color: 'bg-red-500/20 text-red-400' }
  if (s === 'manager_rejected')
    return { text: 'Manager Rejected', color: 'bg-red-500/20 text-red-400' }
  if (s === 'expired') return { text: 'Expired', color: 'bg-gray-500/20 text-gray-400' }
  if (s === 'pending') return { text: 'Pending', color: 'bg-amber-500/20 text-amber-400' }
  return { text: s, color: 'bg-gray-500/20 text-gray-400' }
}

const cardBorder = (s: string) =>
  s === 'bar_accepted'
    ? 'border-amber-500/40'
    : s === 'accepted'
      ? 'border-green-500/20'
      : s === 'rejected' || s === 'manager_rejected'
        ? 'border-red-500/20'
        : 'border-gray-800'

export default function SupervisorReturnsTab() {
  const [date, setDate] = useState(watToday())
  const [returns, setReturns] = useState<ReturnEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchReturns = useCallback(async (d: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('returns_log')
      .select(
        'id, order_id, order_item_id, item_name, quantity, item_total, table_name, waitron_name, barman_name, return_reason, status, requested_at, resolved_at, shift_date'
      )
      .eq('shift_date', d)
      .order('requested_at', { ascending: false })
    setReturns((data as ReturnEntry[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchReturns(date)
    const ch = supabase
      .channel('supervisor-returns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'returns_log' }, () =>
        fetchReturns(date)
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [date, fetchReturns])

  const barAccepted = returns.filter((r) => r.status === 'bar_accepted')
  const accepted = returns.filter((r) => r.status === 'accepted')
  const rejected = returns.filter((r) => r.status === 'rejected' || r.status === 'manager_rejected')
  const acceptedTotal = [...barAccepted, ...accepted].reduce((s, r) => s + (r.item_total || 0), 0)

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <input
          type="date"
          value={date}
          max={watToday()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setDate(watToday())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === watToday() ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toLocaleDateString('en-CA'))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-900 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
        <button onClick={() => fetchReturns(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Total', value: String(returns.length), color: 'text-white' },
          { label: 'Bar Accepted', value: String(barAccepted.length), color: 'text-amber-400' },
          { label: 'Approved', value: String(accepted.length), color: 'text-green-400' },
          { label: 'Rejected', value: String(rejected.length), color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center"
          >
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 border border-amber-500/20 rounded-xl px-4 py-2.5 mb-4 flex items-center justify-between">
        <span className="text-gray-400 text-xs font-semibold">Accepted value</span>
        <span className="text-amber-400 font-bold">N{acceptedTotal.toLocaleString()}</span>
      </div>

      {loading ? (
        <div className="text-center py-10 text-amber-500">Loading...</div>
      ) : returns.length === 0 ? (
        <div className="text-center py-12">
          <RotateCcw size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            No returned items for {date === watToday() ? 'today' : date}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {returns.map((r) => {
            const st = statusStyle(r.status)
            return (
              <div
                key={r.id}
                className={`bg-gray-900 border rounded-xl p-3 ${cardBorder(r.status)}`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div>
                    <p className="text-white text-sm font-semibold">
                      {r.quantity}x {r.item_name}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {r.table_name || '?'} — by {r.waitron_name || '?'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.color}`}
                    >
                      {st.text}
                    </span>
                    <p className="text-gray-400 text-xs mt-1">N{r.item_total.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                  <span>
                    Barman:{' '}
                    {r.barman_name
                      ? r.barman_name
                      : r.status === 'pending'
                        ? 'Pending'
                        : r.status === 'bar_accepted'
                          ? 'Accepted'
                          : 'Direct approval'}
                  </span>
                  <span>·</span>
                  <span>
                    {new Date(r.requested_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </span>
                  {r.return_reason && (
                    <>
                      <span>·</span>
                      <span className="italic">{r.return_reason}</span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
