import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { RefreshCw } from 'lucide-react'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'

import StatCards from './exec/StatCards'
import RevenueChart from './exec/RevenueChart'
import QuickActions from './exec/QuickActions'
import RecentOrders from './exec/RecentOrders'

import type { Stats, TrendDay } from './exec/types'

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
      "Six real-time metrics: today's revenue, open orders, occupied tables, staff on duty, and low stock count. All cards refresh every 30 seconds and instantly on any database change. Staff on duty is deduplicated — one person always counts as one even if clocked in multiple times.",
  },
  {
    id: 'exec-bank',
    title: 'Bank Transfer Details',
    description:
      'Set the venue bank name, account number, and account name. These details appear on the POS payment screen whenever a customer selects Bank Transfer — your waitron can show it to the customer for instant transfer.',
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
      'Shortcut tiles to Accounting, Reports, Back Office, Management, and Analytics. Use these instead of navigating through the sidebar.',
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

  const [stats, setStats] = useState<Stats>({
    revenue: 0,
    openOrders: 0,
    occupiedTables: 0,
    totalTables: 0,
    staffOnDuty: 0,
    lowStock: 0,
  })
  const [recentOrders, setRecentOrders] = useState<Record<string, unknown>[]>([])
  const [trendData, setTrendData] = useState<TrendDay[]>([])
  const [loading, setLoading] = useState(true)

  const statsRefreshTimer = useRef<number | null>(null)
  const statsRefreshInFlight = useRef(false)
  const lastStatsFetchAt = useRef(0)

  const isVisible = () => document.visibilityState === 'visible'

  const fetchStats = useCallback(async () => {
    void supabase.rpc('free_orphaned_tables')
    const { sessionStart, sessionEnd, sessionStartIso } = getSessionWindow()
    const [ordersRes, tablesRes, shiftsRes, stockRes, recentRes, revenueRes, trendRes] =
      await Promise.all([
        supabase.from('orders').select('id').eq('status', 'open'),
        supabase.from('tables').select('status'),
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
      staffOnDuty: new Set((shiftsRes.data || []).map((r: { staff_id: string }) => r.staff_id))
        .size,
      lowStock: stockRes.data?.filter((i) => i.current_stock <= i.minimum_stock).length || 0,
    })
    setRecentOrders((recentRes.data || []) as Record<string, unknown>[])
    const dayMap: Record<string, TrendDay> = {}
    ;(trendRes.data || []).forEach((o) => {
      const day = new Date(o.closed_at).toLocaleDateString('en-SS', {
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

  useEffect(() => {
    scheduleFetchStats(0)
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
      .subscribe()
    return () => {
      if (statsRefreshTimer.current) window.clearTimeout(statsRefreshTimer.current)
      supabase.removeChannel(ch)
    }
  }, [scheduleFetchStats])

  useVisibilityInterval(() => scheduleFetchStats(15000), 60_000, [scheduleFetchStats])

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
          <button onClick={fetchStats} className="text-gray-400 hover:text-white">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6">
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
