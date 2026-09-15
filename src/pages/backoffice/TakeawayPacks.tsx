import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

interface Props {
  onBack: () => void
}

export interface PackSize {
  id: string
  name: string
  price: number
}

export default function TakeawayPacks({ onBack }: Props) {
  const toast = useToast()
  const [packs, setPacks] = useState<PackSize[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'takeaway_pack_sizes')
      .single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            setPacks(JSON.parse(data.value))
          } catch {
            /* invalid */
          }
        }
        setLoading(false)
      })
  }, [])

  const addPack = () => {
    setPacks((prev) => [...prev, { id: crypto.randomUUID(), name: '', price: 0 }])
  }

  const updatePack = (id: string, field: 'name' | 'price', value: string) => {
    setPacks((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, [field]: field === 'price' ? parseFloat(value) || 0 : value } : p
      )
    )
  }

  const removePack = (id: string) => {
    setPacks((prev) => prev.filter((p) => p.id !== id))
  }

  const handleSave = async () => {
    const valid = packs.filter((p) => p.name.trim() && p.price > 0)
    if (valid.length === 0 && packs.length > 0) {
      toast.error('Invalid', 'Each pack size needs a name and a price above 0')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('settings').upsert(
        {
          id: 'takeaway_pack_sizes',
          value: JSON.stringify(valid),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      if (error) throw error
      setPacks(valid)
      toast.success('Saved', `${valid.length} pack size${valid.length !== 1 ? 's' : ''} saved`)
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={24} />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gray-950 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <div className="max-w-lg">
        <h2 className="text-white text-xl font-bold mb-1">Takeaway Pack Sizes</h2>
        <p className="text-gray-400 text-sm mb-6">
          Define pack sizes and their prices. When a waitron processes a takeaway order, they select
          the pack size and it is automatically added to the total.
        </p>

        <div className="space-y-3 mb-5">
          {packs.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">No pack sizes configured</p>
              <p className="text-gray-600 text-xs mt-1">
                Add sizes like Small, Medium, Large with their prices
              </p>
            </div>
          ) : (
            packs.map((pack, idx) => (
              <div
                key={pack.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3"
              >
                <span className="text-gray-600 text-xs w-5 shrink-0">{idx + 1}.</span>
                <input
                  type="text"
                  value={pack.name}
                  onChange={(e) => updatePack(pack.id, 'name', e.target.value)}
                  placeholder="e.g. Small Pack"
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-600"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-gray-500 text-sm">₦</span>
                  <input
                    type="number"
                    min="0"
                    value={pack.price || ''}
                    onChange={(e) => updatePack(pack.id, 'price', e.target.value)}
                    placeholder="0"
                    className="w-24 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm text-right focus:outline-none focus:border-amber-500 placeholder-gray-600"
                  />
                </div>
                <button
                  onClick={() => removePack(pack.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={addPack}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-xl text-sm transition-colors"
          >
            <Plus size={14} /> Add Size
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save Pack Sizes'}
          </button>
        </div>
      </div>
    </div>
  )
}
