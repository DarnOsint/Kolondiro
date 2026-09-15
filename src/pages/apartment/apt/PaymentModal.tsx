import { X, Banknote, Loader2 } from 'lucide-react'
import { fmt, PAYMENT_METHODS } from './types'
import type { RoomStay, PayForm } from './types'

interface Props {
  stay: RoomStay
  form: PayForm
  saving: boolean
  onChange: (f: PayForm) => void
  onConfirm: () => void
  onClose: () => void
}

export default function PaymentModal({ stay, form, saving, onChange, onConfirm, onClose }: Props) {
  const balance = Math.max(0, (stay.total_amount || 0) - (stay.amount_paid || 0))
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white font-bold">Record Payment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-800 rounded-2xl px-4 py-3 text-sm">
            <p className="text-gray-400">
              Guest: <span className="text-white font-semibold">{stay.guest_name}</span>
            </p>
            <p className="text-gray-400 mt-1">
              Balance: <span className="text-red-400 font-black">{fmt(balance)}</span>
            </p>
          </div>
          <div>
            <label className="text-gray-400 text-xs block mb-1">Amount Received</label>
            <input
              type="number"
              value={form.amount}
              placeholder="0.00"
              onChange={(e) => onChange({ ...form, amount: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="text-gray-400 text-xs block mb-1">Method</label>
            <select
              value={form.method}
              onChange={(e) => onChange({ ...form, method: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-400 text-xs block mb-1">Reference</label>
            <input
              type="text"
              value={form.reference}
              placeholder="Transfer ref, etc."
              onChange={(e) => onChange({ ...form, reference: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            onClick={onConfirm}
            disabled={saving || !form.amount}
            className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-40 text-white font-black rounded-2xl py-3 flex items-center justify-center gap-2 transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />}
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
