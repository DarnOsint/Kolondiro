import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { RefreshCw, Camera } from 'lucide-react'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'

import StatCards from './exec/StatCards'
import RevenueChart from './exec/RevenueChart'
import QuickActions from './exec/QuickActions'
import RecentOrders from './exec/RecentOrders'
import CctvPanel from './exec/CctvPanel'
import GeofenceControls from './exec/GeofenceControls'

import type { Stats, TrendDay, CvData } from './exec/types'

function getGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
}

// Accounting session: 08:00 WAT previous day → 08:00 WAT current day
function getSessionWindow() {
  const now = new Date()
  const lagosNow = new Date(
    now.toLocaleString('en-US', {
      timeZone: 'Africa/Lagos',
    })
  )
  const sessionStart = new Date(lagosNow)
  sessionStart.setHours(8, 0, 0, 0)
  if (lagosNow.getHours() < 8) {
    sessionStart.setDate(sessionStart.getDate() - 1)
  }
  const sessionEnd = new Date(sessionStart)
  sessionEnd.setDate(sessionEnd.getDate() + 1)
  return { sessionStart, sessionEnd, sessionStartIso: sessionStart.toISOString() }
}

const HELP_TIPS = [
  {
    id: 'exec-kpis',
    title: 'Live KPI Cards',
    description:
      "Six real-time metrics: today's revenue, open orders, occupied tables, occupied rooms, staff on duty, and low stock count. All cards refresh every 30 seconds and instantly on any database change. Staff on duty is deduplicated — one person always counts as one even if clocked in multiple times.",
  },
  {
    id: 'exec-geofence',
    title: 'Geofence Control',
    description:
      "Toggle GPS boundary enforcement for all floor staff. When ON, staff can only use the POS from within the restaurant's physical boundary. Owners and managers are always exempt. Use Radius to set separate boundaries for the Main venue and Apartments. The boundary is off by default — enable it deliberately once your GPS coordinates are configured.",
  },
  {
    id: 'exec-bank',
    title: 'Bank Transfer Details',
    description:
      'Set the venue bank name, account number, and account name. These details appear on the POS payment screen whenever a customer selects Bank Transfer — your waitron can show it to the customer for instant transfer.',
  },
  {
    id: 'exec-cctv',
    title: 'CCTV Intelligence',
    description:
      'Live occupancy, camera alerts by severity, zone heatmaps, till anomalies, and bar shelf warnings — all fed from the CV module on your Raspberry Pi server. Alerts can be resolved directly from this panel. Requires the Pi CV script to be running.',
  },
  {
    id: 'exec-lowstock',
    title: 'Low Stock Alert',
    description:
      'A red button appears when any inventory item is at or below its minimum threshold. Tap it to jump to Inventory in Back Office to restock. The count updates in real time.',
  },
  {
    id: 'exec-recentorders',
    title: "Today's Orders Feed",
    description:
      "Shows today's orders — table name, assigned waitron, time, amount, and status badge (open = amber, paid = green). Paid orders from previous days no longer appear here. Tap Full Report to go to detailed Reports.",
  },
  {
    id: 'exec-quickactions',
    title: 'Quick Actions',
    description:
      'Shortcut tiles to Accounting, Reports, Back Office, Management, Rooms, and Analytics. Use these instead of navigating through the sidebar.',
  },
  {
    id: 'exec-peak',
    title: 'Peak Hour',
    description:
      'Shows the hour of the day that generated the most revenue over the last 7 days. Use this to plan staffing — ensure your best waitrons are on during peak.',
  },
]

