export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance'

export interface RoomRow {
  id: string
  name: string
  room_type: string | null
  floor: number | null
  capacity: number | null
  rate_per_night: number | null
  amenities: string | null
  notes: string | null
  status: RoomStatus
}

export interface StayRow {
  id: string
  room_id: string
  room_name: string
  guest_name: string
  guest_phone: string
  guest_email: string | null
  id_type: string
  id_number: string
  num_guests: number
  check_in_at: string
  check_out_at: string
  nights: number
  rate_per_night: number
  total_amount: number
  payment_method: string
  payment_reference: string | null
  notes: string | null
  checked_in_by: string | null
  checked_in_by_name: string | null
  status: 'active' | 'checked_out' | 'overstay'
  actual_checkout_at?: string | null
}

export interface CheckinForm {
  guest_name: string
  guest_phone: string
  guest_email: string
  id_type: string
  id_number: string
  num_guests: string
  check_in_at: string
  nights: string
  payment_method: string
  payment_reference: string
  notes: string
}

export interface RoomEditForm {
  name: string
  room_type: string
  floor: string
  capacity: string
  rate_per_night: string
  amenities: string
  notes: string
}

export const ID_TYPES = [
  'NIN',
  'Passport',
  'Drivers License',
  'Voters Card',
  'Staff ID',
  'Other',
] as const
export const ROOM_TYPES = ['standard', 'deluxe', 'suite', 'vip'] as const
export const ROOM_STATUSES: RoomStatus[] = ['available', 'occupied', 'cleaning', 'maintenance']

export const STATUS_CONFIG: Record<RoomStatus, { label: string; color: string; dot: string }> = {
  available: {
    label: 'Available',
    color: 'bg-green-500/20 text-green-400 border-green-500/30',
    dot: 'bg-green-400',
  },
  occupied: {
    label: 'Occupied',
    color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  cleaning: {
    label: 'Cleaning',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  maintenance: {
    label: 'Maintenance',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
    dot: 'bg-red-400',
  },
}

export const BLANK_CHECKIN: CheckinForm = {
  guest_name: '',
  guest_phone: '',
  guest_email: '',
  id_type: 'NIN',
  id_number: '',
  num_guests: '1',
  check_in_at: new Date().toISOString().slice(0, 16),
  nights: '1',
  payment_method: 'cash',
  payment_reference: '',
  notes: '',
}
