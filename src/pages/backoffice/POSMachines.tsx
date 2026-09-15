import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Plus, Trash2, Save, Monitor } from 'lucide-react'
import { useToast } from '../../context/ToastContext'

interface Props {
  onBack: () => void
}

export default function POSMachines({ onBack }: Props) {
  const [machines, setMachines] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'pos_machines')
      .single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            setMachines(JSON.parse(data.value) as string[])
          } catch {
            setMachines([])
          }
        }
        setLoading(false)
      })
  }, [])

  const save = async (updated: string[]) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('settings').upsert({
        id: 'pos_machines',
        value: JSON.stringify(updated),
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      setMachines(updated)
    } catch (err) {
      toast.error('Error', 'Failed to save: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const addMachine = async () => {
    const name = newName.trim()
    if (!name) return
    if (machines.includes(name)) {
      toast.warning('Duplicate', 'A machine with that name already exists')
      return
    }
    await save([...machines, name])
    setNewName('')
  }

  const removeMachine = async (name: string) => {
    if (!confirm(`Remove "${name}"? This won't affect historical records.`)) return
    await save(machines.filter((m) => m !== name))
  }

  if (loading)
    return <div className="flex items-center justify-center p-8 text-amber-500">Loading…</div>

  return (
    <div className="min-h-full bg-gray-950">
      <div className="flex items-center gap-3 p-4 border-b border-gray-800">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white p-2 rounded-xl hover:bg-gray-800"
        >
          ←
        </button>
        <div className="w-9 h-9 rounded-xl bg-cyan-500 flex items-center justify-center">
          <Monitor size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold">POS Machines</h1>
          <p className="text-gray-400 text-xs">Name and manage your POS terminals</p>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-lg">
        {/* Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-400 text-sm leading-relaxed">
            Give each POS machine a clear name (e.g.{' '}
            <span className="text-white font-medium">POS-1</span>,{' '}
            <span className="text-white font-medium">Counter</span>,{' '}
            <span className="text-white font-medium">Bar Terminal</span>). The manager will assign
            one to a waitron at clock-in so every sale can be traced back to a specific terminal for
            end-of-shift reconciliation.
          </p>
        </div>

        {/* Current machines */}
        {machines.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <Monitor size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">No POS machines defined yet</p>
            <p className="text-gray-600 text-xs mt-1">Add your first machine below</p>
          </div>
        ) : (
          <div className="space-y-2">
            {machines.map((name) => (
              <div
                key={name}
                className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Monitor size={16} className="text-cyan-400" />
                  <span className="text-white font-medium">{name}</span>
                </div>
                <button
                  onClick={() => removeMachine(name)}
                  disabled={saving}
                  className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Add Machine</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMachine()}
              placeholder="e.g. POS-1, Counter, Bar Terminal"
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={addMachine}
              disabled={saving || !newName.trim()}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
            >
              {saving ? <Save size={14} /> : <Plus size={14} />}
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
