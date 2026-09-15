import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, XCircle, Edit2, AlertTriangle, CheckCircle, X, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { audit } from '../../../lib/audit'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useVisibilityInterval } from '../../../hooks/useVisibilityInterval'
import EditOrderModal from './EditOrderModal'
import type { Profile } from '../../../types'

interface DeleteRequest {
  id: string
  order_id: string
  order_item_id: string
  item_name: string
  quantity: number
  item_total: number
  table_name: string
  waitron_id: string
  waitron_name: string
  requested_at: string
}

interface OrderRow {
  id: string
  table_id?: string
  total_amount?: number
  created_at: string
  order_type?: string
  tables?: { name: string; table_categories?: { name: string } | null } | null
  profiles?: { full_name: string } | null
  order_items?: Array<{
    id: string
    menu_item_id: string
    quantity: number
    unit_price: number
    total_price: number
    status: string
    destination: string
    modifier_notes?: string | null
    menu_items?: {
      name: string
      menu_categories?: { name?: string; destination?: string } | null
    } | null
  }>
}

export default function OpenOrdersTab() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null)
  const [deleteRequests, setDeleteRequests] = useState<DeleteRequest[]>([])
  const toast = useToast()

  const fetchDeleteRequests = useCallback(async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('id', 'pending_delete_requests')
      .single()
    if (data?.value) {
      try {
        setDeleteRequests(JSON.parse(data.value))
      } catch {
        /* invalid */
      }
    } else {
      setDeleteRequests([])
    }
  }, [])

  const approveDelete = async (req: DeleteRequest) => {
    // Delete the item from DB
    const { error } = await supabase.from('order_items').delete().eq('id', req.order_item_id)
    if (error) {
      toast.error('Error', 'Failed to delete item: ' + error.message)
      return
    }
    // Recalculate order total
    const { data: remaining } = await supabase
      .from('order_items')
      .select('total_price')
      .eq('order_id', req.order_id)
    const newTotal = (remaining || []).reduce(
      (s: number, r: { total_price: number }) => s + (r.total_price || 0),
      0
    )
    await supabase
      .from('orders')
      .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
      .eq('id', req.order_id)

    // Remove from pending list
    const updated = deleteRequests.filter((r) => r.id !== req.id)
    await supabase.from('settings').upsert(
      {
        id: 'pending_delete_requests',
        value: JSON.stringify(updated),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    setDeleteRequests(updated)

    await audit({
      action: 'ITEM_DELETE_APPROVED',
      entity: 'order_item',
      entityId: req.order_item_id,
      entityName: req.item_name,
      oldValue: { requested_by: req.waitron_name, table: req.table_name },
      newValue: { approved_by: profile?.full_name, new_total: newTotal },
      performer: profile as Profile,
    })
    toast.success('Approved', `${req.item_name} removed from ${req.table_name}`)
    fetchOrders()
  }

  const rejectDelete = async (req: DeleteRequest) => {
    const updated = deleteRequests.filter((r) => r.id !== req.id)
    await supabase.from('settings').upsert(
      {
        id: 'pending_delete_requests',
        value: JSON.stringify(updated),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    setDeleteRequests(updated)
    await audit({
      action: 'ITEM_DELETE_REJECTED',
      entity: 'order_item',
      entityId: req.order_item_id,
      entityName: req.item_name,
      newValue: { rejected_by: profile?.full_name, table: req.table_name },
      performer: profile as Profile,
    })
    toast.success('Rejected', `${req.item_name} stays on the order`)
  }

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(
        '*, table_id, tables(name, table_categories(name)), profiles(full_name), order_items(*, menu_items(name, menu_categories(name, destination)))'
      )
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    if (!error) setOrders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchOrders()
    fetchDeleteRequests()
    const ch = supabase
      .channel('open-orders-ch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchOrders, fetchDeleteRequests])

  useVisibilityInterval(fetchDeleteRequests, 30_000, [fetchDeleteRequests])

  if (loading)
    return <div className="flex items-center justify-center p-8 text-amber-500">Loading...</div>

  return (
    <>
      {/* Deletion requests from waitrons */}
      {deleteRequests.length > 0 && (
        <div className="mb-4 bg-red-500/5 border border-red-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 size={16} className="text-red-400" />
            <span className="text-red-400 font-bold text-sm">
              {deleteRequests.length} Deletion Request{deleteRequests.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {deleteRequests.map((req) => (
              <div key={req.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="mb-2">
                  <p className="text-white text-sm font-semibold">
                    {req.quantity}x {req.item_name}
                  </p>
                  <p className="text-gray-400 text-xs">
                    {req.table_name} — requested by {req.waitron_name}
                  </p>
                  <p className="text-gray-500 text-xs">
                    ₦{req.item_total.toLocaleString()} ·{' '}
                    {new Date(req.requested_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => approveDelete(req)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-xs py-2 rounded-xl transition-colors"
                  >
                    <CheckCircle size={13} /> Approve
                  </button>
                  <button
                    onClick={() => rejectDelete(req)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-xs py-2 rounded-xl transition-colors"
                  >
                    <X size={13} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
            <ShoppingBag size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No open orders right now</p>
          </div>
        ) : (
          orders.map((order) => {
            // Hide items that are pending return review by barman
            const visibleItems = (order.order_items || []).filter(
              (i) => !(i as any).return_requested
            )
            const itemsSum = visibleItems.reduce((s, i) => s + (i.total_price || 0), 0)
            const totalMismatch = Math.abs((order.total_amount || 0) - itemsSum) > 1
            const zoneName = (order.tables as unknown as { table_categories?: { name: string } })
              ?.table_categories?.name
            return (
              <div
                key={order.id}
                className={`bg-gray-900 rounded-2xl border p-4 ${totalMismatch ? 'border-red-500/40' : 'border-gray-800'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-bold">
                        {order.tables?.name || 'Unknown Table'}
                      </p>
                      {zoneName && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                          {zoneName}
                        </span>
                      )}
                      {totalMismatch && (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                          <AlertTriangle size={9} /> Total mismatch
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs">{order.profiles?.full_name}</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1.5">
                    <p className="text-amber-400 font-bold">
                      ₦{order.total_amount?.toLocaleString()}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {new Date(order.created_at).toLocaleTimeString('en-NG', {
                        timeZone: 'Africa/Lagos',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </p>
                    <button
                      onClick={() => setEditingOrder(order)}
                      className="flex items-center gap-1 text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg px-2 py-1 transition-colors"
                    >
                      <Edit2 size={10} /> Edit Order
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            'Force-close this order? Use this only for stuck orders that were already paid.'
                          )
                        )
                          return
                        const { error } = await supabase
                          .from('orders')
                          .update({
                            status: 'paid',
                            payment_method: 'transfer',
                            closed_at: new Date().toISOString(),
                          })
                          .eq('id', order.id)
                        if (error) {
                          toast.error('Error', 'Failed: ' + error.message)
                          return
                        }
                        // Mark all items delivered so KDS clears and shift summary is accurate
                        await supabase
                          .from('order_items')
                          .update({ status: 'delivered' })
                          .eq('order_id', order.id)
                        await supabase
                          .from('tables')
                          .update({ status: 'available', assigned_staff: null })
                          .eq('id', order.table_id)
                        fetchOrders()
                      }}
                      className="flex items-center gap-1 text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg px-2 py-1 transition-colors"
                    >
                      <XCircle size={10} /> Force Close
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {visibleItems.map((item) => (
                    <div key={String(item.id)} className="flex justify-between text-sm">
                      <span className="text-gray-300">
                        {item.quantity}x {item.menu_items?.name}
                      </span>
                      <span className="text-gray-400">
                        ₦{(item.total_price as number)?.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {visibleItems.length === 0 && (
                    <p className="text-gray-500 text-xs">All items pending return review</p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => {
            setEditingOrder(null)
            fetchOrders()
          }}
        />
      )}
    </>
  )
}
