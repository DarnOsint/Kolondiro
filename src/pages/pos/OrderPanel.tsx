import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  Plus,
  Minus,
  Trash2,
  Send,
  X,
  CheckCircle2,
  Circle,
  Search,
  Clock,
  ShoppingBag,
} from 'lucide-react'
import type { Table, MenuItem, Order, OrderItem, Profile } from '../../types'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import { sendPushToStaff } from '../../hooks/usePushNotifications'

interface OrderItemLocal {
  id: string
  order_id?: string
  menu_item_id?: string
  quantity: number
  unit_price?: number
  total_price?: number
  status?: string
  destination?: string
  created_at?: string
  modifier_notes?: string | null
  extra_charge?: number
  _dbId?: string
  _newId?: string
  _existing?: boolean
  name: string
  price: number
  total: number
  menu_categories?: { name?: string; destination?: string } | null
  menu_items?: { name: string } | null
}

interface Props {
  table: Table
  menuItems: MenuItem[]
  onPlaceOrder: (payload: {
    table: Table
    items: OrderItemLocal[]
    notes: string
    total: number
  }) => Promise<void>
  onClose: () => void
  paymentInProgress?: boolean
  activeOrder?:
    | (Order & {
        order_items?: (OrderItem & {
          menu_items?: {
            name: string
            menu_categories?: { name?: string; destination?: string } | null
          } | null
        })[]
      })
    | null
  profile?: Profile | null
  compact?: boolean
  onRegisterAddItem?: (addFn: (item: MenuItem) => void) => void
}

