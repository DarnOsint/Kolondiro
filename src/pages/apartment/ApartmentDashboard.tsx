import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import {
  LogOut,
  BedDouble,
  ShoppingBag,
  Users,
  TrendingUp,
  Calendar,
  AlertTriangle,
  Clock,
  RefreshCw,
  Loader2,
  BookOpen,
} from 'lucide-react'

import RoomsTab from './apt/RoomsTab'
import CalendarTab from './apt/CalendarTab'
import RoomServiceTab from './apt/RoomServiceTab'
import RevenueTab from './apt/RevenueTab'
import StaffTab from './apt/StaffTab'
import CheckInModal from './apt/CheckInModal'
import CheckOutModal from './apt/CheckOutModal'
import PaymentModal from './apt/PaymentModal'
import DetailsModal from './apt/DetailsModal'

import { fmtShort, todayStr } from './apt/types'
import { HelpTooltip } from '../../components/HelpTooltip'
import type { Room, RoomStay, ServiceOrder, StaffMember, CheckInForm, PayForm } from './apt/types'
import { useToast } from '../../context/ToastContext'

const TABS = [
  { id: 'rooms', label: 'Rooms', icon: BedDouble },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'roomservice', label: 'Room Service', icon: ShoppingBag },
  { id: 'revenue', label: 'Revenue', icon: TrendingUp },
  { id: 'reservations', label: 'Reservations', icon: BookOpen },
  { id: 'staff', label: 'Staff', icon: Users },
] as const

const DEFAULT_FORM: CheckInForm = {
  guest_name: '',
  guest_phone: '',
  guest_email: '',
  guest_id_number: '',
  check_in_date: todayStr(),
  check_out_date: '',
  adults: 1,
  children: 0,
  payment_method: 'cash',
  amount_paid: '',
  notes: '',
}

const APARTMENT_HELP_TIPS = [
  {
    id: 'apt-rooms',
    title: 'Rooms Tab',
    description:
      'All apartment rooms at a glance — status badges (Available, Occupied, Reserved, Maintenance), current guest name, and check-out date. Tap Check In to register a new guest or Check Out to process a departure. Tap a guest card to see full details or record a payment.',
  },
  {
    id: 'apt-reservations',
    title: 'Reservations Tab',
    description:
      'Book a room in advance with a specific check-in date and expected arrival time. The system checks for date conflicts before saving — it will not let you double-book. Reserved rooms appear as blue blocks on the Calendar. Tap Check In on a reservation card when the guest arrives to convert it to an active stay.',
  },
  {
    id: 'apt-calendar',
    title: 'Calendar Tab',
    description:
      '14-day availability view across all rooms. Green = available, amber = occupied (active stay), blue = reserved (future booking). Navigate forward and backward with the arrow buttons. Hover any block to see the guest name.',
  },
  {
    id: 'apt-roomservice',
    title: 'Room Service Tab',
    description:
      'Pending room service orders from guests. Tap Mark Delivered when the order has been brought to the room. Orders automatically appear here when placed by guests through the system.',
  },
  {
    id: 'apt-revenue',
    title: 'Revenue Tab',
    description:
      'Room revenue for the selected period — total from active stays, average nightly rate, occupancy count, and a breakdown by payment method. Also shows room service revenue separately.',
  },
  {
    id: 'apt-checkin',
    title: 'Checking In a Guest',
    description:
      'Tap Check In on any available room. Fill in guest name, ID number, phone, check-in and check-out dates, number of adults and children, payment method, and amount paid. The room is immediately marked Occupied and blocked on the Calendar.',
  },
  {
    id: 'apt-checkout',
    title: 'Checking Out',
    description:
      'Tap Check Out on an occupied room. Confirm the checkout — the room status resets to Available and the stay is archived in the revenue records. If a guest is still outstanding on payment, record it via the Pay button before checking out.',
  },
  {
    id: 'apt-overstay',
    title: 'Overstays',
    description:
      'Rooms where the check-out date has passed but the guest is still marked as active are automatically flagged as Overstay (shown in red). Contact the guest and process check-out or update the dates.',
  },
]

