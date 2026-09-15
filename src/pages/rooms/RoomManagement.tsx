import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { HelpTooltip } from '../../components/HelpTooltip'
import { BedDouble, Users, Clock, Wrench } from 'lucide-react'

import RoomBoardTab from './RoomBoardTab'
import ActiveStaysTab from './ActiveStaysTab'
import RoomSettingsTab from './RoomSettingsTab'
import RoomHistory from './RoomHistory'
import CheckInModal from './CheckInModal'
import CheckOutModal from './CheckOutModal'
import StayDetailModal from './StayDetailModal'
import RoomEditModal from './RoomEditModal'

import type { RoomRow, StayRow, CheckinForm, RoomEditForm, RoomStatus } from './types'
import { BLANK_CHECKIN } from './types'
import { useToast } from '../../context/ToastContext'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'

const TABS = [
  { id: 'board', label: 'Room Board', icon: BedDouble },
  { id: 'stays', label: 'Active Stays', icon: Users },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'settings', label: 'Room Settings', icon: Wrench },
] as const

const ROOMS_HELP_TIPS = [
  {
    id: 'rooms-board',
    title: 'Room Board Tab',
    description:
      'Visual grid of all rooms — colour-coded by status: green (available), amber (occupied), blue (reserved), red (maintenance/overstay). Tap any room card to check in a new guest, view the current guest, or change the room status.',
  },
  {
    id: 'rooms-checkin',
    title: 'Checking In',
    description:
      'Tap Check In on any available room. Enter guest name, ID type and number, phone, email, number of guests, check-in and check-out dates, rate per night, payment method, and notes. The total amount is calculated automatically from the number of nights.',
  },
  {
    id: 'rooms-checkout',
    title: 'Checking Out',
    description:
      'Tap Check Out on any occupied room. The room status resets to Cleaning and the stay is archived. Ensure payment is fully settled before checking out.',
  },
  {
    id: 'rooms-active',
    title: 'Active Stays Tab',
    description:
      'List of all currently occupied rooms with guest name, check-in date, check-out date, nights remaining, and outstanding balance. Overstays are highlighted in red — contact the guest immediately.',
  },
  {
    id: 'rooms-history',
    title: 'History Tab',
    description:
      'Completed stays — checked-out and overstay records. Includes guest name, room, nights, total amount, and payment method.',
  },
  {
    id: 'rooms-settings',
    title: 'Settings Tab',
    description:
      'Configure room details — room number, type (Standard, Deluxe, Suite, etc.), and nightly rate. Changes take effect immediately for new check-ins.',
  },
  {
    id: 'rooms-overstay',
    title: 'Overstay Detection',
    description:
      'The system automatically checks every 5 minutes for stays where the check-out date has passed. These are flagged as Overstay (red) on the board so you can take action.',
  },
]

