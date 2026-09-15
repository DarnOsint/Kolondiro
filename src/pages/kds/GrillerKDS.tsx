import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { audit } from '../../lib/audit'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import {
  LogOut,
  RefreshCw,
  Flame,
  CheckCircle,
  AlertTriangle,
  Printer,
  RotateCcw,
  X,
  History,
} from 'lucide-react'
import type { GrillerTicket, GrillerItem } from './types'
import { useToast } from '../../context/ToastContext'
import DailySummaryTab from './DailySummaryTab'

const HELP_TIPS = [
  {
    id: 'grill-tickets',
    title: 'Grill Tickets',
    description:
      'Each card groups all grillable items from one order. Tickets arrive automatically when a waitron confirms on POS — sorted oldest first, work from the top.',
  },
  {
    id: 'grill-items',
    title: 'Marking Items Done',
    description:
      'Tap Done next to each item as it comes off the grill. When every item on a ticket is done, the waitron is notified automatically to collect.',
  },
  {
    id: 'grill-allready',
    title: 'All Done Button',
    description:
      'Marks every item on the ticket ready at once. Use this when the full order is plated and ready to go together. The button is hidden once all items are complete.',
  },
  {
    id: 'grill-urgency',
    title: 'Urgency Colours',
    description:
      'Grey = normal (under 10 min). Amber = getting late (10–20 min). Red with pulsing icon = critically overdue (20+ min).',
  },
  {
    id: 'grill-realtime',
    title: 'Live Updates',
    description:
      'Tickets appear and disappear automatically — no manual refresh needed. Tap the refresh button in the header if you ever need to force a reload.',
  },
]

type Urgency = 'normal' | 'warning' | 'critical'

function getElapsed(createdAt: string): string {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`
}

function getUrgency(createdAt: string): Urgency {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000
  if (mins > 20) return 'critical'
  if (mins > 10) return 'warning'
  return 'normal'
}

const URGENCY_STYLES: Record<
  Urgency,
  { border: string; header: string; flame: string; time: string }
> = {
  normal: {
    border: 'border-gray-700',
    header: 'bg-gray-800',
    flame: 'text-orange-400',
    time: 'text-gray-400',
  },
  warning: {
    border: 'border-amber-500/50',
    header: 'bg-amber-500/10',
    flame: 'text-amber-400',
    time: 'text-amber-400',
  },
  critical: {
    border: 'border-red-500/50',
    header: 'bg-red-500/10',
    flame: 'text-red-400',
    time: 'text-red-400',
  },
}

function getStatusRank(status: string): number {
  if (status === 'pending') return 0
  if (status === 'preparing') return 1
  if (status === 'ready') return 2
  return 3
}

function getItemTime(item: GrillerItem, fallback: string): string {
  return item.created_at || fallback
}

function sortGrillItems(items: GrillerItem[], fallbackCreatedAt: string): GrillerItem[] {
  return [...items].sort((a, b) => {
    const rankDiff = getStatusRank(a.status) - getStatusRank(b.status)
    if (rankDiff !== 0) return rankDiff
    return (
      new Date(getItemTime(a, fallbackCreatedAt)).getTime() -
      new Date(getItemTime(b, fallbackCreatedAt)).getTime()
    )
  })
}

function getLatestPendingTime(items: GrillerItem[], fallbackCreatedAt: string): string | null {
  const pending = items.filter((item) => item.status === 'pending')
  if (!pending.length) return null
  return pending.reduce(
    (latest, item) => {
      const itemTime = getItemTime(item, fallbackCreatedAt)
      return new Date(itemTime).getTime() > new Date(latest).getTime() ? itemTime : latest
    },
    getItemTime(pending[0], fallbackCreatedAt)
  )
}

function getLatestPendingItems(items: GrillerItem[], fallbackCreatedAt: string): GrillerItem[] {
  const latestPendingTime = getLatestPendingTime(items, fallbackCreatedAt)
  if (!latestPendingTime) return []
  return items
    .filter(
      (item) =>
        item.status === 'pending' && getItemTime(item, fallbackCreatedAt) === latestPendingTime
    )
    .sort(
      (a, b) =>
        new Date(getItemTime(a, fallbackCreatedAt)).getTime() -
        new Date(getItemTime(b, fallbackCreatedAt)).getTime()
    )
}

// Tracks the latest item timestamp already printed via the "NEW ITEMS" button,
// per order, so subsequent prints only include items added after the last print.
const grillerNewPrintedAt = new Map<string, string>()

function GrillerKDSInner() {
  const { profile, signOut } = useAuth()
  const printOrderTicket = (ticket: GrillerTicket) => {
    const W = 40
    const divider = '-'.repeat(W)
    const centre = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtRow = (l: string, r: string) => {
      const space = W - l.length - r.length
      return l + ' '.repeat(Math.max(1, space)) + r
    }
    const itemLines = ticket.items
      .map((i) => fmtRow(`${i.quantity}x ${(i.menu_items?.name ?? '').substring(0, 28)}`, ''))
      .join('\n')
    const ticketBody = [
      '',
      centre('** GRILL ORDER **'),
      divider,
      fmtRow('Table:', ticket.tableName ?? 'N/A'),
      fmtRow(
        'Time:',
        new Date(ticket.createdAt).toLocaleTimeString('en-NG', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      ),
      divider,
      itemLines,
      divider,
      '',
    ].join('\n')

    const html = `<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Grill Ticket</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:13px;width:80mm;padding:4mm;white-space:pre;}
