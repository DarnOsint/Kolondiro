import { useState, useEffect, useCallback } from 'react'
import { Package, Search, RefreshCw, Check, X, Plus, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import type { Profile } from '../../types'

interface InventoryItem {
  id: string
  item_name: string
  category: string | null
  unit: string
  current_stock: number
  minimum_stock: number
  cost_price: number | null
  is_active: boolean
}

interface StoreRequest {
  id: string
  item_name: string
  inventory_id: string | null
  quantity: number
  unit: string
  requested_by: string | null
  requested_by_name: string | null
  status: string
  reason: string | null
  created_at: string
}

interface RestockForm {
  quantity: string
  cost_price_per_unit: string
  supplier_name: string
  notes: string
}

const elapsed = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function SupervisorMainStoreTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [view, setView] = useState<'stock' | 'requests'>('requests')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [requests, setRequests] = useState<StoreRequest[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null)
  const [restockForm, setRestockForm] = useState<RestockForm>({
    quantity: '',
    cost_price_per_unit: '',
    supplier_name: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [reqDate, setReqDate] = useState(() => {
    const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
    return wat.toLocaleDateString('en-CA')
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const dayStart = new Date(reqDate + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const [{ data: inv }, { data: reqs }] = await Promise.all([
      supabase
        .from('inventory')
        .select(
          'id, item_name, category, unit, current_stock, minimum_stock, cost_price, is_active'
        )
        .eq('is_active', true)
        .order('item_name'),
      supabase
        .from('store_requests')
        .select('*')
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ])
    setItems((inv || []) as InventoryItem[])
    setRequests((reqs || []) as StoreRequest[])
    setLoading(false)
  }, [reqDate])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('supervisor-store')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_requests' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchData)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const approveRequest = async (req: StoreRequest) => {
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('approve_store_request', {
        req_id: req.id,
        approver_name: profile?.full_name ?? null,
      })
      if (error) throw error
      if (!data || (data as any)?.status !== 'approved') {
        toast.info('Already handled')
        setSaving(false)
        return
      }

      await audit({
        action: 'STORE_REQUEST_APPROVED',
        entity: 'store_requests',
        entityId: req.id,
        entityName: req.item_name,
        newValue: {
          quantity: req.quantity,
          unit: req.unit,
          requested_by: req.requested_by_name,
          approved_by: profile?.full_name,
        },
        performer: profile as Profile,
      })

      // Notify barman
      if (req.requested_by)
        sendPushToStaff(
          req.requested_by,
          '✅ Request Approved',
          `${req.quantity}x ${req.item_name} released to chiller`
        ).catch(() => {})
      toast.success('Approved', `${req.quantity} ${req.unit} of ${req.item_name} sent to chiller`)
      setRequests((current) => current.filter((request) => request.id !== req.id))
      fetchData()
    } catch (e: any) {
      toast.error('Error', e?.message || 'Failed to approve')
    }
    setSaving(false)
  }

  const rejectRequest = async (req: StoreRequest, reason: string) => {
    setSaving(true)
    try {
      await supabase
        .from('store_requests')
        .update({
          status: 'rejected',
          approved_by: profile?.id ?? null,
          approved_by_name: profile?.full_name ?? null,
          reject_reason: reason || 'Rejected by supervisor',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', req.id)

      await audit({
        action: 'STORE_REQUEST_REJECTED',
        entity: 'store_requests',
        entityId: req.id,
        entityName: req.item_name,
        newValue: { quantity: req.quantity, rejected_by: profile?.full_name, reason },
        performer: profile as Profile,
      })

      if (req.requested_by)
        sendPushToStaff(
          req.requested_by,
          '❌ Request Rejected',
          `${req.item_name} — ${reason || 'No reason'}`
        ).catch(() => {})
      toast.success('Rejected', `Request for ${req.item_name} rejected`)
      setRequests((current) => current.filter((request) => request.id !== req.id))
      fetchData()
    } catch (e: any) {
      toast.error('Error', e?.message || 'Failed to reject')
    }
    setSaving(false)
  }

  const processRestock = async () => {
    if (!restockItem) return
    const qty = parseFloat(restockForm.quantity)
    if (!qty || qty <= 0) {
      toast.error('Invalid', 'Enter a valid quantity')
      return
    }
    setSaving(true)
    try {
      const prevStock = restockItem.current_stock
      const newStock = prevStock + qty
      await supabase
        .from('inventory')
        .update({ current_stock: newStock, updated_at: new Date().toISOString() })
        .eq('id', restockItem.id)

      await supabase.from('restock_log').insert({
        inventory_id: restockItem.id,
        item_name: restockItem.item_name,
        quantity_added: qty,
        previous_stock: prevStock,
        new_stock: newStock,
        cost_price_per_unit: parseFloat(restockForm.cost_price_per_unit) || 0,
        total_cost: qty * (parseFloat(restockForm.cost_price_per_unit) || 0),
        supplier_name: restockForm.supplier_name || null,
        payment_method: 'cash',
        condition: 'good',
        notes: restockForm.notes || null,
        restocked_by: profile?.id,
        restocked_by_name: profile?.full_name,
        restocked_at: new Date().toISOString(),
      })

      await audit({
        action: 'INVENTORY_RESTOCK',
        entity: 'inventory',
        entityId: restockItem.id,
        entityName: restockItem.item_name,
        oldValue: { stock: prevStock },
        newValue: { stock: newStock, added: qty, by: profile?.full_name },
        performer: profile as Profile,
      })

      toast.success('Restocked', `${restockItem.item_name}: ${prevStock} → ${newStock}`)
      setRestockItem(null)
      setRestockForm({ quantity: '', cost_price_per_unit: '', supplier_name: '', notes: '' })
      fetchData()
    } catch (e: any) {
      toast.error('Error', e?.message || 'Restock failed')
    }
    setSaving(false)
  }

  const filtered = items.filter(
    (i) =>
      i.item_name.toLowerCase().includes(search.toLowerCase()) ||
      (i.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const outOfStock = items.filter((i) => i.current_stock <= 0).length
  const lowStock = items.filter(
    (i) => i.current_stock > 0 && i.current_stock <= i.minimum_stock
  ).length

  return (
    <div className="space-y-3">
      {/* Sub-view toggle + pending badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setView('requests')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${view === 'requests' ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Pending Requests
          {requests.length > 0 && (
            <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {requests.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setView('stock')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${view === 'stock' ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Stock Levels
        </button>
        <input
          type="date"
          value={reqDate}
          onChange={(e) => setReqDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-2 py-1.5 text-xs"
        />
        <button
          onClick={() => {
            const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
            if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
            setReqDate(wat.toLocaleDateString('en-CA'))
          }}
          className={`px-2 py-1.5 rounded-xl text-xs font-medium ${
            reqDate ===
            (() => {
              const w = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
              if (w.getHours() < 8) w.setDate(w.getDate() - 1)
              return w.toLocaleDateString('en-CA')
            })()
              ? 'bg-amber-500 text-black'
              : 'bg-gray-900 text-gray-400'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(reqDate)
            d.setDate(d.getDate() - 1)
            setReqDate(d.toLocaleDateString('en-CA'))
          }}
          className="px-2 py-1.5 rounded-xl text-xs bg-gray-900 text-gray-400 hover:text-white"
        >
          Prev Day
        </button>
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
        {(outOfStock > 0 || lowStock > 0) && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            {outOfStock > 0 && <span className="text-red-400 font-bold">{outOfStock} out</span>}
            {lowStock > 0 && <span className="text-amber-400 font-bold">{lowStock} low</span>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : view === 'requests' ? (
        /* ── PENDING REQUESTS ── */
        requests.length === 0 ? (
          <div className="text-center py-12">
            <Package size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No pending requests</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => (
              <RequestCard
                key={req.id}
                req={req}
                onApprove={() => approveRequest(req)}
                onReject={(reason) => rejectRequest(req, reason)}
                saving={saving}
              />
            ))}
          </div>
        )
      ) : (
        /* ── STOCK LEVELS ── */
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="space-y-1.5">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-white text-sm font-semibold">{item.item_name}</p>
                  <p className="text-gray-500 text-xs">
                    {item.category || 'General'} · {item.unit}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p
                      className={`text-lg font-bold ${item.current_stock <= 0 ? 'text-red-400' : item.current_stock <= item.minimum_stock ? 'text-amber-400' : 'text-white'}`}
                    >
                      {item.current_stock}
                    </p>
                    <p className="text-gray-600 text-[10px]">min: {item.minimum_stock}</p>
                  </div>
                  <button
                    onClick={() => {
                      setRestockItem(item)
                      setRestockForm({
                        quantity: '',
                        cost_price_per_unit: String(item.cost_price || ''),
                        supplier_name: '',
                        notes: '',
                      })
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-xl text-xs font-bold hover:bg-green-500/30 border border-green-500/30"
                  >
                    <Plus size={12} /> Restock
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Restock Modal */}
      {restockItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-sm p-5">
            <h3 className="text-white font-bold mb-1">Restock {restockItem.item_name}</h3>
            <p className="text-gray-500 text-xs mb-4">
              Current: {restockItem.current_stock} {restockItem.unit}
            </p>
            <div className="space-y-3">
              <input
                type="number"
                placeholder="Quantity to add"
                value={restockForm.quantity}
                onChange={(e) => setRestockForm((f) => ({ ...f, quantity: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <input
                type="number"
                placeholder="Cost per unit (optional)"
                value={restockForm.cost_price_per_unit}
                onChange={(e) =>
                  setRestockForm((f) => ({ ...f, cost_price_per_unit: e.target.value }))
                }
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <input
                type="text"
                placeholder="Supplier (optional)"
                value={restockForm.supplier_name}
                onChange={(e) => setRestockForm((f) => ({ ...f, supplier_name: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <input
                type="text"
                placeholder="Notes (optional)"
                value={restockForm.notes}
                onChange={(e) => setRestockForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRestockItem(null)}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={processRestock}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-green-500 text-black font-bold rounded-xl text-sm hover:bg-green-400 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Restock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RequestCard({
  req,
  onApprove,
  onReject,
  saving,
}: {
  req: StoreRequest
  onApprove: () => void
  onReject: (reason: string) => void
  saving: boolean
}) {
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  return (
    <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-white text-sm font-bold">
            {req.quantity} {req.unit} of {req.item_name}
          </p>
          <p className="text-gray-400 text-xs">
            Requested by {req.requested_by_name || 'Unknown'} · {elapsed(req.created_at)} ago
          </p>
          {req.reason && <p className="text-gray-500 text-xs italic mt-1">{req.reason}</p>}
        </div>
        <Clock size={14} className="text-amber-400 shrink-0 mt-1" />
      </div>
      {showReject ? (
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            placeholder="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs"
            autoFocus
          />
          <button
            onClick={() => {
              onReject(rejectReason)
              setShowReject(false)
            }}
            disabled={saving}
            className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold"
          >
            Confirm
          </button>
          <button
            onClick={() => setShowReject(false)}
            className="px-2 py-1.5 bg-gray-800 text-gray-400 rounded-lg text-xs"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onApprove}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-xs py-2 rounded-xl"
          >
            <Check size={13} /> Approve
          </button>
          <button
            onClick={() => setShowReject(true)}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-xs py-2 rounded-xl"
          >
            <X size={13} /> Reject
          </button>
        </div>
      )}
    </div>
  )
}
