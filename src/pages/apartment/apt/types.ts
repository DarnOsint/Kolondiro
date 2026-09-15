export interface Room {
  id: string
  room_number: number
  room_type: string
  rate_per_night: number
  status: 'available' | 'occupied' | 'maintenance' | 'reserved'
}

export interface RoomStay {
  id: string
  room_id: string
  guest_name: string
  guest_phone: string | null
  guest_email: string | null
  guest_id_number: string | null
  check_in_date: string
  check_out_date: string
  adults: number
  children: number
  total_amount: number
  amount_paid: number
  payment_method: string
  notes: string | null
  status: 'active' | 'checked_out' | 'reserved'
  created_at: string
  rooms?: { room_number: number; room_type: string; rate_per_night: number } | null
}

export interface ServiceOrder {
  id: string
  room_id: string
  status: 'pending' | 'delivered' | 'cancelled'
  total_amount: number
  notes: string | null
  created_at: string
  rooms?: { room_number: number } | null
}

export interface StaffMember {
  id: string
  full_name: string
  role: string
  phone: string | null
  hire_date: string | null
}

export interface CheckInForm {
  guest_name: string
  guest_phone: string
  guest_email: string
  guest_id_number: string
  check_in_date: string
  check_out_date: string
  adults: number
  children: number
  payment_method: string
  amount_paid: string
  notes: string
}

export interface PayForm {
  amount: string
  method: string
  reference: string
}

export const STATUS_CONFIG = {
  available: {
    bg: 'bg-green-500/15',
    border: 'border-green-500/30',
    text: 'text-green-400',
    dot: 'bg-green-400',
  },
  occupied: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  maintenance: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
  reserved: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
} as const

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Bank POS' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit Account' },
] as const

export const fmt = (n: number | null | undefined) =>
  '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })
export const fmtShort = (n: number | null | undefined) =>
  '₦' + Number(n || 0).toLocaleString('en-NG')
export const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'
export const todayStr = () => new Date().toISOString().split('T')[0]
