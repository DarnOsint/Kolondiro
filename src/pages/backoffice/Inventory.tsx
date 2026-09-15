import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import {
  ArrowLeft,
  Plus,
  Search,
  Edit2,
  X,
  Save,
  AlertTriangle,
  Package,
  RefreshCw,
  Truck,
  DollarSign,
  Filter,
  Clock,
  Trash2,
} from 'lucide-react'
import { audit } from '../../lib/audit'

const UNITS = ['bottles', 'crates', 'litres', 'kg', 'packs', 'cartons', 'pieces'] as const
const CONDITIONS = ['good', 'damaged', 'partial'] as const
const PAYMENT_METHODS = ['cash', 'transfer', 'credit'] as const

interface InventoryItem {
  id: string
  item_name: string
  category?: string
  unit?: string
  current_stock: number
  minimum_stock: number
  cost_price?: number
  selling_price?: number
  menu_item_id?: string
}
interface RestockEntry {
  id: string
  item_name: string
  quantity_added: number
  previous_stock: number
  new_stock: number
  cost_price_per_unit?: number
  total_cost?: number
  supplier_name?: string
  supplier_phone?: string
  invoice_number?: string
  payment_method?: string
  delivery_person?: string
  condition?: string
  notes?: string
  restocked_by_name?: string
  restocked_at: string
}
interface MenuItem {
  id: string
  name: string
  menu_categories?: { name?: string; destination?: string } | null
}
interface ItemForm {
  item_name: string
  category: string
  unit: string
  current_stock: string
  minimum_stock: string
  cost_price: string
  selling_price: string
  menu_item_id: string
}
interface RestockForm {
  quantity_added: string
  cost_price_per_unit: string
  supplier_name: string
  supplier_phone: string
  invoice_number: string
  payment_method: string
  delivery_person: string
  condition: string
  notes: string
}
interface Props {
  onBack: () => void
}

const blankItemForm: ItemForm = {
  item_name: '',
  category: '',
  unit: 'bottles',
  current_stock: '',
  minimum_stock: '10',
  cost_price: '',
  selling_price: '',
  menu_item_id: '',
}
const blankRestockForm: RestockForm = {
  quantity_added: '',
  cost_price_per_unit: '',
  supplier_name: '',
  supplier_phone: '',
  invoice_number: '',
  payment_method: 'cash',
  delivery_person: '',
  condition: 'good',
  notes: '',
}

