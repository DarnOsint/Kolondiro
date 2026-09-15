import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { Wind, LogOut, RefreshCw, Banknote, CreditCard, Smartphone, Trash2 } from 'lucide-react'

interface ShishaVariant {
  id: string
  name: string
  category: string
  price: number
  description?: string
  is_active: boolean
}

interface ShishaSale {
  id: string
  variant_name: string
  flavour?: string
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

const todayStr = () => new Date().toISOString().slice(0, 10)
const CATEGORIES = ['pot', 'session', 'refill', 'accessory'] as const

export default function ShishaAttendantPage() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const isManager = ['owner', 'manager'].includes(profile?.role || '')

  const [variants, setVariants] = useState<ShishaVariant[]>([])
  const [sales, setSales] = useState<ShishaSale[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'sell' | 'history' | 'config'>('sell')

  // Sale form
  const [selectedVariant, setSelectedVariant] = useState<string>('')
  const [flavour, setFlavour] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [customerName, setCustomerName] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<string>('cash')
  const [notes, setNotes] = useState('')
  const [processing, setProcessing] = useState(false)

  // Config form
  const [configForm, setConfigForm] = useState({
    name: '',
    category: 'pot' as string,
    price: '',
    description: '',
  })
  const [configSaving, setConfigSaving] = useState(false)

  // Common flavours for quick selection
  const [flavourList] = useState([
    'Double Apple',
    'Grape Mint',
    'Watermelon',
    'Blueberry',
    'Lemon Mint',
    'Peach',
    'Mango',
    'Mixed Berry',
    'Pineapple',
    'Rose',
  ])

  const fetchAll = useCallback(async () => {
    const today = new Date(todayStr())
    const [varRes, salesRes] = await Promise.all([
      supabase.from('shisha_variants').select('*').eq('is_active', true).order('category, name'),
      supabase
        .from('shisha_sales')
        .select('*')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false }),
    ])
    if (varRes.data) setVariants(varRes.data as ShishaVariant[])
    if (salesRes.data) setSales(salesRes.data as ShishaSale[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const selectedVar = variants.find((v) => v.id === selectedVariant)
  const saleTotal = (selectedVar?.price || 0) * (parseInt(quantity) || 1)

  const handleSale = async () => {
    if (!selectedVar) return toast.warning('Required', 'Select a shisha variant')
    setProcessing(true)
    const qty = parseInt(quantity) || 1
    const { error } = await supabase.from('shisha_sales').insert({
      variant_id: selectedVar.id,
      variant_name: selectedVar.name,
      flavour: flavour || null,
      quantity: qty,
      unit_price: selectedVar.price,
      total_price: selectedVar.price * qty,
      customer_name: customerName || null,
      payment_method: paymentMethod,
      status: 'paid',
      notes: notes || null,
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    })
    setProcessing(false)
    if (error) return toast.error('Error', error.message)
    toast.success(
      'Sale Recorded',
      `${qty}x ${selectedVar.name}${flavour ? ` (${flavour})` : ''} — ₦${(selectedVar.price * qty).toLocaleString()}`
    )
    setQuantity('1')
    setFlavour('')
    setCustomerName('')
    setNotes('')
    fetchAll()
  }

  const addVariant = async () => {
    if (!configForm.name || !configForm.price)
      return toast.warning('Required', 'Name and price are required')
    setConfigSaving(true)
    const { error } = await supabase.from('shisha_variants').insert({
      name: configForm.name.trim(),
      category: configForm.category,
      price: parseFloat(configForm.price),
      description: configForm.description.trim() || null,
    })
    setConfigSaving(false)
    if (error) return toast.error('Error', error.message)
    setConfigForm({ name: '', category: 'pot', price: '', description: '' })
    fetchAll()
  }

  const removeVariant = async (id: string) => {
    await supabase.from('shisha_variants').update({ is_active: false }).eq('id', id)
    fetchAll()
  }

  const todaySales = sales.reduce((s, sale) => s + sale.total_price, 0)
  const todayCount = sales.length
  const groupedVariants = CATEGORIES.reduce<Record<string, ShishaVariant[]>>(
    (acc, cat) => {
      acc[cat] = variants.filter((v) => v.category === cat)
      return acc
    },
    {} as Record<string, ShishaVariant[]>
  )

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
          <div className="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center">
            <Wind size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold">Shisha</h1>
            <p className="text-gray-400 text-xs">
              ₦{todaySales.toLocaleString()} today · {todayCount} session
              {todayCount !== 1 ? 's' : ''}
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
            ...(isManager ? [['config', 'Variants & Pricing']] : []),
          ] as [string, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-rose-500 text-rose-400' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-w-lg mx-auto w-full">
        {tab === 'sell' && (
          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Shisha Type</label>
              <select
                value={selectedVariant}
                onChange={(e) => setSelectedVariant(e.target.value)}
                className={inp}
              >
                <option value="">Select...</option>
                {CATEGORIES.map((cat) => {
                  const items = groupedVariants[cat]
                  if (!items || items.length === 0) return null
                  return (
                    <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                      {items.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} — ₦{v.price.toLocaleString()}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Flavour</label>
              <input
                value={flavour}
                onChange={(e) => setFlavour(e.target.value)}
                placeholder="Type or select flavour"
                list="flavour-list"
                className={inp}
              />
              <datalist id="flavour-list">
                {flavourList.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {flavourList.slice(0, 6).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFlavour(f)}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${flavour === f ? 'bg-rose-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
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
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-xs font-medium transition-all ${paymentMethod === id ? 'border-rose-500 bg-rose-500/10 text-rose-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}
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
            {selectedVar && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-center">
                <p className="text-rose-400/70 text-[10px] uppercase tracking-wider mb-1">Total</p>
                <p className="text-rose-400 text-3xl font-bold">₦{saleTotal.toLocaleString()}</p>
                {flavour && (
                  <p className="text-rose-300 text-xs mt-1">
                    {selectedVar.name} · {flavour}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={handleSale}
              disabled={!selectedVariant || processing}
              className="w-full bg-rose-500 hover:bg-rose-400 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl py-3 text-sm transition-colors"
            >
              {processing ? 'Recording...' : 'Record Sale'}
            </button>
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-2">
            {sales.length === 0 ? (
              <div className="text-center py-16">
                <Wind size={32} className="text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500">No shisha sales today</p>
              </div>
            ) : (
              sales.map((sale) => (
                <div key={sale.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-white text-sm font-semibold">
                        {sale.quantity}x {sale.variant_name}
                      </p>
                      {sale.flavour && <p className="text-rose-400 text-xs">{sale.flavour}</p>}
                    </div>
                    <p className="text-rose-400 font-bold text-sm">
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
              <p className="text-white font-semibold text-sm">Add Shisha Variant</p>
              <input
                value={configForm.name}
                onChange={(e) => setConfigForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name (e.g. Single Pot, Double Pot, VIP Session)"
                className={inp}
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={configForm.category}
                  onChange={(e) => setConfigForm((p) => ({ ...p, category: e.target.value }))}
                  className={inp}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  value={configForm.price}
                  onChange={(e) => setConfigForm((p) => ({ ...p, price: e.target.value }))}
                  placeholder="Price (₦)"
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
                onClick={addVariant}
                disabled={configSaving}
                className="w-full bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-sm"
              >
                {configSaving ? 'Saving...' : 'Add Variant'}
              </button>
            </div>
            {CATEGORIES.map((cat) => {
              const items = groupedVariants[cat]
              if (!items || items.length === 0) return null
              return (
                <div key={cat}>
                  <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">{cat}</p>
                  <div className="space-y-2">
                    {items.map((v) => (
                      <div
                        key={v.id}
                        className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-white text-sm font-semibold">{v.name}</p>
                          <p className="text-rose-400 text-xs font-bold">
                            ₦{v.price.toLocaleString()}
                          </p>
                          {v.description && (
                            <p className="text-gray-500 text-xs">{v.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => removeVariant(v.id)}
                          className="text-red-400 hover:text-red-300 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
