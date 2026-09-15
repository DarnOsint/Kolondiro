import { useState, useEffect } from 'react'
import { X, Plus, Minus, Trash2, Search, Save, Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { audit } from '../../../lib/audit'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import type { Profile } from '../../../types'

interface OrderItem {
  id: string
  menu_item_id: string
  quantity: number
  unit_price: number
  total_price: number
  status: string
  destination: string
  modifier_notes?: string | null
  menu_items?: {
    name: string
    menu_categories?: { name?: string; destination?: string } | null
  } | null
}

interface MenuItem {
  id: string
  name: string
  price: number
  menu_categories?: { name?: string; destination?: string } | null
}

interface Order {
  id: string
  total_amount?: number
  table_id?: string
  tables?: { name: string } | null
  profiles?: { full_name: string } | null
  order_items?: OrderItem[]
}

interface Props {
  order: Order
  onClose: () => void
  onSaved: () => void
}

export default function EditOrderModal({ order, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<OrderItem[]>(order.order_items || [])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [menuSearch, setMenuSearch] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [addedItems, setAddedItems] = useState<
    Array<{ tempId: string; menuItem: MenuItem; quantity: number }>
  >([])

  useEffect(() => {
    supabase
      .from('menu_items')
      .select('id, name, price, menu_categories(name, destination)')
      .eq('is_available', true)
      .order('name')
      .then(({ data }) => {
        if (data) setMenuItems(data as MenuItem[])
      })
  }, [])

  const filteredMenu = menuItems.filter(
    (m) => !menuSearch || m.name.toLowerCase().includes(menuSearch.toLowerCase())
  )

  const removeExistingItem = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    setRemovedIds((prev) => [...prev, itemId])
  }

  const addMenuItem = (mi: MenuItem) => {
    const existing = addedItems.find((a) => a.menuItem.id === mi.id)
    if (existing) {
      setAddedItems((prev) =>
        prev.map((a) => (a.menuItem.id === mi.id ? { ...a, quantity: a.quantity + 1 } : a))
      )
    } else {
      setAddedItems((prev) => [...prev, { tempId: crypto.randomUUID(), menuItem: mi, quantity: 1 }])
    }
  }

  const removeAddedItem = (tempId: string) => {
    setAddedItems((prev) => {
      const item = prev.find((a) => a.tempId === tempId)
      if (!item) return prev
      if (item.quantity === 1) return prev.filter((a) => a.tempId !== tempId)
      return prev.map((a) => (a.tempId === tempId ? { ...a, quantity: a.quantity - 1 } : a))
    })
  }

  const deleteAddedItem = (tempId: string) => {
    setAddedItems((prev) => prev.filter((a) => a.tempId !== tempId))
  }

  // Calculate new total
  const existingTotal = items.reduce((s, i) => s + (i.total_price || 0), 0)
  const addedTotal = addedItems.reduce((s, a) => s + a.menuItem.price * a.quantity, 0)
  const newTotal = existingTotal + addedTotal

  // Detect total mismatch — stored total doesn't match actual items
  const storedTotal = order.total_amount || 0
  const actualItemsTotal = (order.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
  const hasTotalMismatch = Math.abs(storedTotal - actualItemsTotal) > 1

  const handleSave = async () => {
    setSaving(true)
    try {
      const changes: string[] = []

      // Delete removed items
      for (const id of removedIds) {
        const removed = (order.order_items || []).find((i) => i.id === id)
        await supabase.from('order_items').delete().eq('id', id)
        if (removed) {
          changes.push(`Removed ${removed.quantity}x ${removed.menu_items?.name || 'item'}`)
        }
      }

      // Note total correction if mismatch
      if (hasTotalMismatch && removedIds.length === 0 && addedItems.length === 0) {
        changes.push(
          `Total corrected from ₦${storedTotal.toLocaleString()} to ₦${actualItemsTotal.toLocaleString()}`
        )
      }

      // Insert new items
      for (const added of addedItems) {
        await supabase.from('order_items').insert({
          id: crypto.randomUUID(),
          order_id: order.id,
          menu_item_id: added.menuItem.id,
          quantity: added.quantity,
          unit_price: added.menuItem.price,
          total_price: added.menuItem.price * added.quantity,
          status: 'pending',
          destination: added.menuItem.menu_categories?.destination || 'bar',
          created_at: new Date().toISOString(),
        })
        changes.push(`Added ${added.quantity}x ${added.menuItem.name}`)
      }

      // Recalculate total from DB
      const { data: remaining } = await supabase
        .from('order_items')
        .select('total_price')
        .eq('order_id', order.id)
      const correctTotal = (remaining || []).reduce(
        (s: number, r: { total_price: number }) => s + (r.total_price || 0),
        0
      )
      await supabase
        .from('orders')
        .update({ total_amount: correctTotal, updated_at: new Date().toISOString() })
        .eq('id', order.id)

      // Audit
      if (changes.length > 0) {
        await audit({
          action: 'ORDER_MODIFIED_BY_MANAGER',
          entity: 'order',
          entityId: order.id,
          entityName: order.tables?.name || 'Order',
          oldValue: { total: order.total_amount },
          newValue: { total: correctTotal, changes },
          performer: profile as Profile,
        })
      }

      toast.success('Order Updated', changes.join(', '))
      onSaved()
    } catch (e) {
      toast.error('Failed', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = removedIds.length > 0 || addedItems.length > 0 || hasTotalMismatch

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
          <div>
            <h3 className="text-white font-bold">Edit Order</h3>
            <p className="text-gray-400 text-xs">
              {order.tables?.name || 'Order'} — {order.profiles?.full_name || 'Staff'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Total mismatch warning */}
          {hasTotalMismatch && (
            <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <p className="text-red-400 text-sm font-bold mb-1">Total Mismatch Detected</p>
              <p className="text-red-400/80 text-xs">
                Stored total is ₦{storedTotal.toLocaleString()} but items only add up to ₦
                {actualItemsTotal.toLocaleString()}. This usually means items were deleted but the
                total wasn't updated. Click Save to fix.
              </p>
            </div>
          )}

          {/* Current items */}
          <div className="p-4">
            <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-2">Current Items</p>
            {items.length === 0 && removedIds.length > 0 ? (
              <p className="text-gray-600 text-sm py-4 text-center">All items removed</p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-white text-sm font-medium truncate">
                        {item.menu_items?.name ||
                          (item as unknown as { modifier_notes?: string }).modifier_notes ||
                          'Item'}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {item.quantity}x ₦{item.unit_price?.toLocaleString()} = ₦
                        {item.total_price?.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          item.status === 'delivered'
                            ? 'bg-green-500/20 text-green-400'
                            : item.status === 'ready'
                              ? 'bg-blue-500/20 text-blue-400'
                              : item.status === 'preparing'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-gray-700 text-gray-400'
                        }`}
                      >
                        {item.status}
                      </span>
                      <button
                        onClick={() => removeExistingItem(item.id)}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Added items */}
          {addedItems.length > 0 && (
            <div className="px-4 pb-3">
              <p className="text-amber-500/60 text-[10px] uppercase tracking-wider mb-2">Adding</p>
              <div className="space-y-2">
                {addedItems.map((added) => (
                  <div
                    key={added.tempId}
                    className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-amber-100 text-sm font-medium truncate">
                        {added.menuItem.name}
                      </p>
                      <p className="text-amber-400/60 text-xs">
                        ₦{added.menuItem.price.toLocaleString()} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => removeAddedItem(added.tempId)}
                        className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-white text-sm font-bold w-5 text-center">
                        {added.quantity}
                      </span>
                      <button
                        onClick={() => addMenuItem(added.menuItem)}
                        className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="text-amber-400 text-sm font-bold ml-1">
                        ₦{(added.menuItem.price * added.quantity).toLocaleString()}
                      </span>
                      <button
                        onClick={() => deleteAddedItem(added.tempId)}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add items section */}
          <div className="px-4 pb-4">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 text-amber-400 hover:text-amber-300 text-sm font-medium mb-2 transition-colors"
            >
              <Plus size={14} /> {showMenu ? 'Hide Menu' : 'Add Items from Menu'}
            </button>
            {showMenu && (
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="p-2 border-b border-gray-700">
                  <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-1.5">
                    <Search size={12} className="text-gray-500" />
                    <input
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      placeholder="Search menu..."
                      className="flex-1 bg-transparent text-white text-xs placeholder-gray-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredMenu.map((mi) => (
                    <button
                      key={mi.id}
                      onClick={() => addMenuItem(mi)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition-colors text-left"
                    >
                      <span className="text-gray-300 text-xs">{mi.name}</span>
                      <span className="text-amber-400 text-xs font-bold shrink-0 ml-2">
                        ₦{mi.price.toLocaleString()}
                      </span>
                    </button>
                  ))}
                  {filteredMenu.length === 0 && (
                    <p className="text-gray-600 text-xs text-center py-4">No items found</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — total + save */}
        <div className="p-4 border-t border-gray-800 shrink-0 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-gray-500 text-xs">Original Total</p>
              <p className="text-gray-400 text-sm">₦{order.total_amount?.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-500 text-xs">New Total</p>
              <p
                className={`text-lg font-bold ${newTotal !== order.total_amount ? 'text-amber-400' : 'text-white'}`}
              >
                ₦{newTotal.toLocaleString()}
              </p>
            </div>
          </div>
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-3 text-sm transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
