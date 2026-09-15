import { X, CheckCircle, Loader2 } from 'lucide-react'
import { fmtShort, PAYMENT_METHODS } from './types'
import type { Room, CheckInForm } from './types'

interface Props {
  room: Room
  form: CheckInForm
  saving: boolean
  onChange: (f: CheckInForm) => void
  onConfirm: () => void
  onClose: () => void
}

const TEXT_FIELDS = [
  { label: 'Guest Name *', key: 'guest_name', type: 'text', ph: 'Full name' },
  { label: 'Phone', key: 'guest_phone', type: 'tel', ph: '080xxxxxxxx' },
  { label: 'Email', key: 'guest_email', type: 'email', ph: 'optional' },
  {
    label: 'ID / Passport No.',
    key: 'guest_id_number',
    type: 'text',
    ph: 'NIN / Passport / Drivers licence',
  },
] as const

export default function CheckInModal({ room, form, saving, onChange, onConfirm, onClose }: Props) {
  const nights =
    form.check_out_date && form.check_in_date
      ? Math.max(
          0,
          Math.ceil(
            (new Date(form.check_out_date).getTime() - new Date(form.check_in_date).getTime()) /
              86400000
          )
        )
      : 0
  const totalDue = nights * (room.rate_per_night || 0)

  return (
    <div className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start justify-center px-4 py-8">
      <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-white font-bold">Check In — Room #{room.room_number}</h2>
            <p className="text-gray-500 text-xs mt-0.5">
              {room.room_type} · {fmtShort(room.rate_per_night)}/night
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-gray-400 text-xs block mb-1">{f.label}</label>
              <input
                type={f.type}
                value={form[f.key]}
                placeholder={f.ph}
                onChange={(e) => onChange({ ...form, [f.key]: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            {(['check_in_date', 'check_out_date'] as const).map((k) => (
              <div key={k}>
                <label className="text-gray-400 text-xs block mb-1">
                  {k === 'check_in_date' ? 'Check-in *' : 'Check-out *'}
                </label>
                <input
                  type="date"
                  value={form[k]}
                  onChange={(e) => onChange({ ...form, [k]: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['Adults', 'adults', 1],
                ['Children', 'children', 0],
              ] as const
            ).map(([l, k, min]) => (
              <div key={k}>
                <label className="text-gray-400 text-xs block mb-1">{l}</label>
                <input
                  type="number"
                  min={min}
                  value={form[k]}
                  onChange={(e) => onChange({ ...form, [k]: parseInt(e.target.value) || min })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            ))}
          </div>
          {nights > 0 && (
            <div className="bg-gray-800 rounded-2xl p-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Nights</p>
                <p className="text-white font-bold">{nights}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Total Due</p>
                <p className="text-amber-400 font-black">{fmtShort(totalDue)}</p>
              </div>
            </div>
          )}
          <div>
            <label className="text-gray-400 text-xs block mb-1">Payment Method</label>
            <select
              value={form.payment_method}
              onChange={(e) => onChange({ ...form, payment_method: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-400 text-xs block mb-1">Amount Paid Now</label>
            <input
              type="number"
              value={form.amount_paid}
              onChange={(e) => onChange({ ...form, amount_paid: e.target.value })}
              placeholder={`Leave blank to default to ${fmtShort(totalDue)}`}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
            {form.amount_paid && parseFloat(form.amount_paid) < totalDue && (
              <p className="text-amber-400 text-xs mt-1">
                {fmtShort(totalDue - parseFloat(form.amount_paid))} balance will be outstanding
              </p>
            )}
          </div>
          <textarea
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            placeholder="Special requests…"
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 resize-none"
          />
          <button
            onClick={onConfirm}
            disabled={saving || !form.guest_name || !form.check_out_date}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-black rounded-2xl py-3 flex items-center justify-center gap-2 transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {saving ? 'Checking in…' : 'Confirm Check In'}
          </button>
        </div>
      </div>
    </div>
  )
}
