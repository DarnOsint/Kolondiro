import { useState } from 'react'
import { supabase } from '../lib/supabase'

export interface LateOrder {
  id: string
  order_number?: string
  order_type: string
  customer_name?: string | null
  created_at: string
  tables?: { name: string } | null
  order_items?: Array<{
    id: string
    status: string
    destination: string
    return_accepted?: boolean
  }>
}

export function useLateOrders() {
  // SUSPENDED: late order alerts disabled until further notice
  const [lateOrders] = useState<LateOrder[]>([])
  const [threshold, setThreshold] = useState(15)

  const markDelivered = async (orderId: string): Promise<void> => {
    await supabase
      .from('order_items')
      .update({ status: 'delivered' })
      .eq('order_id', orderId)
      .eq('status', 'pending')
  }

  return { lateOrders, threshold, setThreshold, markDelivered }
}
