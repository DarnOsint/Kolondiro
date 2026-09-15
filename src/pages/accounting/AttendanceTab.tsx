import { useState, useEffect, useCallback } from 'react'
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'

function getWeekDates(refDate: string): string[] {
  const d = new Date(refDate)
  const day = d.getDay()
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((day + 6) % 7))
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(mon)
    dd.setDate(mon.getDate() + i)
    days.push(dd.toISOString().slice(0, 10))
  }
  return days
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function AttendanceTab() {
  const [weekRef, setWeekRef] = useState(new Date().toISOString().slice(0, 10))
  const [weekAttendance, setWeekAttendance] = useState<Record<string, Set<string>>>({})
  const [hoursMap, setHoursMap] = useState<Record<string, Record<string, number>>>({})
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role: string }>>([])
  const [loading, setLoading] = useState(false)

  const weekDates = getWeekDates(weekRef)
  const weekLabel = `${new Date(weekDates[0]).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })} — ${new Date(weekDates[6]).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}`

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [attRes, staffRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('staff_id, staff_name, role, date, duration_minutes')
        .gte('date', weekDates[0])
        .lte('date', weekDates[6]),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name'),
    ])
    if (staffRes.data) {
      setStaffList(
        staffRes.data.map((s: { id: string; full_name: string; role: string }) => ({
          id: s.id,
          name: s.full_name,
          role: s.role,
        }))
      )
    }
    const attMap: Record<string, Set<string>> = {}
    const hMap: Record<string, Record<string, number>> = {}
    if (attRes.data) {
      for (const row of attRes.data as Array<{
        staff_id: string
        date: string
        duration_minutes?: number
      }>) {
        if (!attMap[row.staff_id]) attMap[row.staff_id] = new Set()
        attMap[row.staff_id].add(row.date)
        if (!hMap[row.staff_id]) hMap[row.staff_id] = {}
        hMap[row.staff_id][row.date] =
          (hMap[row.staff_id][row.date] || 0) + (row.duration_minutes || 0)
      }
    }
    setWeekAttendance(attMap)
    setHoursMap(hMap)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDates[0], weekDates[6]])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const prevWeek = () => {
    const d = new Date(weekRef)
    d.setDate(d.getDate() - 7)
    setWeekRef(d.toISOString().slice(0, 10))
  }
  const nextWeek = () => {
    const d = new Date(weekRef)
    d.setDate(d.getDate() + 7)
    if (d <= new Date()) setWeekRef(d.toISOString().slice(0, 10))
  }
  const thisWeek = () => setWeekRef(new Date().toISOString().slice(0, 10))

  const operational = staffList.filter(
    (s) => !['owner', 'executive', 'auditor', 'accountant'].includes(s.role)
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Clock size={14} className="text-amber-400" /> Weekly Attendance
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            className="text-gray-400 hover:text-white p-1.5 bg-gray-800 rounded-lg"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={thisWeek}
            className="text-gray-400 hover:text-white text-xs px-3 py-1.5 bg-gray-800 rounded-lg"
          >
            This Week
          </button>
          <button
            onClick={nextWeek}
            className="text-gray-400 hover:text-white p-1.5 bg-gray-800 rounded-lg"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800">
                <th className="text-left px-3 py-2.5 text-gray-400 min-w-[150px]">Staff</th>
                <th className="text-left px-1 py-2.5 text-gray-500 text-[10px] min-w-[60px]">
                  Role
                </th>
                {weekDates.map((d, i) => (
                  <th key={d} className="text-center px-1 py-2.5 text-gray-400 min-w-[48px]">
                    <div className="text-[9px]">{DAY_LABELS[i]}</div>
                    <div className="text-[10px] text-gray-500">
                      {new Date(d).getDate()}/{new Date(d).getMonth() + 1}
                    </div>
                  </th>
                ))}
                <th className="text-center px-2 py-2.5 text-gray-400 min-w-[45px]">Days</th>
                <th className="text-right px-3 py-2.5 text-gray-400 min-w-[50px]">Hours</th>
              </tr>
            </thead>
            <tbody>
              {operational.map((staff) => {
                const attended = weekAttendance[staff.id] || new Set()
                const daysWorked = weekDates.filter((d) => attended.has(d)).length
                const totalHours = Object.values(hoursMap[staff.id] || {}).reduce(
                  (s, m) => s + m,
                  0
                )
                return (
                  <tr key={staff.id} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-white font-medium truncate max-w-[170px]">
                      {staff.name}
                    </td>
                    <td className="px-1 py-2 text-gray-500 capitalize text-[10px]">
                      {staff.role.replace('_', ' ')}
                    </td>
                    {weekDates.map((d) => {
                      const present = attended.has(d)
                      const isFuture = d > new Date().toISOString().slice(0, 10)
                      const hrs = hoursMap[staff.id]?.[d]
                      return (
                        <td key={d} className="text-center px-1 py-2">
                          {isFuture ? (
                            <span className="text-gray-700">·</span>
                          ) : (
                            <div>
                              <span
                                className={`inline-block w-6 h-6 rounded-md text-[10px] font-bold leading-6 ${present ? 'bg-green-500/20 text-green-400' : 'bg-red-500/10 text-red-400/50'}`}
                              >
                                {present ? '✓' : '✗'}
                              </span>
                              {present && hrs ? (
                                <div className="text-[8px] text-gray-600 mt-0.5">
                                  {(hrs / 60).toFixed(0)}h
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="text-center px-2 py-2">
                      <span
                        className={`text-xs font-bold ${daysWorked >= 5 ? 'text-green-400' : daysWorked >= 3 ? 'text-amber-400' : 'text-red-400'}`}
                      >
                        {daysWorked}/7
                      </span>
                    </td>
                    <td className="text-right px-3 py-2 text-gray-400 text-xs">
                      {totalHours > 0 ? `${(totalHours / 60).toFixed(1)}h` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
