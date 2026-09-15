// ─── Core domain types ────────────────────────────────────────────────────

export type Role =
  | 'owner'
  | 'executive'
  | 'manager'
  | 'accountant'
  | 'auditor'
  | 'waitron'
  | 'kitchen'
  | 'bar'
  | 'griller'
  | 'mixologist'
  | 'games_master'
  | 'shisha_attendant'
  | 'supervisor'
  | 'apartment_manager'
  | 'floor_staff'
  | 'social_media_manager'
  | 'dj'
  | 'hypeman'

export type OrderStatus = 'open' | 'paid' | 'voided' | 'pending'
export type OrderType = 'table' | 'cash_sale' | 'takeaway'
export type PaymentMethod =
  | 'cash'
  | 'bank_pos'
  | 'bank_transfer'
  | 'credit'
  | 'card'
  | 'transfer'
  | 'split'
export type ItemDestination = 'kitchen' | 'bar' | 'griller' | 'shisha' | 'games' | 'mixologist'
export type ItemStatus = 'pending' | 'preparing' | 'ready' | 'delivered'
export type TableStatus = 'available' | 'occupied' | 'reserved'
export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance'

// ─── Database row types ────────────────────────────────────────────────────

export interface Profile {
  id: string
  full_name: string
  role: Role
  email?: string
  phone?: string
  pin?: string
  is_active: boolean
  created_at: string
}

export interface TableCategory {
  id: string
  name: string
  hire_fee?: number | null
}

export interface Table {
  id: string
  name: string
  status: TableStatus
  category_id: string
  assigned_staff?: string | null
  capacity?: number
  table_categories?: TableCategory
}

export interface MenuCategory {
  id: string
  name: string
  destination: ItemDestination
}

export interface MenuItem {
  id: string
  name: string
  price: number
  rave_price?: number | null
  is_available: boolean
  category_id: string
  menu_categories?: MenuCategory
  current_stock?: number | null
  hasZonePrice?: boolean
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string
  quantity: number
  unit_price: number
  total_price: number
  status?: ItemStatus
  destination?: ItemDestination
  modifier_notes?: string | null
  extra_charge?: number
  created_at: string
  menu_items?:
    | (Pick<MenuItem, 'name' | 'price'> & { menu_categories?: MenuCategory })
    | { name: string; price?: number; menu_categories?: MenuCategory }
    | null
}

export interface Order {
  id: string
  table_id?: string | null
  staff_id?: string | null
  order_type: OrderType
  status: OrderStatus
  total_amount: number
  notes?: string | null
  covers?: number | null
  payment_method?: PaymentMethod | null
  customer_name?: string | null
  customer_phone?: string | null
  created_at: string
  closed_at?: string | null
  updated_at?: string | null
  tables?:
    | Pick<Table, 'id' | 'name'>
    | { name: string; table_categories?: { name: string } | null }
    | null
  order_items?: OrderItem[]
}

export interface TillSession {
  id: string
  staff_id: string
  opening_float: number
  closing_float?: number | null
  total_sales: number
  total_payouts: number
  expected_cash: number
  shortfall?: number
  surplus?: number
  opened_at: string
  closed_at?: string | null
  status: 'open' | 'closed'
  notes?: string | null
}

export interface Payout {
  id: string
  till_session_id: string
  amount: number
  reason: string
  category: string
  staff_id: string
  created_at: string
}

export interface InventoryItem {
  id: string
  item_name: string
  category: string
  unit: string
  current_stock: number
  minimum_stock: number
  cost_price?: number
  selling_price?: number
  menu_item_id?: string | null
  is_active: boolean
}

export interface Room {
  id: string
  name: string
  room_type: string
  floor: number
  capacity?: number
  rate_per_night: number
  status: RoomStatus
  amenities?: string
  notes?: string
}

export interface RoomStay {
  id: string
  room_id: string
  guest_name: string
  guest_phone: string
  guest_email?: string
  id_type: string
  id_number: string
  num_guests: number
  check_in_at: string
  check_out_at: string
  nights: number
  payment_method: string
  payment_reference?: string
  total_amount: number
  status: 'active' | 'checked_out' | 'overstay'
  notes?: string
}

export interface AuditEntry {
  id: string
  action: string
  entity: string
  entity_id?: string
  entity_name?: string
  old_value?: unknown
  new_value?: unknown
  performed_by?: string
  performed_by_name?: string
  performed_by_role?: Role
  created_at: string
}

export interface Setting {
  id: string
  value: string
  updated_at: string
}

// ─── CV / CCTV types ────────────────────────────────────────────────────────

export interface CvAlert {
  id: string
  camera_id: string
  alert_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description?: string
  resolved: boolean
  created_at: string
}

export interface CvPeopleCount {
  id: string
  occupancy: number
  created_at: string
}

export interface CvZoneHeatmap {
  id: string
  zone_label: string
  person_count: number
  avg_dwell_seconds: number
  created_at: string
}

export interface CvTillEvent {
  id: string
  alert_type: string
  created_at: string
}

export interface CvShelfEvent {
  id: string
  alert_level: 'normal' | 'low' | 'critical'
  created_at: string
}

// ─── Hook return types ────────────────────────────────────────────────────

export interface GeofenceResult {
  status: 'checking' | 'inside' | 'outside' | 'error' | 'unsupported'
  distance: number | null
  location: { lat: number; lng: number } | null
}

export interface SyncStatus {
  status: 'online' | 'offline' | 'syncing' | 'partial'
  pending: number
}

// ─── Audit helper params ──────────────────────────────────────────────────

export interface AuditParams {
  action: string
  entity: string
  entityId?: string
  entityName?: string
  oldValue?: unknown
  newValue?: unknown
  performer?: Pick<Profile, 'id' | 'full_name' | 'role'> | null
}
