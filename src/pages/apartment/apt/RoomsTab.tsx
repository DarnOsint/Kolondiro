import { AlertTriangle, Banknote, Eye, ArrowRight, Phone } from 'lucide-react'
import { fmt, fmtShort, STATUS_CONFIG } from './types'
import type { Room, RoomStay } from './types'

interface Props {
  rooms: Room[]
  activeStays: RoomStay[]
  onCheckIn: (room: Room) => void
  onCheckOut: (stay: RoomStay) => void
  onPayment: (stay: RoomStay) => void
  onDetails: (stay: RoomStay) => void
  onSetMaintenance: (roomId: string) => void
  onSetAvailable: (roomId: string) => void
}

function BalanceBadge({ total, paid }: { total: number; paid: number }) {
  const balance = (total || 0) - (paid || 0)
  if (balance <= 0) return <span className="text-xs text-green-400 font-medium">Fully paid</span>
  return <span className="text-xs text-red-400 font-semibold">{fmt(balance)} due</span>
}

export default function RoomsTab({
  rooms,
  activeStays,
  onCheckIn,
  onCheckOut,
  onPayment,
  onDetails,
  onSetMaintenance,
  onSetAvailable,
}: Props) {
  return (
    <>
      {/* Active stays */}
      {activeStays.length > 0 && (
        <div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Active Stays ({activeStays.length})
          </p>
          <div className="space-y-3">
            {activeStays.map((stay) => {
              const d = new Date(stay.check_out_date),
                t = new Date()
              t.setHours(8, 0, 0, 0)
              const daysLeft = Math.ceil((d.getTime() - t.getTime()) / 86400000)
              const isOS = daysLeft < 0
              const balance = Math.max(0, (stay.total_amount || 0) - (stay.amount_paid || 0))
              return (
                <div
                  key={stay.id}
                  className={`bg-gray-900 border rounded-2xl overflow-hidden ${isOS ? 'border-purple-500/40' : 'border-gray-800'}`}
                >
                  {isOS && (
                    <div className="bg-purple-500/20 px-4 py-1.5 flex items-center gap-2">
                      <AlertTriangle size={12} className="text-purple-400" />
                      <p className="text-purple-400 text-xs font-semibold">
                        Overstay — {Math.abs(daysLeft)}d past checkout
                      </p>
                    </div>
                  )}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-white font-bold">{stay.guest_name}</p>
                        <p className="text-gray-500 text-xs">Room {stay.rooms?.room_number}</p>
                      </div>
                      <div className="text-right">
                        <BalanceBadge total={stay.total_amount} paid={stay.amount_paid} />
                        <p
                          className={`text-xs mt-0.5 ${isOS ? 'text-purple-400' : daysLeft === 0 ? 'text-amber-400' : 'text-gray-500'}`}
                        >
                          {isOS ? 'Overdue' : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                      {[
                        {
                          label: 'Check-in',
                          value: new Date(stay.check_in_date).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          }),
                        },
                        {
                          label: 'Check-out',
                          value: new Date(stay.check_out_date).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          }),
                        },
                        { label: 'Total', value: fmtShort(stay.total_amount), amber: true },
                      ].map((item) => (
                        <div key={item.label} className="bg-gray-800 rounded-xl px-2 py-2">
                          <p className="text-gray-500">{item.label}</p>
                          <p
                            className={`font-medium mt-0.5 ${item.amber ? 'text-amber-400 font-bold' : 'text-white'}`}
                          >
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>
                    {stay.guest_phone && (
                      <p className="text-gray-500 text-xs flex items-center gap-1 mb-3">
                        <Phone size={10} />
                        {stay.guest_phone}
                      </p>
                    )}
                    <div className="flex gap-2">
                      {balance > 0 && (
                        <button
                          onClick={() => onPayment(stay)}
                          className="flex items-center gap-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <Banknote size={13} /> Collect {fmt(balance)}
                        </button>
                      )}
                      <button
                        onClick={() => onDetails(stay)}
                        className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl px-3 py-2 text-xs transition-colors"
                      >
                        <Eye size={13} /> Details
                      </button>
                      <button
                        onClick={() => onCheckOut(stay)}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
                      >
                        <ArrowRight size={13} /> Check Out
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All rooms grid */}
      <div>
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
          All Rooms ({rooms.length})
        </p>
        <div className="grid grid-cols-2 gap-3">
          {rooms.map((room) => {
            const sc = STATUS_CONFIG[room.status] ?? STATUS_CONFIG.available
            const activeStay = activeStays.find((s) => s.room_id === room.id)
            return (
              <div key={room.id} className={`rounded-2xl border p-3 ${sc.bg} ${sc.border}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
                    <p className="text-white font-black text-base">#{room.room_number}</p>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${sc.bg} ${sc.border} ${sc.text}`}
                  >
                    {room.status}
                  </span>
                </div>
                <p className="text-gray-400 text-xs capitalize mb-0.5">{room.room_type}</p>
                <p className={`text-xs font-semibold mb-3 ${sc.text}`}>
                  {fmtShort(room.rate_per_night)}/night
                </p>
                {room.status === 'available' && (
                  <>
                    <button
                      onClick={() => onCheckIn(room)}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl py-2 transition-colors mb-1"
                    >
                      Check In
                    </button>
                    <button
                      onClick={() => onSetMaintenance(room.id)}
                      className="w-full text-gray-600 hover:text-red-400 text-xs py-1 transition-colors"
                    >
                      Set Maintenance
                    </button>
                  </>
                )}
                {room.status === 'occupied' && activeStay && (
                  <div>
                    <p className="text-gray-300 text-xs font-medium truncate mb-2">
                      {activeStay.guest_name}
                    </p>
                    <button
                      onClick={() => onDetails(activeStay)}
                      className="w-full bg-gray-800/50 hover:bg-gray-700 text-gray-300 text-xs rounded-xl py-2 flex items-center justify-center gap-1 transition-colors"
                    >
                      <Eye size={11} /> View Stay
                    </button>
                  </div>
                )}
                {room.status === 'maintenance' && (
                  <button
                    onClick={() => onSetAvailable(room.id)}
                    className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs rounded-xl py-2 transition-colors"
                  >
                    Mark Available
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
