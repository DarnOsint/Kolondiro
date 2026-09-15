import { Wrench } from 'lucide-react'
import type { RoomRow } from './types'

interface Props {
  rooms: RoomRow[]
  onEditRoom: (room: RoomRow) => void
}

export default function RoomSettingsTab({ rooms, onEditRoom }: Props) {
  return (
    <div className="space-y-3 max-w-3xl">
      <p className="text-gray-400 text-sm mb-4">Click a room to edit its rate, type and details.</p>
      {rooms.map((room) => (
        <div
          key={room.id}
          className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between"
        >
          <div>
            <p className="text-white font-semibold">{room.name}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-gray-400 text-xs capitalize">
                {room.room_type || 'standard'}
              </span>
              <span className="text-gray-600 text-xs">Floor {room.floor || 1}</span>
              <span className="text-gray-600 text-xs">{room.capacity || 2} guests max</span>
            </div>
            {room.amenities && <p className="text-gray-600 text-xs mt-1">{room.amenities}</p>}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-amber-400 font-bold">
                ₦{room.rate_per_night?.toLocaleString() || 0}
              </p>
              <p className="text-gray-600 text-xs">per night</p>
            </div>
            <button onClick={() => onEditRoom(room)} className="text-gray-400 hover:text-white p-2">
              <Wrench size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
