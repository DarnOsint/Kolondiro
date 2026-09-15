import { X } from 'lucide-react'
import type { StayRow } from './types'

interface Props {
  stay: StayRow
  onClose: () => void
}

export default function StayDetailModal({ stay, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h3 className="text-white font-bold">Guest Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {(
            [
              ['Room', stay.room_name],
              ['Guest', stay.guest_name],
              ['Phone', stay.guest_phone],
              ['Email', stay.guest_email || '—'],
              ['ID Type', stay.id_type],
              ['ID Number', stay.id_number],
              ['Guests', stay.num_guests],
              ['Check-in', new Date(stay.check_in_at).toLocaleString('en-NG')],
              ['Check-out', new Date(stay.check_out_at).toLocaleString('en-NG')],
              ['Nights', stay.nights],
              ['Rate/Night', `₦${stay.rate_per_night?.toLocaleString()}`],
              ['Total Paid', `₦${stay.total_amount?.toLocaleString()}`],
              ['Payment', stay.payment_method],
              ['Reference', stay.payment_reference || '—'],
              ['Checked in by', stay.checked_in_by_name],
            ] as [string, string | number | null][]
          ).map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between py-1 border-b border-gray-800 last:border-0"
            >
              <span className="text-gray-500">{label}</span>
              <span className="text-white font-medium text-right">{value}</span>
            </div>
          ))}
          {stay.notes && (
            <div className="bg-gray-800 rounded-xl p-3 text-xs text-gray-400">📝 {stay.notes}</div>
          )}
        </div>
      </div>
    </div>
  )
}
