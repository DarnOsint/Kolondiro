type OrderItemWithReturns = {
  id?: string
  quantity?: number
  total_price?: number
  extra_charge?: number
  status?: string
  destination?: string
  modifier_notes?: string
  menu_items?: {
    name?: string
    menu_categories?: {
      name?: string
      destination?: string
    } | null
  } | null
  return_requested?: boolean
  return_accepted?: boolean
}

type OrderLike = {
  order_items?: Array<OrderItemWithReturns | undefined> | undefined
}

export function getValidOrderItems(order: OrderLike) {
  return (order.order_items || []).filter((item) => {
    const orderItem = item as OrderItemWithReturns | undefined
    if (!orderItem) return false
    return (
      !orderItem.return_requested &&
      !orderItem.return_accepted &&
      (orderItem.status || '').toLowerCase() !== 'cancelled'
    )
  })
}

export function getNetOrderAmount(order: OrderLike) {
  return getValidOrderItems(order).reduce(
    (sum, item) => sum + (item.total_price || 0) + (item.extra_charge || 0),
    0
  )
}

export function getValidOrderItemCount(order: OrderLike) {
  return getValidOrderItems(order).reduce((sum, item) => sum + (item.quantity || 0), 0)
}