export default function OrderPanel({
  table,
  menuItems,
  onPlaceOrder,
  onClose,
  paymentInProgress: _paymentInProgress = false,
  activeOrder,
  profile,
  compact = false,
  onRegisterAddItem,
}: Props) {
  const toast = useToast()
  const [servedItems, setServedItems] = useState<Record<string, boolean>>(() => {
    if (!activeOrder?.order_items) return {}
    return activeOrder.order_items.reduce((acc: Record<string, boolean>, i) => {
      if (i.status === 'delivered') acc[i.id] = true
      return acc
    }, {})
  })

  const dbIdMap = (activeOrder?.order_items || []).reduce((acc: Record<string, string>, i) => {
    acc[i.menu_item_id] = i.id
    return acc
  }, {})

  const markServed = async (item: OrderItemLocal) => {
    if (!activeOrder) return
    const dbId = item._dbId || dbIdMap[item.id]
    if (!dbId) return
    setServedItems((prev) => ({ ...prev, [dbId]: true }))
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'delivered' })
      .eq('id', dbId)
    if (error) {
      setServedItems((prev) => ({ ...prev, [dbId]: false }))
      toast.error('Error', 'Failed to mark item served: ' + error.message)
      return
    }
    // service_log is best-effort — requires RLS policy, fail silently if missing
    supabase
      .from('service_log')
      .insert({
        order_id: activeOrder.id,
        order_item_id: dbId,
        table_id: activeOrder.table_id,
        item_name: item.name,
        table_name: table?.name || null,
        served_by: profile?.id || null,
        served_by_name: profile?.full_name || null,
        served_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error && error.code !== 'PGRST301' && error.code !== '42501') {
          console.warn('service_log insert failed:', error.message)
        }
      })
  }

  const [orderItems, setOrderItems] = useState<OrderItemLocal[]>(() => {
    if (!activeOrder?.order_items) return []
    return activeOrder.order_items.map((i) => ({
      // Ensure an id even when menu_item_id is empty (e.g., takeaway packs)
      id: i.menu_item_id || i.id || crypto.randomUUID(),
      _dbId: i.id,
      status: i.status,
      name:
        i.menu_items?.name ||
        (i as unknown as { modifier_notes?: string }).modifier_notes ||
        i.menu_item_id ||
        'Custom Item',
      quantity: i.quantity,
      price: i.unit_price,
      total: i.total_price,
      menu_categories: i.menu_items?.menu_categories || null,
      modifier_notes: (i as unknown as { modifier_notes?: string }).modifier_notes || '',
      extra_charge: (i as unknown as { extra_charge?: number }).extra_charge || 0,
      _existing: true,
      menu_item_id: i.menu_item_id,
      unit_price: i.unit_price,
      total_price: i.total_price,
      order_id: activeOrder.id,
    }))
  })

  // Sync order items when activeOrder changes (e.g. realtime DB update, manager edit)
  useEffect(() => {
    if (!activeOrder?.order_items) return
    setOrderItems((prev) => {
      // Keep any new (unconfirmed) items the waitron is adding
      const newItems = prev.filter((i) => !i._existing)
      const dbItems = activeOrder.order_items!.map((i) => ({
        id: i.menu_item_id || i.id || crypto.randomUUID(),
        _dbId: i.id,
        status: i.status,
        name:
          i.menu_items?.name ||
          (i as unknown as { modifier_notes?: string }).modifier_notes ||
          i.menu_item_id ||
          'Custom Item',
        quantity: i.quantity,
        price: i.unit_price,
        total: i.total_price,
        menu_categories: i.menu_items?.menu_categories || null,
        modifier_notes: (i as unknown as { modifier_notes?: string }).modifier_notes || '',
        extra_charge: (i as unknown as { extra_charge?: number }).extra_charge || 0,
        _existing: true,
        _newId: undefined as string | undefined,
        unit_price: i.unit_price,
        total_price: i.total_price,
        order_id: activeOrder.id,
      }))
      return [...dbItems, ...newItems]
    })
  }, [activeOrder])

  const [activeCategory, setActiveCategory] = useState('All')
  const [menuSearch, setMenuSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [modifierItem, setModifierItem] = useState<OrderItemLocal | null>(null)
  const isSubmitting = useRef(false)
  const [modifierNotes, setModifierNotes] = useState('')
  const [modifierCharge, setModifierCharge] = useState('')

  // Takeaway packs for table orders
  const [packSizes, setPackSizes] = useState<{ id: string; name: string; price: number }[]>([])
  const [packQuantities, setPackQuantities] = useState<Record<string, number>>({})
  const [showPacks, setShowPacks] = useState(false)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'takeaway_pack_sizes')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          try {
            setPackSizes(JSON.parse(data.value))
          } catch {
            /* */
          }
        }
      })
  }, [])

  const packFee = packSizes.reduce((sum, p) => sum + (packQuantities[p.id] || 0) * p.price, 0)
  const packItems = packSizes
    .filter((p) => (packQuantities[p.id] || 0) > 0)
    .map((p) => ({ ...p, qty: packQuantities[p.id] }))

  // Clear packs when the section is hidden
  useEffect(() => {
    if (!showPacks && Object.keys(packQuantities).length > 0) {
      setPackQuantities({})
    }
  }, [showPacks, packQuantities])

  const categories = [
    'All',
    ...new Set(
      menuItems
        .map(
          (item) =>
            (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name
        )
        .filter(Boolean) as string[]
    ),
  ]
  const filteredMenu = menuItems
    .filter(
      (item) =>
        activeCategory === 'All' ||
        (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name ===
          activeCategory
    )
    .filter((item) => !menuSearch || item.name.toLowerCase().includes(menuSearch.toLowerCase()))

  const addItem = (item: MenuItem | OrderItemLocal) => {
    setOrderItems((prev) => {
      const newEntry = prev.find((i) => i.id === item.id && !i._existing)
      if (newEntry)
        return prev.map((i) =>
          i.id === item.id && !i._existing
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
            : i
        )
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: (item as MenuItem).price || (item as OrderItemLocal).price,
          quantity: 1,
          total: (item as MenuItem).price || (item as OrderItemLocal).price,
          menu_categories: (
            item as unknown as { menu_categories?: { name?: string; destination?: string } | null }
          ).menu_categories,
          _existing: false,
          _newId: crypto.randomUUID(),
          menu_item_id: item.id,
          unit_price: (item as MenuItem).price,
          total_price: (item as MenuItem).price,
          order_id: '',
        },
      ]
    })
  }

  // Register addItem with parent so desktop menu browser can call it
  const addItemRef = useRef(addItem)
  addItemRef.current = addItem
  useEffect(() => {
    if (compact && onRegisterAddItem) {
      onRegisterAddItem((item: MenuItem) => addItemRef.current(item))
    }
  }, [compact, onRegisterAddItem])

  const removeItem = (itemKey: string) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => (i._newId || i.id) === itemKey)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter((i) => (i._newId || i.id) !== itemKey)
      return prev.map((i) =>
        (i._newId || i.id) === itemKey
          ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price }
          : i
      )
    })
  }

  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set())

  const deleteItem = async (item: OrderItemLocal) => {
    // New (unconfirmed) items — remove from local state immediately
    if (!item._existing) {
      const itemKey = item._newId || item.id
      setOrderItems((prev) => prev.filter((i) => (i._newId || i.id) !== itemKey))
      return
    }

    // Confirmed items — waitrons cannot delete, must request manager approval
    const isManagerRole = profile && ['owner', 'manager'].includes(profile.role)
    const dbId = item._dbId || dbIdMap[item.id]
    if (!dbId) return

    if (isManagerRole) {
      // Managers can delete directly
      const { error } = await supabase.from('order_items').delete().eq('id', dbId)
      if (error) {
        toast.error('Error', 'Failed to delete item: ' + error.message)
        return
      }
      const { data: remaining } = await supabase
        .from('order_items')
        .select('total_price')
        .eq('order_id', activeOrder?.id || '')
      const newTotal = (remaining || []).reduce(
        (sum: number, r: { total_price: number }) => sum + (r.total_price || 0),
        0
      )
      await supabase
        .from('orders')
        .update({ total_amount: newTotal })
        .eq('id', activeOrder?.id || '')
      setOrderItems((prev) => prev.filter((i) => i._dbId !== dbId))
      return
    }

    // Waitron — send deletion request to manager
    if (pendingDeletes.has(dbId)) {
      toast.warning('Already requested', 'Waiting for manager/bar approval')
      return
    }

    // For bar items: also mark as return_requested so barman sees it on KDS + notify bar staff
    const itemDest = item.menu_categories?.destination || 'bar'
    if (itemDest === 'bar') {
      await supabase
        .from('order_items')
        .update({
          return_requested: true,
          return_reason: 'Deleted by waitron',
          return_requested_at: new Date().toISOString(),
        })
        .eq('id', dbId)
      await supabase.from('returns_log').delete().eq('order_item_id', dbId).eq('status', 'pending')
      // Log to returns_log
      await supabase.from('returns_log').insert({
        order_id: activeOrder?.id,
        order_item_id: dbId,
        item_name: item.name,
        quantity: item.quantity,
        item_total: item.total,
        table_name: table?.name ?? null,
        waitron_id: profile?.id ?? null,
        waitron_name: profile?.full_name ?? null,
        return_reason: 'Deleted by waitron',
        status: 'pending',
        requested_at: new Date().toISOString(),
      })
      // Notify all bar staff
      const { data: barStaff } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'bar')
        .eq('is_active', true)
      if (barStaff) {
        for (const staff of barStaff) {
          sendPushToStaff(
            staff.id,
            '↩ Return Requested',
            `${item.quantity}x ${item.name} — ${table?.name || 'Table'} — Deleted by ${profile?.full_name || 'waitron'}`
          ).catch(() => {})
        }
      }
      setPendingDeletes((prev) => new Set(prev).add(dbId))
      toast.success('Return Sent to Bar', `${item.name} — bar will review`)
      await audit({
        action: 'ITEM_DELETE_REQUESTED',
        entity: 'order_item',
        entityId: dbId,
        entityName: item.name,
        newValue: {
          order_id: activeOrder?.id,
          table: table?.name,
          quantity: item.quantity,
          total: item.total,
          sentToBar: true,
        },
        performer: profile as Profile,
      })
      return
    }

    // Kitchen and griller items cannot be returned — orders are final once accepted
    if (itemDest === 'kitchen' || itemDest === 'griller') {
      toast.error('Cannot Return', 'Kitchen and grill orders cannot be returned once accepted.')
      return
    }

    // Non-bar items (mixologist etc): mark return_requested and send to manager
    await supabase
      .from('order_items')
      .update({
        return_requested: true,
        return_reason: 'Deleted by waitron',
        return_requested_at: new Date().toISOString(),
      })
      .eq('id', dbId)

    // Send deletion request to manager via settings
    // Load existing requests, add this one, save
    const { data: settingsRow } = await supabase
      .from('settings')
      .select('value')
      .eq('id', 'pending_delete_requests')
      .single()
    const existing: Array<Record<string, unknown>> = settingsRow?.value
      ? JSON.parse(settingsRow.value)
      : []
    existing.push({
      id: crypto.randomUUID(),
      order_id: activeOrder?.id,
      order_item_id: dbId,
      item_name: item.name,
      quantity: item.quantity,
      item_total: item.total,
      table_name: table?.name || '',
      waitron_id: profile?.id,
      waitron_name: profile?.full_name,
      requested_at: new Date().toISOString(),
    })
    await supabase.from('settings').upsert(
      {
        id: 'pending_delete_requests',
        value: JSON.stringify(existing),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )

    // Mirror into returns_log so management returns tab sees non-bar returns
    await supabase.from('returns_log').delete().eq('order_item_id', dbId).eq('status', 'pending')
    await supabase.from('returns_log').insert({
      order_id: activeOrder?.id,
      order_item_id: dbId,
      item_name: item.name,
      quantity: item.quantity,
      item_total: item.total,
      table_name: table?.name || '',
      waitron_id: profile?.id,
      waitron_name: profile?.full_name,
      return_reason: 'Deleted by waitron',
      status: 'pending',
      requested_at: new Date().toISOString(),
    })

    setPendingDeletes((prev) => new Set(prev).add(dbId))
    toast.success('Delete Requested', `Manager will review removal of ${item.name}`)
    await audit({
      action: 'ITEM_DELETE_REQUESTED',
      entity: 'order_item',
      entityId: dbId,
      entityName: item.name,
      newValue: {
        order_id: activeOrder?.id,
        table: table?.name,
        quantity: item.quantity,
        total: item.total,
      },
      performer: profile as Profile,
    })
  }

  const openModifier = (item: OrderItemLocal) => {
    setModifierItem(item)
    setModifierNotes(item.modifier_notes || '')
    setModifierCharge(item.extra_charge ? String(item.extra_charge) : '')
  }

  const saveModifier = () => {
    const charge = parseFloat(modifierCharge) || 0
    setOrderItems((prev) =>
      prev.map((i) =>
        i.id === modifierItem!.id
          ? {
              ...i,
              modifier_notes: modifierNotes,
              extra_charge: charge,
              total: i.quantity * i.price + charge,
            }
          : i
      )
    )
    setModifierItem(null)
    setModifierNotes('')
    setModifierCharge('')
  }

  const itemsTotal = orderItems.reduce(
    (sum, item) => sum + item.quantity * item.price + (item.extra_charge || 0),
    0
  )
  const total = itemsTotal + packFee

  const handlePlaceOrder = async () => {
    if (isSubmitting.current) return
    isSubmitting.current = true
    try {
      const hasPacks = packItems.reduce((s, p) => s + (p.qty || 0), 0) > 0
      const packOnly = orderItems.length === 0 && hasPacks
      if (orderItems.length === 0 && !packOnly) return
      const newItems = orderItems.filter((i) => !i._existing)
      if (newItems.length === 0 && activeOrder && !hasPacks) {
        await onPlaceOrder({ table, items: [], notes, total: 0 })
        return
      }
      const newTotal = newItems.reduce((sum, i) => sum + (i.total || 0), 0) + packFee
      // Add pack items as order items
      const allItems = [
        ...newItems,
        ...packItems.map((p) => ({
          id: `takeaway_pack:${p.id}`,
          name: `Takeaway Pack — ${p.name}`,
          price: p.price,
          quantity: p.qty,
          total: p.qty * p.price,
          menu_categories: null,
          modifier_notes: `Takeaway Pack — ${p.name}`,
          destination: 'kitchen', // ensure it shows on kitchen KDS/prints
          _existing: false,
          _newId: `takeaway_pack:${p.id}:${crypto.randomUUID()}`,
          // Preserve explicit null to satisfy menu_item_id null paths
          menu_item_id: null,
          unit_price: p.price,
          total_price: p.qty * p.price,
          order_id: '',
        })),
      ]
      await onPlaceOrder({ table, items: allItems as typeof newItems, notes, total: newTotal })
      // Reset pack selections after a successful submit to avoid duplicate adds
      setPackQuantities({})
      setShowPacks(false)
    } finally {
      isSubmitting.current = false
    }
  }

  return (
    <>
      <div className="flex flex-col h-full bg-gray-900">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-bold">{table.name}</h2>
            <p className="text-gray-400 text-xs">
              {
                (table as unknown as { table_categories?: { name?: string } }).table_categories
                  ?.name
              }
            </p>
            {(() => {
              const hireFee = (
                table as unknown as { table_categories?: { hire_fee?: number | null } }
              ).table_categories?.hire_fee
              return hireFee ? (
                <p className="text-amber-400 text-xs font-semibold mt-0.5">
                  🏷 Hire fee: ₦{hireFee.toLocaleString()} — add to bill manually
                </p>
              ) : null
            })()}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {!compact && (
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-gray-800 shrink-0">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {!compact && (
          <div className="flex px-3 pt-2 pb-0 shrink-0">
            <div className="flex items-center gap-2 flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-amber-500 transition-colors">
              <Search size={14} className="text-gray-500 shrink-0" />
              <input
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Search menu…"
                className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
              />
              {menuSearch && (
                <button
                  onClick={() => setMenuSearch('')}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Zone 1: On-table items (existing) ── */}
        {orderItems.some((i) => i._existing) && (
          <div className="border-b border-gray-800 bg-gray-950 px-3 pt-1 pb-1 max-h-36 overflow-y-auto space-y-0.5 shrink-0">
            <p className="text-gray-600 text-[10px] uppercase tracking-widest mb-0.5">On Table</p>
            {orderItems
              .filter((i) => i._existing)
              .map((item) => {
                const dbId = item._dbId || dbIdMap[item.id]
                return (
                  <div
                    key={item._dbId || item._newId || item.id}
                    className="flex items-center gap-2 py-0.5"
                  >
                    <span className="text-gray-500 text-xs w-5 text-center shrink-0">
                      {item.quantity}×
                    </span>
                    <span className="flex-1 text-gray-400 text-sm truncate">{item.name}</span>
                    <span className="text-gray-500 text-xs shrink-0">₦{item.total.toFixed(0)}</span>
                    <button
                      onClick={() => {
                        if (dbId && !servedItems[dbId]) markServed(item)
                      }}
                      className={`transition-colors shrink-0 ${dbId && servedItems[dbId] ? 'text-green-400' : 'text-gray-600 hover:text-green-400'}`}
                      title={dbId && servedItems[dbId] ? 'Served' : 'Mark as served'}
                    >
                      {dbId && servedItems[dbId] ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <Circle size={14} />
                      )}
                    </button>
                    {pendingDeletes.has(dbId || '') ? (
                      <span className="text-amber-400 shrink-0" title="Awaiting manager approval">
                        <Clock size={12} />
                      </span>
                    ) : (
                      <button
                        onClick={() => deleteItem(item)}
                        className="text-red-400 hover:text-red-300 shrink-0"
                        title="Request removal"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* ── Zone 2: New items being added ── */}
        {orderItems.some((i) => !i._existing) && (
          <div className="border-b border-amber-500/20 bg-gray-900 px-3 pt-1 pb-1 max-h-40 overflow-y-auto space-y-0.5 shrink-0">
            <p className="text-amber-500/60 text-[10px] uppercase tracking-widest mb-0.5">Adding</p>
            {orderItems
              .filter((i) => !i._existing)
              .map((item) => (
                <div key={item._newId || item.id} className="flex items-center gap-1.5 py-0.5">
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => removeItem(item._newId || item.id)}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white bg-gray-700 hover:bg-gray-600"
                    >
                      <Minus size={9} />
                    </button>
                    <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => addItem(item)}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white bg-gray-700 hover:bg-gray-600"
                    >
                      <Plus size={9} />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => openModifier(item)} className="text-left w-full">
                      <p className="text-sm text-amber-100 truncate">{item.name}</p>
                      {item.modifier_notes && (
                        <p className="text-amber-400 text-xs truncate">{item.modifier_notes}</p>
                      )}
                    </button>
                  </div>
                  <span className="text-amber-400 text-sm shrink-0">₦{item.total.toFixed(0)}</span>
                  <button
                    onClick={() => deleteItem(item)}
                    className="text-red-400 hover:text-red-300 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* ── Zone 3: Menu grid (hidden in compact mode) ── */}
        <div className={`flex-1 overflow-y-auto ${compact ? 'hidden' : ''}`}>
          <div className="p-3">
            {filteredMenu.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No menu items yet</p>
                <p className="text-xs mt-1">Add items in the Back Office</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredMenu.map((item) => {
                  return (
                    <button
                      key={item.id}
                      onClick={() => addItem(item)}
                      className="rounded-xl p-3 text-left transition-colors border bg-gray-800 hover:bg-gray-700 border-gray-700 hover:border-amber-500/50"
                    >
                      <p className="text-white text-sm font-medium">{item.name}</p>
                      <p className="text-amber-400 text-sm font-bold mt-1">
                        ₦{item.price.toFixed(2)}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="px-3 pb-3">
            <input
              type="text"
              placeholder="Order notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Takeaway packs for table orders */}
        {packSizes.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-800 bg-gray-900 shrink-0">
            <button
              onClick={() => setShowPacks(!showPacks)}
              className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 text-xs font-medium mb-1"
            >
              <ShoppingBag size={12} /> {showPacks ? 'Hide' : 'Add'} Takeaway Packs
              {packFee > 0 && (
                <span className="text-amber-400/60 ml-1">(₦{packFee.toLocaleString()})</span>
              )}
            </button>
            {showPacks && (
              <div className="space-y-1">
                {packSizes.map((pack) => {
                  const qty = packQuantities[pack.id] || 0
                  return (
                    <div key={pack.id} className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setPackQuantities((p) => ({
                            ...p,
                            [pack.id]: Math.max(0, (p[pack.id] || 0) - 1),
                          }))
                        }
                        disabled={qty === 0}
                        className="w-5 h-5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 flex items-center justify-center text-white text-[10px]"
                      >
                        -
                      </button>
                      <span
                        className={`text-xs w-4 text-center ${qty > 0 ? 'text-white font-bold' : 'text-gray-600'}`}
                      >
                        {qty}
                      </span>
                      <button
                        onClick={() =>
                          setPackQuantities((p) => ({ ...p, [pack.id]: (p[pack.id] || 0) + 1 }))
                        }
                        className="w-5 h-5 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white text-[10px]"
                      >
                        +
                      </button>
                      <span
                        className={`text-xs flex-1 ${qty > 0 ? 'text-white' : 'text-gray-500'}`}
                      >
                        {pack.name}
                      </span>
                      <span className={`text-xs ${qty > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                        ₦{pack.price.toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="p-3 border-t border-gray-800 bg-gray-900 shrink-0">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400">Total</span>
            <span className="text-white font-bold text-lg">₦{total.toFixed(2)}</span>
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={orderItems.length === 0 || isSubmitting.current}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
          >
            <Send size={16} /> Confirm Order
          </button>
        </div>
      </div>

      {modifierItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-end justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">Modify Item</h3>
              <button
                onClick={() => setModifierItem(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-amber-400 font-medium">{modifierItem.name}</p>
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Special Instructions
              </label>
              <textarea
                value={modifierNotes}
                onChange={(e) => setModifierNotes(e.target.value)}
                placeholder="e.g. no onions, well done, extra spicy..."
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Extra Charge (₦)
              </label>
              <input
                type="number"
                value={modifierCharge}
                onChange={(e) => setModifierCharge(e.target.value)}
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-gray-500 text-xs mt-1">Leave blank if no extra charge</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setModifierItem(null)}
                className="py-3 rounded-xl bg-gray-800 text-gray-300 hover:bg-gray-700 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveModifier}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
