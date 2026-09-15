import type { Order } from '../../types'
import { getNetOrderAmount, getValidOrderItemCount } from './orderAmounts'

interface OrderFilter {
  status: string
  type: string
}
interface Props {
  orders: Order[]
  orderFilter: OrderFilter
  onFilterChange: (f: OrderFilter) => void
}

const paymentColor: Record<string, string> = {
  cash: 'bg-emerald-500/20 text-emerald-400',
  card: 'bg-blue-500/20 text-blue-400',
  transfer: 'bg-purple-500/20 text-purple-400',
}
const statusColor: Record<string, string> = {
  paid: 'bg-green-500/20 text-green-400',
  open: 'bg-amber-500/20 text-amber-400',
}

export default function OrdersTab({ orders, orderFilter, onFilterChange }: Props) {
  const filtered = orders.filter((o) => {
    const matchStatus = orderFilter.status === 'all' || o.status === orderFilter.status
    const matchType = orderFilter.type === 'all' || o.order_type === orderFilter.type
    return matchStatus && matchType
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <select
          value={orderFilter.status}
          onChange={(e) => onFilterChange({ ...orderFilter, status: e.target.value })}
          className="bg-gray-900 border border-gray-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
        >
          <option value="all">All Status</option>
          <option value="paid">Paid</option>
          <option value="open">Open</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={orderFilter.type}
          onChange={(e) => onFilterChange({ ...orderFilter, type: e.target.value })}
          className="bg-gray-900 border border-gray-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
        >
          <option value="all">All Types</option>
          <option value="table">Table</option>
          <option value="cash_sale">Cash Sale</option>
          <option value="takeaway">Takeaway</option>
        </select>
        <span className="text-gray-500 text-sm self-center">{filtered.length} orders</span>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                {['Ref', 'Time', 'Table/Type', 'Staff', 'Items', 'Payment', 'Status', 'Total'].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left text-gray-500 text-xs uppercase tracking-wide px-4 py-3 font-medium whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-600">
                    No orders found
                  </td>
                </tr>
              ) : (
                filtered.map((order, i) => (
                  <tr
                    key={order.id}
                    className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}
                  >
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                      {order.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(order.created_at).toLocaleTimeString('en-NG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-white text-sm whitespace-nowrap">
                      {order.tables?.name || order.order_type}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">
                      {(order as Order & { profiles?: { full_name: string } }).profiles
                        ?.full_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {getValidOrderItemCount(order)} items
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-lg capitalize ${order.payment_method ? (paymentColor[order.payment_method] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'}`}
                      >
                        {order.payment_method || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-lg capitalize ${statusColor[order.status] ?? 'bg-red-500/20 text-red-400'}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-amber-400 font-bold text-sm whitespace-nowrap">
                      ₦{getNetOrderAmount(order).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
