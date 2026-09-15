import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { Gamepad2, LogOut, RefreshCw, Banknote, CreditCard, Smartphone, Trash2 } from 'lucide-react'

interface GameType {
  id: string
  name: string
  price: number
  duration_mins?: number
  description?: string
  is_active: boolean
}

interface GameSale {
  id: string
  game_name: string
  quantity: number
  unit_price: number
  total_price: number
  customer_name?: string
  payment_method: string
  status: string
  notes?: string
  recorded_by_name?: string
  created_at: string
}

import { audit } from '../../lib/audit'
import type { Profile } from '../../types'

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

export default function GamesMasterPage() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const isManager = ['owner', 'manager'].includes(profile?.role || '')

  const [gameTypes, setGameTypes] = useState<GameType[]>([])
  const [sales, setSales] = useState<GameSale[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'sell' | 'history' | 'config'>('sell')
  const [date, setDate] = useState(todayWAT())
  const [waitrons, setWaitrons] = useState<Array<{ id: string; name: string }>>([])

  // Sale form
  const [selectedGame, setSelectedGame] = useState<string>('')
  const [quantity, setQuantity] = useState('1')
  const [customerName, setCustomerName] = useState('')
  const [selectedWaitron, setSelectedWaitron] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<string>('cash')
  const [notes, setNotes] = useState('')
  const [processing, setProcessing] = useState(false)

  // Config form
  const [configForm, setConfigForm] = useState({
    name: '',
    price: '',
    duration_mins: '',
    description: '',
  })
  const [configSaving, setConfigSaving] = useState(false)

  const fetchAll = useCallback(async () => {
    const dayStart = new Date(date + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const [typesRes, salesRes, staffRes] = await Promise.all([
      supabase
        .from('menu_items')
        .select('id, name, price, menu_categories(destination)')
        .eq('is_available', true),
      supabase
        .from('game_sales')
        .select('*')
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('attendance')
        .select('staff_id, staff_name')
        .or('clock_out.is.null')
        .order('staff_name'),
    ])
    if (typesRes.data) {
      const gamesFromMenu = (typesRes.data as any[])
        .filter((i) => i.menu_categories?.destination === 'games')
        .map((i) => ({ id: i.id, name: i.name, price: i.price, is_active: true }))
      setGameTypes(gamesFromMenu as GameType[])
    }
    if (salesRes.data) setSales(salesRes.data as GameSale[])
    if (staffRes.data) {
      const unique = new Map<string, string>()
      staffRes.data.forEach((s: { staff_id: string; staff_name: string }) =>
        unique.set(s.staff_id, s.staff_name)
      )
      setWaitrons(Array.from(unique.entries()).map(([id, name]) => ({ id, name })))
    }
    setLoading(false)
  }, [date])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const selectedGameType = gameTypes.find((g) => g.id === selectedGame)
  const saleTotal = (selectedGameType?.price || 0) * (parseInt(quantity) || 1)

  const handleSale = async () => {
    if (!selectedGameType) return toast.warning('Required', 'Select a game type')
    if (!selectedWaitron)
      return toast.warning('Required', 'Select the waitron who collected payment')
    setProcessing(true)
    const qty = parseInt(quantity) || 1
    const waitron = waitrons.find((w) => w.id === selectedWaitron)
    const saleNotes = [
      `Waitron: ${waitron?.name || '—'}`,
      `Waitron ID: ${selectedWaitron}`,
      notes.trim() || null,
    ]
      .filter(Boolean)
      .join(' · ')
    const { error } = await supabase.from('game_sales').insert({
      game_name: selectedGameType.name,
      quantity: qty,
      unit_price: selectedGameType.price,
      total_price: selectedGameType.price * qty,
      customer_name: customerName || null,
      payment_method: paymentMethod,
      status: 'paid',
      notes: saleNotes || null,
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    })
    setProcessing(false)
    if (error) return toast.error('Error', error.message)
    await audit({
      action: 'GAME_RECORDED',
      entity: 'game_sales',
      entityName: `${qty}x ${selectedGameType.name}`,
      newValue: {
        game: selectedGameType.name,
        qty,
        total: selectedGameType.price * qty,
        waitron: waitron?.name,
        customer: customerName,
      },
      performer: profile as Profile,
    })
    toast.success(
      'Sale Recorded',
      `${qty}x ${selectedGameType.name} — ₦${(selectedGameType.price * qty).toLocaleString()} via ${waitron?.name}`
    )
    setQuantity('1')
    setCustomerName('')
    setNotes('')
    fetchAll()
  }

  const addGameType = async () => {
    if (!configForm.name || !configForm.price)
      return toast.warning('Required', 'Name and price are required')
    setConfigSaving(true)
    const { error } = await supabase.from('game_types').insert({
      name: configForm.name.trim(),
      price: parseFloat(configForm.price),
      duration_mins: parseInt(configForm.duration_mins) || null,
      description: configForm.description.trim() || null,
    })
    setConfigSaving(false)
    if (error) return toast.error('Error', error.message)
    setConfigForm({ name: '', price: '', duration_mins: '', description: '' })
    fetchAll()
  }

  const removeGameType = async (id: string) => {
    await supabase.from('game_types').update({ is_active: false }).eq('id', id)
    fetchAll()
  }

  const todaySales = sales.reduce((s, sale) => s + sale.total_price, 0)
  const todayCount = sales.length

  const inp =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500'

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center">
            <Gamepad2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold">Games</h1>
            <p className="text-gray-400 text-xs">
              ₦{todaySales.toLocaleString()} today · {todayCount} game{todayCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="text-gray-400 hover:text-white">
            <RefreshCw size={16} />
          </button>
          <p className="text-gray-400 text-sm hidden sm:block">{profile?.full_name}</p>
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <div className="flex border-b border-gray-800 bg-gray-900">
        {(
          [
            ['sell', 'Record Sale'],
            ['history', "Today's Sales"],
            ...(isManager ? [['config', 'Game Types']] : []),
          ] as [string, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayWAT()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm"
        />
        <button
          onClick={() => setDate(todayWAT())}
          className={`px-3 py-2 rounded-xl text-xs font-medium ${date === todayWAT() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toLocaleDateString('en-CA'))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white"
        >
          Prev Day
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-w-lg mx-auto w-full">
        {tab === 'sell' && (
          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Game Type</label>
              <select
                value={selectedGame}
                onChange={(e) => setSelectedGame(e.target.value)}
                className={inp}
              >
                <option value="">Select game...</option>
                {gameTypes.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} — ₦{g.price.toLocaleString()}
                    {g.duration_mins ? ` (${g.duration_mins}min)` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Customer (optional)</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Name"
                  className={inp}
                />
              </div>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Waitron (who collected payment)
              </label>
              <select
                value={selectedWaitron}
                onChange={(e) => setSelectedWaitron(e.target.value)}
                className={inp}
              >
                <option value="">Select waitron...</option>
                {waitrons.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Payment</label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['cash', 'Cash', Banknote],
                    ['card', 'POS', CreditCard],
                    ['transfer', 'Transfer', Smartphone],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setPaymentMethod(id)}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-xs font-medium transition-all ${paymentMethod === id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className={inp}
            />
            {selectedGameType && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
                <p className="text-emerald-400/70 text-[10px] uppercase tracking-wider mb-1">
                  Total
                </p>
                <p className="text-emerald-400 text-3xl font-bold">₦{saleTotal.toLocaleString()}</p>
              </div>
            )}
            <button
              onClick={handleSale}
              disabled={!selectedGame || processing}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 text-sm transition-colors"
            >
              {processing ? 'Recording...' : 'Record Sale'}
            </button>
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-2">
            {sales.length === 0 ? (
              <div className="text-center py-16">
                <Gamepad2 size={32} className="text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500">No games sold today</p>
              </div>
            ) : (
              sales.map((sale) => (
                <div key={sale.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-white text-sm font-semibold">
                      {sale.quantity}x {sale.game_name}
                    </p>
                    <p className="text-emerald-400 font-bold text-sm">
                      ₦{sale.total_price.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>
                      {new Date(sale.created_at).toLocaleTimeString('en-NG', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{sale.payment_method}</span>
                    {sale.customer_name && (
                      <>
                        <span>·</span>
                        <span>{sale.customer_name}</span>
                      </>
                    )}
                    {sale.recorded_by_name && (
                      <>
                        <span>·</span>
                        <span>{sale.recorded_by_name}</span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'config' && isManager && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-white font-semibold text-sm">Add Game Type</p>
              <input
                value={configForm.name}
                onChange={(e) => setConfigForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Game name (e.g. Pool, FIFA, Table Tennis)"
                className={inp}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min="0"
                  value={configForm.price}
                  onChange={(e) => setConfigForm((p) => ({ ...p, price: e.target.value }))}
                  placeholder="Price (₦)"
                  className={inp}
                />
                <input
                  type="number"
                  min="0"
                  value={configForm.duration_mins}
                  onChange={(e) => setConfigForm((p) => ({ ...p, duration_mins: e.target.value }))}
                  placeholder="Duration (mins)"
                  className={inp}
                />
              </div>
              <input
                value={configForm.description}
                onChange={(e) => setConfigForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Description (optional)"
                className={inp}
              />
              <button
                onClick={addGameType}
                disabled={configSaving}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold rounded-xl py-2.5 text-sm"
              >
                {configSaving ? 'Saving...' : 'Add Game Type'}
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-gray-500 text-xs uppercase tracking-wider">Active Game Types</p>
              {gameTypes.map((g) => (
                <div
                  key={g.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white text-sm font-semibold">{g.name}</p>
                    <p className="text-emerald-400 text-xs font-bold">
                      ₦{g.price.toLocaleString()}
                      {g.duration_mins ? ` · ${g.duration_mins} min` : ''}
                    </p>
                    {g.description && <p className="text-gray-500 text-xs">{g.description}</p>}
                  </div>
                  <button
                    onClick={() => removeGameType(g.id)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
