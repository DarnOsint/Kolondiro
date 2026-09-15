import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { audit } from '../../lib/audit'
import { useToast } from '../../context/ToastContext'
import {
  Plus,
  X,
  Truck,
  Package,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  ArrowLeft,
} from 'lucide-react'

interface Supplier {
  id: string
  name: string
  contact_name?: string
  phone?: string
  email?: string
  address?: string
  items_supplied?: string
  payment_terms?: string
  notes?: string
  is_active?: boolean
}
interface POItem {
  inventory_id?: string
  name: string
  quantity: number
  unit_cost: number
  total: number
}
interface PurchaseOrder {
  id: string
  supplier_id: string
  supplier_name: string
  items: POItem[]
  total_cost?: number
  status: string
  payment_status: string
  expected_date?: string
  notes?: string
  created_at: string
  ordered_by?: string
  ordered_by_name?: string
  received_date?: string
  received_by?: string
  received_by_name?: string
}
interface InventoryRow {
  id: string
  item_name: string
  unit: string
  current_stock: number
}
interface SupplierForm {
  name: string
  contact_name: string
  phone: string
  email: string
  address: string
  items_supplied: string
  payment_terms: string
  notes: string
}
interface POForm {
  supplier_id: string
  expected_date: string
  notes: string
  items: POItem[]
}
interface POItemDraft {
  inventory_id: string
  name: string
  quantity: string
  unit_cost: string
}

interface Props {
  onBack?: () => void
}

