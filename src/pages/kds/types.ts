export interface KdsOrderItem {
  id: string
  quantity: number
  status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  destination: string
  created_at?: string
  notes?: string | null
  modifier_notes?: string | null
  return_requested?: boolean
  return_accepted?: boolean
  return_reason?: string | null
  menu_items?: {
    name: string
    menu_categories?: { name: string; destination: string } | null
  } | null
}

export interface KdsOrder {
  id: string
  created_at: string
  notes?: string | null
  staff_id?: string | null
  order_type?: string | null
  customer_name?: string | null
  tables?: { name: string } | null
  profiles?: { full_name: string } | null
  order_items: KdsOrderItem[]
}

// Griller groups items by order into tickets
export interface GrillerTicket {
  orderId: string
  orderType?: string | null
  tableName: string
  staffId?: string | null
  createdAt: string
  items: GrillerItem[]
}

export interface GrillerItem {
  id: string
  quantity: number
  status: 'pending' | 'preparing' | 'ready' | 'delivered'
  notes?: string | null
  order_id: string
  created_at?: string
  menu_items?: { name: string; menu_categories?: { destination: string } | null } | null
  orders?: {
    id: string
    order_type?: string | null
    customer_name?: string | null
    staff_id?: string | null
    tables?: { name: string } | null
  } | null
}
