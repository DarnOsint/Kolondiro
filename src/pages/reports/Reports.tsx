import { useState, useRef } from 'react'
import { createPDF, addTable, savePDF } from '../../lib/pdfExport'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useAuth } from '../../context/AuthContext'
import {
  Beer as _Beer,
  LogOut as _LogOut,
  ArrowLeft as _ArrowLeft,
  Download as _Download,
  FileText,
  TrendingUp,
  ShoppingBag,
  Users,
  Banknote,
  CreditCard,
  BarChart2,
  AlertTriangle,
  RefreshCw,
  Printer,
  Download,
} from 'lucide-react'
import { useToast } from '../../context/ToastContext'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import * as XLSX from 'xlsx'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const COLORS = [
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#f97316',
  '#84cc16',
]

interface ChartPoint {
  label: string
  revenue: number
  orders: number
}
interface CategoryStat {
  name: string
  revenue: number
  quantity: number
}
interface ItemStat {
  name: string
  quantity: number
  revenue: number
  returned: number
}
interface StaffStat {
  name: string
  orders: number
  revenue: number
}
interface TableStat {
  table: string
  orders: number
  revenue: number
}
interface Payout {
  id: string
  created_at: string
  reason?: string
  category?: string
  amount?: number
}
interface TillSession {
  opened_at: string
  status?: string
  opening_float?: number
  closing_float?: number
}
interface VoidEntry {
  total_value?: number
}
interface AttendanceEntry {
  staff_name?: string
  role?: string
  duration_minutes?: number
  pos_machine?: string | null
}
interface PaidOrder {
  id: string
  total_amount?: number
  payment_method?: string
  order_type?: string
  created_at: string
  covers?: number | null
  profiles?: { full_name?: string } | null
  tables?: { name?: string; table_categories?: { name?: string } | null } | null
}

interface Report {
  period: string
  reportType: string
  generatedAt: string
  grossRevenue: number
  netRevenue: number
  totalExpenses: number
  totalRevenue: number
  totalOrders: number
  totalCovers: number
  revenuePerCover: number
  paidOrders: PaidOrder[]
  paidOrdersCount: number
  cancelledOrders: number
  returnedItems: number
  returnedValue: number
  avgOrderValue: number
  byPayment: Record<string, number>
  byCategory: CategoryStat[]
  topItems: ItemStat[]
  staffPerformance: StaffStat[]
  hourlyData: ChartPoint[]
  dailyBreakdown: ChartPoint[]
  tableStats: TableStat[]
  totalDebt: number
  totalDebtCreated: number
  debtorCount: number
  totalOpeningFloat: number
  totalClosingFloat: number
  byOrderType: { table: number; cash_sale: number; takeaway: number }
  payouts: Payout[]
  tillSessions: TillSession[]
  voids: VoidEntry[]
  attendance: AttendanceEntry[]
}

