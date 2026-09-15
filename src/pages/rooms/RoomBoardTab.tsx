import { Search, Eye } from 'lucide-react'
import type { RoomRow, StayRow, RoomStatus } from './types'
import { ROOM_STATUSES, STATUS_CONFIG } from './types'

interface Stats {
  total: number
  available: number
  occupied: number
  cleaning: number
  maintenance: number
}

interface Props {
  rooms: RoomRow[]
  stays: StayRow[]
  search: string
  filterStatus: string
  nightRevenue: number
  stats: Stats
  onSearchChange: (v: string) => void
  onFilterChange: (v: string) => void
  onCheckin: (room: RoomRow) => void
  onCheckout: (room: RoomRow, stay: StayRow) => void
  onViewGuest: (stay: StayRow) => void
  onEditRoom: (room: RoomRow) => void
  onStatusChange: (room: RoomRow, status: RoomStatus) => void
}

export default function RoomBoardTab({
  rooms,
  stays,
  search,
  filterStatus,
  nightRevenue,
  stats,
  onSearchChange,
  onFilterChange,
  onCheckin,
  onCheckout,
  onViewGuest,
  onEditRoom,
  onStatusChange,
}: Props) {
  const getStay = (roomId: string) => stays.find((s) => s.room_id === roomId)

  const filtered = rooms.filter((r) => {
    const matchSearch = r.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || r.status === filterStatus
    return matchSearch && matchStatus
  })

  const statCards = [
    { label: 'Total', value: stats.total, color: 'text-white' },
    { label: 'Available', value: stats.available, color: 'text-green-400' },
    { label: 'Occupied', value: stats.occupied, color: 'text-amber-400' },
    { label: 'Cleaning', value: stats.cleaning, color: 'text-blue-400' },
    { label: 'Maintenance', value: stats.maintenance, color: 'text-red-400' },
    {
      label: 'Revenue Active',
      value: `₦${(nightRevenue / 1000).toFixed(0)}k`,
      color: 'text-purple-400',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {statCards.map((s, i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-gray-500 text-[10px] truncate">{s.label}</p>
            <p className={`font-bold text-base md:text-xl ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search rooms..."
            className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2 focus:outline-none focus:border-amber-500 text-sm"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', ...ROOM_STATUSES] as string[]).map((s) => (
            <button
              key={s}
              onClick={() => onFilterChange(s)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors ${filterStatus === s ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Room Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filtered.map((room) => {
          const stay = getStay(room.id)
          const cfg = STATUS_CONFIG[room.status] ?? STATUS_CONFIG.available
          const isOverstay = stay && new Date(stay.check_out_at) < new Date()
          const hoursLeft = stay
            ? // eslint-disable-next-line react-hooks/purity
              Math.round((new Date(stay.check_out_at).getTime() - Date.now()) / 3_600_000)
            : null

          return (
            <div
              key={room.id}
              className={`bg-gray-900 border rounded-xl p-4 transition-all ${isOverstay ? 'border-red-500/50' : 'border-gray-800'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-white font-bold">{room.name}</p>
                  <p className="text-gray-500 text-xs capitalize">{room.room_type || 'standard'}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-lg border ${cfg.color} capitalize`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot} mr-1`} />
                  {isOverstay ? '⚠️ Overstay' : cfg.label}
                </span>
              </div>

              <p className="text-amber-400 text-sm font-bold mb-1">
                ₦{room.rate_per_night?.toLocaleString()}/night
              </p>

              {stay && (
                <div className="mb-3 text-xs space-y-1">
                  <p className="text-white font-medium truncate">{stay.guest_name}</p>
                  <p className="text-gray-500">
                    {stay.num_guests} guest{stay.num_guests > 1 ? 's' : ''}
                  </p>
                  {hoursLeft !== null && (
                    <p
                      className={`font-medium ${hoursLeft < 2 ? 'text-red-400' : hoursLeft < 6 ? 'text-amber-400' : 'text-gray-400'}`}
                    >
                      {hoursLeft > 0
                        ? `${hoursLeft}h remaining`
                        : `${Math.abs(hoursLeft)}h overdue`}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {room.status === 'available' && (
                  <button
                    onClick={() => onCheckin(room)}
                    className="w-full bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                  >
                    Check In
                  </button>
                )}
                {room.status === 'occupied' && stay && (
                  <>
                    <button
                      onClick={() => onCheckout(room, stay)}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold py-2 rounded-lg transition-colors"
                    >
                      Check Out
                    </button>
                    <button
                      onClick={() => onViewGuest(stay)}
                      className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <Eye size={11} /> View Guest
                    </button>
                  </>
                )}
                {room.status === 'cleaning' && (
                  <button
                    onClick={() => onStatusChange(room, 'available')}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                  >
                    ✅ Mark Clean
                  </button>
                )}
                {room.status === 'maintenance' && (
                  <button
                    onClick={() => onStatusChange(room, 'available')}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                  >
                    Mark Available
                  </button>
                )}
                <div className="flex gap-1">
                  <button
                    onClick={() => onEditRoom(room)}
                    className="flex-1 text-gray-500 hover:text-white text-xs py-1 transition-colors"
                  >
                    Edit
                  </button>
                  {room.status !== 'maintenance' && room.status !== 'occupied' && (
                    <button
                      onClick={() => onStatusChange(room, 'maintenance')}
                      className="flex-1 text-red-500 hover:text-red-400 text-xs py-1 transition-colors"
                    >
                      Maintenance
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