export default function Executive() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Settings state (lifted here so GeofenceControls can be stateless on the save actions)
  const [geofenceEnabled, setGeofenceEnabled] = useState(true)
  const [radiusMain, setRadiusMain] = useState(400)
  const [radiusApartment, setRadiusApartment] = useState(200)
  const [latMain, setLatMain] = useState('7.350834')
  const [lngMain, setLngMain] = useState('3.840780')
  const [latApartment, setLatApartment] = useState('7.349545')
  const [lngApartment, setLngApartment] = useState('3.839690')

  const [stats, setStats] = useState<Stats>({
    revenue: 0,
    openOrders: 0,
    occupiedTables: 0,
    totalTables: 0,
    occupiedRooms: 0,
    totalRooms: 0,
    staffOnDuty: 0,
    lowStock: 0,
  })
  const [recentOrders, setRecentOrders] = useState<Record<string, unknown>[]>([])
  const [trendData, setTrendData] = useState<TrendDay[]>([])
  const [loading, setLoading] = useState(true)
  const [cvTab, setCvTab] = useState(false)
  const [cvData, setCvData] = useState<CvData>({
    occupancy: 0,
    todayAlerts: [],
    zoneHeatmaps: [],
    tillEvents: [],
    shelfAlerts: [],
  })

  const statsRefreshTimer = useRef<number | null>(null)
  const statsRefreshInFlight = useRef(false)
  const lastStatsFetchAt = useRef(0)

  const isVisible = () => document.visibilityState === 'visible'

  const fetchStats = useCallback(async () => {
    void supabase.rpc('free_orphaned_tables')
    const { sessionStart, sessionEnd, sessionStartIso } = getSessionWindow()
    const [ordersRes, tablesRes, roomsRes, shiftsRes, stockRes, recentRes, revenueRes, trendRes] =
      await Promise.all([
        supabase.from('orders').select('id').eq('status', 'open'),
        supabase.from('tables').select('status'),
        supabase.from('rooms').select('status'),
        supabase.from('attendance').select('staff_id').or('clock_out.is.null'),
        supabase.from('inventory').select('id, current_stock, minimum_stock').eq('is_active', true),
        supabase
          .from('orders')
          .select(
            'id, total_amount, status, order_type, created_at, tables(name), profiles(full_name)'
          )
          .gte('created_at', sessionStartIso)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('orders')
          .select(
            'total_amount, order_items(total_price, return_requested, return_accepted, status)'
          )
          .eq('status', 'paid')
          .gte('closed_at', sessionStart.toISOString())
          .lt('closed_at', sessionEnd.toISOString()),
        supabase
          .from('orders')
          .select(
            'closed_at, total_amount, order_items(total_price, status, return_requested, return_accepted)'
          )
          .eq('status', 'paid')
          .gte('closed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('closed_at', { ascending: true }),
      ])
    setStats({
      revenue: (revenueRes.data || []).reduce((s: number, o: any) => {
        const net = (o.order_items || [])
          .filter(
            (i: any) =>
              !i.return_requested &&
              !i.return_accepted &&
              (i.status || '').toLowerCase() !== 'cancelled'
          )
          .reduce((ss: number, i: any) => ss + (i.total_price || 0), 0)
        return s + net
      }, 0),
      openOrders: ordersRes.data?.length || 0,
      occupiedTables: tablesRes.data?.filter((t) => t.status === 'occupied').length || 0,
      totalTables: tablesRes.data?.length || 0,
      occupiedRooms: roomsRes.data?.filter((r) => r.status === 'occupied').length || 0,
      totalRooms: roomsRes.data?.length || 0,
      staffOnDuty: new Set((shiftsRes.data || []).map((r: { staff_id: string }) => r.staff_id))
        .size,
      lowStock: stockRes.data?.filter((i) => i.current_stock <= i.minimum_stock).length || 0,
    })
    setRecentOrders((recentRes.data || []) as Record<string, unknown>[])
    const dayMap: Record<string, TrendDay> = {}
    ;(trendRes.data || []).forEach((o) => {
      const day = new Date(o.closed_at).toLocaleDateString('en-NG', {
        weekday: 'short',
        day: 'numeric',
      })
      if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
      const net = (o.order_items || [])
        .filter(
          (i: any) =>
            !i.return_requested &&
            !i.return_accepted &&
            (i.status || '').toLowerCase() !== 'cancelled'
        )
        .reduce((s: number, i: any) => s + (i.total_price || 0), 0)
      dayMap[day].revenue += net
      dayMap[day].orders++
    })
    setTrendData(Object.values(dayMap))
    setLoading(false)
  }, [])

  const scheduleFetchStats = useCallback(
    (maxFrequencyMs = 5000) => {
      if (!isVisible()) return
      if (statsRefreshTimer.current) return
      const now = Date.now()
      const earliest = lastStatsFetchAt.current + maxFrequencyMs
      const delay = Math.max(0, earliest - now)
      statsRefreshTimer.current = window.setTimeout(async () => {
        statsRefreshTimer.current = null
        if (!isVisible()) return
        if (statsRefreshInFlight.current) return
        statsRefreshInFlight.current = true
        try {
          await fetchStats()
          lastStatsFetchAt.current = Date.now()
        } finally {
          statsRefreshInFlight.current = false
        }
      }, delay)
    },
    [fetchStats]
  )

  const fetchCvData = useCallback(async () => {
    const { sessionStartIso } = getSessionWindow()
    const [occupancyRes, alertsRes, heatmapRes, tillRes, shelfRes] = await Promise.all([
      supabase
        .from('cv_people_counts')
        .select('occupancy')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('cv_alerts')
        .select('id, camera_id, alert_type, description, severity, created_at')
        .eq('resolved', false)
        .gte('created_at', sessionStartIso)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('cv_zone_heatmaps')
        .select('zone_label, person_count, avg_dwell_seconds')
        .gte('created_at', sessionStartIso)
        .order('person_count', { ascending: false })
        .limit(10),
      supabase
        .from('cv_till_events')
        .select('id, alert_type, created_at')
        .neq('alert_type', 'normal')
        .gte('created_at', sessionStartIso)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('cv_shelf_events')
        .select('id, drink_name, alert_level, created_at')
        .neq('alert_level', 'normal')
        .gte('created_at', sessionStartIso)
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    setCvData({
      occupancy: occupancyRes.data?.[0]?.occupancy || 0,
      todayAlerts: (alertsRes.data || []) as Record<string, unknown>[],
      zoneHeatmaps: (heatmapRes.data || []) as Record<string, unknown>[],
      tillEvents: (tillRes.data || []) as Record<string, unknown>[],
      shelfAlerts: (shelfRes.data || []) as Record<string, unknown>[],
    })
  }, [])

  useEffect(() => {
    scheduleFetchStats(0)
    supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'geofence_enabled',
        'geofence_radius_main',
        'geofence_radius_apartment',
        'geofence_lat_main',
        'geofence_lng_main',
        'geofence_lat_apartment',
        'geofence_lng_apartment',
        'bank_name',
        'bank_account_number',
        'bank_account_name',
      ])
      .then(({ data }) => {
        if (!data) return
        const map = Object.fromEntries(data.map((r) => [r.id, r.value]))
        if (map['geofence_enabled'] !== undefined)
          setGeofenceEnabled(map['geofence_enabled'] === 'true')
        if (map['geofence_radius_main']) setRadiusMain(parseInt(map['geofence_radius_main']))
        if (map['geofence_radius_apartment'])
          setRadiusApartment(parseInt(map['geofence_radius_apartment']))
        if (map['geofence_lat_main']) setLatMain(map['geofence_lat_main'])
        if (map['geofence_lng_main']) setLngMain(map['geofence_lng_main'])
        if (map['geofence_lat_apartment']) setLatApartment(map['geofence_lat_apartment'])
        if (map['geofence_lng_apartment']) setLngApartment(map['geofence_lng_apartment'])
      })
    const ch = supabase
      .channel('executive-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () =>
        scheduleFetchStats(8000)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () =>
        scheduleFetchStats(8000)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () =>
        scheduleFetchStats(8000)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () =>
        scheduleFetchStats(8000)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, () =>
        scheduleFetchStats(8000)
      )
      .subscribe()
    return () => {
      if (statsRefreshTimer.current) window.clearTimeout(statsRefreshTimer.current)
      supabase.removeChannel(ch)
    }
  }, [scheduleFetchStats])

  useVisibilityInterval(() => scheduleFetchStats(15000), 60_000, [scheduleFetchStats])

  useEffect(() => {
    if (!cvTab) return
    if (!isVisible()) return
    fetchCvData()
    const cvCh = supabase
      .channel('cv-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_alerts' },
        () => void fetchCvData()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_people_counts' },
        () => void fetchCvData()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_till_events' },
        () => void fetchCvData()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_shelf_events' },
        () => void fetchCvData()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(cvCh)
    }
  }, [cvTab, fetchCvData])

  const peakHour = (() => {
    const hourMap: Record<number, number> = {}
    recentOrders.forEach((o) => {
      const h = new Date(o.created_at as string).getHours()
      hourMap[h] = (hourMap[h] || 0) + 1
    })
    const peak = Object.entries(hourMap).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    if (!peak) return null
    const h = parseInt(peak[0])
    return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
  })()

  const resolveAlert = async (id: string) => {
    await supabase.from('cv_alerts').update({ resolved: true }).eq('id', id)
    setCvData((prev) => ({
      ...prev,
      todayAlerts: prev.todayAlerts.filter((a) => (a as Record<string, string>).id !== id),
    }))
  }

  return (
    <div className="min-h-full bg-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 md:px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-sm md:text-base">Executive Dashboard</h1>
          <p className="text-gray-400 text-xs">
            Good {getGreeting()}, {profile?.full_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HelpTooltip storageKey="executive" tips={HELP_TIPS} />
          <button
            onClick={() => setCvTab((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors ${cvTab ? 'bg-purple-500/20 border-purple-500/40 text-purple-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
          >
            <Camera size={13} /> CCTV
          </button>
          <button onClick={fetchStats} className="text-gray-400 hover:text-white">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6">
        <GeofenceControls
          stats={stats}
          geofenceEnabled={geofenceEnabled}
          setGeofenceEnabled={setGeofenceEnabled}
          radiusMain={radiusMain}
          setRadiusMain={setRadiusMain}
          radiusApartment={radiusApartment}
          setRadiusApartment={setRadiusApartment}
          latMain={latMain}
          setLatMain={setLatMain}
          lngMain={lngMain}
          setLngMain={setLngMain}
          latApartment={latApartment}
          setLatApartment={setLatApartment}
          lngApartment={lngApartment}
          setLngApartment={setLngApartment}
          peakHour={peakHour}
          onNavigateLowStock={() => navigate('/management?tab=mainstore&lowStock=true')}
        />

        {cvTab && <CctvPanel cvData={cvData} onResolve={resolveAlert} />}

        <StatCards
          stats={stats}
          onLowStockClick={() => navigate('/management?tab=mainstore&lowStock=true')}
        />
        <RevenueChart trendData={trendData} />
        <QuickActions />
        <RecentOrders
          orders={recentOrders as unknown as Parameters<typeof RecentOrders>[0]['orders']}
        />
      </div>
    </div>
  )
}
