import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  ArrowLeft,
  TrendingUp,
  Users,
  ShoppingBag,
  Clock,
  Zap,
  AlertTriangle,
  CreditCard,
  RefreshCw,
  Loader2,
  Star,
  MapPin,
} from 'lucide-react'
import { HelpTooltip } from '../../components/HelpTooltip'

const AMBER = '#f59e0b',
  GREEN = '#10b981',
  RED = '#ef4444',
  BLUE = '#3b82f6',
  PURPLE = '#8b5cf6'
const PIE_COLORS = [AMBER, GREEN, BLUE, PURPLE, RED, '#ec4899', '#14b8a6']
const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'custom', label: 'Custom' },
]

interface ChartPoint {
  label?: string
  day?: string
  revenue: number
  orders: number
}
interface HeatmapRow {
  day: string
  [hour: number]: number
}
interface ItemStat {
  name: string
  category: string
  qty: number
  revenue: number
}
interface CatStat {
  name: string
  value: number
}
interface StaffStat {
  name: string
  orders: number
  revenue: number
}
interface ZoneStat {
  name: string
  value: number
}
interface KPIs {
  totalRevenue: number
  totalOrders: number
  avgOrder: number
  cancelRate: number | string
  debtExposure: number
  repeatRate: number | string
}
interface AnalyticsData {
  kpis: KPIs
  heatmap: HeatmapRow[]
  hours: number[]
  hourlyChart: ChartPoint[]
  bestSellers: ItemStat[]
  categorySplit: CatStat[]
  paymentBreakdown: CatStat[]
  staffPerf: StaffStat[]
  revenueByZone: ZoneStat[]
  revenueTrend: ChartPoint[]
}

function getRangeDates(range: string, custom: { from: string; to: string }) {
  const now = new Date()
  const sessionStart = () => {
    const s = new Date(now)
    s.setHours(8, 0, 0, 0)
    if (now.getHours() < 8) s.setDate(s.getDate() - 1)
    return s
  }
  const pad = (d: Date) => d.toISOString()
  if (range === 'today') {
    const s = sessionStart()
    const e = new Date(s)
    e.setDate(e.getDate() + 1)
    return { from: pad(s), to: pad(e) }
  }
  if (range === 'week') {
    const e = sessionStart()
    const s = new Date(e)
    s.setDate(s.getDate() - 6)
    return { from: pad(s), to: pad(e) }
  }
  if (range === 'month') {
    const e = sessionStart()
    const s = new Date(e)
    s.setDate(1)
    return { from: pad(s), to: pad(e) }
  }
  if (range === 'custom' && custom.from && custom.to) {
    const cEnd = new Date(custom.to + 'T08:00:00+01:00')
    cEnd.setDate(cEnd.getDate() + 1)
    return {
      from: new Date(custom.from + 'T08:00:00+01:00').toISOString(),
      to: cEnd.toISOString(),
    }
  }
  return { from: null, to: null }
}

