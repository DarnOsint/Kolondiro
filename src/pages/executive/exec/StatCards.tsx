import { useNavigate } from 'react-router-dom'
import { TrendingUp, ShoppingBag, LayoutDashboard, BedDouble, Users, Package } from 'lucide-react'
import type { Stats } from './types'

interface Props {
  stats: Stats
  onLowStockClick?: () => void
}

export default function StatCards({ stats, onLowStockClick }: Props) {
  const navigate = useNavigate()
  const cards = [
    {
      label: "Today's Revenue",
      value: `₦${stats.revenue.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
      icon: TrendingUp,
      color: 'text-green-400',
      bg: 'bg-green-400/10',
      onClick: () => navigate('/accounting'),
    },
    {
      label: 'Open Orders',
      value: stats.openOrders.toString(),
      icon: ShoppingBag,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
      onClick: () => navigate('/management?tab=orders'),
    },
    {
      label: 'Occupied Tables',
      value: `${stats.occupiedTables}/${stats.totalTables}`,
      icon: LayoutDashboard,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
      onClick: () => navigate('/management?tab=orders'),
    },
    {
      label: 'Occupied Rooms',
      value: `${stats.occupiedRooms}/${stats.totalRooms}`,
      icon: BedDouble,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
      onClick: () => navigate('/rooms'),
    },
    {
      label: 'Staff On Duty',
      value: stats.staffOnDuty.toString(),
      icon: Users,
      color: 'text-pink-400',
      bg: 'bg-pink-400/10',
      onClick: () => navigate('/management?tab=shifts'),
    },
    {
      label: 'Low Stock Items',
      value: stats.lowStock.toString(),
      icon: Package,
      color: stats.lowStock > 0 ? 'text-red-400' : 'text-gray-400',
      bg: stats.lowStock > 0 ? 'bg-red-400/10' : 'bg-gray-400/10',
      onClick: stats.lowStock > 0 && onLowStockClick ? onLowStockClick : undefined,
    },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
      {cards.map((c) => (
        <button
          key={c.label}
          onClick={c.onClick}
          disabled={!c.onClick}
          className={`bg-gray-900 rounded-2xl p-4 md:p-5 border text-left transition-colors ${c.onClick ? 'cursor-pointer hover:bg-gray-800/80' : ''} ${c.label === 'Low Stock Items' && stats.lowStock > 0 ? 'border-red-500/30 hover:border-red-500/60' : 'border-gray-800'}`}
        >
          <div className={`inline-flex p-2 rounded-lg ${c.bg} mb-3`}>
            <c.icon size={18} className={c.color} />
          </div>
          <p className="text-gray-400 text-xs md:text-sm">{c.label}</p>
          <p className="text-white text-xl md:text-2xl font-bold mt-1">{c.value}</p>
        </button>
      ))}
    </div>
  )
}
