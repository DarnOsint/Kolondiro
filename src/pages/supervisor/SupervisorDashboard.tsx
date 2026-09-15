import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import ErrorBoundary from '../../components/ErrorBoundary'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'
import ShiftManager from '../management/ShiftManager'
import TableAssignment from '../management/TableAssignment'
import {
  Users,
  ShoppingBag,
  AlertTriangle,
  Clock,
  CheckCircle,
  Phone,
  RefreshCw,
  LogOut,
  ChefHat,
  Wine,
  Flame,
  Bell,
  UserCheck,
  LayoutGrid,
  Package,
  RotateCcw,
  Banknote,
} from 'lucide-react'
import SupervisorMainStoreTab from './SupervisorMainStoreTab'
import SupervisorReturnsTab from './SupervisorReturnsTab'
import SupervisorReconTab from './SupervisorReconTab'

interface OpenOrder {
  id: string
  created_at: string
  order_type: string
  tables?: { name: string; table_categories?: { name: string } | null } | null
  profiles?: { full_name: string } | null
  order_items?: Array<{
    id: string
    status: string
    destination: string
    menu_items?: { name: string } | null
  }>
}
interface ActiveShift {
  id: string
  staff_id: string
  staff_name: string
  role: string
  clock_in: string
}
interface WaiterCall {
  id: string
  table_name: string
  waitron_name: string | null
  status: string
  created_at: string
}
interface VoidEntry {
  id: string
  menu_item_name: string
  total_value: number
  approved_by_name: string | null
  created_at: string
}

function elapsed(ts: string) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}
function urgencyBorder(ts: string, hasPending: boolean) {
  if (!hasPending) return 'border-gray-700 bg-gray-900'
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m >= 20) return 'border-red-500 bg-red-500/5'
  if (m >= 10) return 'border-amber-500 bg-amber-500/5'
  return 'border-gray-700 bg-gray-900'
}
function urgencyText(ts: string, hasPending: boolean) {
  if (!hasPending) return 'text-gray-400'
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m >= 20) return 'text-red-400 font-bold'
  if (m >= 10) return 'text-amber-400 font-bold'
  return 'text-gray-400'
}
const ROLE_ICON: Record<string, React.ReactNode> = {
  kitchen: <ChefHat size={13} className="text-orange-400" />,
  bar: <Wine size={13} className="text-blue-400" />,
  griller: <Flame size={13} className="text-red-400" />,
  waitron: <Users size={13} className="text-amber-400" />,
}

const SUPERVISOR_TIPS = [
  {
    id: 'sup-floor',
    title: 'Floor Tab',
    description:
      'Live view of every open order on the floor. Cards turn amber at 10 minutes and red at 20 minutes — escalate red cards immediately to the kitchen or bar. Use the zone filter (Outdoor, Indoor, VIP Lounge, The Nook) to focus on a specific area. This is a read-only view — use the Management page to take action.',
  },
  {
    id: 'sup-staff',
    title: 'Staff Tab',
    description:
      'Who is currently on shift, their role, and how long they have been on. Use this to quickly verify all positions are covered without calling the manager.',
  },
  {
    id: 'sup-calls',
    title: 'Calls Tab',
    description:
      'Pending waiter calls from customer tables — table name, assigned waitron, and how long the call has been waiting. If a call is unanswered beyond a reasonable time, notify the waitron directly.',
  },
  {
    id: 'sup-voids',
    title: 'Voids Tab',
    description:
      "Today's void log — item name, who authorised it, and when. The total voided value is shown at the top. Unusual void patterns should be escalated to the manager.",
  },
  {
    id: 'sup-returns',
    title: 'Returns Tab',
    description:
      'Read-only view of all returned items for a chosen day. Switch between dates with the date picker, Today, or Prev Day buttons. This is a view-only tab — approvals and rejections are handled on the Management page.',
  },
  {
    id: 'sup-kpis',
    title: 'KPI Strip',
    description:
      'Four live counts at a glance: open orders, pending items (not yet started in kitchen/bar), items currently being prepared, and total staff on shift. These update every 30 seconds and in real time via live subscriptions.',
  },
  {
    id: 'sup-recon',
    title: 'Recon Tab',
    description:
      'Enter how much each waitron submitted in cash and POS/transfer at close of work. Expected amounts come from paid sales; shortage and excess are computed automatically. Saved to the same daily reconciliation record the accountant uses.',
  },
  {
    id: 'sup-alerts',
    title: 'Alert Badges',
    description:
      'The header shows red badge for late orders and amber badge for unanswered waiter calls. These are the two things that need your immediate attention on the floor.',
  },
]