type ColorKey = 'amber' | 'green' | 'red' | 'blue' | 'purple'
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'amber',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: ColorKey
}) {
  const colors: Record<ColorKey, string> = {
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    green: 'text-green-400 bg-green-500/10 border-green-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  }
  const iconColors: Record<ColorKey, string> = {
    amber: 'text-amber-400',
    green: 'text-green-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  }
  return (
    <div className={`rounded-2xl border p-5 ${colors[color]}`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon size={18} className={iconColors[color]} />
        <span className="text-gray-400 text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-white text-2xl font-bold">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

const ANALYTICS_HELP_TIPS = [
  {
    id: 'ana-kpis',
    title: 'KPI Summary',
    description:
      'Six performance metrics for the selected period: total revenue, total orders, average order value, cancel rate, repeat customer rate, and debt exposure (outstanding credit balances). Use the date range selector to compare periods.',
  },
  {
    id: 'ana-hourly',
    title: 'Hourly Heatmap',
    description:
      'A 7-day × 24-hour grid showing revenue concentration by time of day. Darker cells = higher revenue. Use this to identify your true peak hours for staffing decisions.',
  },
  {
    id: 'ana-bestsellers',
    title: 'Top Selling Items',
    description:
      'Your highest-revenue menu items for the period — item name, units sold, and total revenue. Use this to ensure top sellers are always in stock and to inform menu decisions.',
  },
  {
    id: 'ana-waitrons',
    title: 'Waitron Performance',
    description:
      'Revenue, order count, and average order value per waitron for the period. Useful for identifying your strongest performers and any outliers that may need attention.',
  },
  {
    id: 'ana-ai',
    title: 'AI Insights',
    description:
      'Tap the AI Insights button to get 5–6 sharp, data-driven observations about your trading patterns — generated by Claude based on your actual figures. Refreshes each time you tap.',
  },
  {
    id: 'ana-daterange',
    title: 'Date Range',
    description:
      'Select any date range to filter all analytics to that period. Shorter ranges give more granular insight; longer ranges show trends. The default is the last 30 days.',
  },
]

export default function Analytics() {
  const navigate = useNavigate()
  const [range, setRange] = useState('week')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiInsight, setAiInsight] = useState('')
  const [aiError, setAiError] = useState(false)
  const [aiErrorMsg, setAiErrorMsg] = useState('')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const fmt = (n: number) => '₦' + (n || 0).toLocaleString()

  const processData = useCallback(
    (
      orders: Record<string, unknown>[],
      items: Record<string, unknown>[],
      _staff: unknown[],
      debtors: { status?: string; current_balance?: number }[],
      _tables: unknown[]
    ) => {
      const paid = orders.filter((o) => o.status === 'paid')
      const cancelled = orders.filter((o) => o.status === 'void')
      const totalOrders = paid.length
      const totalRevenue = paid.reduce((s, o) => s + ((o.total_amount as number) || 0), 0)
      const avgOrder = totalOrders ? Math.round(totalRevenue / totalOrders) : 0
      const cancelRate = orders.length ? ((cancelled.length / orders.length) * 100).toFixed(1) : 0
      const debtExposure = (debtors || [])
        .filter((d) => d.status !== 'paid')
        .reduce((s, d) => s + (d.current_balance || 0), 0)

      const phoneMap: Record<string, number> = {}
      paid.forEach((o) => {
        if (o.customer_phone)
          phoneMap[o.customer_phone as string] = (phoneMap[o.customer_phone as string] || 0) + 1
      })
      const repeatCustomers = Object.values(phoneMap).filter((v) => v > 1).length
      const totalWithPhone = Object.keys(phoneMap).length
      const repeatRate = totalWithPhone ? ((repeatCustomers / totalWithPhone) * 100).toFixed(1) : 0

      const hourMapRaw: Record<string, number> = {}
      paid.forEach((o) => {
        const d = new Date(o.created_at as string)
        const day = d.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short' })
        const hour = parseInt(
          d.toLocaleTimeString('en-NG', {
            timeZone: 'Africa/Lagos',
            hour: 'numeric',
            hour12: false,
          })
        )
        hourMapRaw[`${day}-${hour}`] = (hourMapRaw[`${day}-${hour}`] || 0) + 1
      })
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const hours = Array.from({ length: 18 }, (_, i) => i + 6)
      const heatmap: HeatmapRow[] = days.map((day) => {
        const row: HeatmapRow = { day }
        hours.forEach((h) => {
          row[h] = hourMapRaw[`${day}-${h}`] || 0
        })
        return row
      })

      const hourlyMap: Record<number, { hour: number; orders: number; revenue: number }> = {}
      paid.forEach((o) => {
        const h = parseInt(
          new Date(o.created_at as string).toLocaleTimeString('en-NG', {
            timeZone: 'Africa/Lagos',
            hour: 'numeric',
            hour12: false,
          })
        )
        if (!hourlyMap[h]) hourlyMap[h] = { hour: h, orders: 0, revenue: 0 }
        hourlyMap[h].orders++
        hourlyMap[h].revenue += (o.total_amount as number) || 0
      })
      const hourlyChart = Array.from({ length: 18 }, (_, i) => {
        const h = i + 6
        const label = h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`
        return { label, orders: hourlyMap[h]?.orders || 0, revenue: hourlyMap[h]?.revenue || 0 }
      })

      const itemMap: Record<string, ItemStat> = {}
      ;(
        items as {
          quantity?: number
          unit_price?: number
          menu_items?: { name?: string; menu_categories?: { name?: string } | null } | null
        }[]
      ).forEach((i) => {
        const name = i.menu_items?.name || 'Unknown',
          cat = i.menu_items?.menu_categories?.name || 'Other'
        if (!itemMap[name]) itemMap[name] = { name, category: cat, qty: 0, revenue: 0 }
        itemMap[name].qty += i.quantity || 0
        itemMap[name].revenue += (i.unit_price || 0) * (i.quantity || 0)
      })

      const catMap: Record<string, number> = {}
      ;(
        items as {
          unit_price?: number
          quantity?: number
          menu_items?: { menu_categories?: { name?: string } | null } | null
        }[]
      ).forEach((i) => {
        const cat = i.menu_items?.menu_categories?.name || 'Other'
        catMap[cat] = (catMap[cat] || 0) + (i.unit_price || 0) * (i.quantity || 0)
      })

      const payMap: Record<string, number> = { cash: 0, card: 0, transfer: 0, credit: 0 }
      paid.forEach((o) => {
        const m = o.payment_method as string
        if (payMap[m] !== undefined) payMap[m] += (o.total_amount as number) || 0
      })

      const staffMap: Record<string, StaffStat> = {}
      paid.forEach((o) => {
        const prof = o.profiles as { full_name?: string } | null
        const name = prof?.full_name || 'Unknown'
        if (!staffMap[name]) staffMap[name] = { name, orders: 0, revenue: 0 }
        staffMap[name].orders++
        staffMap[name].revenue += (o.total_amount as number) || 0
      })

      const zoneMap: Record<string, number> = {}
      paid.forEach((o) => {
        const tbl = o.tables as { table_categories?: { name?: string } | null } | null
        const zone = tbl?.table_categories?.name || 'Unknown'
        zoneMap[zone] = (zoneMap[zone] || 0) + ((o.total_amount as number) || 0)
      })

      const dayMap: Record<string, ChartPoint> = {}
      paid.forEach((o) => {
        const day = new Date(o.created_at as string).toLocaleDateString('en-NG', {
          timeZone: 'Africa/Lagos',
          month: 'short',
          day: 'numeric',
        })
        if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
        dayMap[day].revenue += (o.total_amount as number) || 0
        dayMap[day].orders++
      })

      setData({
        kpis: { totalRevenue, totalOrders, avgOrder, cancelRate, debtExposure, repeatRate },
        heatmap,
        hours,
        hourlyChart,
        bestSellers: Object.values(itemMap)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10),
        categorySplit: Object.entries(catMap)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value),
        paymentBreakdown: [
          { name: 'Cash', value: payMap.cash },
          { name: 'POS/Card', value: payMap.card },
          { name: 'Transfer', value: payMap.transfer },
          { name: 'Credit', value: payMap.credit },
        ].filter((p) => p.value > 0),
        staffPerf: Object.values(staffMap)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8),
        revenueByZone: Object.entries(zoneMap)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value),
        revenueTrend: Object.values(dayMap).slice(-14),
      })
    },
    []
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { from, to } = getRangeDates(range, custom)
    if (!from) {
      setLoading(false)
      return
    }
    const { data: orders } = await supabase
      .from('orders')
      .select(
        'id, status, total_amount, payment_method, created_at, closed_at, order_type, customer_phone, table_id, staff_id, profiles(full_name), tables(name, table_categories(name))'
      )
      .gte('created_at', from)
      .lte('created_at', to)
    const orderIds = (orders || []).map((o: { id: string }) => o.id)
    const { data: items } = orderIds.length
      ? await supabase
          .from('order_items')
          .select('id, quantity, unit_price, order_id, menu_items(name, menu_categories(name))')
          .in('order_id', orderIds)
      : { data: [] }
    const { data: staff } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
    const { data: debtors } = await supabase
      .from('debtors')
      .select('current_balance, status')
      .eq('is_active', true)
    const { data: tables } = await supabase
      .from('tables')
      .select('id, category_id, table_categories(name)')
    processData(orders || [], items || [], staff || [], debtors || [], tables || [])
    setLoading(false)
  }, [range, custom, processData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getAIInsights = async () => {
    if (!data) return
    setAiLoading(true)
    setAiInsight('')
    setAiError(false)
    setAiErrorMsg('')
    try {
      const d = data
      // SECURITY: send only a data prompt — model/system/tokens are set server-side
      const prompt = `Period: ${range}
Revenue: ${fmt(d.kpis.totalRevenue)} | Orders: ${d.kpis.totalOrders} | Avg Order: ${fmt(d.kpis.avgOrder)}
Cancel Rate: ${d.kpis.cancelRate}% | Repeat Customers: ${d.kpis.repeatRate}% | Debt Exposure: ${fmt(d.kpis.debtExposure)}
Top Items: ${d.bestSellers
        .slice(0, 5)
        .map((i) => i.name + ' ' + fmt(i.revenue))
        .join(', ')}
Top Zones: ${d.revenueByZone
        .slice(0, 3)
        .map((z) => z.name + ' ' + fmt(z.value))
        .join(', ')}
Payment Mix: ${d.paymentBreakdown.map((p) => p.name + ' ' + fmt(p.value)).join(', ')}
Categories: ${d.categorySplit
        .slice(0, 3)
        .map((c) => c.name + ' ' + fmt(c.value))
        .join(', ')}`

      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({ prompt }),
      })
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }
      const result = (await response.json()) as {
        content?: { type: string; text?: string }[]
        error?: string
      }
      if (result.error) throw new Error(result.error)
      setAiInsight(result.content?.find((b) => b.type === 'text')?.text || 'No insights returned.')
    } catch (err) {
      const msg = (err as Error)?.message || String(err)
      console.error('AI insights error:', msg)
      setAiErrorMsg(msg)
      setAiError(true)
    }
    setAiLoading(false)
  }

  const heatColor = (val: number, max: number) => {
    if (!val) return 'bg-gray-800'
    const i = val / max
    if (i < 0.25) return 'bg-amber-900/40'
    if (i < 0.5) return 'bg-amber-700/60'
    if (i < 0.75) return 'bg-amber-500/80'
    return 'bg-amber-400'
  }

  return (
    <div className="min-h-full bg-gray-950 text-white">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold text-lg">Analytics</h1>
            <p className="text-gray-500 text-xs">AI-powered business intelligence</p>
          </div>
        </div>
        <HelpTooltip storageKey="analytics" tips={ANALYTICS_HELP_TIPS} />
        <button onClick={fetchData} className="text-gray-400 hover:text-white">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="px-6 py-4 flex items-center gap-2 flex-wrap">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${range === r.id ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            {r.label}
          </button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={custom.from}
              onChange={(e) => setCustom((p) => ({ ...p, from: e.target.value }))}
              className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500"
            />
            <span className="text-gray-500 text-xs">to</span>
            <input
              type="date"
              value={custom.to}
              onChange={(e) => setCustom((p) => ({ ...p, to: e.target.value }))}
              className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={32} className="animate-spin text-amber-500" />
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No data for selected range
        </div>
      ) : (
        <div className="px-6 pb-12 space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
              icon={TrendingUp}
              label="Revenue"
              value={fmt(data.kpis.totalRevenue)}
              color="amber"
            />
            <StatCard
              icon={ShoppingBag}
              label="Orders"
              value={data.kpis.totalOrders}
              color="green"
            />
            <StatCard
              icon={CreditCard}
              label="Avg Order"
              value={fmt(data.kpis.avgOrder)}
              color="blue"
            />
            <StatCard
              icon={AlertTriangle}
              label="Cancel Rate"
              value={`${data.kpis.cancelRate}%`}
              color="red"
              sub="of all orders"
            />
            <StatCard
              icon={Users}
              label="Repeat Customers"
              value={`${data.kpis.repeatRate}%`}
              color="purple"
              sub="identified customers"
            />
            <StatCard
              icon={Zap}
              label="Debt Exposure"
              value={fmt(data.kpis.debtExposure)}
              color="red"
              sub="outstanding credit"
            />
          </div>

          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star size={16} className="text-amber-400" />
                <h2 className="text-white font-semibold">AI Insights</h2>
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                  Powered by Claude
                </span>
              </div>
              <button
                onClick={getAIInsights}
                disabled={aiLoading}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black text-xs font-bold px-4 py-2 rounded-xl transition-colors"
              >
                {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                {aiLoading ? 'Analysing...' : 'Generate Insights'}
              </button>
            </div>
            {aiError && (
              <p className="text-gray-500 text-sm">
                AI insights unavailable{aiErrorMsg ? `: ${aiErrorMsg}` : ''}. All charts below are
                still fully functional.
              </p>
            )}
            {!aiInsight && !aiError && !aiLoading && (
              <p className="text-gray-500 text-sm">
                Click "Generate Insights" for a plain-English analysis of your business performance.
              </p>
            )}
            {aiInsight && (
              <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">
                {aiInsight}
              </div>
            )}
          </div>

          {data.revenueTrend.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-amber-400" /> Revenue Trend
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.revenueTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={(v: number) => '₦' + (v / 1000).toFixed(0) + 'k'}
                  />
                  <Tooltip
                    formatter={(v: number) => ['₦' + v.toLocaleString(), 'Revenue']}
                    contentStyle={{
                      background: '#111827',
                      border: '1px solid #374151',
                      borderRadius: 8,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke={AMBER}
                    strokeWidth={2}
                    dot={{ fill: AMBER, r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {data.hourlyChart && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
                <Zap size={16} className="text-amber-400" /> Busiest Hours
              </h2>
              <p className="text-gray-500 text-xs mb-4">Orders and revenue by hour of day</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.hourlyChart}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} interval={1} />
                  <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 10 }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111827',
                      border: '1px solid #374151',
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: '#f9fafb', fontSize: 12 }}
                    formatter={(value: number, name: string) => [
                      name === 'revenue' ? `₦${value.toLocaleString()}` : value,
                      name === 'revenue' ? 'Revenue' : 'Orders',
                    ]}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="orders"
                    fill="#f59e0b"
                    radius={[3, 3, 0, 0]}
                    name="orders"
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="revenue"
                    fill="#10b981"
                    radius={[3, 3, 0, 0]}
                    name="revenue"
                    opacity={0.7}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-amber-500 inline-block" /> Orders
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-green-500 inline-block" /> Revenue
                </span>
              </div>
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Clock size={16} className="text-amber-400" /> Peak Hours Heatmap
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-gray-500 text-left pr-3 pb-2 w-10">Day</th>
                    {data.hours.map((h) => (
                      <th key={h} className="text-gray-500 pb-2 text-center px-0.5 min-w-[28px]">
                        {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.heatmap.map((row) => {
                    const max = Math.max(...data.hours.map((h) => row[h] || 0), 1)
                    return (
                      <tr key={row.day}>
                        <td className="text-gray-400 pr-3 py-1 font-medium">{row.day}</td>
                        {data.hours.map((h) => (
                          <td key={h} className="py-1 px-0.5">
                            <div
                              title={`${row[h] || 0} orders`}
                              className={`h-6 w-full rounded ${heatColor(row[h] || 0, max)}`}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                <span>Low</span>
                {[
                  'bg-gray-800',
                  'bg-amber-900/40',
                  'bg-amber-700/60',
                  'bg-amber-500/80',
                  'bg-amber-400',
                ].map((c) => (
                  <div key={c} className={`w-4 h-3 rounded ${c}`} />
                ))}
                <span>High</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Star size={16} className="text-amber-400" /> Best Sellers
              </h2>
              {data.bestSellers.length === 0 ? (
                <p className="text-gray-500 text-sm">No data</p>
              ) : (
                <div className="space-y-3">
                  {data.bestSellers.slice(0, 8).map((item, i) => (
                    <div key={item.name + item.revenue} className="flex items-center gap-3">
                      <span className="text-gray-600 text-xs w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between mb-1">
                          <span className="text-white text-xs truncate">{item.name}</span>
                          <span className="text-amber-400 text-xs ml-2 flex-shrink-0">
                            {fmt(item.revenue)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-800 rounded-full">
                          <div
                            className="h-1.5 bg-amber-500 rounded-full"
                            style={{
                              width: `${(item.revenue / data.bestSellers[0].revenue) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-gray-500 text-xs w-10 text-right">{item.qty}x</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <ShoppingBag size={16} className="text-amber-400" /> Sales by Category
              </h2>
              {data.categorySplit.length === 0 ? (
                <p className="text-gray-500 text-sm">No data</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie
                        data={data.categorySplit}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        strokeWidth={0}
                      >
                        {data.categorySplit.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: '#111827',
                          border: '1px solid #374151',
                          borderRadius: 8,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {data.categorySplit.map((cat, i) => (
                      <div key={cat.name + cat.value} className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-gray-300 text-xs flex-1 truncate">{cat.name}</span>
                        <span className="text-white text-xs font-medium">{fmt(cat.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <MapPin size={16} className="text-amber-400" /> Revenue by Zone
              </h2>
              {data.revenueByZone.length === 0 ? (
                <p className="text-gray-500 text-sm">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.revenueByZone} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={(v: number) => '₦' + (v / 1000).toFixed(0) + 'k'}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                      width={80}
                    />
                    <Tooltip
                      formatter={(v: number) => fmt(v)}
                      contentStyle={{
                        background: '#111827',
                        border: '1px solid #374151',
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="value" fill={AMBER} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <CreditCard size={16} className="text-amber-400" /> Payment Methods
              </h2>
              {data.paymentBreakdown.length === 0 ? (
                <p className="text-gray-500 text-sm">No data</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie
                        data={data.paymentBreakdown}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        strokeWidth={0}
                      >
                        {data.paymentBreakdown.map((_, i) => (
                          <Cell key={i} fill={[GREEN, BLUE, PURPLE, RED][i % 4]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: '#111827',
                          border: '1px solid #374151',
                          borderRadius: 8,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-3">
                    {data.paymentBreakdown.map((p, i) => {
                      const total = data.paymentBreakdown.reduce((s, x) => s + x.value, 0)
                      const pct = total ? ((p.value / total) * 100).toFixed(1) : 0
                      return (
                        <div key={p.name + p.value}>
                          <div className="flex justify-between mb-1">
                            <span className="text-gray-300 text-xs">{p.name}</span>
                            <span className="text-white text-xs font-medium">{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-800 rounded-full">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${pct}%`,
                                background: [GREEN, BLUE, PURPLE, RED][i % 4],
                              }}
                            />
                          </div>
                          <p className="text-gray-500 text-xs mt-0.5">{fmt(p.value)}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Users size={16} className="text-amber-400" /> Staff Performance
            </h2>
            {data.staffPerf.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No staff data available. This updates once orders are linked to staff accounts.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase tracking-wide pb-3">
                        Staff
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase tracking-wide pb-3">
                        Orders
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase tracking-wide pb-3">
                        Revenue
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase tracking-wide pb-3">
                        Avg/Order
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staffPerf.map((s, i) => (
                      <tr key={s.name + i} className="border-b border-gray-800/50">
                        <td className="py-3 flex items-center gap-2">
                          <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  '}</span>
                          <span className="text-white">{s.name}</span>
                        </td>
                        <td className="py-3 text-right text-gray-300">{s.orders}</td>
                        <td className="py-3 text-right text-amber-400 font-medium">
                          {fmt(s.revenue)}
                        </td>
                        <td className="py-3 text-right text-gray-400">
                          {s.orders ? fmt(Math.round(s.revenue / s.orders)) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
