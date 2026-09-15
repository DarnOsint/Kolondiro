import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { audit } from '../../lib/audit'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import {
  Beer,
  Clock,
  LogOut,
  RefreshCw,
  CheckCircle,
  BarChart2,
  RotateCcw,
  X,
  History,
  Snowflake,
  Package,
  ClipboardList,
} from 'lucide-react'
import BarChillerStock from '../backoffice/BarChillerStock'
import StoreRequestPanel from './StoreRequestPanel'
import type { KdsOrder } from './types'
import DailySummaryTab from './DailySummaryTab'
import { useToast } from '../../context/ToastContext'

const BarIssueLogTab = lazy(() => import('./BarIssueLogTab'))

const isBarItem = (item: KdsOrder['order_items'][number]): boolean => {
  const dest = (item.destination || '').toLowerCase()
  if (dest === 'mixologist') return false
  if (dest === 'bar') return true
  const catDest = item.menu_items?.menu_categories?.destination?.toLowerCase()
  if (catDest === 'mixologist') return false
  return catDest === 'bar'
}

const HELP_TIPS = [
  {
    id: 'bar-incoming',
    title: 'Incoming Orders',
    description:
      'Drink orders from all tables arrive the moment a waitron confirms on the POS. Sorted oldest first — always work top to bottom. Only bar-destined items appear here.',
  },
  {
    id: 'bar-status',
    title: 'Item Status',
    description:
      'Tap an item to mark it Ready. Use All Ready to mark the full order at once. Items disappear from the screen once ready.',
  },
  {
    id: 'bar-returns',
    title: 'Return Requests',
    description:
      'When a waitron marks an item as returned, it appears in the Returns section. You must Accept or Reject. Accepted returns are deducted from the order total automatically.',
  },
  {
    id: 'bar-notify',
    title: 'Waitron Notification',
    description:
      'Marking an item or full order ready sends an automatic push notification to the assigned waitron. No shouting across the floor.',
  },
  {
    id: 'bar-urgency',
    title: 'Urgency Colours',
    description:
      'Grey = normal (under 7 min). Amber = getting late (7–15 min). Red = critically overdue (15+ min). Prioritise red cards immediately.',
  },
]

interface MixoRequest {
  id: string
  items: Array<{ item: string; qty: number }>
  status: 'pending' | 'approved' | 'rejected'
  at: string
  requested_by?: string | null
  resolved_by?: string | null
}