export default function Inventory({ onBack }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [view, setView] = useState<'stock' | 'log'>('stock')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [restockLog, setRestockLog] = useState<RestockEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterLow, setFilterLow] = useState(false)
  const [logStart, setLogStart] = useState('')
  const [logEnd, setLogEnd] = useState('')
  const [showAddItem, setShowAddItem] = useState(false)
  const [showRestock, setShowRestock] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [itemForm, setItemForm] = useState<ItemForm>(blankItemForm)
  const [restockForm, setRestockForm] = useState<RestockForm>(blankRestockForm)
  const fi = (v: Partial<ItemForm>) => setItemForm((p) => ({ ...p, ...v }))
  const fr = (v: Partial<RestockForm>) => setRestockForm((p) => ({ ...p, ...v }))

  const fetchAll = async (opts?: { logStart?: string; logEnd?: string }) => {
    setLoading(true)
    const start = opts?.logStart ?? logStart
    const end = opts?.logEnd ?? logEnd
    const [invRes, logRes, menuRes] = await Promise.all([
      supabase.from('inventory').select('*').eq('is_active', true).order('item_name'),
      (() => {
        let q = supabase.from('restock_log').select('*').order('restocked_at', { ascending: false })
        if (start) q = q.gte('restocked_at', new Date(start + 'T00:00:00+01:00').toISOString())
        if (end) {
          const e = new Date(end + 'T00:00:00+01:00')
          e.setDate(e.getDate() + 1)
          q = q.lt('restocked_at', e.toISOString())
        }
        return q.limit(200)
      })(),
      supabase
        .from('menu_items')
        .select('id, name, menu_categories(name, destination)')
        .eq('is_available', true)
        .order('name'),
    ])
    if (invRes.data) setItems(invRes.data as InventoryItem[])
    if (logRes.data) setRestockLog(logRes.data as RestockEntry[])
    if (menuRes.data)
      setMenuItems(
        (menuRes.data as MenuItem[]).filter((i) => i.menu_categories?.destination === 'bar')
      )
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveItem = async () => {
    if (!itemForm.item_name) return toast.warning('Required', 'Item name is required')
    setSaving(true)
    const payload = {
      item_name: itemForm.item_name,
      category: itemForm.category,
      unit: itemForm.unit,
      current_stock: parseFloat(itemForm.current_stock) || 0,
      minimum_stock: parseFloat(itemForm.minimum_stock) || 10,
      cost_price: parseFloat(itemForm.cost_price) || 0,
      selling_price: parseFloat(itemForm.selling_price) || 0,
      menu_item_id: itemForm.menu_item_id || null,
      updated_at: new Date().toISOString(),
    }
    try {
      if (selectedItem) {
        const { error } = await supabase.from('inventory').update(payload).eq('id', selectedItem.id)
        if (error) throw error
        triggerStockAlerts(selectedItem.id)
      } else {
        const { error } = await supabase.from('inventory').insert(payload)
        if (error) throw error
      }
      await fetchAll()
      setShowAddItem(false)
      setSelectedItem(null)
    } catch (err) {
      toast.error('Error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
    setItemForm(blankItemForm)
  }

  const triggerStockAlerts = async (itemId: string | null = null) => {
    try {
      await fetch('/api/stock-alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET,
        },
        body: JSON.stringify({ trigger: 'edit', item_id: itemId }),
      })
    } catch {
      /* silent */
    }
  }

  const openRestock = (item: InventoryItem) => {
    setSelectedItem(item)
    setRestockForm({ ...blankRestockForm, cost_price_per_unit: item.cost_price?.toString() || '' })
    setShowRestock(true)
  }

  const processRestock = async () => {
    if (!restockForm.quantity_added || !selectedItem)
      return toast.warning('Required', 'Quantity is required')
    setSaving(true)
    const qtyAdded = parseFloat(restockForm.quantity_added)
    const costPerUnit = parseFloat(restockForm.cost_price_per_unit) || 0
    const previousStock = selectedItem.current_stock || 0
    const newStock = previousStock + qtyAdded
    try {
      const { error: invError } = await supabase
        .from('inventory')
        .update({
          current_stock: newStock,
          cost_price: costPerUnit || selectedItem.cost_price,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedItem.id)
      if (invError) throw invError
      const { error: logError } = await supabase.from('restock_log').insert({
        inventory_id: selectedItem.id,
        item_name: selectedItem.item_name,
        quantity_added: qtyAdded,
        previous_stock: previousStock,
        new_stock: newStock,
        cost_price_per_unit: costPerUnit,
        total_cost: qtyAdded * costPerUnit,
        supplier_name: restockForm.supplier_name,
        supplier_phone: restockForm.supplier_phone,
        invoice_number: restockForm.invoice_number,
        payment_method: restockForm.payment_method,
        delivery_person: restockForm.delivery_person,
        condition: restockForm.condition,
        notes: restockForm.notes,
        restocked_by: profile?.id,
        restocked_by_name: profile?.full_name,
        restocked_at: new Date().toISOString(),
      })
      if (logError) throw logError
      await fetchAll()
      triggerStockAlerts(selectedItem.id)
      setShowRestock(false)
      setSelectedItem(null)
    } catch (err) {
      toast.error('Error', 'Restock failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (item: InventoryItem) => {
    setSelectedItem(item)
    setItemForm({
      item_name: item.item_name,
      category: item.category || '',
      unit: item.unit || 'bottles',
      current_stock: item.current_stock?.toString() || '0',
      minimum_stock: item.minimum_stock?.toString() || '10',
      cost_price: item.cost_price?.toString() || '',
      selling_price: item.selling_price?.toString() || '',
      menu_item_id: item.menu_item_id || '',
    })
    setShowAddItem(true)
  }

  const deleteItem = async (item: InventoryItem) => {
    if (!confirm(`Delete "${item.item_name}" from main store? This cannot be undone.`)) return
    const { error } = await supabase.from('inventory').delete().eq('id', item.id)
    if (error) {
      toast.error('Error', error.message)
      return
    }
    await audit({
      action: 'INVENTORY_DELETED',
      entity: 'inventory',
      entityId: item.id,
      entityName: item.item_name,
      oldValue: { stock: item.current_stock, category: item.category },
      performer: profile ?? undefined,
    })
    toast.success('Deleted', `${item.item_name} removed from main store`)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  const filtered = items.filter((item) => {
    const matchSearch =
      item.item_name.toLowerCase().includes(search.toLowerCase()) ||
      item.category?.toLowerCase().includes(search.toLowerCase())
    const matchLow = !filterLow || item.current_stock <= item.minimum_stock
    return matchSearch && matchLow
  })
  const lowStockCount = items.filter((i) => i.current_stock <= i.minimum_stock).length
  const totalStockValue = items.reduce(
    (s, i) => s + (i.current_stock || 0) * (i.selling_price || i.cost_price || 0),
    0
  )

  const stockStatus = (item: InventoryItem) => {
    if (item.current_stock <= 0)
      return { label: 'Out of Stock', color: 'text-red-400 bg-red-500/10', icon: '🔴' }
    if (item.current_stock <= item.minimum_stock)
      return { label: 'Low Stock', color: 'text-amber-400 bg-amber-500/10', icon: '🟡' }
    return { label: 'In Stock', color: 'text-green-400 bg-green-500/10', icon: '🟢' }
  }

  return (
    <div className="min-h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold">Drink Inventory & Restocking</h1>
            <p className="text-gray-400 text-xs">
              {items.length} items · {lowStockCount} low stock · Stock value: ₦
              {totalStockValue.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchAll()} className="text-gray-400 hover:text-white p-2">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => {
              setSelectedItem(null)
              setItemForm(blankItemForm)
              setShowAddItem(true)
            }}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border-b border-gray-800 px-4 flex gap-1 py-2">
        <button
          onClick={() => setView('stock')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === 'stock' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
        >
          <Package size={14} /> Stock Levels
        </button>
        <button
          onClick={() => setView('log')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === 'log' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
        >
          <Clock size={14} /> Restock Log
        </button>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="text-amber-500 text-center py-12">Loading...</div>
        ) : view === 'stock' ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                {
                  label: 'Total Items',
                  value: items.length,
                  icon: Package,
                  color: 'text-blue-400',
                  bg: 'bg-blue-400/10',
                },
                {
                  label: 'Low Stock',
                  value: lowStockCount,
                  icon: AlertTriangle,
                  color: 'text-amber-400',
                  bg: 'bg-amber-400/10',
                },
                {
                  label: 'Out of Stock',
                  value: items.filter((i) => i.current_stock <= 0).length,
                  icon: X,
                  color: 'text-red-400',
                  bg: 'bg-red-400/10',
                },
                {
                  label: 'Stock Value',
                  value: `₦${totalStockValue.toLocaleString()}`,
                  icon: DollarSign,
                  color: 'text-green-400',
                  bg: 'bg-green-400/10',
                },
              ].map((card, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-2`}>
                    <card.icon size={16} className={card.color} />
                  </div>
                  <p className="text-gray-400 text-xs">{card.label}</p>
                  <p className="text-white font-bold text-lg">{card.value}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items..."
                  className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-amber-500 text-sm"
                />
              </div>
              <button
                onClick={() => setFilterLow(!filterLow)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm border-2 transition-all ${filterLow ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-900 text-gray-400 hover:text-white'}`}
              >
                <Filter size={14} /> Low Stock Only
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No items found. Add your first inventory item.
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {[
                          'Item',
                          'Category',
                          'Stock',
                          'Min',
                          'Unit',
                          'Price/Unit',
                          'Stock Value',
                          'Status',
                          'Actions',
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left text-gray-500 text-xs uppercase tracking-wide px-4 py-3 font-medium whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item, i) => {
                        const status = stockStatus(item)
                        return (
                          <tr
                            key={item.id}
                            className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}
                          >
                            <td className="px-4 py-3">
                              <p className="text-white font-medium text-sm">{item.item_name}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-sm">
                              {item.category || '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`font-bold text-sm ${item.current_stock <= 0 ? 'text-red-400' : item.current_stock <= item.minimum_stock ? 'text-amber-400' : 'text-white'}`}
                              >
                                {item.current_stock}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-sm">
                              {item.minimum_stock}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-sm">{item.unit}</td>
                            <td className="px-4 py-3 text-gray-400 text-sm">
                              ₦{(item.selling_price || item.cost_price || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-amber-400 text-sm font-medium">
                              ₦
                              {(
                                (item.current_stock || 0) *
                                (item.selling_price || item.cost_price || 0)
                              ).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded-lg ${status.color}`}>
                                {status.icon} {status.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openRestock(item)}
                                  className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                  <Truck size={11} /> Restock
                                </button>
                                <button
                                  onClick={() => openEdit(item)}
                                  className="text-gray-400 hover:text-white"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => deleteItem(item)}
                                  className="text-gray-400 hover:text-red-400"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-400 text-sm">{restockLog.length} restock entries</p>
              <p className="text-gray-500 text-xs">
                Total spent: ₦
                {restockLog.reduce((s, r) => s + (r.total_cost || 0), 0).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={logStart}
                onChange={(e) => setLogStart(e.target.value)}
                className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1.5"
              />
              <span className="text-gray-600 text-xs">to</span>
              <input
                type="date"
                value={logEnd}
                onChange={(e) => setLogEnd(e.target.value)}
                className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1.5"
              />
              <button
                onClick={() => fetchAll({ logStart, logEnd })}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-gray-400 border border-gray-800 hover:text-white"
              >
                Apply
              </button>
              <button
                onClick={() => {
                  setLogStart('')
                  setLogEnd('')
                  fetchAll({ logStart: '', logEnd: '' })
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-gray-400 border border-gray-800 hover:text-white"
              >
                Clear
              </button>
            </div>
            {restockLog.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No restock history yet</div>
            ) : (
              restockLog.map((log) => (
                <div key={log.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-white font-semibold">{log.item_name}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {new Date(log.restocked_at).toLocaleString('en-NG', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-green-400 font-bold">+{log.quantity_added} units</p>
                      <p className="text-gray-500 text-xs">
                        ₦{log.total_cost?.toLocaleString()} total
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: 'Before', value: log.previous_stock },
                      { label: 'After', value: log.new_stock },
                      {
                        label: 'Cost/Unit',
                        value: `₦${log.cost_price_per_unit?.toLocaleString()}`,
                      },
                      { label: 'Payment', value: log.payment_method },
                      { label: 'Supplier', value: log.supplier_name || '—' },
                      { label: 'Invoice #', value: log.invoice_number || '—' },
                      { label: 'Condition', value: log.condition },
                      { label: 'By', value: log.restocked_by_name || '—' },
                    ].map((f) => (
                      <div key={f.label} className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-gray-500">{f.label}</p>
                        <p className="text-white font-medium capitalize">{f.value}</p>
                      </div>
                    ))}
                  </div>
                  {log.notes && (
                    <div className="mt-2 text-xs text-gray-500 bg-gray-800 rounded-lg px-3 py-2">
                      📝 {log.notes}
                    </div>
                  )}
                  {log.delivery_person && (
                    <p className="text-gray-500 text-xs mt-2">
                      🚚 Delivered by: {log.delivery_person}
                    </p>
                  )}
                  {log.condition !== 'good' && (
                    <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-400">
                      ⚠️ Delivery condition: {log.condition}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showAddItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
              <h3 className="text-white font-bold">
                {selectedItem ? 'Edit Inventory Item' : 'Add Inventory Item'}
              </h3>
              <button
                onClick={() => setShowAddItem(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Link to Menu Item (optional)
                </label>
                <select
                  value={itemForm.menu_item_id}
                  onChange={(e) => {
                    const sel = menuItems.find((m) => m.id === e.target.value)
                    fi({ menu_item_id: e.target.value, item_name: sel?.name || itemForm.item_name })
                  }}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                >
                  <option value="">— Not linked —</option>
                  {menuItems.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Item Name *
                </label>
                <input
                  value={itemForm.item_name}
                  onChange={(e) => fi({ item_name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="e.g. Heineken Bottle"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Category
                  </label>
                  <input
                    value={itemForm.category}
                    onChange={(e) => fi({ category: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="e.g. Beer, Spirits"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Unit
                  </label>
                  <select
                    value={itemForm.unit}
                    onChange={(e) => fi({ unit: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Current Stock
                  </label>
                  <input
                    type="number"
                    value={itemForm.current_stock}
                    onChange={(e) => fi({ current_stock: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Min Stock (Alert)
                  </label>
                  <input
                    type="number"
                    value={itemForm.minimum_stock}
                    onChange={(e) => fi({ minimum_stock: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Cost Price (₦)
                  </label>
                  <input
                    type="number"
                    value={itemForm.cost_price}
                    onChange={(e) => fi({ cost_price: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Selling Price (₦)
                  </label>
                  <input
                    type="number"
                    value={itemForm.selling_price}
                    onChange={(e) => fi({ selling_price: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
              <button
                onClick={saveItem}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
              >
                <Save size={16} />
                {saving ? 'Saving...' : selectedItem ? 'Update Item' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestock && selectedItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
              <div>
                <h3 className="text-white font-bold">Restock — {selectedItem.item_name}</h3>
                <p className="text-gray-400 text-xs mt-0.5">
                  Current stock:{' '}
                  <span className="text-amber-400 font-bold">
                    {selectedItem.current_stock} {selectedItem.unit}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowRestock(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Quantity Added ({selectedItem.unit}) *
                </label>
                <input
                  type="number"
                  value={restockForm.quantity_added}
                  onChange={(e) => fr({ quantity_added: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-2xl font-bold"
                  placeholder="0"
                />
                {restockForm.quantity_added && (
                  <p className="text-green-400 text-xs mt-1">
                    New stock will be:{' '}
                    <span className="font-bold">
                      {(selectedItem.current_stock || 0) +
                        parseFloat(restockForm.quantity_added || '0')}{' '}
                      {selectedItem.unit}
                    </span>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Cost/Unit (₦)
                  </label>
                  <input
                    type="number"
                    value={restockForm.cost_price_per_unit}
                    onChange={(e) => fr({ cost_price_per_unit: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm font-bold"
                    placeholder="0"
                  />
                </div>
                <div className="bg-gray-800 rounded-xl px-4 py-3 flex flex-col justify-center">
                  <p className="text-gray-500 text-xs">Total Cost</p>
                  <p className="text-amber-400 font-bold text-lg">
                    ₦
                    {(
                      (parseFloat(restockForm.quantity_added) || 0) *
                      (parseFloat(restockForm.cost_price_per_unit) || 0)
                    ).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Supplier Name
                  </label>
                  <input
                    value={restockForm.supplier_name}
                    onChange={(e) => fr({ supplier_name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="e.g. Guinness Nigeria"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Supplier Phone
                  </label>
                  <input
                    value={restockForm.supplier_phone}
                    onChange={(e) => fr({ supplier_phone: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="08012345678"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Invoice Number
                  </label>
                  <input
                    value={restockForm.invoice_number}
                    onChange={(e) => fr({ invoice_number: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                    placeholder="INV-0001"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Payment Method
                  </label>
                  <select
                    value={restockForm.payment_method}
                    onChange={(e) => fr({ payment_method: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Delivery Person / Driver
                </label>
                <input
                  value={restockForm.delivery_person}
                  onChange={(e) => fr({ delivery_person: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="Name of person who delivered"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Delivery Condition
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c}
                      onClick={() => fr({ condition: c })}
                      className={`py-2.5 rounded-xl text-sm font-medium border-2 capitalize transition-all ${restockForm.condition === c ? (c === 'good' ? 'border-green-500 bg-green-500/10 text-green-400' : c === 'damaged' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-amber-500 bg-amber-500/10 text-amber-400') : 'border-gray-700 bg-gray-800 text-gray-400'}`}
                    >
                      {c === 'good' ? '✅' : c === 'damaged' ? '❌' : '⚠️'} {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Notes
                </label>
                <textarea
                  value={restockForm.notes}
                  onChange={(e) => fr({ notes: e.target.value })}
                  rows={2}
                  placeholder="Any additional notes..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none"
                />
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
                <p className="font-semibold mb-1">📋 Accountability Record</p>
                <p>
                  This restock will be logged under{' '}
                  <span className="font-bold text-white">{profile?.full_name}</span> at{' '}
                  {new Date().toLocaleString('en-NG')}. This record cannot be deleted.
                </p>
              </div>
              <button
                onClick={processRestock}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
              >
                <Truck size={16} />
                {saving ? 'Processing...' : 'Confirm Restock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
