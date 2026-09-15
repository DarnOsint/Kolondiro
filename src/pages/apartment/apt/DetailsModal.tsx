import { X } from 'lucide-react'
import { fmt, fmtDate } from './types'
import type { RoomStay } from './types'

interface Props {
  stay: RoomStay
  onClose: () => void
}

export default function DetailsModal({ stay, onClose }: Props) {
  const balance = Math.max(0, (stay.total_amount || 0) - (stay.amount_paid || 0))
  const rows: [string, string][] = [
    ['Guest', stay.guest_name],
    ['Phone', stay.guest_phone || '—'],
    ['Email', stay.guest_email || '—'],
    ['ID No.', stay.guest_id_number || '—'],
    ['Room', `#${stay.rooms?.room_number} (${stay.rooms?.room_type})`],
    ['Adults/Children', `${stay.adults} / ${stay.children}`],
    ['Check-in', fmtDate(stay.check_in_date)],
    ['Check-out', fmtDate(stay.check_out_date)],
    ['Payment', stay.payment_method?.replace(/_/g, ' ') || '—'],
    ['Total Charged', fmt(stay.total_amount)],
    ['Amount Paid', fmt(stay.amount_paid)],
  ]
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white font-bold">Stay Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="space-y-2 text-sm">
            {rows.map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <p className="text-gray-400">{l}</p>
                <p className="text-white font-medium text-right max-w-[180px] truncate">{v}</p>
              </div>
            ))}
            {balance > 0 && (
              <div className="flex justify-between border-t border-gray-700 pt-2">
                <p className="text-red-400 font-bold">Outstanding</p>
                <p className="text-red-400 font-black">{fmt(balance)}</p>
              </div>
            )}
          </div>
          {stay.notes && (
            <div className="bg-gray-800 rounded-xl px-3 py-2">
              <p className="text-gray-500 text-xs font-medium mb-1">Notes</p>
              <p className="text-gray-300 text-xs">{stay.notes}</p>
            </div>
          )}
          <button
            onClick={onClose}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-2xl py-3 text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
