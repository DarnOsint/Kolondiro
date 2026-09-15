import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Room, RoomStay } from './types'

const CAL_DAYS = 14

interface Props {
  rooms: Room[]
  activeStays: RoomStay[]
  calStart: Date
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

export default function CalendarTab({
  rooms,
  activeStays,
  calStart,
  onPrev,
  onNext,
  onToday,
}: Props) {
  const calDays = Array.from({ length: CAL_DAYS }, (_, i) => {
    const d = new Date(calStart)
    d.setDate(d.getDate() + i)
    return d
  })

  function getRoomCalStatus(room: Room, day: Date) {
    const ds = day.toISOString().split('T')[0]
    const stay = activeStays.find(
      (s) => s.room_id === room.id && ds >= s.check_in_date && ds < s.check_out_date
    )
    if (!stay) return { type: 'available', stay: null }
    return { type: stay.status === 'reserved' ? 'reserved' : 'occupied', stay }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-bold">14-Day Availability</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onPrev}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-gray-400"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={onToday}
            className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2"
          >
            Today
          </button>
          <button
            onClick={onNext}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-gray-400"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-4 mb-3 text-xs">
        {[
          { dot: 'bg-green-400', label: 'Available' },
          { dot: 'bg-amber-400', label: 'Occupied' },
          { dot: 'bg-blue-400', label: 'Reserved' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${l.dot}`} />
            <span className="text-gray-400">{l.label}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div
            className="grid gap-px mb-1"
            style={{ gridTemplateColumns: `80px repeat(${CAL_DAYS},1fr)` }}
          >
            <div />
            {calDays.map((d) => {
              const isToday = d.toDateString() === new Date().toDateString()
              return (
                <div
                  key={d.toISOString()}
                  className={`text-center py-1 rounded-lg text-xs ${isToday ? 'bg-amber-500 text-black font-bold' : 'text-gray-500'}`}
                >
                  <p className="font-semibold">{d.getDate()}</p>
                  <p className="text-[9px]">{d.toLocaleDateString('en', { weekday: 'short' })}</p>
                </div>
              )
            })}
          </div>
          {rooms.map((room) => (
            <div
              key={room.id}
              className="grid gap-px mb-1"
              style={{ gridTemplateColumns: `80px repeat(${CAL_DAYS},1fr)` }}
            >
              <div className="flex items-center pr-2">
                <p className="text-white text-xs font-bold">#{room.room_number}</p>
                <p className="text-gray-600 text-[10px] ml-1 truncate">
                  {room.room_type?.slice(0, 3)}
                </p>
              </div>
              {calDays.map((d) => {
                const { type, stay } = getRoomCalStatus(room, d)
                return (
                  <div
                    key={d.toISOString()}
                    title={stay ? stay.guest_name : 'Available'}
                    className={`h-8 rounded border ${type === 'occupied' ? 'bg-amber-500/30 border-amber-500/40' : type === 'reserved' ? 'bg-blue-500/30 border-blue-500/40' : 'bg-green-500/20 border-green-500/20'} cursor-default`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