export default function RoomManagement() {
  const { profile } = useAuth()
  const toast = useToast()

  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [stays, setStays] = useState<StayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('board')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [saving, setSaving] = useState(false)

  // Modal visibility
  const [showCheckin, setShowCheckin] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showRoomEdit, setShowRoomEdit] = useState(false)
  const [showStayDetail, setShowStayDetail] = useState(false)

  // Selected items
  const [selectedRoom, setSelectedRoom] = useState<RoomRow | null>(null)
  const [selectedStay, setSelectedStay] = useState<StayRow | null>(null)

  // Forms
  const [checkinForm, setCheckinForm] = useState<CheckinForm>(BLANK_CHECKIN)
  const [roomEditForm, setRoomEditForm] = useState<RoomEditForm>({
    name: '',
    room_type: 'standard',
    floor: '1',
    capacity: '2',
    rate_per_night: '',
    amenities: '',
    notes: '',
  })

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const [roomsRes, staysRes] = await Promise.all([
      supabase.from('rooms').select('*').order('name'),
      supabase
        .from('room_stays')
        .select('*')
        .eq('status', 'active')
        .order('check_in_at', { ascending: false }),
    ])
    if (roomsRes.data) setRooms(roomsRes.data as RoomRow[])
    if (staysRes.data) setStays(staysRes.data as StayRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel('rooms-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchAll)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchAll])

  // Scroll to top on tab change
  useEffect(() => {
    const _ms = document.getElementById('main-scroll')
    if (_ms) _ms.scrollTop = 0
  }, [activeTab])

  // Auto-check overstays
  const checkOverstays = useCallback(async () => {
    const now = new Date().toISOString()
    const overstays = stays.filter((s) => s.check_out_at < now && s.status === 'active')
    for (const stay of overstays) {
      await supabase.from('room_stays').update({ status: 'overstay' }).eq('id', stay.id)
    }
    if (overstays.length > 0) fetchAll()
  }, [stays, fetchAll])

  useEffect(() => {
    // interval handled by visibility-aware hook
  }, [checkOverstays])

  useVisibilityInterval(checkOverstays, 5 * 60_000, [checkOverstays])

  // ── Actions ───────────────────────────────────────────────────────────────
  const openCheckin = (room: RoomRow) => {
    setSelectedRoom(room)
    setCheckinForm({ ...BLANK_CHECKIN, check_in_at: new Date().toISOString().slice(0, 16) })
    setShowCheckin(true)
  }

  const processCheckin = async () => {
    if (!checkinForm.guest_name) return toast.warning('Required', 'Guest name is required')
    if (!checkinForm.guest_phone) return toast.warning('Required', 'Guest phone is required')
    if (!checkinForm.id_number) return toast.warning('Required', 'ID number is required')
    if (!selectedRoom || !profile) return
    setSaving(true)

    const checkOutAt = new Date(checkinForm.check_in_at)
    checkOutAt.setDate(checkOutAt.getDate() + parseInt(checkinForm.nights))

    const { error } = await supabase.from('room_stays').insert({
      room_id: selectedRoom.id,
      room_name: selectedRoom.name,
      guest_name: checkinForm.guest_name,
      guest_phone: checkinForm.guest_phone,
      guest_email: checkinForm.guest_email || null,
      id_type: checkinForm.id_type,
      id_number: checkinForm.id_number,
      num_guests: parseInt(checkinForm.num_guests),
      check_in_at: new Date(checkinForm.check_in_at).toISOString(),
      check_out_at: checkOutAt.toISOString(),
      nights: parseInt(checkinForm.nights),
      rate_per_night: selectedRoom.rate_per_night,
      total_amount: (selectedRoom.rate_per_night || 0) * parseInt(checkinForm.nights),
      payment_method: checkinForm.payment_method,
      payment_reference: checkinForm.payment_reference || null,
      notes: checkinForm.notes || null,
      checked_in_by: profile.id,
      checked_in_by_name: profile.full_name,
      status: 'active',
    })

    if (error) {
      toast.error('Error', error instanceof Error ? error.message : String(error))
      setSaving(false)
      return
    }
    const { error: roomErr } = await supabase
      .from('rooms')
      .update({ status: 'occupied' })
      .eq('id', selectedRoom.id)
    if (roomErr) console.error('Failed to mark room occupied:', roomErr.message)
    await fetchAll()
    setSaving(false)
    setShowCheckin(false)
  }

  const processCheckout = async () => {
    if (!selectedRoom || !selectedStay) return
    setSaving(true)
    try {
      const { error: stayError } = await supabase
        .from('room_stays')
        .update({ status: 'checked_out', actual_checkout_at: new Date().toISOString() })
        .eq('id', selectedStay.id)
      if (stayError) throw stayError
      const { error: roomError } = await supabase
        .from('rooms')
        .update({ status: 'cleaning' })
        .eq('id', selectedRoom.id)
      if (roomError) throw roomError
      await fetchAll()
      setShowCheckout(false)
    } catch (err) {
      toast.error('Error', 'Checkout failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const updateRoomStatus = async (room: RoomRow, status: RoomStatus) => {
    const { error } = await supabase.from('rooms').update({ status }).eq('id', room.id)
    if (error) {
      toast.error('Error', 'Error updating room: ' + error.message)
      return
    }
    fetchAll()
  }

  const openRoomEdit = (room: RoomRow) => {
    setSelectedRoom(room)
    setRoomEditForm({
      name: room.name || '',
      room_type: room.room_type || 'standard',
      floor: room.floor?.toString() || '1',
      capacity: room.capacity?.toString() || '2',
      rate_per_night: room.rate_per_night?.toString() || '',
      amenities: room.amenities || '',
      notes: room.notes || '',
    })
    setShowRoomEdit(true)
  }

  const saveRoomEdit = async () => {
    if (!selectedRoom) return
    setSaving(true)
    await supabase
      .from('rooms')
      .update({
        name: roomEditForm.name,
        room_type: roomEditForm.room_type,
        floor: parseInt(roomEditForm.floor),
        capacity: parseInt(roomEditForm.capacity),
        rate_per_night: parseFloat(roomEditForm.rate_per_night) || 0,
        amenities: roomEditForm.amenities || null,
        notes: roomEditForm.notes || null,
      })
      .eq('id', selectedRoom.id)
    await fetchAll()
    setSaving(false)
    setShowRoomEdit(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const stats = {
    total: rooms.length,
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    cleaning: rooms.filter((r) => r.status === 'cleaning').length,
    maintenance: rooms.filter((r) => r.status === 'maintenance').length,
  }
  const nightRevenue = stays.reduce((s, r) => s + (r.total_amount || 0), 0)

  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-amber-500">
        Loading rooms...
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950">
      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto items-center">
        <div className="mr-2">
          <HelpTooltip storageKey="rooms" tips={ROOMS_HELP_TIPS} />
        </div>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-6">
        {activeTab === 'board' && (
          <RoomBoardTab
            rooms={rooms}
            stays={stays}
            search={search}
            filterStatus={filterStatus}
            nightRevenue={nightRevenue}
            stats={stats}
            onSearchChange={setSearch}
            onFilterChange={setFilterStatus}
            onCheckin={openCheckin}
            onCheckout={(room, stay) => {
              setSelectedRoom(room)
              setSelectedStay(stay)
              setShowCheckout(true)
            }}
            onViewGuest={(stay) => {
              setSelectedStay(stay)
              setShowStayDetail(true)
            }}
            onEditRoom={openRoomEdit}
            onStatusChange={updateRoomStatus}
          />
        )}
        {activeTab === 'stays' && <ActiveStaysTab stays={stays} />}
        {activeTab === 'history' && <RoomHistory />}
        {activeTab === 'settings' && <RoomSettingsTab rooms={rooms} onEditRoom={openRoomEdit} />}
      </div>

      {/* Modals */}
      {showCheckin && selectedRoom && (
        <CheckInModal
          room={selectedRoom}
          form={checkinForm}
          saving={saving}
          onFormChange={setCheckinForm}
          onConfirm={processCheckin}
          onClose={() => setShowCheckin(false)}
        />
      )}
      {showCheckout && selectedRoom && selectedStay && (
        <CheckOutModal
          room={selectedRoom}
          stay={selectedStay}
          saving={saving}
          onConfirm={processCheckout}
          onClose={() => setShowCheckout(false)}
        />
      )}
      {showStayDetail && selectedStay && (
        <StayDetailModal stay={selectedStay} onClose={() => setShowStayDetail(false)} />
      )}
      {showRoomEdit && selectedRoom && (
        <RoomEditModal
          room={selectedRoom}
          form={roomEditForm}
          saving={saving}
          onFormChange={setRoomEditForm}
          onSave={saveRoomEdit}
          onClose={() => setShowRoomEdit(false)}
        />
      )}
    </div>
  )
}