export default function Suppliers({ onBack }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<'suppliers' | 'orders'>('suppliers')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [inventory, setInventory] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [showPOModal, setShowPOModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [expandedPO, setExpandedPO] = useState<string | null>(null)
  const [supplierForm, setSupplierForm] = useState<SupplierForm>({
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    items_supplied: '',
    payment_terms: '',
    notes: '',
  })
  const [poForm, setPOForm] = useState<POForm>({
    supplier_id: '',
    expected_date: '',
    notes: '',
    items: [],
  })
  const [poItem, setPOItem] = useState<POItemDraft>({
    inventory_id: '',
    name: '',
    quantity: '',
    unit_cost: '',
  })

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [suppRes, poRes, invRes] = await Promise.all([
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase
        .from('inventory')
        .select('id, item_name, unit, current_stock')
        .eq('is_active', true)
        .order('item_name'),
    ])
    setSuppliers(suppRes.data || [])
    setPOs(poRes.data || [])
    setInventory(invRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) return toast.warning('Required', 'Supplier name is required')
    setSaving(true)
    try {
      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update(supplierForm)
          .eq('id', editingSupplier.id)
        if (error) throw error
        await audit({
          action: 'SUPPLIER_UPDATED',
          entity: 'supplier',
          entityId: editingSupplier.id,
          entityName: supplierForm.name,
          performer: profile,
        })
      } else {
        const { error } = await supabase.from('suppliers').insert(supplierForm)
        if (error) throw error
        await audit({
          action: 'SUPPLIER_CREATED',
          entity: 'supplier',
          entityName: supplierForm.name,
          performer: profile,
        })
      }
      setShowSupplierModal(false)
      setEditingSupplier(null)
      fetchAll()
    } catch (err) {
      toast.error(
        'Error',
        'Failed to save supplier: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setSaving(false)
    }
  }

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s)
    setSupplierForm({
      name: s.name,
      contact_name: s.contact_name || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      items_supplied: s.items_supplied || '',
      payment_terms: s.payment_terms || '',
      notes: s.notes || '',
    })
    setShowSupplierModal(true)
  }

  const deactivateSupplier = async (id: string) => {
    if (!window.confirm('Remove this supplier?')) return
    const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', id)
    if (error) {
      toast.error('Error', 'Failed to deactivate supplier: ' + error.message)
      return
    }
    fetchAll()
  }

  const addPOItem = () => {
    if (!poItem.name || !poItem.quantity || !poItem.unit_cost)
      return toast.warning('Required', 'Fill in all item fields')
    const qty = parseFloat(poItem.quantity),
      cost = parseFloat(poItem.unit_cost)
    setPOForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          inventory_id: poItem.inventory_id,
          name: poItem.name,
          quantity: qty,
          unit_cost: cost,
          total: qty * cost,
        },
      ],
    }))
    setPOItem({ inventory_id: '', name: '', quantity: '', unit_cost: '' })
  }

  const removePOItem = (idx: number) =>
    setPOForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))

  const savePO = async () => {
    if (!poForm.supplier_id) return toast.warning('Required', 'Select a supplier')
    if (poForm.items.length === 0) return toast.warning('Required', 'Add at least one item')
    const supplier = suppliers.find((s) => s.id === poForm.supplier_id)
    const total = poForm.items.reduce((s, i) => s + i.total, 0)
    const { error } = await supabase.from('purchase_orders').insert({
      supplier_id: poForm.supplier_id,
      supplier_name: supplier?.name,
      items: poForm.items,
      total_cost: total,
      status: 'pending',
      payment_status: 'unpaid',
      expected_date: poForm.expected_date || null,
      notes: poForm.notes,
      ordered_by: profile?.id,
      ordered_by_name: profile?.full_name,
    })
    if (error) return toast.error('Error', error instanceof Error ? error.message : String(error))
    await audit({
      action: 'PO_CREATED',
      entity: 'purchase_order',
      entityName: supplier?.name,
      newValue: { total, items: poForm.items.length },
      performer: profile,
    })
    setShowPOModal(false)
    setPOForm({ supplier_id: '', expected_date: '', notes: '', items: [] })
    fetchAll()
  }

  const receivePO = async (po: PurchaseOrder) => {
    if (!window.confirm('Mark this order as received? This will update inventory stock.')) return
    try {
      for (const item of po.items) {
        if (item.inventory_id) {
          const { data: inv, error: invErr } = await supabase
            .from('inventory')
            .select('current_stock')
            .eq('id', item.inventory_id)
            .single()
          if (invErr) throw invErr
          if (inv) {
            const { error: updErr } = await supabase
              .from('inventory')
              .update({
                current_stock: (inv as { current_stock: number }).current_stock + item.quantity,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.inventory_id)
            if (updErr) throw updErr
            // restock_log is best-effort
            await supabase.from('restock_log').insert({
              inventory_id: item.inventory_id,
              change_amount: item.quantity,
              reason: 'purchase_order',
              recorded_by: profile?.id,
              notes: 'PO received from ' + po.supplier_name,
            })
          }
        }
      }
      const { error: poErr } = await supabase
        .from('purchase_orders')
        .update({
          status: 'received',
          received_by: profile?.id,
          received_by_name: profile?.full_name,
          received_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', po.id)
      if (poErr) throw poErr
      await audit({
        action: 'PO_RECEIVED',
        entity: 'purchase_order',
        entityId: po.id,
        entityName: po.supplier_name,
        performer: profile,
      })
      fetchAll()
    } catch (err) {
      toast.error(
        'Error',
        'Failed to receive PO: ' + (err instanceof Error ? err.message : String(err))
      )
    }
  }

  const markPaid = async (po: PurchaseOrder) => {
    const { error } = await supabase
      .from('purchase_orders')
      .update({ payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] })
      .eq('id', po.id)
    if (error) {
      toast.error('Error', 'Failed to mark paid: ' + error.message)
      return
    }
    fetchAll()
  }

  const poTotal = pos.reduce((s, p) => s + (p.total_cost || 0), 0)
  const poUnpaid = pos
    .filter((p) => p.payment_status === 'unpaid')
    .reduce((s, p) => s + (p.total_cost || 0), 0)
  const poPending = pos.filter((p) => p.status === 'pending').length

  const supplierFormFields: { key: keyof SupplierForm; label: string; placeholder: string }[] = [
    { key: 'name', label: 'Supplier Name *', placeholder: 'e.g. Beersheba Distributors' },
    { key: 'contact_name', label: 'Contact Person', placeholder: 'e.g. John Adeyemi' },
    { key: 'phone', label: 'Phone', placeholder: '+234...' },
    { key: 'email', label: 'Email', placeholder: 'supplier@email.com' },
    { key: 'address', label: 'Address', placeholder: 'Supplier address' },
    {
      key: 'items_supplied',
      label: 'Items Supplied',
      placeholder: 'e.g. Beer, Spirits, Soft drinks',
    },
    { key: 'payment_terms', label: 'Payment Terms', placeholder: 'e.g. 30 days, COD' },
  ]

  if (loading)
    return <div className="flex items-center justify-center p-12 text-amber-500">Loading...</div>

  return (
    <div className="min-h-full bg-gray-950 text-white">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="text-gray-400 hover:text-white">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-white font-bold text-sm">Supplier Management</h1>
            <p className="text-gray-400 text-xs">Purchase orders & supplier records</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowSupplierModal(true)
              setEditingSupplier(null)
              setSupplierForm({
                name: '',
                contact_name: '',
                phone: '',
                email: '',
                address: '',
                items_supplied: '',
                payment_terms: '',
                notes: '',
              })
            }}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-white text-sm px-3 py-2 rounded-xl border border-gray-700"
          >
            <Plus size={14} /> Supplier
          </button>
          <button
            onClick={() => {
              setShowPOModal(true)
              setPOForm({ supplier_id: '', expected_date: '', notes: '', items: [] })
            }}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm px-3 py-2 rounded-xl"
          >
            <Plus size={14} /> Purchase Order
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-4">
        {[
          { label: 'Total Spend', value: '₦' + poTotal.toLocaleString(), color: 'text-white' },
          { label: 'Unpaid Orders', value: '₦' + poUnpaid.toLocaleString(), color: 'text-red-400' },
          { label: 'Pending Delivery', value: poPending, color: 'text-amber-400' },
        ].map((card) => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">{card.label}</p>
            <p className={`text-lg md:text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="px-4">
        <div className="flex bg-gray-900 rounded-xl p-1 gap-1 w-full md:w-fit border border-gray-800">
          {(['suppliers', 'orders'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${tab === t ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
            >
              {t === 'suppliers' ? 'Suppliers' : 'Purchase Orders'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {tab === 'suppliers' &&
          (suppliers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Truck size={32} className="mx-auto mb-3 opacity-40" />
              <p>No active suppliers.</p>
            </div>
          ) : (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search suppliers…"
                className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-4 py-2.5 mb-3 focus:outline-none focus:border-amber-500"
              />
              {suppliers
                .filter(
                  (s) =>
                    !search ||
                    s.name.toLowerCase().includes(search.toLowerCase()) ||
                    (s.contact_name || '').toLowerCase().includes(search.toLowerCase())
                )
                .map((s) => (
                  <div
                    key={s.id}
                    className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start justify-between gap-4"
                  >
                    <div className="flex-1">
                      <p className="text-white font-bold">{s.name}</p>
                      {s.contact_name && <p className="text-gray-400 text-sm">{s.contact_name}</p>}
                      <div className="flex gap-4 mt-1">
                        {s.phone && (
                          <span className="text-gray-500 text-xs flex items-center gap-1">
                            <Phone size={10} />
                            {s.phone}
                          </span>
                        )}
                        {s.email && (
                          <span className="text-gray-500 text-xs flex items-center gap-1">
                            <Mail size={10} />
                            {s.email}
                          </span>
                        )}
                      </div>
                      {s.items_supplied && (
                        <p className="text-gray-500 text-xs mt-1">Supplies: {s.items_supplied}</p>
                      )}
                      {s.payment_terms && (
                        <p className="text-gray-500 text-xs">Terms: {s.payment_terms}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditSupplier(s)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deactivateSupplier(s.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
            </>
          ))}

        {tab === 'orders' &&
          (pos.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Package size={32} className="mx-auto mb-3 opacity-40" />
              <p>No purchase orders yet.</p>
            </div>
          ) : (
            pos.map((po) => (
              <div
                key={po.id}
                className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
              >
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-bold">{po.supplier_name}</p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-lg ${po.status === 'received' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}
                      >
                        {po.status}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-lg ${po.payment_status === 'paid' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}
                      >
                        {po.payment_status}
                      </span>
                    </div>
                    <p className="text-amber-400 font-bold">
                      ₦{(po.total_cost || 0).toLocaleString()}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {new Date(po.created_at).toLocaleDateString('en-NG')} · by{' '}
                      {po.ordered_by_name}
                      {po.expected_date && ' · Expected: ' + po.expected_date}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {po.status === 'pending' && (
                      <button
                        onClick={() => receivePO(po)}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20"
                      >
                        <CheckCircle size={12} /> Receive
                      </button>
                    )}
                    {po.payment_status === 'unpaid' && (
                      <button
                        onClick={() => markPaid(po)}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20"
                      >
                        Mark Paid
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedPO(expandedPO === po.id ? null : po.id)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400"
                    >
                      Items{' '}
                      {expandedPO === po.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>
                </div>
                {expandedPO === po.id && (
                  <div className="border-t border-gray-800 p-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 text-xs">
                          <th className="text-left pb-2">Item</th>
                          <th className="text-right pb-2">Qty</th>
                          <th className="text-right pb-2">Unit Cost</th>
                          <th className="text-right pb-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(po.items || []).map((item, i) => (
                          <tr key={i} className="border-t border-gray-800/50">
                            <td className="py-2 text-white">{item.name}</td>
                            <td className="py-2 text-right text-gray-400">{item.quantity}</td>
                            <td className="py-2 text-right text-gray-400">
                              ₦{(item.unit_cost || 0).toLocaleString()}
                            </td>
                            <td className="py-2 text-right text-amber-400 font-medium">
                              ₦{(item.total || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {po.notes && <p className="text-gray-500 text-xs mt-3">Notes: {po.notes}</p>}
                    {po.received_date && (
                      <p className="text-gray-500 text-xs">
                        Received: {po.received_date} by {po.received_by_name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
          ))}
      </div>

      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">
                {editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
              <button
                onClick={() => setShowSupplierModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            {supplierFormFields.map((f) => (
              <div key={f.key}>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  {f.label}
                </label>
                <input
                  value={supplierForm[f.key]}
                  onChange={(e) => setSupplierForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            ))}
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Notes
              </label>
              <textarea
                value={supplierForm.notes}
                onChange={(e) => setSupplierForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Any additional notes"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => setShowSupplierModal(false)}
                className="py-3 rounded-xl bg-gray-800 text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={saveSupplier}
                disabled={saving}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-400 text-black font-bold"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPOModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">New Purchase Order</h3>
              <button
                onClick={() => setShowPOModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Supplier *
              </label>
              <select
                value={poForm.supplier_id}
                onChange={(e) => setPOForm((p) => ({ ...p, supplier_id: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">Select supplier...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Expected Delivery Date
              </label>
              <input
                type="date"
                value={poForm.expected_date}
                onChange={(e) => setPOForm((p) => ({ ...p, expected_date: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-white text-sm font-medium">Add Items</p>
              <select
                value={poItem.inventory_id}
                onChange={(e) => {
                  const inv = inventory.find((i) => i.id === e.target.value)
                  setPOItem((p) => ({
                    ...p,
                    inventory_id: e.target.value,
                    name: inv?.item_name || '',
                  }))
                }}
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">Link to inventory item (optional)...</option>
                {inventory.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.item_name} (stock: {i.current_stock} {i.unit})
                  </option>
                ))}
              </select>
              <input
                value={poItem.name}
                onChange={(e) => setPOItem((p) => ({ ...p, name: e.target.value }))}
                placeholder="Item name *"
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={poItem.quantity}
                  onChange={(e) => setPOItem((p) => ({ ...p, quantity: e.target.value }))}
                  placeholder="Quantity *"
                  className="bg-gray-900 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <input
                  type="number"
                  value={poItem.unit_cost}
                  onChange={(e) => setPOItem((p) => ({ ...p, unit_cost: e.target.value }))}
                  placeholder="Unit cost (₦) *"
                  className="bg-gray-900 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <button
                onClick={addPOItem}
                className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium flex items-center justify-center gap-1"
              >
                <Plus size={14} /> Add Item
              </button>
            </div>
            {poForm.items.length > 0 && (
              <div className="space-y-2">
                {poForm.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3"
                  >
                    <div>
                      <p className="text-white text-sm">{item.name}</p>
                      <p className="text-gray-500 text-xs">
                        {item.quantity} × ₦{item.unit_cost.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-amber-400 font-medium text-sm">
                        ₦{item.total.toLocaleString()}
                      </p>
                      <button
                        onClick={() => removePOItem(i)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between px-4 py-2 border-t border-gray-800">
                  <span className="text-gray-400 text-sm">Total</span>
                  <span className="text-white font-bold">
                    ₦{poForm.items.reduce((s, i) => s + i.total, 0).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Notes
              </label>
              <textarea
                value={poForm.notes}
                onChange={(e) => setPOForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Any notes for this order"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => setShowPOModal(false)}
                className="py-3 rounded-xl bg-gray-800 text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={savePO}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold"
              >
                Create PO
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