export default function ApartmentDashboard() {
  const { profile, signOut } = useAuth()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('apartment')
  const toast = useToast()

  const [tab, setTab] = useState<string>('rooms')
  const [rooms, setRooms] = useState<Room[]>([])
  const [stays, setStays] = useState<RoomStay[]>([])
  const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)

  const [showCheckIn, setShowCheckIn] = useState<Room | null>(null)
  const [showCheckOut, setShowCheckOut] = useState<RoomStay | null>(null)
  const [showPayment, setShowPayment] = useState<RoomStay | null>(null)
  const [showDetails, setShowDetails] = useState<RoomStay | null>(null)
  const [saving, setSaving] = useState(false)

  const [checkInForm, setCheckInForm] = useState<CheckInForm>(DEFAULT_FORM)
  const [payForm, setPayForm] = useState<PayForm>({ amount: '', method: 'cash', reference: '' })

  // Reservation modal
  const [showReserve, setShowReserve] = useState(false)
  const [reserveForm, setReserveForm] = useState({
    room_id: '',
    guest_name: '',
    guest_phone: '',
    check_in_date: todayStr(),
    check_in_time: '14:00',
    check_out_date: '',
    notes: '',
  })

  const [calStart, setCalStart] = useState<Date>(() => {
    const d = new Date()
    d.setHours(8, 0, 0, 0)
    return d
  })

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [roomsRes, staysRes, serviceRes, staffRes] = await Promise.all([
      supabase.from('rooms').select('*').order('room_number'),
      supabase
        .from('room_stays')
        .select('*, rooms(room_number, room_type, rate_per_night)')
        .order('created_at', { ascending: false }),
      supabase
        .from('room_service_orders')
        .select('*, rooms(room_number)')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('profiles')
        .select('id, full_name, role, phone, is_active, hire_date')
        .eq('is_active', true),
    ])
    setRooms((roomsRes.data || []) as Room[])
    setStays((staysRes.data || []) as RoomStay[])
    setServiceOrders((serviceRes.data || []) as ServiceOrder[])
    setStaff(
      ((staffRes.data || []) as StaffMember[]).filter(
        (s) => !['apartment_manager', 'manager', 'owner'].includes(s.role)
      )
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    const ch = supabase
      .channel('apt-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_service_orders' },
        fetchAll
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchAll])

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeStays = stays.filter((s) => s.status === 'active' || s.status === 'reserved')
  const overstays = activeStays.filter((s) => new Date(s.check_out_date) < new Date())
  const dueToday = activeStays.filter((s) => {
    const d = new Date(s.check_out_date),
      t = new Date()
    t.setHours(8, 0, 0, 0)
    const tmr = new Date(t)
    tmr.setDate(tmr.getDate() + 1)
    return d >= t && d < tmr
  })
  const occupied = rooms.filter((r) => r.status === 'occupied').length
  const available = rooms.filter((r) => r.status === 'available').length
  const occupancyPct = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0
  const totalOutstanding = activeStays.reduce(
    (s, st) => s + Math.max(0, (st.total_amount || 0) - (st.amount_paid || 0)),
    0
  )
  const pendingService = serviceOrders.filter((o) => o.status === 'pending').length

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleCheckIn() {
    if (!showCheckIn || !checkInForm.guest_name || !checkInForm.check_out_date) return
    setSaving(true)
    try {
      const nights = Math.max(
        0,
        Math.ceil(
          (new Date(checkInForm.check_out_date).getTime() -
            new Date(checkInForm.check_in_date).getTime()) /
            86400000
        )
      )
      const totalDue = nights * (showCheckIn.rate_per_night || 0)
      const { error: stayErr } = await supabase.from('room_stays').insert({
        room_id: showCheckIn.id,
        guest_name: checkInForm.guest_name,
        guest_phone: checkInForm.guest_phone,
        guest_email: checkInForm.guest_email,
        guest_id_number: checkInForm.guest_id_number,
        check_in_date: checkInForm.check_in_date,
        check_out_date: checkInForm.check_out_date,
        adults: checkInForm.adults,
        children: checkInForm.children,
        total_amount: totalDue,
        amount_paid: parseFloat(checkInForm.amount_paid) || totalDue,
        payment_method: checkInForm.payment_method,
        notes: checkInForm.notes,
        status: 'active',
        checked_in_by: profile?.id,
      })
      if (stayErr) throw stayErr
      const { error: roomErr } = await supabase
        .from('rooms')
        .update({ status: 'occupied' })
        .eq('id', showCheckIn.id)
      if (roomErr) throw roomErr
      setShowCheckIn(null)
      setCheckInForm(DEFAULT_FORM)
      fetchAll()
    } catch (err) {
      toast.error('Error', 'Check-in failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  async function confirmCheckOut() {
    if (!showCheckOut) return
    setSaving(true)
    try {
      const { error: stayErr } = await supabase
        .from('room_stays')
        .update({ status: 'checked_out', actual_check_out: new Date().toISOString() })
        .eq('id', showCheckOut.id)
      if (stayErr) throw stayErr
      const { error: roomErr } = await supabase
        .from('rooms')
        .update({ status: 'available' })
        .eq('id', showCheckOut.room_id)
      if (roomErr) throw roomErr
      setShowCheckOut(null)
      fetchAll()
    } catch (err) {
      toast.error(
        'Error',
        'Check-out failed: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setSaving(false)
    }
  }

  async function recordPayment() {
    if (!showPayment || !payForm.amount) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('room_stays')
        .update({
          amount_paid: (showPayment.amount_paid || 0) + parseFloat(payForm.amount),
          updated_at: new Date().toISOString(),
        })
        .eq('id', showPayment.id)
      if (error) throw error
      setShowPayment(null)
      setPayForm({ amount: '', method: 'cash', reference: '' })
      fetchAll()
    } catch (err) {
      toast.error('Error', 'Payment failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  async function handleReserve() {
    if (
      !reserveForm.room_id ||
      !reserveForm.guest_name ||
      !reserveForm.check_in_date ||
      !reserveForm.check_out_date
    ) {
      return toast.warning('Required', 'Fill in room, guest name and dates')
    }
    setSaving(true)
    try {
      // Check for conflicts
      const { data: conflicts } = await supabase
        .from('room_stays')
        .select('id')
        .eq('room_id', reserveForm.room_id)
        .in('status', ['active', 'reserved'])
        .lt('check_in_date', reserveForm.check_out_date)
        .gt('check_out_date', reserveForm.check_in_date)
      if (conflicts && conflicts.length > 0) {
        toast.warning('Conflict', 'This room already has a booking for those dates')
        return
      }
      const { error } = await supabase.from('room_stays').insert({
        room_id: reserveForm.room_id,
        guest_name: reserveForm.guest_name,
        guest_phone: reserveForm.guest_phone || null,
        check_in_date: reserveForm.check_in_date,
        check_out_date: reserveForm.check_out_date,
        check_in_time: reserveForm.check_in_time,
        adults: 1,
        children: 0,
        total_amount: 0,
        amount_paid: 0,
        payment_method: 'cash',
        notes: reserveForm.notes || null,
        status: 'reserved',
        checked_in_by: profile?.id,
      })
      if (error) throw error
      await supabase.from('rooms').update({ status: 'reserved' }).eq('id', reserveForm.room_id)
      setShowReserve(false)
      setReserveForm({
        room_id: '',
        guest_name: '',
        guest_phone: '',
        check_in_date: todayStr(),
        check_in_time: '14:00',
        check_out_date: '',
        notes: '',
      })
      fetchAll()
    } catch (err) {
      toast.error(
        'Error',
        'Reservation failed: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setSaving(false)
    }
  }

  async function cancelReservation(stay: RoomStay) {
    if (!confirm(`Cancel reservation for ${stay.guest_name}?`)) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('room_stays')
        .update({ status: 'checked_out' })
        .eq('id', stay.id)
      if (error) throw error
      await supabase.from('rooms').update({ status: 'available' }).eq('id', stay.room_id)
      fetchAll()
    } catch (err) {
      toast.error(
        'Error',
        'Failed to cancel: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setSaving(false)
    }
  }

  async function updateRoomStatus(roomId: string, status: Room['status']) {
    const { error } = await supabase.from('rooms').update({ status }).eq('id', roomId)
    if (error) {
      toast.error('Error', 'Failed to update room: ' + error.message)
      return
    }
    fetchAll()
  }

  const shiftCal = (days: number) => {
    const d = new Date(calStart)
    d.setDate(d.getDate() + days)
    setCalStart(d)
  }

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
              <BedDouble size={17} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm">Apartment Manager</h1>
              <p className="text-gray-500 text-xs">{profile?.full_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HelpTooltip storageKey="apartment" tips={APARTMENT_HELP_TIPS} />
            <button onClick={fetchAll} className="p-2 rounded-xl hover:bg-gray-800 text-gray-400">
              <RefreshCw size={15} />
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 text-xs border border-gray-700 rounded-xl px-3 py-2 transition-colors"
            >
              <LogOut size={13} /> Out
            </button>
          </div>
        </div>
      </div>

      {/* Alert banners */}
      {overstays.length > 0 && (
        <div className="mx-4 mt-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-purple-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-purple-400 font-semibold text-sm">
              {overstays.length} overstay{overstays.length !== 1 ? 's' : ''} — checkout date passed
            </p>
            <p className="text-gray-400 text-xs mt-0.5">
              {overstays.map((s) => `${s.guest_name} (Room ${s.rooms?.room_number})`).join(' · ')}
            </p>
          </div>
        </div>
      )}
      {dueToday.length > 0 && (
        <div className="mx-4 mt-2 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
          <Clock size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-400 font-semibold text-sm">
              {dueToday.length} guest{dueToday.length !== 1 ? 's' : ''} checking out today
            </p>
            <p className="text-gray-400 text-xs mt-0.5">
              {dueToday.map((s) => `${s.guest_name} (Room ${s.rooms?.room_number})`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-800 mx-4 mt-3 rounded-2xl overflow-hidden">
        {[
          { label: 'Available', value: available, color: 'text-green-400' },
          { label: 'Occupied', value: `${occupied}/${rooms.length}`, color: 'text-amber-400' },
          { label: 'Occupancy', value: `${occupancyPct}%`, color: 'text-blue-400' },
          {
            label: 'Outstanding',
            value: fmtShort(totalOutstanding),
            color: totalOutstanding > 0 ? 'text-red-400' : 'text-gray-500',
          },
        ].map((k) => (
          <div key={k.label} className="bg-gray-900 px-2 py-3 text-center">
            <p className={`text-sm font-black ${k.color}`}>{k.value}</p>
            <p className="text-gray-600 text-[10px] mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-2 mt-3 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors relative ${tab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-500 hover:text-white'}`}
          >
            <t.icon size={13} />
            {t.label}
            {t.id === 'roomservice' && pendingService > 0 && (
              <span className="absolute -top-0.5 right-0 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {pendingService}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={28} className="animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-4">
          {tab === 'rooms' && (
            <RoomsTab
              rooms={rooms}
              activeStays={activeStays}
              onCheckIn={(room) => {
                setShowCheckIn(room)
                setCheckInForm(DEFAULT_FORM)
              }}
              onCheckOut={(stay) => setShowCheckOut(stay)}
              onPayment={(stay) => setShowPayment(stay)}
              onDetails={(stay) => setShowDetails(stay)}
              onSetMaintenance={(id) => updateRoomStatus(id, 'maintenance')}
              onSetAvailable={(id) => updateRoomStatus(id, 'available')}
            />
          )}
          {tab === 'calendar' && (
            <CalendarTab
              rooms={rooms}
              activeStays={activeStays}
              calStart={calStart}
              onPrev={() => shiftCal(-7)}
              onNext={() => shiftCal(7)}
              onToday={() => {
                const d = new Date()
                d.setHours(8, 0, 0, 0)
                setCalStart(d)
              }}
            />
          )}
          {tab === 'roomservice' && (
            <RoomServiceTab serviceOrders={serviceOrders} onRefresh={fetchAll} />
          )}
          {tab === 'revenue' && (
            <RevenueTab stays={stays} serviceOrders={serviceOrders} rooms={rooms} />
          )}
          {tab === 'reservations' && (
            <div className="space-y-3">
              <button
                onClick={() => setShowReserve(true)}
                className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-2xl py-3 text-sm transition-colors"
              >
                <BookOpen size={16} /> New Reservation
              </button>
              {stays.filter((s) => s.status === 'reserved').length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  No upcoming reservations
                </div>
              ) : (
                stays
                  .filter((s) => s.status === 'reserved')
                  .map((stay) => {
                    const room = rooms.find((r) => r.id === stay.room_id)
                    return (
                      <div
                        key={stay.id}
                        className="bg-gray-900 border border-blue-500/30 rounded-2xl p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-white font-bold">{stay.guest_name}</p>
                            <p className="text-blue-400 text-xs mt-0.5">
                              Room {room?.room_number} · {room?.room_type}
                            </p>
                            <p className="text-gray-500 text-xs mt-1">
                              Check-in: <span className="text-white">{stay.check_in_date}</span>
                              {(stay as RoomStay & { check_in_time?: string }).check_in_time && (
                                <span className="text-amber-400">
                                  {' '}
                                  @ {(stay as RoomStay & { check_in_time?: string }).check_in_time}
                                </span>
                              )}
                            </p>
                            <p className="text-gray-500 text-xs">
                              Check-out: <span className="text-white">{stay.check_out_date}</span>
                            </p>
                            {stay.guest_phone && (
                              <p className="text-gray-500 text-xs">{stay.guest_phone}</p>
                            )}
                            {stay.notes && (
                              <p className="text-gray-600 text-xs italic mt-1">{stay.notes}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 shrink-0 ml-3">
                            <button
                              onClick={() => {
                                setShowCheckIn(rooms.find((r) => r.id === stay.room_id) || null)
                              }}
                              className="text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3 py-1.5 rounded-xl font-medium"
                            >
                              Check In
                            </button>
                            <button
                              onClick={() => cancelReservation(stay)}
                              className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-xl font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })
              )}
            </div>
          )}
          {tab === 'staff' && <StaffTab staff={staff} />}
        </div>
      )}

      {/* Modals */}
      {showCheckIn && (
        <CheckInModal
          room={showCheckIn}
          form={checkInForm}
          saving={saving}
          onChange={setCheckInForm}
          onConfirm={handleCheckIn}
          onClose={() => setShowCheckIn(null)}
        />
      )}
      {showCheckOut && (
        <CheckOutModal
          stay={showCheckOut}
          saving={saving}
          onConfirm={confirmCheckOut}
          onClose={() => setShowCheckOut(null)}
        />
      )}
      {showPayment && (
        <PaymentModal
          stay={showPayment}
          form={payForm}
          saving={saving}
          onChange={setPayForm}
          onConfirm={recordPayment}
          onClose={() => setShowPayment(null)}
        />
      )}
      {showDetails && <DetailsModal stay={showDetails} onClose={() => setShowDetails(null)} />}

      {/* Reservation Modal */}
      {showReserve && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-white font-bold">New Reservation</h2>
              <button
                onClick={() => setShowReserve(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Room *</label>
                <select
                  value={reserveForm.room_id}
                  onChange={(e) => setReserveForm((p) => ({ ...p, room_id: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select room…</option>
                  {rooms
                    .filter((r) => r.status === 'available')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} — {r.room_type}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Guest Name *</label>
                <input
                  value={reserveForm.guest_name}
                  onChange={(e) => setReserveForm((p) => ({ ...p, guest_name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Phone</label>
                <input
                  value={reserveForm.guest_phone}
                  onChange={(e) => setReserveForm((p) => ({ ...p, guest_phone: e.target.value }))}
                  placeholder="080xxxxxxxx"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 text-xs block mb-1">Check-in Date *</label>
                  <input
                    type="date"
                    value={reserveForm.check_in_date}
                    onChange={(e) =>
                      setReserveForm((p) => ({ ...p, check_in_date: e.target.value }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs block mb-1">Expected Time</label>
                  <input
                    type="time"
                    value={reserveForm.check_in_time}
                    onChange={(e) =>
                      setReserveForm((p) => ({ ...p, check_in_time: e.target.value }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Check-out Date *</label>
                <input
                  type="date"
                  value={reserveForm.check_out_date}
                  onChange={(e) =>
                    setReserveForm((p) => ({ ...p, check_out_date: e.target.value }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Notes</label>
                <input
                  value={reserveForm.notes}
                  onChange={(e) => setReserveForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Special requests…"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="px-5 pb-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowReserve(false)}
                className="py-3 rounded-xl bg-gray-800 text-gray-300 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleReserve}
                disabled={saving}
                className="py-3 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:bg-gray-700 text-white font-bold text-sm"
              >
                {saving ? 'Saving…' : 'Confirm Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
