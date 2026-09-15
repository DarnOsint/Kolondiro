import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { HelpTooltip } from '../../components/HelpTooltip'
import { Receipt, Bell, Plus, Loader, CheckCircle, Clock, ChefHat, Truck } from 'lucide-react'

interface OrderItem {
  id: string
  status: string
  quantity: number
  unit_price: number
  menu_items?: { name: string; price: number }
}

interface OrderTable {
  name: string
  assigned_staff?: string | null
  profiles?: { full_name: string; id: string } | null
}

interface Order {
  id: string
  status: string
  total_amount: number
  payment_method: string
  created_at: string
  table_id?: string
  notes?: string
  order_items?: OrderItem[]
  tables?: OrderTable | null
}

const ITEM_STATUS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  pending: { label: 'Waiting', icon: Clock, color: 'text-gray-400' },
  preparing: { label: 'Preparing', icon: ChefHat, color: 'text-amber-400' },
  ready: { label: 'Ready!', icon: CheckCircle, color: 'text-green-400' },
  delivered: { label: 'Served', icon: Truck, color: 'text-blue-400' },
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank_pos: 'Bank POS',
  card: 'Bank POS',
  transfer: 'Bank Transfer',
  bank_transfer: 'Bank Transfer',
  run_tab: 'Run Tab',
}

export default function ReceiptView() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [waiterCalled, setWaiterCalled] = useState(false)
  const [calling, setCalling] = useState(false)

  const fetchOrder = async () => {
    const { data } = await supabase
      .from('orders')
      .select(
        '*, order_items(*, menu_items(name, price)), tables(name, assigned_staff, profiles(full_name, id))'
      )
      .eq('id', orderId!)
      .single()
    setOrder(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchOrder()
    const channel = supabase
      .channel(`receipt-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` },
        fetchOrder
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        fetchOrder
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const callWaiter = async () => {
    if (waiterCalled || calling || !order?.tables) return
    setCalling(true)
    const waitronId = order.tables?.assigned_staff || order.tables?.profiles?.id || null
    await supabase.from('waiter_calls').insert({
      table_id: order.table_id,
      table_name: order.tables?.name,
      waitron_id: waitronId,
      waitron_name: order.tables?.profiles?.full_name || null,
      status: 'pending',
    })
    if (waitronId) {
      await sendPushToStaff(waitronId, '🔔 Waiter Called', `${order.tables?.name} needs assistance`)
    }
    setCalling(false)
    setWaiterCalled(true)
    setTimeout(() => setWaiterCalled(false), 30000)
  }

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <Loader size={24} className="text-amber-500 animate-spin" />
      </div>
    )

  if (!order)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-white font-bold text-lg mb-2">Receipt not found</p>
          <p className="text-gray-500 text-sm">Please ask your waiter for assistance.</p>
        </div>
      </div>
    )

  const items = order.order_items || []
  const isPaid = order.status === 'paid'

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <Receipt size={17} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm">Your Receipt</h1>
              <p className="text-amber-400 text-xs">{order.tables?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HelpTooltip
              storageKey="customer-receipt"
              tips={[
                {
                  id: 'rv-status',
                  title: 'Order Status',
                  description:
                    'This page shows whether your order is open or has been settled. The status updates automatically — no need to refresh.',
                },
                {
                  id: 'rv-items',
                  title: 'Item Progress',
                  description:
                    'Each item shows its stage — Pending (not started), Preparing (being made), Ready (on its way to you), or Served (delivered). Once all items are served, the order is complete.',
                },
                {
                  id: 'rv-payment',
                  title: 'Paying Your Bill',
                  description:
                    'Payment is collected by your waiter at the table — Cash, Bank POS, Bank Transfer, or run a tab for later. Once paid, this receipt will confirm Payment complete and show the method used.',
                },
                {
                  id: 'rv-waiter',
                  title: 'Call the Waiter',
                  description:
                    'Tap Call Waiter to send your assigned waitron an instant notification. Use this to ask for anything or signal that you are ready to pay.',
                },
              ]}
            />
            <button
              onClick={callWaiter}
              disabled={calling || waiterCalled}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-all ${waiterCalled ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-gray-800 text-white border border-gray-700 hover:bg-gray-700'}`}
            >
              <Bell size={13} />
              {waiterCalled ? 'Called!' : calling ? '...' : 'Call Waiter'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4 pb-24">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs">Order Reference</p>
            <p className="text-white font-bold font-mono">{order.id.slice(-8).toUpperCase()}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 text-xs">
              {new Date(order.created_at).toLocaleDateString('en-NG', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
            <p className="text-gray-400 text-xs">
              {new Date(order.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        <div
          className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${isPaid ? 'bg-green-500/5 border-green-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}
        >
          {isPaid ? (
            <CheckCircle size={18} className="text-green-400 shrink-0" />
          ) : (
            <Clock size={18} className="text-amber-400 shrink-0 animate-pulse" />
          )}
          <div>
            <p className={`text-sm font-bold ${isPaid ? 'text-green-400' : 'text-amber-400'}`}>
              {isPaid ? 'Payment complete' : 'Order in progress'}
            </p>
            <p className="text-gray-500 text-xs">
              {isPaid
                ? `Paid via ${METHOD_LABEL[order.payment_method] || order.payment_method}`
                : 'Payment will be collected by your waiter'}
            </p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-white font-bold text-sm">Items Ordered</p>
          </div>
          <div className="divide-y divide-gray-800">
            {items.map((item) => {
              const cfg = ITEM_STATUS[item.status] || ITEM_STATUS.pending
              const Icon = cfg.icon
              const unitPrice = item.unit_price || item.menu_items?.price || 0
              return (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{item.menu_items?.name}</p>
                    <div className={`inline-flex items-center gap-1 mt-1 text-xs ${cfg.color}`}>
                      <Icon size={11} />
                      {cfg.label}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-gray-500 text-xs">x{item.quantity}</p>
                    <p className="text-white text-sm font-bold">
                      ₦{(unitPrice * item.quantity).toLocaleString()}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="px-4 py-3 border-t border-gray-800">
            <div className="flex items-center justify-between pt-1">
              <span className="text-white font-bold">Total</span>
              <span className="text-amber-400 font-bold text-xl">
                ₦{order.total_amount?.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {!isPaid && order.table_id && (
          <a
            href={`/table/${order.table_id}`}
            className="w-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/5 font-medium py-3 rounded-2xl flex items-center justify-center gap-2 transition-colors text-sm"
          >
            <Plus size={16} /> Add More Items
          </a>
        )}

        <p className="text-gray-600 text-xs text-center px-4">
          Please do not leave without settling your bill with your waiter.
        </p>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-gray-950 border-t border-gray-800 py-2 text-center">
        <p className="text-gray-700 text-xs">Kolondiro · RestaurantOS</p>
      </div>
    </div>
  )
}
