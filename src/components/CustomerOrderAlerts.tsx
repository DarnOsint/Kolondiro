import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ShoppingCart, Check, X, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import type { Profile } from '../types'

function useElapsed(since: string | null): string {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!since) return
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [since])
  const m = Math.floor(elapsed / 60)
  return m > 0 ? `${m}m ${elapsed % 60}s` : `${elapsed % 60}s`
}

interface OrderItem {
  menu_item_id: string
  quantity: number
  price: number
  total: number
  name: string
  destination?: string
}
interface CustomerOrder {
  id: string
  table_id: string
  table_name: string
  total_amount: number
  created_at: string
  items: OrderItem[]
}

function CustomerOrderCard({
  order,
  profile,
  onDone,
}: {
  order: CustomerOrder
  profile: Profile
  onDone: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const elapsed = useElapsed(order.created_at)

  const accept = async () => {
    setAccepting(true)
    await supabase
      .from('customer_orders')
      .update({
        status: 'accepted',
        accepted_by: profile.id,
        accepted_by_name: profile.full_name,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', order.id)

    const today = new Date()
    today.setHours(8, 0, 0, 0)
    const { data: existing } = await supabase
      .from('orders')
      .select('id, total_amount')
      .eq('table_id', order.table_id)
      .eq('status', 'open')
      .gte('created_at', today.toISOString())
      .maybeSingle()

    let orderId = existing?.id
    const newTotal = (existing?.total_amount || 0) + order.total_amount

    if (!orderId) {
      const { data: newOrder } = await supabase
        .from('orders')
        .insert({
          table_id: order.table_id,
          staff_id: profile.id,
          status: 'open',
          total_amount: order.total_amount,
          order_type: 'dine_in',
        })
        .select('id')
        .single()
      orderId = newOrder?.id
      await supabase.from('tables').update({ status: 'occupied' }).eq('id', order.table_id)
    } else {
      await supabase.from('orders').update({ total_amount: newTotal }).eq('id', orderId)
    }

    if (orderId) {
      await supabase.from('order_items').insert(
        order.items.map((item) => ({
          order_id: orderId,
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          unit_price: item.price,
          total_price: item.total,
          status: 'pending',
          destination: item.destination || 'kitchen',
        }))
      )
    }
    setAccepting(false)
    onDone()
  }

  const decline = async () => {
    setDeclining(true)
    await supabase
      .from('customer_orders')
      .update({
        status: 'declined',
        decline_reason: declineReason || 'Order declined by waiter',
      })
      .eq('id', order.id)
    setDeclining(false)
    onDone()
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <ShoppingCart size={15} className="text-amber-400" />
          <span className="text-white font-bold text-sm">{order.table_name}</span>
          <span className="text-amber-400 text-xs">
            {order.items?.length} item{order.items?.length !== 1 ? 's' : ''} · ₦
            {order.total_amount?.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs flex items-center gap-1">
            <Clock size={10} /> {elapsed}
          </span>
          {expanded ? (
            <ChevronUp size={14} className="text-gray-500" />
          ) : (
            <ChevronDown size={14} className="text-gray-500" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/20 px-4 pb-4">
          <div className="py-2 space-y-1">
            {order.items?.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-300">
                  {item.quantity}x {item.name}
                </span>
                <span className="text-gray-500">₦{item.total?.toLocaleString()}</span>
              </div>
            ))}
          </div>
          {showDecline && (
            <div className="mb-3">
              <input
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Reason for declining (optional)"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-red-500"
              />
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {!showDecline ? (
              <>
                <button
                  onClick={accept}
                  disabled={accepting}
                  className="flex-1 bg-green-500 hover:bg-green-400 disabled:bg-gray-700 text-black font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-sm transition-colors"
                >
                  <Check size={14} /> {accepting ? 'Accepting...' : 'Accept'}
                </button>
                <button
                  onClick={() => setShowDecline(true)}
                  className="flex-1 bg-gray-800 hover:bg-red-500/10 border border-gray-700 hover:border-red-500/30 text-gray-400 hover:text-red-400 font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-sm transition-colors"
                >
                  <X size={14} /> Decline
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={decline}
                  disabled={declining}
                  className="flex-1 bg-red-500 hover:bg-red-400 disabled:bg-gray-700 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-sm transition-colors"
                >
                  <X size={14} /> {declining ? 'Declining...' : 'Confirm Decline'}
                </button>
                <button
                  onClick={() => setShowDecline(false)}
                  className="px-4 bg-gray-800 text-gray-400 rounded-xl text-sm"
                >
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  profile: Profile
  assignedTableIds?: string[]
}

export default function CustomerOrderAlerts({ profile, assignedTableIds }: Props) {
  const [pendingOrders, setPendingOrders] = useState<CustomerOrder[]>([])

  const expireOldOrders = async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    await supabase
      .from('customer_orders')
      .update({
        status: 'declined',
        decline_reason: 'Order timed out — not attended to within 30 minutes',
      })
      .eq('status', 'pending')
      .lt('created_at', cutoff)
  }

  const fetchPending = async () => {
    await expireOldOrders()
    const today = new Date()
    today.setHours(8, 0, 0, 0)
    const { data: directTables } = await supabase
      .from('tables')
      .select('id')
      .eq('assigned_staff', profile?.id)
    const directIds = (directTables || []).map((t) => t.id)
    const allTableIds = [...new Set([...(assignedTableIds || []), ...directIds])]
    if (!allTableIds.length) return
    const { data } = await supabase
      .from('customer_orders')
      .select('*')
      .eq('status', 'pending')
      .in('table_id', allTableIds)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true })
    setPendingOrders((data || []) as CustomerOrder[])
  }

  useEffect(() => {
    if (!assignedTableIds?.length) return
    void fetchPending()
    const expireInterval = setInterval(() => {
      void expireOldOrders().then(fetchPending)
    }, 30_000)
    const ch = supabase
      .channel('customer-order-alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_orders' },
        fetchPending
      )
      .subscribe()
    return () => {
      clearInterval(expireInterval)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedTableIds])

  if (!pendingOrders.length) return null

  return (
    <div className="px-4 py-3 space-y-3 border-b border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-amber-400 text-xs font-bold uppercase tracking-wide">
          {pendingOrders.length} Customer Order{pendingOrders.length !== 1 ? 's' : ''} Awaiting
          Approval
        </span>
      </div>
      {pendingOrders.map((order) => (
        <CustomerOrderCard key={order.id} order={order} profile={profile} onDone={fetchPending} />
      ))}
    </div>
  )
}