function SupervisorDashboardInner() {
  const { profile, signOut } = useAuth()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [shifts, setShifts] = useState<ActiveShift[]>([])
  const [calls, setCalls] = useState<WaiterCall[]>([])
  const [voids, setVoids] = useState<VoidEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<
    'floor' | 'staff' | 'calls' | 'voids' | 'shift' | 'tables' | 'store' | 'returns' | 'recon'
  >('floor')
  const [zoneFilter, setZoneFilter] = useState('All')
  const [lateCount] = useState(0) // SUSPENDED
  const [pendingStore, setPendingStore] = useState(0)

  const fetchAll = useCallback(async () => {
    const today = new Date()
    today.setHours(8, 0, 0, 0)
    if (new Date().getHours() < 8) today.setDate(today.getDate() - 1)
    const [oR, sR, cR, vR, storeR] = await Promise.all([
      supabase
        .from('orders')
        .select(
          'id,created_at,order_type,tables(name),profiles(full_name),order_items(id,status,destination,menu_items(name))'
        )
        .eq('status', 'open')
        .order('created_at', { ascending: true }),
      supabase
        .from('attendance')
        .select('id,staff_id,staff_name,role,clock_in')
        .or('clock_out.is.null')
        .order('clock_in', { ascending: true }),
      supabase
        .from('waiter_calls')
        .select('id,table_name,waitron_name,status,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('void_log')
        .select('id,menu_item_name,total_value,approved_by_name,created_at')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('store_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])
    setOrders((oR.data || []) as unknown as OpenOrder[])
    setShifts((sR.data || []) as ActiveShift[])
    setCalls((cR.data || []) as WaiterCall[])
    setVoids((vR.data || []) as VoidEntry[])
    setPendingStore(storeR.count || 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const ch = supabase
      .channel('supervisor-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_requests' }, fetchAll)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchAll])

  useVisibilityInterval(fetchAll, 60_000, [fetchAll])

  // SUSPENDED: late order alerts disabled until further notice
  // useEffect(() => { ... }, [orders])

  const pendingItems = useMemo(
    () =>
      orders.reduce(
        (n, o) => n + (o.order_items?.filter((i) => i.status === 'pending').length || 0),
        0
      ),
    [orders]
  )
  const preparingItems = useMemo(
    () =>
      orders.reduce(
        (n, o) => n + (o.order_items?.filter((i) => i.status === 'preparing').length || 0),
        0
      ),
    [orders]
  )

  const TABS = [
    {
      id: 'floor' as const,
      label: 'Floor',
      icon: ShoppingBag,
      badge: lateCount,
      badgeRed: lateCount > 0,
    },
    { id: 'staff' as const, label: 'Staff', icon: Users, badge: shifts.length, badgeRed: false },
    {
      id: 'store' as const,
      label: 'Store',
      icon: Package,
      badge: pendingStore,
      badgeRed: pendingStore > 0,
    },
    { id: 'shift' as const, label: 'Shift', icon: UserCheck, badge: 0, badgeRed: false },
    { id: 'tables' as const, label: 'Tables', icon: LayoutGrid, badge: 0, badgeRed: false },
    { id: 'returns' as const, label: 'Returns', icon: RotateCcw, badge: 0, badgeRed: false },
    {
      id: 'recon' as const,
      label: 'Recon',
      icon: Banknote,
      badge: 0,
      badgeRed: false,
    },
  ]

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading…</div>
      </div>
    )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500 flex items-center justify-center">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">Supervisor</p>
            <p className="text-gray-400 text-xs">{profile?.full_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lateCount > 0 && (
            <div className="flex items-center gap-1 bg-red-500/20 border border-red-500/30 rounded-xl px-2 py-1">
              <AlertTriangle size={11} className="text-red-400" />
              <span className="text-red-400 text-xs font-bold">{lateCount} late</span>
            </div>
          )}
          {calls.length > 0 && (
            <div className="flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 rounded-xl px-2 py-1">
              <Bell size={11} className="text-amber-400" />
              <span className="text-amber-400 text-xs font-bold">{calls.length}</span>
            </div>
          )}
          <HelpTooltip storageKey="supervisor" tips={SUPERVISOR_TIPS} />
          <button onClick={fetchAll} className="text-gray-400 hover:text-white p-1">
            <RefreshCw size={15} />
          </button>
          <button onClick={signOut} className="text-gray-400 hover:text-white p-1">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-800 border-b border-gray-800">
        {[
          { label: 'Open', value: orders.length, color: 'text-white' },
          {
            label: 'Pending',
            value: pendingItems,
            color: pendingItems > 0 ? 'text-amber-400' : 'text-green-400',
          },
          { label: 'Cooking', value: preparingItems, color: 'text-blue-400' },
          { label: 'On Shift', value: shifts.length, color: 'text-purple-400' },
        ].map((k) => (
          <div key={k.label} className="bg-gray-950 py-3 text-center">
            <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
            <p className="text-gray-600 text-[10px] mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 sticky top-[61px] z-10 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-w-[64px] flex flex-col items-center py-2.5 gap-0.5 relative transition-colors ${tab === t.id ? 'text-amber-400 border-b-2 border-amber-500' : 'text-gray-500'}`}
          >
            <t.icon size={15} />
            <span className="text-[10px] font-medium">{t.label}</span>
            {t.badge > 0 && (
              <span
                className={`absolute top-1 right-1/4 text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center ${t.badgeRed ? 'bg-red-500 text-white' : 'bg-amber-500 text-black'}`}
              >
                {t.badge > 9 ? '9+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'floor' && (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {['All', 'Outdoor', 'Indoor', 'VIP Lounge', 'The Nook'].map((z) => (
                <button
                  key={z}
                  onClick={() => setZoneFilter(z)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${zoneFilter === z ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
                >
                  {z}
                </button>
              ))}
            </div>
            {(zoneFilter === 'All'
              ? orders
              : orders.filter(
                  (o) =>
                    (o.tables as { table_categories?: { name?: string } | null } | null)
                      ?.table_categories?.name === zoneFilter
                )
            ).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <CheckCircle size={36} className="mb-3 text-green-500/40" />
                <p className="font-medium">
                  {zoneFilter === 'All'
                    ? 'All clear — no open orders'
                    : `No open orders in ${zoneFilter}`}
                </p>
              </div>
            ) : (
              (zoneFilter === 'All'
                ? orders
                : orders.filter(
                    (o) =>
                      (o.tables as { table_categories?: { name?: string } | null } | null)
                        ?.table_categories?.name === zoneFilter
                  )
              ).map((order) => {
                const pending = order.order_items?.filter((i) => i.status === 'pending') || []
                const preparing = order.order_items?.filter((i) => i.status === 'preparing') || []
                const ready = order.order_items?.filter((i) => i.status === 'ready') || []
                return (
                  <div
                    key={order.id}
                    className={`rounded-2xl border-2 p-3 ${urgencyBorder(order.created_at, pending.length > 0)}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-bold">
                          {order.tables?.name || order.order_type}
                        </p>
                        {order.profiles?.full_name && (
                          <span className="text-gray-500 text-xs">
                            · {order.profiles.full_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={11} className="text-gray-500" />
                        <span
                          className={`text-xs ${urgencyText(order.created_at, pending.length > 0)}`}
                        >
                          {elapsed(order.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs flex-wrap">
                      {pending.length > 0 && (
                        <span className="bg-gray-700 text-gray-300 rounded-lg px-2 py-0.5">
                          {pending.length} pending
                        </span>
                      )}
                      {preparing.length > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 rounded-lg px-2 py-0.5">
                          {preparing.length} cooking
                        </span>
                      )}
                      {ready.length > 0 && (
                        <span className="bg-green-500/20 text-green-400 rounded-lg px-2 py-0.5">
                          {ready.length} ready
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </>
        )}

        {tab === 'staff' &&
          (shifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <Users size={36} className="mb-3 opacity-30" />
              <p className="font-medium">No staff on shift</p>
            </div>
          ) : (
            shifts.map((s) => (
              <div
                key={s.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gray-800 flex items-center justify-center">
                    {ROLE_ICON[s.role] || <Users size={13} className="text-gray-400" />}
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">{s.staff_name}</p>
                    <p className="text-gray-500 text-xs capitalize">{s.role}</p>
                  </div>
                </div>
                <p className="text-gray-400 text-xs flex items-center gap-1">
                  <Clock size={11} />
                  {elapsed(s.clock_in)} on shift
                </p>
              </div>
            ))
          ))}

        {tab === 'calls' &&
          (calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <Phone size={36} className="mb-3 opacity-30" />
              <p className="font-medium">No pending waiter calls</p>
            </div>
          ) : (
            calls.map((call) => (
              <div
                key={call.id}
                className="bg-gray-900 border border-amber-500/30 rounded-2xl px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-white font-bold">{call.table_name}</p>
                  <p className="text-gray-500 text-xs">
                    {call.waitron_name ? `Waitron: ${call.waitron_name}` : 'Unassigned'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-amber-400 text-xs font-bold">{elapsed(call.created_at)} ago</p>
                  <span className="text-xs bg-amber-500/20 text-amber-400 rounded-lg px-2 py-0.5">
                    Pending
                  </span>
                </div>
              </div>
            ))
          ))}

        {tab === 'voids' &&
          (voids.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <CheckCircle size={36} className="mb-3 text-green-500/40" />
              <p className="font-medium">No voids today</p>
            </div>
          ) : (
            <>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2 flex items-center justify-between">
                <span className="text-red-400 text-xs font-semibold">Total voided today</span>
                <span className="text-red-400 font-bold">
                  ₦{voids.reduce((s, v) => s + (v.total_value || 0), 0).toLocaleString()}
                </span>
              </div>
              {voids.map((v) => (
                <div
                  key={v.id}
                  className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white text-sm font-semibold">{v.menu_item_name}</p>
                    <p className="text-gray-500 text-xs">
                      Approved: {v.approved_by_name || '—'} · {elapsed(v.created_at)} ago
                    </p>
                  </div>
                  <p className="text-red-400 font-bold text-sm">
                    ₦{(v.total_value || 0).toLocaleString()}
                  </p>
                </div>
              ))}
            </>
          ))}

        {tab === 'store' && <SupervisorMainStoreTab />}

        {tab === 'shift' && <ShiftManager />}

        {tab === 'tables' && <TableAssignment />}

        {tab === 'returns' && <SupervisorReturnsTab />}

        {tab === 'recon' && <SupervisorReconTab />}
      </div>
    </div>
  )
}

export default function SupervisorDashboard() {
  return (
    <ErrorBoundary title="Supervisor Error">
      <SupervisorDashboardInner />
    </ErrorBoundary>
  )
}
