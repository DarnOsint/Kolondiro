import { X } from 'lucide-react'
import type { RoomRow, StayRow } from './types'

interface Props {
  room: RoomRow
  stay: StayRow
  saving: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function CheckOutModal({ room, stay, saving, onConfirm, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h3 className="text-white font-bold">Check Out — {room.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
            {(
              [
                ['Guest', stay.guest_name],
                ['Phone', stay.guest_phone],
                ['Checked In', new Date(stay.check_in_at).toLocaleString('en-NG')],
                ['Due Out', new Date(stay.check_out_at).toLocaleString('en-NG')],
                ['Nights', stay.nights],
                ['Total Paid', `₦${stay.total_amount?.toLocaleString()}`],
              ] as [string, string | number][]
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-gray-500">{label}</span>
                <span className="text-white font-medium">{value}</span>
              </div>
            ))}
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
            Room will move to <span className="font-bold">Cleaning</span> status after checkout.
            Mark it clean when ready.
          </div>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 transition-colors"
          >
            {saving ? 'Processing...' : 'Confirm Check Out'}
          </button>
        </div>
      </div>
    </div>
  )
}