@media print{body{width:80mm;}@page{margin:0;size:80mm auto;}}</style></head><body>${ticketBody}</body></html>`

    // Print two physical copies via two windows to avoid single-copy issues
    for (let copy = 0; copy < 2; copy++) {
      const win = window.open('', '_blank', 'width=400,height=500,toolbar=no,menubar=no')
      if (!win) continue
      win.document.open('text/html', 'replace')
      win.document.write(html)
      win.document.close()
      win.onload = () =>
        setTimeout(() => {
          try {
            win.print()
          } catch {
            /* ignore */
          }
          win.close()
        }, 200)
    }
  }
  const printPendingTicket = (ticket: GrillerTicket) => {
    // Only print grill items ADDED since the last "NEW ITEMS" print. On the very
    // first print for an order, emit just the latest pending batch so we don't
    // re-print items the grill already has.
    const lastPrinted = grillerNewPrintedAt.get(ticket.orderId)
    const pending = lastPrinted
      ? ticket.items.filter(
          (i) => i.status === 'pending' && getItemTime(i, ticket.createdAt) > lastPrinted
        )
      : getLatestPendingItems(ticket.items, ticket.createdAt)

    if (!pending.length) return

    const printedMax = pending.reduce(
      (latest, i) => {
        const t = getItemTime(i, ticket.createdAt)
        return t > latest ? t : latest
      },
      getItemTime(pending[0], ticket.createdAt)
    )
    grillerNewPrintedAt.set(ticket.orderId, printedMax)

    const W = 40
    const divider = '-'.repeat(W)
    const centre = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtRow = (l: string, r: string) => {
      const space = W - l.length - r.length
      return l + ' '.repeat(Math.max(1, space)) + r
    }
    const itemLines = pending
      .map((i) => fmtRow(`${i.quantity}x ${(i.menu_items?.name ?? '').substring(0, 28)}`, ''))
      .join('\n')
    const ticketBody = [
      '',
      centre('** GRILL (NEW ITEMS) **'),
      divider,
      fmtRow('Table:', ticket.tableName ?? 'N/A'),
      fmtRow(
        'Time:',
        new Date(getItemTime(pending[0], ticket.createdAt)).toLocaleTimeString('en-NG', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      ),
      divider,
      itemLines,
      divider,
      '',
    ].join('\n')
    for (let copy = 0; copy < 2; copy++) {
      const win = window.open('', '_blank', 'width=400,height=500,toolbar=no,menubar=no')
      if (!win) continue
      win.document.open('text/html', 'replace')
      win.document.write(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Grill Ticket</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:13px;width:80mm;padding:4mm;white-space:pre;}
@media print{body{width:80mm;}@page{margin:0;size:80mm auto;}}</style></head><body>${ticketBody}</body></html>`
      )
      win.document.close()
      win.onload = () =>
        setTimeout(() => {
          try {
            win.print()
          } catch {
            /* ignore */
          }
          win.close()
        }, 200)
    }
  }
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [tickets, setTickets] = useState<GrillerTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<Record<string, boolean>>({})
  const [, setTick] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [activeTab, setActiveTab] = useState<'orders' | 'summary' | 'returns' | 'history'>('orders')
  const [returnItems, setReturnItems] = useState<
    Array<GrillerItem & { tableName: string; orderId: string; staffId?: string | null }>
  >([])
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10))
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
          'id, item_name, quantity, item_total, table_name, waitron_name, return_reason, status, requested_at, resolved_at, order_item_id'
        )
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString())
        .order('requested_at', { ascending: false })
      if (data) {
        const itemIds = data.map((r) => r.order_item_id)
        if (itemIds.length > 0) {
          const { data: items } = await supabase
            .from('order_items')
            .select('id, menu_items(menu_categories(destination))')
            .in('id', itemIds)
          const grillerIds = new Set(
            (items || [])
              .filter((i: any) => i.menu_items?.menu_categories?.destination === 'griller')
              .map((i: any) => i.id)
          )
          setReturnHistory(data.filter((r) => grillerIds.has(r.order_item_id)))
        } else {
          setReturnHistory([])
        }
      }
    },
    [profile, historyDate]
  )

  const acceptReturn = async (itemId: string, staffId?: string | null, tableName?: string) => {
    const { error } = await supabase
      .from('order_items')
      .update({ return_accepted: true, return_accepted_at: new Date().toISOString() })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to accept return')
      return
    }
    const { data: itemData } = await supabase
      .from('order_items')
      .select('order_id, total_price')
      .eq('id', itemId)
      .single()
    if (itemData) {
      const { data: remaining } = await supabase
        .from('order_items')
        .select('total_price, return_accepted')
        .eq('order_id', itemData.order_id)
      const newTotal = (remaining || [])
        .filter((r: { return_accepted?: boolean }) => !r.return_accepted)
        .reduce((s: number, r: { total_price: number }) => s + (r.total_price || 0), 0)
      await supabase
        .from('orders')
        .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
        .eq('id', itemData.order_id)
    }

    await supabase
      .from('returns_log')
      .update({
        status: 'griller_accepted',
        resolved_at: new Date().toISOString(),
        griller_name: profile?.full_name ?? null,
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    await supabase
      .from('returns_log')
      .update({
        status: 'bar_accepted',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    audit({
      action: 'GRILLER_RETURN_ACCEPTED',
      entity: 'order_items',
      entityId: itemId,
      newValue: { table: tableName },
      performer: profile as any,
    })
    toast.success('Return Accepted', 'Item tentatively removed — awaiting manager final approval')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '↩ Return Accepted by Grill',
        `Return accepted for ${tableName ?? 'table'} — pending manager approval`
      )
    fetchTickets()
  }

  const rejectReturn = async (itemId: string, staffId?: string | null, tableName?: string) => {
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

    await supabase
      .from('returns_log')
      .update({
        status: 'rejected',
        resolved_at: new Date().toISOString(),
        griller_name: profile?.full_name ?? null,
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
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
    audit({
      action: 'GRILLER_RETURN_REJECTED',
      entity: 'order_items',
      entityId: itemId,
      newValue: { table: tableName },
      performer: profile as any,
    })
    toast.success('Return Rejected', 'Item stays on bill')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '❌ Return Rejected',
        `Return rejected for ${tableName ?? 'table'} — item stays on bill`
      )
    fetchTickets()
  }

  const fetchTickets = async (isRealtime = false) => {
    // Egress optimization: fetch only active griller items + return requests.
    const [{ data, error }, { data: ret, error: retErr }] = await Promise.all([
      supabase
        .from('order_items')
        .select(
          `id, order_id, quantity, status, destination, created_at, notes, modifier_notes, return_requested, return_accepted, return_reason,
          menu_items(name, menu_categories(name, destination)),
          orders(id, order_type, customer_name, staff_id, tables(name))`
        )
        .eq('destination', 'griller')
        .in('status', ['pending', 'preparing'])
        .order('created_at', { ascending: true }),
      supabase
        .from('order_items')
        .select(
          `id, order_id, quantity, status, destination, created_at, notes, modifier_notes, return_requested, return_accepted, return_reason,
          menu_items(name, menu_categories(name, destination)),
          orders(id, order_type, customer_name, staff_id, tables(name))`
        )
        .eq('destination', 'griller')
        .eq('return_requested', true)
        .eq('return_accepted', false)
        .order('created_at', { ascending: true }),
    ])

    if (error) {
      console.error(error)
      return
    }

    const grillerItems = (data || []) as any

    const orderMap: Record<string, GrillerTicket> = {}
    grillerItems.forEach((item) => {
      const oid = item.order_id
      if (!orderMap[oid]) {
        orderMap[oid] = {
          orderId: oid,
          orderType: item.orders?.order_type,
          tableName: item.orders?.tables?.name || item.orders?.customer_name || 'Counter',
          staffId: item.orders?.staff_id || null,
          createdAt: item.created_at as unknown as string,
          items: [],
        }
      }
      orderMap[oid].items.push(item)
      if (
        new Date(getItemTime(item, orderMap[oid].createdAt)).getTime() >
        new Date(orderMap[oid].createdAt).getTime()
      ) {
        orderMap[oid].createdAt = getItemTime(item, orderMap[oid].createdAt)
      }
    })

    const newTickets = Object.values(orderMap)
      .map((ticket) => ({
        ...ticket,
        items: sortGrillItems(ticket.items, ticket.createdAt),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    if (isRealtime && newTickets.length > tickets.length) audioRef.current?.play().catch(() => {})

    setTickets(newTickets)

    // Return requests (griller items with return_requested but not yet accepted)
    if (!retErr && ret) {
      const returns = (ret as any[]).map((i) => ({
        ...i,
        tableName: i.orders?.tables?.name || i.orders?.customer_name || 'Unknown',
        orderId: i.order_id,
        staffId: i.orders?.staff_id || null,
      }))
      setReturnItems(returns)
    } else {
      setReturnItems([])
    }

    setLoading(false)
  }

  const markItemReady = async (item: GrillerItem, ticket: GrillerTicket) => {
    setCompleting((p) => ({ ...p, [item.id]: true }))
    const { error: iErr } = await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .eq('id', item.id)
    setCompleting((p) => ({ ...p, [item.id]: false }))
    if (iErr) {
      toast.error('Error', 'Failed to mark item ready: ' + iErr.message)
      return
    }
    if (ticket.staffId)
      await sendPushToStaff(
        ticket.staffId,
        '✅ Item Ready',
        `${item.menu_items?.name || 'Item'} ready for ${ticket.tableName}`
      )
    fetchTickets()
  }

  const markAllReady = async (ticket: GrillerTicket) => {
    const ids = ticket.items.map((i) => i.id)
    ids.forEach((id) => setCompleting((p) => ({ ...p, [id]: true })))
    const { error: gaErr } = await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .in('id', ids)
    ids.forEach((id) => setCompleting((p) => ({ ...p, [id]: false })))
    if (gaErr) {
      toast.error('Error', 'Failed to mark all ready: ' + gaErr.message)
      return
    }
    if (ticket.staffId)
      await sendPushToStaff(
        ticket.staffId,
        '✅ Order Ready',
        `Grill order for ${ticket.tableName} is ready to collect`
      )
    fetchTickets()
  }

  const rejectOrder = async (ticket: GrillerTicket) => {
    const ids = ticket.items
      .filter((i) => i.status !== 'ready' && i.status !== 'delivered')
      .map((i) => i.id)
    if (!ids.length) return
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'cancelled' })
      .in('id', ids)
    if (error) {
      toast.error('Error', error.message)
      return
    }
    const { data: remaining } = await supabase
      .from('order_items')
      .select('total_price, status')
      .eq('order_id', ticket.orderId)
    const newTotal = (remaining || [])
      .filter((r: { status: string }) => r.status !== 'cancelled')
      .reduce((s: number, r: { total_price: number }) => s + (r.total_price || 0), 0)
    await supabase
      .from('orders')
      .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
      .eq('id', ticket.orderId)
    if (ticket.staffId)
      await sendPushToStaff(
        ticket.staffId,
        '❌ Grill Rejected',
        `Grill rejected items for ${ticket.tableName}`
      ).catch(() => {})
    audit({
      action: 'GRILLER_ORDER_REJECTED',
      entity: 'orders',
      entityId: ticket.orderId,
      entityName: ticket.tableName,
      newValue: { items: ids.length, newTotal },
      performer: profile as any,
    })
    toast.success('Rejected', 'Grill items cancelled and total updated')
    fetchTickets()
  }

  useEffect(() => {
    fetchTickets()
    fetchReturnHistory()
    const tickTimer = setInterval(() => setTick((t) => t + 1), 1000)
    const pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchTickets()
      fetchReturnHistory()
    }, 30000)
    const channel = supabase
      .channel('griller-kds')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: 'destination=eq.griller' },
        () => fetchTickets(true)
      )
      .subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchTickets()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tickTimer)
      clearInterval(pollTimer)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-orange-400 animate-pulse">Loading Grill Station...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <audio ref={audioRef} preload="auto" />

      <nav className="bg-gray-900 border-b border-orange-500/30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
              <Flame size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm">Grill Station</h1>
              <p className="text-orange-400 text-xs">
                {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} active
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => fetchTickets()} className="text-gray-400 hover:text-white">
              <RefreshCw size={16} />
            </button>
            <div className="text-right">
              <p className="text-white text-sm">{profile?.full_name}</p>
              <p className="text-orange-400 text-xs capitalize">{profile?.role}</p>
            </div>
            <button onClick={signOut} className="text-gray-400 hover:text-white">
              <LogOut size={18} />
            </button>
            <HelpTooltip storageKey="griller-kds" tips={HELP_TIPS} />
          </div>
        </div>
      </nav>

      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-4">
        {[
          { color: 'bg-gray-500', label: 'Normal (<10 min)' },
          { color: 'bg-amber-500', label: 'Getting late (10-20 min)' },
          { color: 'bg-red-500', label: 'Urgent (20+ min)' },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${s.color}`} />
            <span className="text-gray-500 text-xs">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'orders' ? 'border-orange-500 text-orange-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <Flame size={14} /> Orders
          {tickets.length > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
              {tickets.length}
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
          <History size={14} /> History
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'summary' ? 'border-orange-500 text-orange-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          Today's Summary
        </button>
      </div>

      {/* Returns Tab */}
      {activeTab === 'returns' ? (
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
                      {(item as unknown as { return_reason?: string }).return_reason && (
                        <p className="text-amber-400 text-xs mt-1 italic">
                          Reason: &quot;
                          {(item as unknown as { return_reason?: string }).return_reason}&quot;
                        </p>
                      )}
                    </div>
                    <span className="text-red-400 text-xs font-semibold bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg whitespace-nowrap">
                      ↩ Return Request
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptReturn(item.id, item.staffId, item.tableName)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-sm py-2.5 rounded-xl transition-colors"
                    >
                      <CheckCircle size={14} /> Accept Return
                    </button>
                    <button
                      onClick={() => rejectReturn(item.id, item.staffId, item.tableName)}
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
      ) : activeTab === 'history' ? (
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
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <button
                onClick={() => {
                  const d = new Date().toISOString().slice(0, 10)
                  setHistoryDate(d)
                  fetchReturnHistory(d)
                }}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${historyDate === new Date().toISOString().slice(0, 10) ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
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
                No grill returns for{' '}
                {historyDate === new Date().toISOString().slice(0, 10) ? 'today' : historyDate}
              </p>
            </div>
          ) : (
            <div className="max-w-lg mx-auto space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-xs uppercase tracking-wider">
                  Grill Returns — {returnHistory.length} total
                </p>
                <p className="text-gray-400 text-xs font-bold">
                  ₦
                  {returnHistory
                    .filter((r) => r.status === 'accepted' || r.status === 'bar_accepted')
                    .reduce((s, r) => s + (r.item_total || 0), 0)
                    .toLocaleString()}{' '}
                  accepted
                </p>
              </div>
              {returnHistory.map((r) => (
                <div
                  key={r.id}
                  className={`bg-gray-900 border rounded-xl p-3 ${
                    r.status === 'accepted' || r.status === 'bar_accepted'
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
                          r.status === 'accepted' || r.status === 'bar_accepted'
                            ? 'bg-green-500/20 text-green-400'
                            : r.status === 'rejected'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {r.status === 'bar_accepted' ? 'grill accepted' : r.status}
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
      ) : activeTab === 'summary' ? (
        <DailySummaryTab
          destination="griller"
          icon={<Flame size={24} className="text-orange-400" />}
          color="text-orange-400"
        />
      ) : (
        <div className="flex-1 p-4 overflow-auto">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div className="w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center mb-4 border border-gray-800">
                <Flame size={36} className="text-gray-700" />
              </div>
              <p className="text-white font-bold text-lg">Grill is clear</p>
              <p className="text-gray-500 text-sm mt-1">No active grill tickets</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {tickets.map((ticket) => {
                const urgency = getUrgency(ticket.createdAt)
                const styles = URGENCY_STYLES[urgency]
                const elapsed = getElapsed(ticket.createdAt)
                return (
                  <div
                    key={ticket.orderId}
                    className={`border rounded-xl overflow-hidden font-mono ${styles.border}`}
                  >
                    <div className={`${styles.header} px-3 py-2 border-b ${styles.border}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Flame size={14} className={styles.flame} />
                          <span className="text-white font-bold text-sm">{ticket.tableName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {urgency === 'critical' && (
                            <AlertTriangle size={13} className="text-red-400 animate-pulse" />
                          )}
                          <span className={`text-xs font-bold ${styles.time}`}>{elapsed}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-gray-500 text-xs capitalize">
                          {ticket.orderType?.replace('_', ' ') || 'table'}
                        </span>
                        <span className="text-gray-600 text-xs">
                          #{ticket.orderId.slice(-4).toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="px-3 py-1 border-b border-dashed border-gray-700">
                      <p className="text-gray-600 text-xs text-center tracking-widest">
                        — GRILL ORDER —
                      </p>
                    </div>

                    <div className="bg-gray-950 divide-y divide-gray-800/50">
                      {ticket.items.map((item) => (
                        <div
                          key={item.id}
                          className={`px-3 py-2.5 flex items-center justify-between gap-2 ${item.status === 'ready' ? 'opacity-40' : ''}`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-bold text-sm">x{item.quantity}</span>
                              <span className="text-white text-sm">{item.menu_items?.name}</span>
                            </div>
                            {item.notes && (
                              <p className="text-amber-400 text-xs mt-0.5">⚠ {item.notes}</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            {item.status === 'ready' ? (
                              <span className="flex items-center gap-1 text-green-400 text-xs">
                                <CheckCircle size={13} /> Ready
                              </span>
                            ) : (
                              <button
                                onClick={() => markItemReady(item, ticket)}
                                disabled={completing[item.id]}
                                className="bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                              >
                                {completing[item.id] ? (
                                  <RefreshCw size={11} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={11} />
                                )}
                                Done
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="px-3 py-1 border-t border-dashed border-gray-700 bg-gray-950">
                      <p className="text-gray-600 text-xs text-center tracking-widest">
                        ————————————
                      </p>
                    </div>

                    <div className="bg-gray-900 px-3 py-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => printOrderTicket(ticket)}
                          className="flex items-center justify-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded-lg transition-colors"
                        >
                          <Printer size={11} /> Print
                        </button>
                        <button
                          onClick={() => printPendingTicket(ticket)}
                          className="flex items-center justify-center gap-1 text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 px-2 py-1.5 rounded-lg transition-colors"
                        >
                          <Printer size={11} /> Print New Items
                        </button>
                      </div>

                      {ticket.items.some((i) => i.status !== 'ready') && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => markAllReady(ticket)}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <CheckCircle size={13} /> All Done
                          </button>
                          <button
                            onClick={() => rejectOrder(ticket)}
                            className="bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 border border-red-500/30"
                          >
                            <X size={13} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function GrillerKDS() {
  return (
    <ErrorBoundary title="Grill Station Error">
      <GrillerKDSInner />
    </ErrorBoundary>
  )
}
