import { useState, useEffect } from 'react'
import {
  ShoppingBag,
  LayoutDashboard,
  BedDouble,
  Users,
  TrendingUp,
  Clock,
  DollarSign,
  Settings,
  BookOpen,
  ChevronRight,
  RefreshCw,
  UtensilsCrossed,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import UnassignedCustomerOrders from '../../../components/UnassignedCustomerOrders'

interface Stats {
  openOrders: number
  occupiedTables: number
  occupiedRooms: number
  staffOnShift: number
  todayRevenue: number
}

interface Props {
  stats: Stats
  pendingCount: number
  onTabChange: (tab: string) => void
}

export default function OverviewTab({ stats, pendingCount, onTabChange }: Props) {
  const navigate = useNavigate()
  const [totalTables, setTotalTables] = useState(0)
  const [totalRooms, setTotalRooms] = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('tables').select('id', { count: 'exact', head: true }),
      supabase.from('rooms').select('id', { count: 'exact', head: true }),
    ]).then(([t, r]) => {
      setTotalTables(t.count || 0)
      setTotalRooms(r.count || 0)
    })
  }, [])

  const kpis = [
    {
      label: 'Open Orders',
      value: stats.openOrders,
      icon: ShoppingBag,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
      onClick: () => onTabChange('orders'),
    },
    {
      label: 'Occupied Tables',
      value: `${stats.occupiedTables}/${totalTables || '—'}`,
      icon: LayoutDashboard,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
      onClick: () => onTabChange('orders'),
    },
    {
      label: 'Occupied Rooms',
      value: `${stats.occupiedRooms}/${totalRooms || '—'}`,
      icon: BedDouble,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
      onClick: () => navigate('/rooms'),
    },
    {
      label: 'Staff On Shift',
      value: stats.staffOnShift,
      icon: Users,
      color: 'text-green-400',
      bg: 'bg-green-400/10',
      onClick: () => onTabChange('shifts'),
    },
    {
      label: 'Revenue Today',
      value: `₦${stats.todayRevenue.toLocaleString()}`,
      icon: TrendingUp,
      color: 'text-pink-400',
      bg: 'bg-pink-400/10',
      onClick: () => navigate('/accounting'),
    },
  ]

  const actions = [
    {
      label: 'Manage Staff Shifts',
      sub: 'Clock in/out staff members',
      action: () => onTabChange('shifts'),
      icon: Clock,
    },
    {
      label: 'Assign Tables',
      sub: 'Assign tables to waitrons',
      action: () => onTabChange('tables'),
      icon: Users,
    },
    {
      label: 'View Open Orders',
      sub: 'Monitor active orders',
      action: () => onTabChange('orders'),
      icon: ShoppingBag,
    },
    {
      label: 'Till Management',
      sub: 'Cash control and payouts',
      action: () => onTabChange('till'),
      icon: DollarSign,
    },
    {
      label: 'Kitchen Stock',
      sub: 'Reconcile food input, yield & benchmarks',
      action: () => onTabChange('kitchen'),
      icon: UtensilsCrossed,
    },
    {
      label: 'Room Management',
      sub: 'Check-in, check-out and room status',
      action: () => navigate('/rooms'),
      icon: BedDouble,
    },
    {
      label: 'Accounting',
      sub: 'Sales reports, trends and expenses',
      action: () => navigate('/accounting'),
      icon: BookOpen,
    },
    {
      label: 'Back Office',
      sub: 'Menu, staff and table config',
      action: () => navigate('/backoffice'),
      icon: Settings,
    },
  ]

  return (
    <div className="space-y-4">
      <UnassignedCustomerOrders />
      {pendingCount > 0 && (
        <button
          onClick={() => onTabChange('sync')}
          className="w-full flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <RefreshCw size={15} className="text-amber-400 animate-spin" />
            <p className="text-amber-400 text-sm font-medium">
              {pendingCount} offline change{pendingCount > 1 ? 's' : ''} pending sync
            </p>
          </div>
          <span className="text-amber-400/60 text-xs">View →</span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-4">
        {kpis.map((k) => (
          <button
            key={k.label}
            onClick={k.onClick}
            className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-left hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <div className={`inline-flex p-2 rounded-lg ${k.bg} mb-2`}>
              <k.icon size={18} className={k.color} />
            </div>
            <p className="text-gray-400 text-xs">{k.label}</p>
            <p className="text-white text-xl font-bold mt-0.5">{k.value}</p>
          </button>
        ))}
      </div>
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <h3 className="text-white font-semibold mb-3">Quick Actions</h3>
        <div className="space-y-2">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.action}
              className="w-full flex items-center justify-between bg-gray-800 hover:bg-gray-700 rounded-xl p-3 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center">
                  <a.icon size={16} className="text-amber-400" />
                </div>
                <div className="text-left">
                  <p className="text-white text-sm font-medium">{a.label}</p>
                  <p className="text-gray-400 text-xs">{a.sub}</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
