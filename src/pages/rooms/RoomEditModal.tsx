import { X, Save } from 'lucide-react'
import type { RoomRow, RoomEditForm } from './types'
import { ROOM_TYPES } from './types'

interface Props {
  room: RoomRow
  form: RoomEditForm
  saving: boolean
  onFormChange: (f: RoomEditForm) => void
  onSave: () => void
  onClose: () => void
}

export default function RoomEditModal({
  room,
  form,
  saving,
  onFormChange,
  onSave,
  onClose,
}: Props) {
  const set = (k: keyof RoomEditForm, v: string) => onFormChange({ ...form, [k]: v })
  const inputCls =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm'
  const labelCls = 'text-gray-500 text-xs block mb-1'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h3 className="text-white font-bold">Edit Room — {room.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Room Name</label>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Room Type</label>
              <select
                value={form.room_type}
                onChange={(e) => set('room_type', e.target.value)}
                className={`${inputCls} capitalize`}
              >
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Floor</label>
              <input
                type="number"
                value={form.floor}
                onChange={(e) => set('floor', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Max Guests</label>
              <input
                type="number"
                value={form.capacity}
                onChange={(e) => set('capacity', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Rate Per Night (₦)</label>
            <input
              type="number"
              value={form.rate_per_night}
              onChange={(e) => set('rate_per_night', e.target.value)}
              className={`${inputCls} text-lg font-bold`}
              placeholder="0"
            />
          </div>
          <div>
            <label className={labelCls}>Amenities</label>
            <input
              value={form.amenities}
              onChange={(e) => set('amenities', e.target.value)}
              className={inputCls}
              placeholder="AC, TV, WiFi, Hot Water..."
            />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none"
            />
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save Room'}
          </button>
        </div>
      </div>
    </div>
  )
}
