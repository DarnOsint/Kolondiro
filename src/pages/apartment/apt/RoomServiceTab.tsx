import { supabase } from '../../../lib/supabase'
import { fmt } from './types'
import type { ServiceOrder } from './types'

interface Props {
  serviceOrders: ServiceOrder[]
  onRefresh: () => void
}

export default function RoomServiceTab({ serviceOrders, onRefresh }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
        Room Service Orders
      </p>
      {serviceOrders.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No room service orders yet</div>
      ) : (
        serviceOrders.map((order) => (
          <div key={order.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-white font-semibold">Room {order.rooms?.room_number}</p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      order.status === 'pending'
                        ? 'bg-amber-500/20 text-amber-400'
                        : order.status === 'delivered'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {order.status}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">
                  {new Date(order.created_at).toLocaleString('en-GB')}
                </p>
                {order.notes && (
                  <p className="text-gray-400 text-xs mt-1 italic">"{order.notes}"</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-amber-400 font-bold">{fmt(order.total_amount)}</p>
                {order.status === 'pending' && (
                  <button
                    onClick={async () => {
                      const { error } = await supabase
                        .from('room_service_orders')
                        .update({ status: 'delivered' })
                        .eq('id', order.id)
                      if (error) {
                        console.error(error.message)
                        return
                      }
                      onRefresh()
                    }}
                    className="mt-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs px-3 py-1.5 rounded-xl transition-colors"
                  >
                    Mark Delivered
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
