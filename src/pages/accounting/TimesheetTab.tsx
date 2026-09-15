import { useState, useEffect, useCallback } from 'react'
import { Clock, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface TimesheetEntry {
  id: string
  staff_id: string
  staff_name: string
  role: string
  date: string
  clock_in: string
  clock_out?: string | null
  duration_minutes?: number | null
  pos_machine?: string
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export default function TimesheetTab() {
  const [date, setDate] = useState(todayStr())
  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEntries = useCallback(async (d: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('attendance')
      .select(
        'id, staff_id, staff_name, role, date, clock_in, clock_out, duration_minutes, pos_machine'
      )
      .eq('date', d)
      .order('clock_in', { ascending: true })
    setEntries((data || []) as TimesheetEntry[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchEntries(date)
  }, [date, fetchEntries])

  const activeCount = entries.filter((e) => !e.clock_out).length
  const totalMinutes = entries.reduce((s, e) => s + (e.duration_minutes || 0), 0)
  const totalHours = (totalMinutes / 60).toFixed(1)

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
        <button onClick={() => fetchEntries(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        <div className="ml-auto flex items-center gap-3">
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> {activeCount}{' '}
              active
            </span>
          )}
          <span className="text-gray-500 text-xs">
            {entries.length} records · {totalHours}h total
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <Clock size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            No attendance records for {date === todayStr() ? 'today' : date}
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Staff</th>
                <th className="text-left px-2 py-2">Role</th>
                <th className="text-left px-2 py-2">Clock In</th>
                <th className="text-left px-2 py-2">Clock Out</th>
                <th className="text-right px-2 py-2">Hours</th>
                <th className="text-left px-3 py-2">POS</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isActive = !e.clock_out
                const hours = e.duration_minutes
                  ? (e.duration_minutes / 60).toFixed(1)
                  : isActive
                    ? '—'
                    : '0'
                return (
                  <tr
                    key={e.id}
                    className={`border-t border-gray-800/50 ${isActive ? 'bg-green-500/5' : ''}`}
                  >
                    <td className="px-3 py-2.5 text-white font-medium">{e.staff_name}</td>
                    <td className="px-2 py-2.5 text-gray-500 capitalize">
                      {e.role.replace('_', ' ')}
                    </td>
                    <td className="px-2 py-2.5 text-gray-300">{fmtTime(e.clock_in)}</td>
                    <td className="px-2 py-2.5">
                      {isActive ? (
                        <span className="text-green-400 text-[10px] bg-green-500/20 px-1.5 py-0.5 rounded">
                          Active
                        </span>
                      ) : (
                        <span className="text-gray-300">{fmtTime(e.clock_out!)}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right text-amber-400 font-medium">{hours}h</td>
                    <td className="px-3 py-2.5 text-gray-500 text-[10px]">
                      {e.pos_machine || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 text-sm font-bold">
                <td className="px-3 py-2 text-white" colSpan={4}>
                  TOTAL
                </td>
                <td className="px-2 py-2 text-right text-amber-400">{totalHours}h</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