function getElapsed(createdAt: string): string {
  const total = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${total % 60}s`
}
function getUrgencyColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 15) return 'border-red-500 bg-red-500/5'
  if (mins >= 7) return 'border-amber-500 bg-amber-500/5'
  return 'border-gray-700 bg-gray-900'
}
function getTimerColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 15) return 'text-red-400 font-bold'
  if (mins >= 7) return 'text-amber-400 font-bold'
  return 'text-gray-400'
}
function getStatusColor(status: string): string {
  if (status === 'ready') return 'bg-green-500/20 text-green-400 cursor-default'
  return 'bg-gray-700 text-gray-400'
}
function getNextStatus(status: string): string | null {
  if (status === 'pending') return 'ready'
  return null
}

function BarKDSInner() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [returnItems, setReturnItems] = useState<
    (KdsOrder['order_items'][0] & { tableName: string; orderId: string; staffId?: string | null })[]
  >([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<
    | 'orders'
    | 'returns'
    | 'summary'
    | 'history'
    | 'chiller'
    | 'issue_log'
    | 'requests'
    | 'store_requests'
  >('orders')
  const [returnHistory, setReturnHistory] = useState<
    Array<{
      id: string
      item_name: string
      quantity: number
      item_total: number
      table_name: string | null
      waitron_name: string | null
      return_reason: string | null
      status: string
      requested_at: string
      resolved_at: string | null
    }>
  >([])
  const [mixoRequests, setMixoRequests] = useState<MixoRequest[]>([])
  const [mixoDateState, setMixoDateState] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  )

  const fetchOrders = useCallback(async () => {
    // Egress optimization:
    // - Fetch ONLY orders that have pending/preparing bar items (via inner join filters).
    // - Fetch return requests separately (returns_log is usually tiny).
    const [{ data: barData, error }, { data: pendingReturns, error: pendingErr }] =
      await Promise.all([
        supabase
          .from('orders')
          .select(
            `id, created_at, notes, staff_id, order_type, customer_name,
            tables(name),
            profiles(full_name),
            order_items!inner(id, quantity, status, destination, notes, return_requested, return_accepted, return_reason,
              menu_items(name, menu_categories(name, destination)))`
          )
          .in('status', ['open', 'paid'])
          .in('order_items.status', ['pending', 'preparing'])
          .order('created_at', { ascending: true }),
        supabase.from('returns_log').select('order_item_id').eq('status', 'pending'),
      ])

    const pendingReturnIds = new Set(
      ((pendingReturns || []) as Array<{ order_item_id: string | null }>)
        .map((row) => row.order_item_id)
        .filter(Boolean)
    )

    if (!error && barData) {
      // Already filtered on server to pending/preparing; keep only the bar items that should display.
      // NOTE: some deployments rely on category destination instead of order_items.destination,
      // so we must apply `isBarItem` here (not just destination=bar).
      const bar = (barData as unknown as KdsOrder[])
        .map((o) => ({
          ...o,
          order_items: (o.order_items || []).filter(
            (i) =>
              (i.status === 'pending' || i.status === 'preparing') &&
              !i.return_accepted &&
              isBarItem(i)
          ),
        }))
        .filter((o) => o.order_items.length > 0)
      setOrders(bar)
    }

    // Return requests: fetch only orders that contain the returned bar items (small set).
    if (!pendingErr && pendingReturnIds.size > 0) {
      const ids = Array.from(pendingReturnIds)
      const { data: retOrders } = await supabase
        .from('orders')
        .select(
          `id, staff_id,
          tables(name),
          order_items!inner(id, quantity, status, destination, notes, return_requested, return_accepted, return_reason,
            menu_items(name, menu_categories(name, destination)))`
        )
        .in('order_items.id', ids)
        .order('created_at', { ascending: true })
      const returns: typeof returnItems = []
      ;((retOrders || []) as unknown as KdsOrder[]).forEach((o) => {
        ;(o.order_items || []).forEach((i) => {
          if (pendingReturnIds.has(i.id) && isBarItem(i)) {
            returns.push({
              ...i,
              tableName: (o.tables as { name: string } | null)?.name ?? 'Unknown',
              orderId: o.id,
              staffId: o.staff_id,
            })
          }
        })
      })
      setReturnItems(returns)
    } else {
      setReturnItems([])
    }

    setLoading(false)
  }, [])

  const loadMixoRequests = useCallback(async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('id', 'mixologist_requests')
      .single()
    if (data?.value) {
      try {
        setMixoRequests(JSON.parse(data.value))
      } catch {
        setMixoRequests([])
      }
    } else {
      setMixoRequests([])
    }
  }, [])

  const updateMixoRequests = async (updated: MixoRequest[]) => {
    await supabase.from('settings').upsert({
      id: 'mixologist_requests',
      value: JSON.stringify(updated.slice(0, 50)),
      updated_at: new Date().toISOString(),
    })
    setMixoRequests(updated.slice(0, 50))
  }

  const approveMixoRequest = async (id: string) => {
    const updated = mixoRequests.map((r) =>
      r.id === id ? { ...r, status: 'approved', resolved_by: profile?.full_name || null } : r
    ) as MixoRequest[]
    await updateMixoRequests(updated)
    const today = new Date().toISOString().slice(0, 10)
    const req = updated.find((r) => r.id === id)
    if (req) {
      // Resolve physical stock units per request line: map item name -> menu_item_id,
      // then apply the highest configured units_per_sale for that item (default 1).
      const names = req.items.map((it) => it.item).filter(Boolean)
      const [itemsRes, zoneRes] = await Promise.all([
        supabase.from('menu_items').select('id, name').in('name', names),
        supabase.from('menu_item_zone_prices').select('menu_item_id, units_per_sale'),
      ])
      const idByName: Record<string, string> = {}
      for (const m of itemsRes.data || []) {
        if (m?.name) idByName[m.name] = m.id
      }
      const maxUnitsByItem: Record<string, number> = {}
      for (const zp of zoneRes.data || []) {
        const u = Number(zp.units_per_sale)
        if (Number.isFinite(u) && u > 1 && zp.menu_item_id) {
          maxUnitsByItem[zp.menu_item_id] = Math.max(maxUnitsByItem[zp.menu_item_id] || 1, u)
        }
      }
      for (const it of req.items) {
        const menuItemId = idByName[it.item]
        const unitsPer = menuItemId ? maxUnitsByItem[menuItemId] || 1 : 1
        const qty = (Number(it.qty) || 0) * unitsPer
        const { data: row } = await supabase
          .from('bar_chiller_stock')
          .select('id, sold_qty')
          .eq('date', today)
          .eq('item_name', it.item)
          .single()
        const newSold = (row?.sold_qty || 0) + qty
        if (row?.id) {
          await supabase
            .from('bar_chiller_stock')
            .update({ sold_qty: newSold, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        } else {
          await supabase.from('bar_chiller_stock').insert({
            date: today,
            item_name: it.item,
            unit: 'units',
            opening_qty: 0,
            received_qty: 0,
            sold_qty: qty,
            void_qty: 0,
            closing_qty: 0,
            created_at: new Date().toISOString(),
          })
        }
      }
    }
    toast.success('Approved', 'Released from chiller')
  }

  const rejectMixoRequest = async (id: string) => {
    const updated = mixoRequests.map((r) =>
      r.id === id ? { ...r, status: 'rejected', resolved_by: profile?.full_name || null } : r
    ) as MixoRequest[]
    await updateMixoRequests(updated)
    toast.success('Rejected', 'Request declined')
  }

  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10))

  const fetchReturnHistory = useCallback(
    async (d?: string) => {
      if (!profile) return
      const targetDate = d || historyDate
      const dayStart = new Date(targetDate)
      dayStart.setHours(8, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const { data } = await supabase
        .from('returns_log')
        .select(
          'id, item_name, quantity, item_total, table_name, waitron_name, return_reason, status, requested_at, resolved_at'
        )
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString())
        .order('requested_at', { ascending: false })
      if (data) setReturnHistory(data)
    },
    [profile, historyDate]
  )

  const updateItemStatus = async (itemId: string, currentStatus: string, orderId: string) => {
    const nextStatus = getNextStatus(currentStatus)
    if (!nextStatus) return
    const { error } = await supabase
      .from('order_items')
      .update({ status: nextStatus })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to update item: ' + error.message)
      return
    }
    const order = orders.find((o) => o.id === orderId)
    const item = order?.order_items.find((i) => i.id === itemId)
    audit({
      action: 'BAR_ITEM_STATUS',
      entity: 'order_items',
      entityId: itemId,
      entityName: item?.menu_items?.name,
      newValue: { from: currentStatus, to: nextStatus },
      performer: profile as any,
    })
    if (nextStatus === 'ready' && order?.staff_id) {
      await sendPushToStaff(
        order.staff_id,
        '✅ Item Ready',
        `${item?.menu_items?.name || 'Item'} ready for ${order.tables?.name || 'a table'}`
      )
    }
    fetchOrders()
  }

  const markAllReady = async (order: KdsOrder) => {
    const barItemIds = order.order_items
      .filter((i) => i.menu_items?.menu_categories?.destination === 'bar' && i.status !== 'ready')
      .map((i) => i.id)
    if (!barItemIds.length) return
    const { error: baErr } = await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .in('id', barItemIds)
    if (baErr) {
      toast.error('Error', 'Failed to mark all ready: ' + baErr.message)
      return
    }
    audit({
      action: 'BAR_ALL_READY',
      entity: 'orders',
      entityId: order.id,
      entityName: order.tables?.name,
      newValue: { items: barItemIds.length },
      performer: profile as any,
    })
    if (order.staff_id)
      await sendPushToStaff(
        order.staff_id,
        '✅ Order Ready',
        `Bar order for ${order.tables?.name || 'a table'} is ready to collect`
      )
    fetchOrders()
  }

  const rejectOrder = async (order: KdsOrder) => {
    // Barman rejects all pending bar items on this order
    const barItemIds = order.order_items
      .filter(
        (i) =>
          i.menu_items?.menu_categories?.destination === 'bar' &&
          i.status !== 'ready' &&
          i.status !== 'delivered'
      )
      .map((i) => i.id)
    if (!barItemIds.length) return
    // Mark items as cancelled
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'cancelled' })
      .in('id', barItemIds)
    if (error) {
      toast.error('Error', 'Failed to reject order: ' + error.message)
      return
    }
    // Recalculate order total without cancelled items
    const { data: remaining } = await supabase
      .from('order_items')
      .select('total_price, status')
      .eq('order_id', order.id)
    const newTotal = (remaining || [])
      .filter((r: { status: string }) => r.status !== 'cancelled')
      .reduce((s: number, r: { total_price: number }) => s + (r.total_price || 0), 0)
    await supabase
      .from('orders')
      .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (order.staff_id)
      await sendPushToStaff(
        order.staff_id,
        '❌ Order Rejected by Bar',
        `Bar rejected drinks for ${order.tables?.name || order.customer_name || 'an order'}`
      )
    audit({
      action: 'BAR_ORDER_REJECTED',
      entity: 'orders',
      entityId: order.id,
      entityName: order.tables?.name,
      newValue: { items: barItemIds.length, newTotal },
      performer: profile as any,
    })
    toast.success('Order Rejected', 'Bar items cancelled and total updated')
    fetchOrders()
  }

  const recalcOrderTotal = async (orderId: string) => {
    const { data: remaining, error } = await supabase
      .from('order_items')
      .select('total_price, extra_charge, status, return_accepted')
      .eq('order_id', orderId)
    if (error) throw error
    const newTotal = (remaining || [])
      .filter((r: { status?: string; return_accepted?: boolean }) => {
        if ((r.status || '').toLowerCase() === 'cancelled') return false
        // Only deduct once station has ACCEPTED the return.
        return !r.return_accepted
      })
      .reduce(
        (s: number, r: { total_price?: number; extra_charge?: number }) =>
          s + (r.total_price || 0) + (r.extra_charge || 0),
        0
      )
    const { error: orderErr } = await supabase
      .from('orders')
      .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
      .eq('id', orderId)
    if (orderErr) throw orderErr
    return newTotal
  }

  const acceptReturn = async (
    itemId: string,
    orderId: string,
    staffId?: string | null,
    tableName?: string
  ) => {
    // Bar acceptance removes the item from the bill immediately (waitron totals),
    // while stock/sales move on manager approval.
    const resolvedAt = new Date().toISOString()
    const { error, data } = await supabase
      .from('returns_log')
      .update({
        status: 'bar_accepted',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: resolvedAt,
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
      .select('id')
    if (error) {
      toast.error('Error', 'Failed to accept return: ' + error.message)
      return
    }
    // If no pending row found, still record barman name on whatever status exists
    if (!data || data.length === 0) {
      const { error: fallbackError } = await supabase
        .from('returns_log')
        .update({
          barman_id: profile?.id ?? null,
          barman_name: profile?.full_name ?? null,
        })
        .eq('order_item_id', itemId)
      if (fallbackError) {
        toast.error('Error', 'Failed to accept return: ' + fallbackError.message)
        return
      }
      toast.info('Already handled', 'This return is no longer pending')
      fetchOrders()
      return
    }

    // Mark the item as accepted return (deducts from waitron/accounting totals)
    const { error: oiErr } = await supabase
      .from('order_items')
      .update({ return_accepted: true, return_accepted_at: resolvedAt })
      .eq('id', itemId)
    if (oiErr) {
      toast.error('Error', 'Failed to accept return: ' + oiErr.message)
      return
    }
    try {
      await recalcOrderTotal(orderId)
    } catch {
      toast.error('Error', 'Failed to update order total')
      return
    }

    toast.success(
      'Return Accepted',
      'Item removed from the bill. Awaiting manager approval before stock and sales are adjusted.'
    )
    if (staffId)
      await sendPushToStaff(
        staffId,
        '↩ Return Accepted by Bar',
        `Return accepted for ${tableName ?? 'table'} — item removed from bill, pending manager approval`
      )
    setReturnItems((current) => current.filter((item) => item.id !== itemId))
    fetchOrders()
  }

  const rejectReturn = async (
    itemId: string,
    orderId: string,
    staffId?: string | null,
    tableName?: string
  ) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        return_requested: false,
        return_accepted: false,
        return_reason: null,
        return_requested_at: null,
      })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to reject return')
      return
    }
    // Update returns_log — mark rejected
    await supabase
      .from('returns_log')
      .update({
        status: 'rejected',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    toast.success('Return Rejected', 'Item stays on bill')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '❌ Return Rejected',
        `Return rejected for ${tableName ?? 'table'} — item stays on bill`
      )
    try {
      await recalcOrderTotal(orderId)
    } catch {
      /* best-effort */
    }
    fetchOrders()
  }

  useEffect(() => {
    fetchOrders()
    fetchReturnHistory()
    loadMixoRequests()
    const tickTimer = setInterval(() => setTick((t) => t + 1), 1000)
    // Poll every 10s as safety net — realtime can drop silently
    const pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchOrders()
    }, 10000)
    const slowPollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchReturnHistory()
      loadMixoRequests()
    }, 120000)
    const channel = supabase
      .channel('bar-channel')
      .on(
        'postgres_changes',
        // Wake up immediately when any new item is created (any station).
        // fetchOrders still pulls only pending/preparing bar items.
        { event: 'INSERT', schema: 'public', table: 'order_items' },
        () => {
          if (document.visibilityState !== 'visible') return
          fetchOrders()
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        if (document.visibilityState !== 'visible') return
        fetchOrders()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        if (document.visibilityState !== 'visible') return
        fetchOrders()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, loadMixoRequests)
      .subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOrders()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tickTimer)
      clearInterval(pollTimer)
      clearInterval(slowPollTimer)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOrders, fetchReturnHistory])

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading Bar Display...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
            <Beer size={18} className="text-black" />
          </div>
          <div>
            <h1 className="text-white font-bold">Bar Display</h1>
            <p className="text-gray-400 text-xs">
              {orders.length} active order{orders.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchOrders} className="text-gray-400 hover:text-white">
            <RefreshCw size={16} />
          </button>
          <p className="text-gray-400 text-sm">{profile?.full_name}</p>
          <HelpTooltip storageKey="bar-kds" tips={HELP_TIPS} />
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'orders' ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <Beer size={14} /> Orders
          {orders.length > 0 && (
            <span className="bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
              {orders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'returns' ? 'border-red-500 text-red-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <RotateCcw size={14} /> Returns
          {returnItems.length > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {returnItems.length}
            </span>
          )}
        </button>
        <button
          onClick={() => {
            setActiveTab('history')
            fetchReturnHistory()
          }}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <History size={14} /> Return History
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'summary' ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <BarChart2 size={14} /> Summary
        </button>
        <button
          onClick={() => setActiveTab('chiller')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'chiller' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <Snowflake size={14} /> Chiller
        </button>
        <button
          onClick={() => setActiveTab('issue_log')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'issue_log'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <ClipboardList size={14} /> Waitron Issue Log
        </button>
        <button
          onClick={() => {
            setActiveTab('requests')
            loadMixoRequests()
          }}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'requests'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <BarChart2 size={14} /> Requests from Mixologist
          {(() => {
            const ds = new Date(
              new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) +
                'T08:00:00+01:00'
            )
            const de = new Date(ds)
            de.setDate(de.getDate() + 1)
            const todayPending = mixoRequests.filter(
              (r) =>
                r.status === 'pending' &&
                new Date(r.at).getTime() >= ds.getTime() &&
                new Date(r.at).getTime() < de.getTime()
            ).length
            return todayPending > 0 ? (
              <span className="bg-emerald-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
                {todayPending}
              </span>
            ) : null
          })()}
        </button>
        <button
          onClick={() => setActiveTab('store_requests')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'store_requests'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <Package size={14} /> Request from Store
        </button>
      </div>

      {/* Chiller Tab */}
      {activeTab === 'chiller' && (
        <div className="flex-1 overflow-y-auto">
          <BarChillerStock onBack={() => setActiveTab('orders')} embedded />
        </div>
      )}

      {activeTab === 'issue_log' && (
        <ErrorBoundary title="Waitron Issue Log Error" fullscreen={false}>
          <Suspense
            fallback={
              <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-3xl mx-auto">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <p className="text-gray-500 text-sm">Loading waitron issue log...</p>
                  </div>
                </div>
              </div>
            }
          >
            <BarIssueLogTab />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Store Requests Tab */}
      {activeTab === 'store_requests' && (
        <div className="flex-1 overflow-y-auto p-4">
          <StoreRequestPanel />
        </div>
      )}

      {/* Return History Tab */}
      {activeTab === 'history' && (
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <input
                type="date"
                value={historyDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setHistoryDate(e.target.value)
                  fetchReturnHistory(e.target.value)
                }}
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={() => {
                  const d = new Date().toISOString().slice(0, 10)
                  setHistoryDate(d)
                  fetchReturnHistory(d)
                }}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${historyDate === new Date().toISOString().slice(0, 10) ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                Today
              </button>
              <button
                onClick={() => {
                  const d = new Date(historyDate)
                  d.setDate(d.getDate() - 1)
                  const ds = d.toISOString().slice(0, 10)
                  setHistoryDate(ds)
                  fetchReturnHistory(ds)
                }}
                className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                Prev Day
              </button>
            </div>
          </div>
          {returnHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <History size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 font-medium">
                No returns for{' '}
                {historyDate === new Date().toISOString().slice(0, 10) ? 'today' : historyDate}
              </p>
              <p className="text-gray-600 text-sm mt-1">Processed returns will appear here</p>
            </div>
          ) : (
            <div className="max-w-lg mx-auto space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-xs uppercase tracking-wider">
                  Returns — {returnHistory.length} total
                </p>
                <p className="text-gray-400 text-xs font-bold">
                  ₦
                  {returnHistory
                    .filter((r) => r.status === 'accepted')
                    .reduce((s, r) => s + (r.item_total || 0), 0)
                    .toLocaleString()}{' '}
                  accepted
                </p>
              </div>
              {returnHistory.map((r) => (
                <div
                  key={r.id}
                  className={`bg-gray-900 border rounded-xl p-3 ${
                    r.status === 'accepted'
                      ? 'border-green-500/20'
                      : r.status === 'rejected'
                        ? 'border-red-500/20'
                        : 'border-amber-500/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <p className="text-white text-sm font-semibold">
                        {r.quantity}x {r.item_name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {r.table_name || 'Unknown'} — by {r.waitron_name || 'Unknown'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          r.status === 'accepted'
                            ? 'bg-green-500/20 text-green-400'
                            : r.status === 'rejected'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {r.status}
                      </span>
                      <p className="text-gray-400 text-xs mt-1">
                        ₦{(r.item_total || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {r.return_reason && (
                    <p className="text-gray-500 text-xs italic">Reason: {r.return_reason}</p>
                  )}
                  <p className="text-gray-600 text-[10px] mt-1">
                    {new Date(r.requested_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                    {r.resolved_at && (
                      <>
                        {' '}
                        — resolved{' '}
                        {new Date(r.resolved_at).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mixologist Requests Tab */}
      {activeTab === 'requests' &&
        (() => {
          const dayStart = new Date(mixoDateState + 'T08:00:00+01:00')
          const dayEnd = new Date(dayStart)
          dayEnd.setDate(dayEnd.getDate() + 1)
          const filtered = mixoRequests.filter((r) => {
            const t = new Date(r.at).getTime()
            return t >= dayStart.getTime() && t < dayEnd.getTime()
          })
          return (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <input
                  type="date"
                  value={mixoDateState}
                  onChange={(e) => setMixoDateState(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() =>
                    setMixoDateState(
                      new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
                    )
                  }
                  className={`px-3 py-2 rounded-xl text-xs font-medium ${mixoDateState === new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400'}`}
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    const d = new Date(mixoDateState)
                    d.setDate(d.getDate() - 1)
                    setMixoDateState(d.toLocaleDateString('en-CA'))
                  }}
                  className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white"
                >
                  Prev Day
                </button>
              </div>
              {filtered.length === 0 ? (
                <div className="text-center text-gray-500 text-sm">
                  No mixologist requests for this date.
                </div>
              ) : (
                <>
                  {filtered.map((r) => (
                    <div
                      key={r.id}
                      className="bg-gray-900 border border-gray-800 rounded-2xl p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-white font-semibold text-sm">
                          {r.items.map((it) => `${it.qty}x ${it.item}`).join(', ')}
                        </p>
                        <p className="text-gray-500 text-xs">
                          {new Date(r.at).toLocaleTimeString('en-NG', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })}{' '}
                          · {r.requested_by || 'Mixologist'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] px-2 py-1 rounded-lg border ${
                            r.status === 'approved'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : r.status === 'rejected'
                                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.status === 'pending' && (
                          <>
                            <button
                              onClick={() => approveMixoRequest(r.id)}
                              className="px-2 py-1 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => rejectMixoRequest(r.id)}
                              className="px-2 py-1 text-xs rounded-lg bg-red-500/20 text-red-400 border border-red-500/30"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                      {r.status === 'approved' && (
                        <span className="text-[11px] text-emerald-400">Deducted from chiller</span>
                      )}
                    </div>
                  ))}
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
                    <p className="text-white font-semibold text-sm mb-2">
                      Summary for {mixoDateState}
                    </p>
                    {Object.entries(
                      filtered.reduce(
                        (acc: Record<string, number>, r: MixoRequest) => {
                          r.items.forEach((it) => {
                            acc[it.item] = (acc[it.item] || 0) + it.qty
                          })
                          return acc
                        },
                        {} as Record<string, number>
                      )
                    ).map(([name, qty]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between text-sm text-gray-300 py-0.5"
                      >
                        <span>{name}</span>
                        <span className="text-emerald-400">{qty}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <DailySummaryTab
          destination="bar"
          icon={<Beer size={24} className="text-amber-400" />}
          color="text-amber-400"
        />
      )}

      {/* Returns Tab */}
      {activeTab === 'returns' && (
        <div className="flex-1 p-4 overflow-y-auto">
          {returnItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <RotateCcw size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 font-medium">No pending return requests</p>
              <p className="text-gray-600 text-sm mt-1">
                Return requests from waitrons will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-lg mx-auto">
              {returnItems.map((item) => (
                <div key={item.id} className="bg-gray-900 border border-red-500/30 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-white font-bold text-sm">
                        {item.quantity}x {item.menu_items?.name || 'Item'}
                      </p>
                      <p className="text-gray-400 text-xs mt-0.5">Table: {item.tableName}</p>
                      {item.return_reason && (
                        <p className="text-amber-400 text-xs mt-1 italic">
                          Reason: "{item.return_reason}"
                        </p>
                      )}
                    </div>
                    <span className="text-red-400 text-xs font-semibold bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg whitespace-nowrap">
                      ↩ Return Request
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        acceptReturn(item.id, item.orderId, item.staffId, item.tableName)
                      }
                      className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-sm py-2.5 rounded-xl transition-colors"
                    >
                      <CheckCircle size={14} /> Accept Return
                    </button>
                    <button
                      onClick={() =>
                        rejectReturn(item.id, item.orderId, item.staffId, item.tableName)
                      }
                      className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-sm py-2.5 rounded-xl transition-colors"
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <div className="flex-1 p-4 overflow-y-auto">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <Beer size={32} className="text-gray-600" />
              </div>
              <p className="text-gray-400 text-lg font-medium">No pending bar orders</p>
              <p className="text-gray-600 text-sm mt-1">
                New orders will appear here automatically
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-colors ${getUrgencyColor(order.created_at)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-white font-bold text-lg">
                        {order.tables?.name ||
                          (order.order_type === 'takeaway'
                            ? `Takeaway${order.customer_name ? ' — ' + order.customer_name : ''}`
                            : order.order_type === 'cash_sale'
                              ? 'Cash Sale'
                              : 'Counter')}
                      </h2>
                      {(order.order_type === 'cash_sale' || order.order_type === 'takeaway') && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                          {order.order_type === 'takeaway' ? 'TAKEAWAY' : 'CASH'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-gray-400 text-xs">
                      <Clock size={12} />
                      <span className={getTimerColor(order.created_at)}>
                        {getElapsed(order.created_at)}
                      </span>
                    </div>
                  </div>
                  {order.profiles?.full_name && (
                    <p className="text-gray-400 text-xs -mt-1">
                      Waitron:{' '}
                      <span className="text-white font-medium">{order.profiles.full_name}</span>
                    </p>
                  )}
                  {order.notes && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <p className="text-amber-400 text-xs">📝 {order.notes}</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 flex-1">
                    {order.order_items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-bold text-lg w-6">
                            {item.quantity}x
                          </span>
                          <span className="text-white text-sm">{item.menu_items?.name}</span>
                        </div>
                        <button
                          onClick={() => updateItemStatus(item.id, item.status, order.id)}
                          disabled={item.status === 'ready'}
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${getStatusColor(item.status)}`}
                        >
                          {item.status === 'pending' ? 'Mark Ready' : '✓ Served'}
                        </button>
                      </div>
                    ))}
                  </div>
                  {order.order_items.some((i) => i.status !== 'ready') && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => markAllReady(order)}
                        className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-2.5 flex items-center justify-center gap-2 transition-colors"
                      >
                        <CheckCircle size={16} /> All Ready
                      </button>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Reject all bar items for ${order.tables?.name || order.customer_name || 'this order'}?`
                            )
                          )
                            rejectOrder(order)
                        }}
                        className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-bold rounded-xl px-4 py-2.5 flex items-center justify-center gap-1.5 transition-colors text-sm"
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BarKDS() {
  return (
    <ErrorBoundary title="Bar Display Error">
      <BarKDSInner />
    </ErrorBoundary>
  )
}
