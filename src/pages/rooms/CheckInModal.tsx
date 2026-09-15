import {
  X,
  User,
  Phone,
  Mail,
  Hash,
  Users,
  Banknote,
  CreditCard,
  Smartphone,
  CheckCircle,
} from 'lucide-react'
import type { RoomRow, CheckinForm } from './types'
import { ID_TYPES } from './types'

interface Props {
  room: RoomRow
  form: CheckinForm
  saving: boolean
  onFormChange: (f: CheckinForm) => void
  onConfirm: () => void
  onClose: () => void
}

export default function CheckInModal({
  room,
  form,
  saving,
  onFormChange,
  onConfirm,
  onClose,
}: Props) {
  const set = (k: keyof CheckinForm, v: string) => onFormChange({ ...form, [k]: v })

  const checkoutPreview = () => {
    const d = new Date(form.check_in_at)
    d.setDate(d.getDate() + parseInt(form.nights || '1'))
    return d.toLocaleString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const total = (room.rate_per_night || 0) * parseInt(form.nights || '1')

  const PAYMENT_METHODS = [
    { id: 'cash', label: 'Cash', icon: Banknote },
    { id: 'card', label: 'Bank POS', icon: CreditCard },
    { id: 'transfer', label: 'Transfer', icon: Smartphone },
  ]

  const inputCls =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm'
  const iconInputCls =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm'
  const labelCls = 'text-gray-500 text-xs block mb-1'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-800 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div>
            <h3 className="text-white font-bold">Check In — {room.name}</h3>
            <p className="text-amber-400 text-sm">₦{room.rate_per_night?.toLocaleString()}/night</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <p className="text-gray-400 text-xs uppercase tracking-wide font-medium">
            Guest Information
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Full Name *</label>
              <div className="relative">
                <User
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={form.guest_name}
                  onChange={(e) => set('guest_name', e.target.value)}
                  className={iconInputCls}
                  placeholder="Guest full name"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Phone *</label>
              <div className="relative">
                <Phone
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={form.guest_phone}
                  onChange={(e) => set('guest_phone', e.target.value)}
                  className={iconInputCls}
                  placeholder="08012345678"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <div className="relative">
                <Mail
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={form.guest_email}
                  onChange={(e) => set('guest_email', e.target.value)}
                  className={iconInputCls}
                  placeholder="guest@email.com"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>ID Type *</label>
              <select
                value={form.id_type}
                onChange={(e) => set('id_type', e.target.value)}
                className={inputCls}
              >
                {ID_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>ID Number *</label>
              <div className="relative">
                <Hash
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={form.id_number}
                  onChange={(e) => set('id_number', e.target.value)}
                  className={iconInputCls}
                  placeholder="ID number"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Number of Guests</label>
              <div className="relative">
                <Users
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  type="number"
                  min="1"
                  value={form.num_guests}
                  onChange={(e) => set('num_guests', e.target.value)}
                  className={iconInputCls}
                />
              </div>
            </div>
          </div>

          <p className="text-gray-400 text-xs uppercase tracking-wide font-medium pt-2">
            Stay Duration
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Check-in Date & Time</label>
              <input
                type="datetime-local"
                value={form.check_in_at}
                onChange={(e) => set('check_in_at', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Number of Nights</label>
              <input
                type="number"
                min="1"
                value={form.nights}
                onChange={(e) => set('nights', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-3 flex items-center justify-between text-sm">
            <span className="text-gray-400">Expected Check-out</span>
            <span className="text-white font-medium">{checkoutPreview()}</span>
          </div>

          <p className="text-gray-400 text-xs uppercase tracking-wide font-medium pt-2">Payment</p>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => set('payment_method', m.id)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-medium transition-all ${form.payment_method === m.id ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}
              >
                <m.icon size={16} />
                {m.label}
              </button>
            ))}
          </div>
          <div>
            <label className={labelCls}>Payment Reference / Receipt No.</label>
            <input
              value={form.payment_reference}
              onChange={(e) => set('payment_reference', e.target.value)}
              className={inputCls}
              placeholder="Transaction ref, POS receipt no, etc."
            />
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-xs">
                {form.nights} night{parseInt(form.nights) > 1 ? 's' : ''} × ₦
                {room.rate_per_night?.toLocaleString()}
              </p>
              <p className="text-white font-bold text-xl break-all mt-0.5">
                ₦{total.toLocaleString()}
              </p>
            </div>
            <CheckCircle size={28} className="text-amber-500" />
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Special requests, observations..."
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none"
            />
          </div>

          <button
            onClick={onConfirm}
            disabled={saving}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
          >
            <CheckCircle size={16} />
            {saving ? 'Processing...' : `Confirm Check-in — ₦${total.toLocaleString()}`}
          </button>
        </div>
      </div>
    </div>
  )
}
