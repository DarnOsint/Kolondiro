import { X, ArrowRight, Loader2 } from 'lucide-react'
import { fmt, fmtDate } from './types'
import type { RoomStay } from './types'

interface Props {
  stay: RoomStay
  saving: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function CheckOutModal({ stay, saving, onConfirm, onClose }: Props) {
  const balance = Math.max(0, (stay.total_amount || 0) - (stay.amount_paid || 0))
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white font-bold">Confirm Check Out</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-gray-800 rounded-2xl p-4 space-y-2 text-sm">
            {(
              [
                ['Guest', stay.guest_name],
                ['Room', `#${stay.rooms?.room_number}`],
                ['Check-in', fmtDate(stay.check_in_date)],
                ['Check-out', fmtDate(stay.check_out_date)],
                ['Total Charged', fmt(stay.total_amount)],
                ['Amount Paid', fmt(stay.amount_paid)],
              ] as [string, string][]
            ).map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <p className="text-gray-400">{l}</p>
                <p className="text-white font-medium">{v}</p>
              </div>
            ))}
            {balance > 0 && (
              <div className="flex justify-between border-t border-gray-700 pt-2">
                <p className="text-red-400 font-bold">Balance Due</p>
                <p className="text-red-400 font-black">{fmt(balance)}</p>
              </div>
            )}
          </div>
          {balance > 0 && (
            <p className="text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              ⚠ Outstanding balance detected. Collect payment before proceeding.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-800 text-gray-300 rounded-2xl py-3 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className="flex-1 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white font-bold rounded-2xl py-3 text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              Check Out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