export default function Reports() {
  const { profile } = useAuth()
  const toast = useToast()
  const printRef = useRef<HTMLDivElement>(null)
  const now = new Date()

  const [reportType, setReportType] = useState('daily')
  const [selectedDay, setSelectedDay] = useState(now.getDate())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate()

  // Build 8am–8am window in Africa/Lagos for a given calendar day
  const lagosDayWindow = (y: number, m: number, d: number) => {
    const start = new Date(
      `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T08:00:00+01:00`
    )
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const getDateBounds = () => {
    if (reportType === 'daily' || reportType === 'zreport') {
      // If the selected day is "today" before 8am WAT, show yesterday's session window
      const lagosNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
      const selectedStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
      const todayStr = lagosNow.toISOString().slice(0, 10)
      if (selectedStr === todayStr && lagosNow.getHours() < 8) {
        const d = new Date(lagosNow)
        d.setDate(d.getDate() - 1)
        return lagosDayWindow(d.getFullYear(), d.getMonth(), d.getDate())
      }
      return lagosDayWindow(selectedYear, selectedMonth, selectedDay)
    } else if (reportType === 'month') {
      return {
        start: new Date(selectedYear, selectedMonth, 1).toISOString(),
        end: new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999).toISOString(),
      }
    } else {
      return {
        start: new Date(selectedYear, 0, 1).toISOString(),
        end: new Date(selectedYear, 11, 31, 23, 59, 59, 999).toISOString(),
      }
    }
  }

  const getPeriodLabel = () => {
    if (reportType === 'daily' || reportType === 'zreport')
      return `${selectedDay} ${MONTHS[selectedMonth]} ${selectedYear} · 8:00 AM – 8:00 AM`
    if (reportType === 'month') return `${MONTHS[selectedMonth]} ${selectedYear}`
    return `Year ${selectedYear}`
  }

  const generateReport = async () => {
    if (reportType === 'zreport') {
      const { start, end } = getDateBounds()
      const { data: openShifts } = await supabase
        .from('attendance')
        .select('*, profiles(full_name)')
        .gte('clock_in', start)
        .lte('clock_in', end)
        .or('clock_out.is.null')
      if (openShifts && openShifts.length > 0) {
        const names = openShifts
          .map(
            (s: { profiles?: { full_name?: string } | null }) => s.profiles?.full_name || 'Unknown'
          )
          .join(', ')
        toast.warning(
          'Required',
          'Z-Report blocked. The following staff are still clocked in:\n\n' +
            names +
            '\n\nAll staff must be clocked out before running the Z-Report.'
        )
        return
      }
    }
    setLoading(true)
    try {
      const { start, end } = getDateBounds()
      const [
        ordersRes,
        orderItemsRes,
        payoutsRes,
        tillRes,
        debtorsRes,
        voidsRes,
        attendanceRes,
        returnsRes,
      ] = await Promise.all([
        supabase
          .from('orders')
          .select(
            '*, profiles(full_name), tables(name, table_categories(name)), order_items(total_price, return_requested, return_accepted, status)'
          )
          .gte('created_at', start)
          .lte('created_at', end),
        supabase
          .from('order_items')
          .select(
            '*, menu_items(name, price, menu_categories(name, destination)), orders(created_at, status)'
          )
          .gte('created_at', start)
          .lte('created_at', end),
        supabase.from('payouts').select('*').gte('created_at', start).lte('created_at', end),
        supabase
          .from('till_sessions')
          .select('*, profiles(full_name)')
          .gte('opened_at', start)
          .lte('opened_at', end),
        supabase.from('debtors').select('*').gte('created_at', start).lte('created_at', end),
        supabase.from('void_log').select('*').gte('created_at', start).lte('created_at', end),
        supabase.from('attendance').select('*').gte('clock_in', start).lte('clock_in', end),
        supabase
          .from('returns_log')
          .select('id, item_name, quantity, item_total, status, requested_at')
          .gte('requested_at', start)
          .lte('requested_at', end),
      ])

      const orders = (ordersRes.data || []) as PaidOrder[]
      const paidOrders = orders.filter(
        (o) => (o as unknown as { status: string }).status === 'paid'
      ) as PaidOrder[]
      const cancelledOrders = orders.filter(
        (o) => (o as unknown as { status: string }).status === 'cancelled'
      ).length
      const allItems = (orderItemsRes.data || []) as {
        quantity?: number
        total_price?: number
        unit_price?: number
        status?: string | null
        return_requested?: boolean | null
        return_accepted?: boolean | null
        order_id?: string
        orders?: { created_at?: string; status?: string } | null
        menu_items?: {
          name?: string
          price?: number
          menu_categories?: { name?: string; destination?: string } | null
        } | null
      }[]
      const payouts = (payoutsRes.data || []) as Payout[]
      const tillSessions = (tillRes.data || []) as TillSession[]
      const debtors = (debtorsRes.data || []) as {
        current_balance?: number
        credit_limit?: number
      }[]
      const voids = (voidsRes.data || []) as VoidEntry[]
      const attendance = (attendanceRes.data || []) as AttendanceEntry[]
      const returnsData = (returnsRes.data || []) as Array<{
        id: string
        item_name: string
        quantity: number
        item_total: number
        status: string
        requested_at: string
      }>
      // Accepted returns (bar_accepted or accepted by manager)
      const acceptedReturns = returnsData.filter(
        (r) => r.status !== 'rejected' && r.status !== 'manager_rejected' && r.status !== 'expired'
      )
      const returnedItems = acceptedReturns.reduce((s, r) => s + (r.quantity || 0), 0)
      const returnedValue = acceptedReturns.reduce((s, r) => s + (r.item_total || 0), 0)
      // Build return count per item name for return rate
      const returnCountMap: Record<string, number> = {}
      acceptedReturns.forEach((r) => {
        returnCountMap[r.item_name] = (returnCountMap[r.item_name] || 0) + (r.quantity || 0)
      })

      const filteredItems = allItems.filter((i) => {
        const cancelled = (i.status || '').toLowerCase() === 'cancelled'
        const returned = i.return_requested || i.return_accepted
        return i.orders?.status === 'paid' && !cancelled && !returned
      })

      const perOrderNet: Record<string, number> = {}
      filteredItems.forEach((i) => {
        const id = i.order_id || ''
        if (!id) return
        const rev = i.total_price || (i.unit_price || 0) * (i.quantity || 0)
        perOrderNet[id] = (perOrderNet[id] || 0) + rev
      })

      const grossRevenue = Object.values(perOrderNet).reduce((s, v) => s + v, 0)
      const totalExpenses = payouts.reduce((s, p) => s + (p.amount || 0), 0)
      // Payment aggregation
      const _paymentTotals: Record<string, number> = {}
      // Group payment methods properly (handles transfer:BankName, cash+transfer:X+Y, cash+card:X+Y)
      const byPayment: Record<string, number> = {}
      paidOrders.forEach((o) => {
        const pm = (o.payment_method || '').toLowerCase()
        let key = 'other'
        if (pm === 'cash') key = 'Cash'
        else if (pm === 'card' || pm === 'bank_pos') key = 'Bank POS'
        else if (pm.startsWith('transfer') || pm === 'bank_transfer' || !pm) key = 'Transfer'
        else if (pm === 'credit') key = 'Credit'
        else if (pm === 'split') key = 'Split'
        else if (pm.startsWith('cash+transfer')) key = 'Cash + Transfer'
        else if (pm.startsWith('cash+card')) key = 'Cash + POS'
        else if (pm === 'complimentary') key = 'Complimentary'
        else key = 'Other'
        const net = perOrderNet[o.id] ?? o.total_amount ?? 0
        byPayment[key] = (byPayment[key] || 0) + net
      })
      const _paymentList = Object.entries(byPayment)
        .map(([label, value]) => ({ label, value }))
        .filter((p) => p.value > 0)
        .sort((a, b) => b.value - a.value)

      const categoryMap: Record<string, CategoryStat> = {}
      filteredItems.forEach((item) => {
        const cat = item.menu_items?.menu_categories?.name || 'Unknown'
        if (!categoryMap[cat]) categoryMap[cat] = { name: cat, revenue: 0, quantity: 0 }
        const revenue = item.total_price || (item.unit_price || 0) * (item.quantity || 0)
        categoryMap[cat].revenue += revenue
        categoryMap[cat].quantity += item.quantity || 0
      })

      const itemMap: Record<string, ItemStat> = {}
      filteredItems.forEach((item) => {
        const n = item.menu_items?.name || 'Unknown'
        if (!itemMap[n]) itemMap[n] = { name: n, quantity: 0, revenue: 0, returned: 0 }
        const revenue = item.total_price || (item.unit_price || 0) * (item.quantity || 0)
        itemMap[n].quantity += item.quantity || 0
        itemMap[n].revenue += revenue
      })
      // Merge return counts into item stats
      for (const [name, count] of Object.entries(returnCountMap)) {
        if (itemMap[name]) {
          itemMap[name].returned = count
        } else {
          itemMap[name] = { name, quantity: 0, revenue: 0, returned: count }
        }
      }

      const staffMap: Record<string, StaffStat> = {}
      paidOrders.forEach((o) => {
        const n = o.profiles?.full_name || 'Unknown'
        if (!staffMap[n]) staffMap[n] = { name: n, orders: 0, revenue: 0 }
        staffMap[n].orders++
        staffMap[n].revenue += perOrderNet[o.id] ?? o.total_amount ?? 0
      })

      const hourMap: Record<number, ChartPoint> = {}
      for (let i = 0; i < 24; i++) hourMap[i] = { label: `${i}:00`, orders: 0, revenue: 0 }
      paidOrders.forEach((o) => {
        const h = new Date(o.created_at).getHours()
        hourMap[h].orders++
        hourMap[h].revenue += perOrderNet[o.id] ?? o.total_amount ?? 0
      })

      const dayMap: Record<string, ChartPoint> = {}
      paidOrders.forEach((o) => {
        const d = new Date(o.created_at).toLocaleDateString('en-SS', {
          month: 'short',
          day: 'numeric',
        })
        if (!dayMap[d]) dayMap[d] = { label: d, revenue: 0, orders: 0 }
        dayMap[d].revenue += perOrderNet[o.id] ?? o.total_amount ?? 0
        dayMap[d].orders++
      })

      const tableMap: Record<string, TableStat> = {}
      paidOrders
        .filter((o) => o.tables?.name)
        .forEach((o) => {
          const t = o.tables!.name!
          if (!tableMap[t]) tableMap[t] = { table: t, orders: 0, revenue: 0 }
          tableMap[t].orders++
          tableMap[t].revenue += perOrderNet[o.id] ?? o.total_amount ?? 0
        })

      setReport({
        period: getPeriodLabel(),
        reportType,
        generatedAt: new Date().toLocaleString('en-SS'),
        grossRevenue,
        netRevenue: grossRevenue - totalExpenses,
        totalExpenses,
        totalRevenue: grossRevenue,
        totalOrders: orders.length,
        totalCovers: paidOrders.reduce((s, o) => s + (o.covers || 0), 0),
        revenuePerCover: (() => {
          const c = paidOrders.reduce((s, o) => s + (o.covers || 0), 0)
          return c > 0 ? grossRevenue / c : 0
        })(),
        paidOrders,
        paidOrdersCount: paidOrders.length,
        cancelledOrders,
        returnedItems,
        returnedValue,
        avgOrderValue: paidOrders.length ? Math.round(grossRevenue / paidOrders.length) : 0,
        byPayment,
        byCategory: Object.values(categoryMap).sort((a, b) => b.revenue - a.revenue),
        topItems: Object.values(itemMap).sort((a, b) => b.quantity - a.quantity),
        staffPerformance: Object.values(staffMap).sort((a, b) => b.revenue - a.revenue),
        hourlyData: Object.values(hourMap).filter((h) => h.orders > 0),
        dailyBreakdown: Object.values(dayMap),
        tableStats: Object.values(tableMap).sort((a, b) => b.revenue - a.revenue),
        totalDebt: debtors.reduce((s, d) => s + (d.current_balance || 0), 0),
        totalDebtCreated: debtors.reduce((s, d) => s + (d.credit_limit || 0), 0),
        debtorCount: debtors.length,
        totalOpeningFloat: tillSessions.reduce((s, t) => s + (t.opening_float || 0), 0),
        totalClosingFloat: tillSessions
          .filter((t) => t.status === 'closed')
          .reduce((s, t) => s + (t.closing_float || 0), 0),
        byOrderType: {
          table: paidOrders.filter(
            (o) => (o as unknown as { order_type?: string }).order_type === 'table'
          ).length,
          cash_sale: paidOrders.filter(
            (o) => (o as unknown as { order_type?: string }).order_type === 'cash_sale'
          ).length,
          takeaway: paidOrders.filter(
            (o) => (o as unknown as { order_type?: string }).order_type === 'takeaway'
          ).length,
        },
        payouts,
        tillSessions,
        voids,
        attendance,
      })
    } catch (err) {
      toast.error(
        'Error',
        'Report generation failed: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = () => {
    if (!report) return
    const rows = [
      ['KOLONDIRO - ' + report.period.toUpperCase() + ' REPORT'],
      ['Generated:', report.generatedAt],
      [],
      ['REVENUE SUMMARY'],
      ['Gross Revenue (F&B)', 'SSP' + report.grossRevenue.toLocaleString()],
      ['Total Revenue', 'SSP' + report.totalRevenue.toLocaleString()],
      ['Total Expenses', 'SSP' + report.totalExpenses.toLocaleString()],
      ['Net Revenue', 'SSP' + report.netRevenue.toLocaleString()],
      [],
      ['ORDERS'],
      ['Total Orders', report.totalOrders],
      ['Paid Orders', report.paidOrdersCount],
      ['Cancelled Orders', report.cancelledOrders],
      ['Returned Items', report.returnedItems],
      ['Return Value', 'SSP' + report.returnedValue.toLocaleString()],
      ['Avg Order Value', 'SSP' + report.avgOrderValue.toLocaleString()],
      [],
      ['PAYMENT METHODS'],
      ...Object.entries(report.byPayment)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => [k, 'SSP' + v.toLocaleString()]),
      [],
      ['ITEMS SOLD'],
      ['Item', 'Qty Sold', 'Returned', 'Return Rate', 'Revenue'],
      ...report.topItems.map((i) => {
        const rate = i.quantity > 0 ? Math.round((i.returned / i.quantity) * 100) : 0
        return [
          i.name,
          i.quantity,
          i.returned,
          rate > 0 ? `${rate}%` : '–',
          'SSP' + i.revenue.toLocaleString(),
        ]
      }),
      [],
      ['STAFF PERFORMANCE'],
      ['Staff', 'Orders', 'Revenue'],
      ...report.staffPerformance.map((s) => [s.name, s.orders, 'SSP' + s.revenue.toLocaleString()]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'kolondiro-' + report.period.toLowerCase().replace(/ /g, '-') + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const _exportXLSX = () => {
    if (!report) return
    const sheets: Record<string, any[][]> = {
      Summary: [
        ['KOLONDIRO', report.period],
        ['Generated', report.generatedAt],
        [],
        ['Metric', 'Value'],
        ['Gross Revenue (F&B)', report.grossRevenue],
        ['Total Revenue', report.totalRevenue],
        ['Total Expenses', report.totalExpenses],
        ['Net Revenue', report.netRevenue],
        ['Total Orders', report.totalOrders],
        ['Paid Orders', report.paidOrdersCount],
        ['Cancelled Orders', report.cancelledOrders],
        ['Returned Items', report.returnedItems],
        ['Return Value', report.returnedValue],
        ['Avg Order Value', report.avgOrderValue],
      ],
      Payments: [
        ['Method', 'Value'],
        ['Cash', report.byPayment.cash],
        ['Bank POS', report.byPayment.bank_pos],
        ['Bank Transfer', report.byPayment.transfer],
        ['Credit', report.byPayment.credit],
        ['Split', report.byPayment.split],
      ],
      Items: [['Item', 'Qty', 'Revenue', 'Returned']],
      Staff: [['Staff', 'Orders', 'Revenue']],
      Tables: [['Table', 'Orders', 'Revenue']],
    }

    ;(report.topItems || []).forEach((i) =>
      sheets.Items.push([i.name, i.quantity, i.revenue, i.returned])
    )
    ;(report.staffPerformance || []).forEach((s) =>
      sheets.Staff.push([s.name, s.orders, s.revenue])
    )
    ;(report.tableStats || []).forEach((t) => sheets.Tables.push([t.table, t.orders, t.revenue]))

    const wb = XLSX.utils.book_new()
    Object.entries(sheets).forEach(([name, data]) => {
      const ws = XLSX.utils.aoa_to_sheet(data)
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
    })
    const fname = `kolondiro_${report.period.replace(/\s+/g, '_')}.xlsx`
    XLSX.writeFile(wb, fname)
  }

  const exportReportPDF = (r: Report) => {
    const doc = createPDF(
      (r.reportType === 'daily'
        ? 'Daily'
        : r.reportType === 'month'
          ? 'Monthly'
          : r.reportType === 'zreport'
            ? 'Z-Report'
            : 'Annual') + ' Report',
      r.period + ' — Generated by ' + (profile?.full_name || 'Staff')
    )
    let y = 35
    y = addTable(
      doc,
      ['Metric', 'Value'],
      [
        ['Gross Revenue', 'SSP' + r.grossRevenue.toLocaleString()],
        ['Total Expenses', 'SSP' + r.totalExpenses.toLocaleString()],
        ['Net Revenue', 'SSP' + r.netRevenue.toLocaleString()],
        ['Total Orders', String(r.totalOrders)],
        ['Paid Orders', String(r.paidOrdersCount)],
        ['Avg Order Value', 'SSP' + r.avgOrderValue.toLocaleString()],
      ],
      y + 2
    )
    if (r.topItems?.length) {
      y += 6
      addTable(
        doc,
        ['Item', 'Qty', 'Revenue'],
        r.topItems.map((i) => [i.name, String(i.quantity), 'SSP' + i.revenue.toLocaleString()]),
        y + 2
      )
    }
    savePDF(doc, 'report-' + r.period.replace(/ /g, '-') + '.pdf')
  }

  const chartData = report?.reportType === 'daily' ? report?.hourlyData : report?.dailyBreakdown

  return (
    <div className="min-h-full bg-gray-950">
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6 print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold flex items-center gap-2">
              <FileText size={18} className="text-amber-400" /> Generate Report
            </h2>
            <HelpTooltip
              storageKey="reports"
              tips={[
                {
                  id: 'rep-daily',
                  title: 'Daily Report',
                  description:
                    'Full trading summary for any selected day — total and net revenue, cash/POS/transfer breakdown, order count, top-selling items, per-waitron performance (including POS machine assigned), void log, and payout deductions.',
                },
                {
                  id: 'rep-monthly',
                  title: 'Monthly Report',
                  description:
                    'Aggregated figures for a full calendar month — revenue, orders, average order value, payment method split, and top items.',
                },
                {
                  id: 'rep-annual',
                  title: 'Annual Report',
                  description:
                    'Year-level summary — total revenue, order volume, and a month-by-month breakdown.',
                },
                {
                  id: 'rep-zreport',
                  title: 'Z-Report',
                  description:
                    'End-of-day closure report. All staff must be clocked out before it runs. Use this to formally close each trading day.',
                },
                {
                  id: 'rep-attendance',
                  title: 'Attendance in Reports',
                  description:
                    'Each report includes the attendance log for the period — staff name, role, shift duration, and POS machine assigned. Use this to match each waitron to their terminal for reconciliation.',
                },
                {
                  id: 'rep-export',
                  title: 'Exporting to PDF',
                  description:
                    'After generating any report, tap Export PDF to download a formatted printable version. Daily email reports are also sent automatically at 4:30am WAT via the scheduled cron job.',
                },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Report Type</label>
              <div className="flex gap-2">
                {(
                  [
                    ['daily', 'Daily'],
                    ['month', 'Monthly'],
                    ['year', 'Annual'],
                    ['zreport', 'Z-Report'],
                  ] as const
                ).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setReportType(t)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${reportType === t ? 'bg-amber-500 text-black' : 'bg-gray-800 border border-gray-700 text-gray-400'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(reportType === 'daily' || reportType === 'month') && (
              <div>
                <label className="text-gray-400 text-xs block mb-1">Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
                >
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {reportType === 'daily' && (
              <div>
                <label className="text-gray-400 text-xs block mb-1">Day</label>
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
                >
                  {Array.from(
                    { length: getDaysInMonth(selectedMonth, selectedYear) },
                    (_, i) => i + 1
                  ).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-gray-400 text-xs block mb-1">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={generateReport}
              disabled={loading}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold px-6 py-2 rounded-xl text-sm transition-colors"
            >
              {loading ? <RefreshCw size={15} className="animate-spin" /> : <BarChart2 size={15} />}
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
            {report && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-bold px-4 py-2 rounded-xl text-sm border border-gray-700"
              >
                <FileText size={15} /> CSV
              </button>
            )}
          </div>
        </div>

        {!report && !loading && (
          <div className="text-center py-20 text-gray-500">
            <FileText size={48} className="mx-auto mb-4 opacity-20" />
            <p>Select a period and click Generate Report</p>
          </div>
        )}

        {report && (
          <div ref={printRef} className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-white font-bold text-2xl">
                    {report.reportType === 'daily'
                      ? 'Daily'
                      : report.reportType === 'month'
                        ? 'Monthly'
                        : report.reportType === 'zreport'
                          ? 'Z-Report (End of Day)'
                          : 'Annual'}{' '}
                    Report
                  </h1>
                  <p className="text-amber-400 text-lg font-semibold">{report.period}</p>
                  <p className="text-gray-500 text-xs mt-1">Generated: {report.generatedAt}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-3xl">
                    SSP{report.totalRevenue.toLocaleString()}
                  </p>
                  <p className="text-gray-400 text-sm">Total Revenue</p>
                  <button
                    onClick={() => exportReportPDF(report)}
                    className="mt-2 flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl ml-auto"
                  >
                    <Printer size={13} /> Export PDF
                  </button>
                  <button
                    onClick={exportCSV}
                    className="mt-2 flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-100 font-bold px-3 py-1.5 rounded-xl ml-auto border border-gray-700"
                  >
                    <Download size={13} /> Export CSV
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(
                [
                  {
                    label: 'Gross F&B Revenue',
                    value: 'SSP' + report.grossRevenue.toLocaleString(),
                    color: 'text-amber-400',
                    icon: TrendingUp,
                  },
                  {
                    label: 'Total Expenses',
                    value: 'SSP' + report.totalExpenses.toLocaleString(),
                    color: 'text-red-400',
                    icon: Banknote,
                  },
                  {
                    label: 'Net Revenue',
                    value: 'SSP' + report.netRevenue.toLocaleString(),
                    color: 'text-green-400',
                    icon: TrendingUp,
                  },
                  {
                    label: 'Total Orders',
                    value: String(report.totalOrders),
                    color: 'text-white',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Paid Orders',
                    value: String(report.paidOrdersCount),
                    color: 'text-green-400',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Cancelled Orders',
                    value: String(report.cancelledOrders),
                    color: 'text-red-400',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Returned Items',
                    value: `${report.returnedItems} (SSP${report.returnedValue.toLocaleString()})`,
                    color: 'text-orange-400',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Avg Order Value',
                    value: 'SSP' + report.avgOrderValue.toLocaleString(),
                    color: 'text-purple-400',
                    icon: BarChart2,
                  },
                  {
                    label: 'Total Covers',
                    value: report.totalCovers > 0 ? String(report.totalCovers) : '—',
                    color: 'text-amber-400',
                    icon: Users,
                  },
                  {
                    label: 'Revenue / Cover',
                    value:
                      report.revenuePerCover > 0
                        ? 'SSP' + Math.round(report.revenuePerCover).toLocaleString()
                        : '—',
                    color: 'text-amber-400',
                    icon: Users,
                  },
                ] as const
              ).map((m, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <m.icon size={15} className={`mb-2 ${m.color}`} />
                  <p className="text-gray-400 text-xs">{m.label}</p>
                  <p className={`font-bold text-lg ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <CreditCard size={16} className="text-amber-400" /> Payment Methods
                </h3>
                <div className="space-y-3">
                  {Object.entries(report.byPayment)
                    .filter(([, v]) => v > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([label, value], i) => {
                      const colors = [
                        'bg-emerald-500',
                        'bg-blue-500',
                        'bg-purple-500',
                        'bg-amber-500',
                        'bg-cyan-500',
                        'bg-pink-500',
                        'bg-red-500',
                        'bg-indigo-500',
                      ]
                      const item = { label, value, color: colors[i % colors.length] }
                      return item
                    })
                    .map((item) => (
                      <div key={item.label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">{item.label}</span>
                          <span className="text-white font-medium">
                            SSP{item.value.toLocaleString()} (
                            {report.grossRevenue
                              ? Math.round((item.value / report.grossRevenue) * 100)
                              : 0}
                            %)
                          </span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${item.color} rounded-full`}
                            style={{
                              width:
                                (report.grossRevenue
                                  ? (item.value / report.grossRevenue) * 100
                                  : 0) + '%',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <ShoppingBag size={16} className="text-amber-400" /> Order Types
                </h3>
                <div className="space-y-3">
                  {(
                    [
                      {
                        label: 'Table Orders',
                        value: report.byOrderType.table,
                        color: 'bg-amber-500',
                      },
                      {
                        label: 'Cash Sales',
                        value: report.byOrderType.cash_sale,
                        color: 'bg-blue-500',
                      },
                      {
                        label: 'Takeaway',
                        value: report.byOrderType.takeaway,
                        color: 'bg-green-500',
                      },
                    ] as const
                  ).map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">{item.label}</span>
                        <span className="text-white font-medium">{item.value} orders</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full`}
                          style={{
                            width:
                              (report.paidOrdersCount
                                ? (item.value / report.paidOrdersCount) * 100
                                : 0) + '%',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {chartData && chartData.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={16} className="text-amber-400" />
                  {report.reportType === 'daily'
                    ? 'Hourly Revenue Breakdown'
                    : 'Daily Revenue Breakdown'}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={(v: number) => 'SSP' + (v / 1000).toFixed(0) + 'k'}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#111827',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                      }}
                      formatter={(v: number) => ['SSP' + v.toLocaleString(), 'Revenue']}
                    />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {report.byCategory.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold mb-4">Revenue by Category</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={report.byCategory}
                        dataKey="revenue"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={35}
                        paddingAngle={2}
                        label={false}
                      >
                        {report.byCategory.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => ['SSP' + v.toLocaleString(), 'Revenue']}
                        contentStyle={{
                          background: '#111827',
                          border: '1px solid #374151',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        iconType="circle"
                        iconSize={8}
                        formatter={(value: string) => {
                          const cat = report.byCategory.find((c) => c.name === value)
                          const pct =
                            report.grossRevenue > 0
                              ? Math.round(((cat?.revenue || 0) / report.grossRevenue) * 100)
                              : 0
                          return `${value} ${pct}%`
                        }}
                        wrapperStyle={{ fontSize: '11px', color: '#9ca3af', lineHeight: '20px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold mb-3">Category Breakdown</h3>
                  <div className="space-y-2">
                    {report.byCategory.map((cat, i) => (
                      <div
                        key={cat.name}
                        className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ background: COLORS[i % COLORS.length] }}
                          />
                          <span className="text-gray-300 text-sm">{cat.name}</span>
                          <span className="text-gray-600 text-xs">{cat.quantity} sold</span>
                        </div>
                        <span className="text-white font-medium text-sm">
                          SSP{cat.revenue.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {report.topItems.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Items Sold</h3>
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full min-w-[380px]">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">#</th>
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                          Item
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Sold
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Returned
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Rate
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Revenue
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topItems.map((item, i) => {
                        const returnRate =
                          item.quantity > 0 ? Math.round((item.returned / item.quantity) * 100) : 0
                        return (
                          <tr key={item.name} className="border-b border-gray-800 last:border-0">
                            <td className="px-3 py-2.5 text-gray-500 text-sm">{i + 1}</td>
                            <td className="px-3 py-2.5 text-white text-sm font-medium">
                              {item.name}
                            </td>
                            <td className="px-3 py-2.5 text-right text-amber-400 font-bold">
                              {item.quantity}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right text-sm font-medium ${item.returned > 0 ? 'text-red-400' : 'text-gray-600'}`}
                            >
                              {item.returned}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right text-xs ${returnRate >= 20 ? 'text-red-400 font-bold' : returnRate > 0 ? 'text-orange-400' : 'text-gray-600'}`}
                            >
                              {returnRate}%
                            </td>
                            <td className="px-3 py-2.5 text-right text-white text-sm">
                              SSP{item.revenue.toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {report.staffPerformance.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Users size={16} className="text-amber-400" /> Staff Performance
                </h3>
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full min-w-[320px]">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                          Staff
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Ord
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Revenue
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2 hidden sm:table-cell">
                          Avg
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.staffPerformance.map((s, i) => (
                        <tr key={s.name} className="border-b border-gray-800 last:border-0">
                          <td className="px-3 py-2.5 text-white text-sm font-medium max-w-[120px]">
                            <span className="text-amber-400 mr-1 text-xs">#{i + 1}</span>
                            <span className="truncate block">{s.name}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-400 text-sm whitespace-nowrap">
                            {s.orders}
                          </td>
                          <td className="px-3 py-2.5 text-right text-white font-bold text-sm whitespace-nowrap">
                            SSP{s.revenue.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-400 text-sm whitespace-nowrap hidden sm:table-cell">
                            SSP{s.orders ? Math.round(s.revenue / s.orders).toLocaleString() : '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {report.tableStats.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Tables by Revenue</h3>
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full min-w-[260px]">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                          Table
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Ord
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Revenue
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.tableStats.map((t) => (
                        <tr key={t.table} className="border-b border-gray-800 last:border-0">
                          <td className="px-3 py-2.5 text-white text-sm">{t.table}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400 text-sm whitespace-nowrap">
                            {t.orders}
                          </td>
                          <td className="px-3 py-2.5 text-right text-amber-400 font-bold text-sm whitespace-nowrap">
                            SSP{t.revenue.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-400" /> Debtor Summary
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs">New Debts</p>
                    <p className="text-white font-bold text-2xl">{report.debtorCount}</p>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs">Outstanding</p>
                    <p className="text-red-400 font-bold text-xl">
                      SSP{report.totalDebt.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {report.payouts.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Expenses & Payouts</h3>
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full min-w-[300px]">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                          Date
                        </th>
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                          Reason
                        </th>
                        <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                          Category
                        </th>
                        <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.payouts.map((p) => (
                        <tr key={p.id} className="border-b border-gray-800 last:border-0">
                          <td className="px-3 py-2.5 text-gray-500 text-xs">
                            {new Date(p.created_at).toLocaleDateString('en-SS')}
                          </td>
                          <td className="px-3 py-2.5 text-white text-sm">{p.reason}</td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-lg bg-red-500/20 text-red-400 capitalize">
                              {p.category}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-red-400 font-bold text-sm">
                            SSP{p.amount?.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-700">
                        <td colSpan={3} className="px-3 py-2.5 text-white font-bold">
                          Total Expenses
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-400 font-bold">
                          SSP{report.totalExpenses.toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4">Till Reconciliation</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Sessions</p>
                  <p className="text-white font-bold text-2xl">{report.tillSessions.length}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Opening Float</p>
                  <p className="text-blue-400 font-bold text-xl">
                    SSP{report.totalOpeningFloat.toLocaleString()}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Closing Float</p>
                  <p className="text-green-400 font-bold text-xl">
                    SSP{report.totalClosingFloat.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {report.reportType === 'zreport' &&
              (() => {
                const vat = report.grossRevenue * 0.075
                const totalWithVat = report.grossRevenue + vat
                const cashTotal = report.paidOrders
                  .filter((o) => o.payment_method === 'cash')
                  .reduce((s, o) => s + (o.total_amount || 0), 0)
                const creditTotal = report.paidOrders
                  .filter((o) => o.payment_method === 'credit')
                  .reduce((s, o) => s + (o.total_amount || 0), 0)
                return (
                  <div className="bg-white text-black rounded-2xl overflow-hidden border border-gray-200">
                    <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                      <span className="font-bold text-gray-800">Z-Report — End of Day</span>
                      <button
                        onClick={() => {
                          const W = 40
                          const div = '-'.repeat(W)
                          const sol = '='.repeat(W)
                          const row = (l: string, r: string) => {
                            const left = l.substring(0, W - r.length - 1)
                            const sp = W - left.length - r.length
                            return left + ' '.repeat(Math.max(1, sp)) + r
                          }
                          const ctr = (s: string) =>
                            ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
                          const z = [
                            '',
                            ctr("KOLONDIRO"),
                            ctr('Lounge & Restaurant'),
                            ctr('Z-REPORT — END OF DAY'),
                            div,
                            row('Period:', getPeriodLabel()),
                            row('Printed:', new Date().toLocaleString('en-SS')),
                            div,
                            ctr('SALES SUMMARY'),
                            div,
                            row('Total Orders:', String(report.paidOrders.length)),
                            row('Cancelled:', String(report.cancelledOrders)),
                            row(
                              'Returned:',
                              `${report.returnedItems} (N${report.returnedValue.toLocaleString()})`
                            ),
                            row('Gross Revenue:', `N${report.grossRevenue.toLocaleString()}`),
                            row(
                              'VAT (7.5%):',
                              `N${vat.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            ),
                            row(
                              'Total incl. VAT:',
                              `N${totalWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            ),
                            div,
                            ctr('PAYMENT BREAKDOWN'),
                            div,
                            row('Cash:', `N${cashTotal.toLocaleString()}`),
                            row('Bank POS:', `N${report.byPayment.bank_pos.toLocaleString()}`),
                            row('Transfer:', `N${report.byPayment.transfer.toLocaleString()}`),
                            row('Credit:', `N${creditTotal.toLocaleString()}`),
                            row('Split:', `N${report.byPayment.split.toLocaleString()}`),
                            div,
                            ctr('RETURNS & DELETIONS'),
                            div,
                            row('Items Returned/Deleted:', String(report.returnedItems)),
                            row('Value Returned:', `N${report.returnedValue.toLocaleString()}`),
                            div,
                            ctr('CASH RECONCILIATION'),
                            div,
                            row('Expected in Drawer:', `N${cashTotal.toLocaleString()}`),
                            row('Expenses/Payouts:', `N${report.totalExpenses.toLocaleString()}`),
                            sol,
                            row(
                              'NET CASH:',
                              `N${(cashTotal - report.totalExpenses).toLocaleString()}`
                            ),
                            sol,
                            div,
                            ctr('STAFF ON SHIFT'),
                            div,
                            ...((report.attendance || []).length > 0
                              ? (report.attendance || []).map((a) =>
                                  row(
                                    `${a.staff_name} (${a.role})`,
                                    a.duration_minutes
                                      ? `${Math.floor(a.duration_minutes / 60)}h ${a.duration_minutes % 60}m`
                                      : 'Active'
                                  )
                                )
                              : ['  No attendance records']),
                            div,
                            '',
                            '',
                            row('Manager:', '________________'),
                            '',
                            row('Cashier:', '________________'),
                            '',
                            '',
                            ctr('*** END OF Z-REPORT ***'),
                            '',
                          ].join('\n')
                          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Z-Report</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',Courier,monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre;}@media print{body{width:80mm;}@page{margin:0;size:80mm auto;}}</style></head><body>${z}</body></html>`
                          const w = window.open(
                            '',
                            '_blank',
                            'width=500,height=700,toolbar=no,menubar=no,scrollbars=no'
                          )
                          if (!w) return
                          w.document.open('text/html', 'replace')
                          w.document.write(html)
                          w.document.close()
                          w.onafterprint = () => w.close()
                          w.onload = () =>
                            setTimeout(() => {
                              try {
                                w.print()
                              } catch {
                                /* closed */
                              }
                            }, 200)
                        }}
                        className="flex items-center gap-1.5 bg-black text-white text-sm px-4 py-2 rounded-xl"
                      >
                        <Printer size={14} /> Print Z-Report
                      </button>
                    </div>
                    <div
                      id="zreport-content"
                      className="p-6"
                      style={{ fontFamily: 'monospace', fontSize: '13px' }}
                    >
                      <div className="text-center mb-4">
                        <div className="text-xl font-bold tracking-widest">KOLONDIRO</div>
                        <div className="text-sm">Lounge & Restaurant</div>
                        <div className="text-xs text-gray-500 mt-1">Z-REPORT — END OF DAY</div>
                        <div className="text-xs text-gray-500">{getPeriodLabel()}</div>
                        <div className="text-xs text-gray-400">
                          Printed: {new Date().toLocaleString('en-SS')}
                        </div>
                      </div>
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Sales Summary</div>
                      {(
                        [
                          ['Total Orders', report.paidOrders.length],
                          ['Cancelled Orders', report.cancelledOrders],
                          [
                            'Returned Items',
                            `${report.returnedItems} (SSP${report.returnedValue.toLocaleString()})`,
                          ],
                          ['Gross Revenue', 'SSP' + report.grossRevenue.toLocaleString()],
                          [
                            'VAT Collected (7.5%)',
                            'SSP' + vat.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                          ],
                          [
                            'Total incl. VAT',
                            'SSP' +
                              totalWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                          ],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="flex justify-between my-1 text-sm">
                          <span>{label}</span>
                          <span className="font-bold">{value}</span>
                        </div>
                      ))}
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Payment Breakdown</div>
                      {(
                        [
                          ['Cash', 'SSP' + cashTotal.toLocaleString()],
                          ['Bank POS', 'SSP' + report.byPayment.bank_pos.toLocaleString()],
                          ['Bank Transfer', 'SSP' + report.byPayment.transfer.toLocaleString()],
                          ['Credit (Pay Later)', 'SSP' + creditTotal.toLocaleString()],
                          ['Split Payment', 'SSP' + report.byPayment.split.toLocaleString()],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="flex justify-between my-1 text-sm">
                          <span>{label}</span>
                          <span>{value}</span>
                        </div>
                      ))}
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Returns & Voids</div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Items Returned</span>
                        <span>{report.returnedItems}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Return Value</span>
                        <span className="text-orange-600 font-bold">
                          SSP{report.returnedValue.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Total Voids</span>
                        <span>{(report.voids || []).length}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Value Voided</span>
                        <span className="text-red-600 font-bold">
                          SSP
                          {(report.voids || [])
                            .reduce((s: number, v: VoidEntry) => s + (v.total_value || 0), 0)
                            .toLocaleString()}
                        </span>
                      </div>
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Cash Reconciliation</div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Expected in Drawer</span>
                        <span className="font-bold">SSP{cashTotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Expenses/Payouts</span>
                        <span>SSP{report.totalExpenses.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm font-bold border-t border-gray-300 pt-1 mt-1">
                        <span>Net Cash</span>
                        <span>SSP{(cashTotal - report.totalExpenses).toLocaleString()}</span>
                      </div>
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Staff on Shift</div>
                      {(report.attendance || []).length === 0 ? (
                        <div className="text-xs text-gray-500">No attendance records</div>
                      ) : (
                        (report.attendance || []).map((a, i) => (
                          <div key={i} className="flex justify-between my-1 text-xs">
                            <span>
                              {a.staff_name} ({a.role}){a.pos_machine ? ` — ${a.pos_machine}` : ''}
                            </span>
                            <span>
                              {a.duration_minutes
                                ? Math.floor(a.duration_minutes / 60) +
                                  'h ' +
                                  (a.duration_minutes % 60) +
                                  'm'
                                : 'Active'}
                            </span>
                          </div>
                        ))
                      )}
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="mt-6 grid grid-cols-2 gap-8 text-xs text-center">
                        <div>
                          <div className="border-t border-black pt-1 mt-8">Manager Signature</div>
                        </div>
                        <div>
                          <div className="border-t border-black pt-1 mt-8">Cashier Signature</div>
                        </div>
                      </div>
                      <div className="text-center text-xs text-gray-400 mt-4">
                        *** END OF Z-REPORT ***
                      </div>
                    </div>
                  </div>
                )
              })()}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-center">
              <p className="text-gray-500 text-xs">
                Kolondiro · {report.period} Report · Generated {report.generatedAt}
              </p>
              <p className="text-gray-600 text-xs mt-1">Powered by RestaurantOS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
