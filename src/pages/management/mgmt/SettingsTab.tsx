import { useState } from 'react'
import { Clock, Save } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../context/ToastContext'

interface Props {
  threshold: number
  setThreshold: (n: number) => void
}

export default function SettingsTab({ threshold, setThreshold }: Props) {
  const [editThreshold, setEditThreshold] = useState('')
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const val = parseInt(editThreshold)
    if (!val || val < 1) return
    setSaving(true)
    try {
      const { error } = await supabase.from('settings').upsert({
        id: 'order_alert_threshold',
        value: String(val),
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      setThreshold(val)
      setEditThreshold('')
    } catch (err) {
      toast.error(
        'Error',
        'Failed to save setting: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-md">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-1 flex items-center gap-2">
          <Clock size={16} className="text-amber-400" /> Order Alert Threshold
        </h3>
        <p className="text-gray-400 text-xs mb-4">
          Alert management when an order item has been pending longer than this many minutes.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-gray-400 text-sm">Current threshold</span>
            <span className="text-amber-400 font-bold">{threshold} mins</span>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <input
            type="number"
            min="1"
            max="120"
            value={editThreshold}
            onChange={(e) => setEditThreshold(e.target.value)}
            placeholder="New threshold (mins)"
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={save}
            disabled={saving || !editThreshold}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Save size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  )
}
