import { ShoppingBag } from 'lucide-react'

interface Order {
  id: string
  total_amount: number
  status: string
  order_type: string
  created_at: string
  tables?: { name: string } | null
  profiles?: { full_name: string } | null
}

interface Props {
  orders: Order[]
}

export default function RecentOrders({ orders: rawOrders }: Props) {
  const orders = rawOrders.slice(0, 10)
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm md:text-base">Recent Orders</h3>
        <span className="text-gray-500 text-xs">Last {orders.length}</span>
      </div>
      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-3">
            <ShoppingBag size={24} className="text-gray-600" />
          </div>
          <p className="text-gray-400">No activity yet today</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
            >
              <div className="min-w-0 flex-1 mr-3">
                <p className="text-white text-sm font-medium truncate">
                  {order.tables?.name || order.order_type || 'Unknown'}
                </p>
                <p className="text-gray-500 text-xs truncate">
                  {order.profiles?.full_name} ·{' '}
                  {new Date(order.created_at).toLocaleTimeString('en-NG', {
                    timeZone: 'Africa/Lagos',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-white text-sm font-bold">
                  ₦{order.total_amount?.toLocaleString()}
                </p>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    order.status === 'open'
                      ? 'bg-amber-500/20 text-amber-400'
                      : order.status === 'paid'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {order.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
