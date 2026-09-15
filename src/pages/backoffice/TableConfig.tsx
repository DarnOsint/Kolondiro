import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Edit2, X, Save, Plus, Trash2 } from 'lucide-react'
import { useToast } from '../../context/ToastContext'

interface Zone {
  id: string
  name: string
  hire_fee?: number | null
  min_spend?: number | null
}

interface Table {
  id: string
  name: string
  capacity: number
  category_id: string
  status: string
  table_categories?: { id: string; name: string; hire_fee?: number | null }
}

interface TableForm {
  name: string
  capacity: string
  category_id: string
}

interface Props {
  onBack: () => void
}

const zoneColorMap: Record<string, string> = {
  Outdoor: 'bg-green-500/20 text-green-400',
  Indoor: 'bg-blue-500/20 text-blue-400',
  'VIP Lounge': 'bg-purple-500/20 text-purple-400',
  'The Nook': 'bg-amber-500/20 text-amber-400',
}

export default function TableConfig({ onBack }: Props) {
  const [tables, setTables] = useState<Table[]>([])
  const toast = useToast()
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Table | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<TableForm>({ name: '', capacity: '4', category_id: '' })
  const [saving, setSaving] = useState(false)
  const [filterZone, setFilterZone] = useState('All')

  // Zone management
  const [showAddZone, setShowAddZone] = useState(false)
  const [newZoneName, setNewZoneName] = useState('')
  const [newZoneHireFee, setNewZoneHireFee] = useState('')
  const [editingZone, setEditingZone] = useState<Zone | null>(null)
  const [zoneForm, setZoneForm] = useState({ name: '', hire_fee: '' })
  const [zoneSaving, setZoneSaving] = useState(false)

  const fetchAll = async () => {
    try {
      const [tablesRes, zonesRes] = await Promise.all([
        supabase.from('tables').select('*, table_categories(id, name, hire_fee)').order('name'),
        supabase.from('table_categories').select('id, name, hire_fee').order('name'),
      ])
      if (tablesRes.error) console.error('Tables fetch error:', tablesRes.error)
      if (zonesRes.error) console.error('Zones fetch error:', zonesRes.error)
      setTables((tablesRes.data || []) as Table[])
      setZones((zonesRes.data || []) as Zone[])
    } catch (err) {
      console.error('fetchAll error:', err)
      toast.error('Error', 'Failed to load tables and zones')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Table CRUD ─────────────────────────────────────────────
  const openEdit = (table: Table) => {
    setEditing(table)
    setShowAdd(false)
    setForm({
      name: table.name,
      capacity: table.capacity.toString(),
      category_id: table.category_id,
    })
  }

  const openAdd = () => {
    setEditing(null)
    setShowAdd(true)
    setForm({ name: '', capacity: '4', category_id: zones[0]?.id || '' })
  }

  const saveTable = async () => {
    if (!form.name || !form.capacity || !form.category_id) {
      toast.warning('Required', 'Name, capacity, and zone are required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from('tables')
          .update({
            name: form.name,
            capacity: parseInt(form.capacity),
            category_id: form.category_id,
          })
          .eq('id', editing.id)
        if (error) throw error
        toast.success('Updated', `${form.name} updated`)
      } else {
        const { error } = await supabase.from('tables').insert({
          name: form.name,
          capacity: parseInt(form.capacity),
          category_id: form.category_id,
          status: 'available',
        })
        if (error) throw error
        toast.success('Added', `${form.name} added`)
      }
      await fetchAll()
      setEditing(null)
      setShowAdd(false)
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const deleteTable = async (table: Table) => {
    if (!confirm(`Delete "${table.name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('tables').delete().eq('id', table.id)
    if (error) {
      toast.error('Error', 'Cannot delete — table may have orders. Try renaming instead.')
      return
    }
    toast.success('Deleted', `${table.name} removed`)
    fetchAll()
  }

  // ── Zone CRUD ──────────────────────────────────────────────
  const addZone = async () => {
    if (!newZoneName.trim()) {
      toast.warning('Required', 'Zone name is required')
      return
    }
    setZoneSaving(true)
    try {
      const { error } = await supabase.from('table_categories').insert({
        name: newZoneName.trim(),
        hire_fee: newZoneHireFee ? parseFloat(newZoneHireFee) : null,
      })
      if (error) throw error
      toast.success('Zone Added', newZoneName)
      setNewZoneName('')
      setNewZoneHireFee('')
      setShowAddZone(false)
      fetchAll()
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err))
    } finally {
      setZoneSaving(false)
    }
  }

  const openEditZone = (zone: Zone) => {
    setEditingZone(zone)
    setZoneForm({ name: zone.name, hire_fee: zone.hire_fee != null ? String(zone.hire_fee) : '' })
  }

  const saveZone = async () => {
    if (!editingZone || !zoneForm.name.trim()) return
    setZoneSaving(true)
    try {
      const { error } = await supabase
        .from('table_categories')
        .update({
          name: zoneForm.name.trim(),
          hire_fee: zoneForm.hire_fee ? parseFloat(zoneForm.hire_fee) : null,
        })
        .eq('id', editingZone.id)
      if (error) throw error
      toast.success('Zone Updated', zoneForm.name)
      setEditingZone(null)
      fetchAll()
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err))
    } finally {
      setZoneSaving(false)
    }
  }

  const deleteZone = async (zone: Zone) => {
    const tablesInZone = tables.filter((t) => t.category_id === zone.id).length
    if (tablesInZone > 0) {
      toast.error(
        'Cannot Delete',
        `${zone.name} has ${tablesInZone} table(s). Move or delete them first.`
      )
      return
    }
    if (!confirm(`Delete zone "${zone.name}"?`)) return
    const { error } = await supabase.from('table_categories').delete().eq('id', zone.id)
    if (error) {
      toast.error('Error', error.message)
      return
    }
    toast.success('Deleted', `${zone.name} removed`)
    fetchAll()
  }

  // ── Bulk add tables ────────────────────────────────────────
  const [bulkCount, setBulkCount] = useState('5')
  const [bulkZone, setBulkZone] = useState<string>('')
  const [bulkAdding, setBulkAdding] = useState(false)

  // Set default bulk zone once zones load
  useEffect(() => {
    if (zones.length > 0 && !bulkZone) setBulkZone(zones[0].id)
  }, [zones, bulkZone])

  const bulkAddTables = async () => {
    const count = parseInt(bulkCount)
    const zoneId = bulkZone
    if (!zoneId || !count || count < 1) return
    const zoneName = zones.find((z) => z.id === zoneId)?.name || 'Table'
    setBulkAdding(true)
    try {
      // Find the highest existing table number in this zone
      const zoneTables = tables.filter((t) => t.category_id === zoneId)
      const maxNum = zoneTables.reduce((max, t) => {
        const match = t.name.match(/(\d+)$/)
        return match ? Math.max(max, parseInt(match[1])) : max
      }, 0)

      const newTables = Array.from({ length: count }, (_, i) => ({
        name: `Table ${maxNum + i + 1}`,
        capacity: 4,
        category_id: zoneId,
        status: 'available',
      }))
      const { error } = await supabase.from('tables').insert(newTables)
      if (error) throw error
      toast.success('Added', `${count} tables added to ${zoneName}`)
      fetchAll()
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err))
    } finally {
      setBulkAdding(false)
    }
  }

  const filtered =
    filterZone === 'All' ? tables : tables.filter((t) => t.table_categories?.name === filterZone)
  const zoneColor = (name?: string) =>
    name ? (zoneColorMap[name] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'
  const inp =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500'

  return (
    <div className="min-h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold">Table & Zone Management</h1>
            <p className="text-gray-400 text-xs">
              {tables.length} tables across {zones.length} zones
            </p>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2 rounded-xl text-sm"
        >
          <Plus size={14} /> Add Table
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Zone filter */}
        <div className="flex gap-2 overflow-x-auto">
          {['All', ...zones.map((z) => z.name)].map((zone) => (
            <button
              key={zone}
              onClick={() => setFilterZone(zone)}
              className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${filterZone === zone ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
            >
              {zone}
            </button>
          ))}
        </div>

        {/* No zones warning */}
        {!loading && zones.length === 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
            <p className="text-red-400 font-bold mb-1">No zones found</p>
            <p className="text-gray-400 text-sm">
              You need to create at least one zone before you can add tables. Scroll down to the
              Zones section and click "Add Zone".
            </p>
          </div>
        )}

        {/* Bulk add */}
        {zones.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-white text-sm font-medium mb-3">Quick Add Multiple Tables</p>
            <div className="flex gap-2 items-end">
              <div>
                <label className="text-gray-500 text-[10px] uppercase block mb-1">Count</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(e.target.value)}
                  className="w-20 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex-1">
                <label className="text-gray-500 text-[10px] uppercase block mb-1">Zone</label>
                <select
                  value={bulkZone}
                  onChange={(e) => setBulkZone(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={bulkAddTables}
                disabled={bulkAdding}
                className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl text-sm"
              >
                {bulkAdding ? 'Adding...' : `Add ${bulkCount} Tables`}
              </button>
            </div>
          </div>
        )}

        {/* Tables grid */}
        {loading ? (
          <div className="text-amber-500 text-center py-12">Loading...</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filtered.map((table) => (
              <div
                key={table.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-lg ${zoneColor(table.table_categories?.name)}`}
                  >
                    {table.table_categories?.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(table)}
                      className="text-gray-400 hover:text-white"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => deleteTable(table)}
                      className="text-gray-400 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-white font-semibold text-sm">{table.name}</p>
                <p className="text-gray-500 text-xs">👥 {table.capacity} seats</p>
                {table.table_categories?.hire_fee ? (
                  <p className="text-amber-400 text-xs font-semibold">
                    Hire: ₦{table.table_categories.hire_fee.toLocaleString()}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Zone Management */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-bold text-sm">Zones</h2>
            <button
              onClick={() => setShowAddZone(true)}
              className="flex items-center gap-1 text-amber-400 hover:text-amber-300 text-xs font-medium"
            >
              <Plus size={13} /> Add Zone
            </button>
          </div>

          {showAddZone && (
            <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-4 mb-3 space-y-3">
              <p className="text-amber-400 font-semibold text-sm">New Zone</p>
              <input
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="Zone name (e.g. Rooftop, Garden)"
                className={inp}
              />
              <input
                type="number"
                min="0"
                value={newZoneHireFee}
                onChange={(e) => setNewZoneHireFee(e.target.value)}
                placeholder="Hire fee (₦) — leave blank if none"
                className={inp}
              />
              <div className="flex gap-2">
                <button
                  onClick={addZone}
                  disabled={zoneSaving}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-2.5 text-sm"
                >
                  {zoneSaving ? 'Adding...' : 'Add Zone'}
                </button>
                <button
                  onClick={() => setShowAddZone(false)}
                  className="flex-1 bg-gray-800 text-gray-300 rounded-xl py-2.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {zones.map((zone) => {
              const count = tables.filter((t) => t.category_id === zone.id).length
              return (
                <div key={zone.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white font-semibold text-sm">{zone.name}</p>
                      <p className="text-gray-500 text-xs">
                        {count} table{count !== 1 ? 's' : ''}
                        {zone.hire_fee ? ` · Hire: ₦${zone.hire_fee.toLocaleString()}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditZone(zone)}
                        className="text-gray-400 hover:text-white p-1"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => deleteZone(zone)}
                        className="text-gray-400 hover:text-red-400 p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Add/Edit Table Modal */}
      {(editing || showAdd) && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">{editing ? 'Edit Table' : 'Add New Table'}</h3>
              <button
                onClick={() => {
                  setEditing(null)
                  setShowAdd(false)
                }}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Table Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Table 1"
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Capacity (seats)
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Zone
                </label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className={inp}
                >
                  <option value="" disabled>
                    Select a zone...
                  </option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={saveTable}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2"
              >
                <Save size={16} /> {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Table'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Zone Modal */}
      {editingZone && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Edit Zone</h3>
              <button
                onClick={() => setEditingZone(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Zone Name
                </label>
                <input
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Hire Fee (₦) — leave blank if none
                </label>
                <input
                  type="number"
                  min="0"
                  value={zoneForm.hire_fee}
                  onChange={(e) => setZoneForm({ ...zoneForm, hire_fee: e.target.value })}
                  placeholder="0"
                  className={inp}
                />
              </div>
              <button
                onClick={saveZone}
                disabled={zoneSaving}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2"
              >
                <Save size={16} /> {zoneSaving ? 'Saving...' : 'Save Zone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
