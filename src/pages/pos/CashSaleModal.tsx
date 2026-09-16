import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { offlineInsert } from '../../lib/offlineWrite'
import { useAuth } from '../../context/AuthContext'
import { audit } from '../../lib/audit'
import {
  X,
  Plus,
  Minus,
  Trash2,
  Search,
  CheckCircle,
  Banknote,
  CreditCard,
  Smartphone,
  ShoppingBag,
  Phone,
  Printer,
  Clock,
} from 'lucide-react'
import type { MenuItem, ItemDestination } from '../../types'
import { useToast } from '../../context/ToastContext'

interface OrderItemLocal {
  id: string
  name: string
  price: number
  quantity: number
  total: number
  menu_categories?: { name?: string; destination?: string } | null
}

interface CompletedOrder {
  order: { id: string }
  items: OrderItemLocal[]
  total: number
  change: number
  customerName: string
  paymentMethod: string
}

interface Props {
  type: 'cash' | 'takeaway'
  menuItems: MenuItem[]
  staffId: string
  onSuccess: () => void
  onClose: () => void
}

const normalizeDestination = (dest?: string | null, name?: string): ItemDestination => {
  const lowerName = (name || '').toLowerCase()
  if (
    lowerName.includes('cocktail') ||
    lowerName.includes('mocktail') ||
    lowerName.includes('chapman') ||
    lowerName.includes('sunrise') ||
    lowerName.includes('colada') ||
    lowerName.includes('mojito') ||
    lowerName.includes('milkshake') ||
    lowerName.includes('shake') ||
    lowerName.includes('smoothie') ||
    lowerName.includes('fruit punch') ||
    lowerName.includes('punch')
  )
    return 'mixologist'

  const d = (dest || '').trim().toLowerCase()
  if (d === 'kitchen') return 'kitchen'
  if (d === 'griller' || d === 'grill' || d === 'grilling') return 'griller'
  if (d === 'shisha' || d === 'hookah') return 'shisha'
  if (d === 'games' || d === 'game' || d === 'games_master') return 'games'
  if (d === 'mixologist' || d === 'cocktail' || d === 'cocktails') return 'mixologist'
  if (d === 'bar') return 'bar'
  return 'bar'
}

export default function CashSaleModal({ type, menuItems, staffId, onSuccess, onClose }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [orderItems, setOrderItems] = useState<OrderItemLocal[]>([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'credit'>(
    'cash'
  )
  const [cashTendered, setCashTendered] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null)
  const [notes, setNotes] = useState('')
  const [activeTab, setActiveTab] = useState<'menu' | 'order'>('menu')
  const [packSizes, setPackSizes] = useState<{ id: string; name: string; price: number }[]>([])
  const [packQuantities, setPackQuantities] = useState<Record<string, number>>({})
  const [waitingForBar, setWaitingForBar] = useState(false)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)

  const isTakeaway = type === 'takeaway'

  // Load takeaway pack sizes
  useEffect(() => {
    if (!isTakeaway) return
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'takeaway_pack_sizes')
      .single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            const sizes = JSON.parse(data.value) as { id: string; name: string; price: number }[]
            setPackSizes(sizes)
          } catch {
            /* invalid */
          }
        }
      })
  }, [isTakeaway])

  const categories = [
    'All',
    ...new Set(
      menuItems
        .map((i) => (i as unknown as { menu_categories?: { name?: string } }).menu_categories?.name)
        .filter(Boolean) as string[]
    ),
  ]

  const filtered = menuItems.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat =
      activeCategory === 'All' ||
      (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name ===
        activeCategory
    return matchSearch && matchCat
  })

  const addItem = (item: MenuItem) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.id === item.id)
      if (existing)
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
            : i
        )
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          total: item.price,
          menu_categories: (
            item as unknown as { menu_categories?: { name?: string; destination?: string } }
          ).menu_categories,
        },
      ]
    })
  }

  const removeItem = (itemId: string) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.id === itemId)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter((i) => i.id !== itemId)
      return prev.map((i) =>
        i.id === itemId ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price } : i
      )
    })
  }

  const packFee = isTakeaway
    ? packSizes.reduce((sum, p) => sum + (packQuantities[p.id] || 0) * p.price, 0)
    : 0
  const packItems = packSizes
    .filter((p) => (packQuantities[p.id] || 0) > 0)
    .map((p) => ({ ...p, qty: packQuantities[p.id] }))
  const itemsTotal = orderItems.reduce((sum, i) => sum + i.total, 0)
  const total = itemsTotal + packFee
  const change = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0

  // Finalize order after barman approves (or immediately if no bar items)
  const finalizeOrder = useCallback(
    async (orderId: string) => {
      const isCredit = paymentMethod === 'credit'
      await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: paymentMethod,
          closed_at: new Date().toISOString(),
        })
        .eq('id', orderId)
      // Do not auto-deliver station items on payment. Stations manage acceptance/ready.

      if (isCredit) {
        const { data: existingDebtors } = await (customerPhone
          ? supabase
              .from('debtors')
              .select('id, current_balance')
              .eq('phone', customerPhone)
              .eq('is_active', true)
              .limit(1)
          : supabase
              .from('debtors')
              .select('id, current_balance')
              .ilike('name', customerName)
              .eq('is_active', true)
              .limit(1))
        const existing = existingDebtors?.[0] as { id: string; current_balance: number } | undefined
        if (existing) {
          await supabase
            .from('debtors')
            .update({
              current_balance: existing.current_balance + total,
              status: 'outstanding',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
        } else {
          await supabase.from('debtors').insert({
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            name: customerName,
            phone: customerPhone || null,
            debt_type: isTakeaway ? 'takeaway' : 'cash_sale',
            order_id: orderId,
            credit_limit: total,
            current_balance: total,
            amount_paid: 0,
            status: 'outstanding',
            is_active: true,
            notes: `Auto-created from POS — ${isTakeaway ? 'Takeaway' : 'Cash Sale'}`,
            recorded_by: profile?.id,
            recorded_by_name: profile?.full_name,
          })
        }
      }
      await audit({
        action: 'ORDER_CREATED',
        entity: 'order',
        entityId: orderId,
        entityName: type === 'takeaway' ? `Takeaway — ${customerName}` : 'Cash Sale',
        newValue: { total, items: orderItems.length, type, paymentMethod },
        performer: profile,
      })
      setCompletedOrder({
        order: { id: orderId },
        items: orderItems,
        total,
        change,
        customerName,
        paymentMethod,
      })
      setWaitingForBar(false)
      setPendingOrderId(null)
      setSuccess(true)
    },
    [
      paymentMethod,
      customerPhone,
      customerName,
      total,
      isTakeaway,
      profile,
      type,
      orderItems,
      change,
    ]
  )

  // Poll for barman approval when waiting
  useEffect(() => {
    if (!waitingForBar || !pendingOrderId) return
    const checkBarReady = async () => {
      const { data } = await supabase
        .from('order_items')
        .select('id, status')
        .eq('order_id', pendingOrderId)
        .eq('destination', 'bar')
        .in('status', ['pending', 'preparing'])
      if (!data || data.length === 0) {
        await finalizeOrder(pendingOrderId)
      }
    }
    checkBarReady()
    const poll = setInterval(checkBarReady, 3000)
    const channel = supabase
      .channel('cashsale-bar-' + pendingOrderId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' }, () => {
        void checkBarReady()
      })
      .subscribe()
    return () => {
      clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [waitingForBar, pendingOrderId, finalizeOrder])

  const canPay = () => {
    if (processing) return false
    if (isTakeaway && !customerName) return false
    if (paymentMethod === 'credit' && !customerName) return false
    if (paymentMethod === 'cash') return parseFloat(cashTendered) >= total
    return true
  }

  const processOrder = async () => {
    if (orderItems.length === 0) return toast.warning('Required', 'Add at least one item')
    if (isTakeaway && !customerName)
      return toast.warning('Required', 'Customer name is required for takeaway')
    if (paymentMethod === 'credit' && !customerName)
      return toast.warning('Required', 'Customer name is required for credit')
    setProcessing(true)
    try {
      const hasBarItems = orderItems.some((i) => {
        const dest = normalizeDestination(
          i.menu_categories?.destination || 'bar',
          (i as any).menu_items?.name
        )
        if (dest === 'shisha') return false
        return dest === 'bar'
      })
      const orderId = crypto.randomUUID()
      // If order has bar items, create as 'open' so barman must approve first
      const { data: order, error: orderError } = await offlineInsert('orders', {
        id: orderId,
        staff_id: staffId,
        order_type: type,
        status: hasBarItems ? 'open' : 'paid',
        payment_method: hasBarItems ? null : paymentMethod,
        total_amount: total,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        notes,
        closed_at: hasBarItems ? null : new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      if (orderError) throw orderError
      const itemRows = orderItems.map((item) => ({
        id: crypto.randomUUID(),
        order_id: (order as { id: string }).id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.total,
        status: 'pending',
        destination: (normalizeDestination as any)(
          item.menu_categories?.destination || 'bar',
          item.name,
          item.menu_categories?.name
        ),
        created_at: new Date().toISOString(),
      }))
      // Add takeaway pack fees as line items
      for (const pack of packItems) {
        itemRows.push({
          id: crypto.randomUUID(),
          order_id: (order as { id: string }).id,
          menu_item_id: null as unknown as string,
          quantity: pack.qty,
          unit_price: pack.price,
          total_price: pack.qty * pack.price,
          status: 'delivered',
          destination: 'kitchen',
          modifier_notes: `Takeaway Pack — ${pack.name}`,
          created_at: new Date().toISOString(),
        } as (typeof itemRows)[0])
      }
      for (const item of itemRows) {
        const { error } = await offlineInsert('order_items', item)
        if (error) throw error
      }

      if (hasBarItems) {
        // Wait for barman to mark all bar items ready before finalizing payment
        setPendingOrderId((order as { id: string }).id)
        setWaitingForBar(true)
        setProcessing(false)
        toast.success('Order Sent to Bar', 'Waiting for barman to confirm drinks...')
      } else {
        // No bar items — finalize immediately
        await finalizeOrder((order as { id: string }).id)
        setProcessing(false)
      }
    } catch (err) {
      toast.error('Error', 'Error processing order: ' + (err as Error).message)
      setProcessing(false)
    }
  }

  const printCashReceipt = () => {
    if (!completedOrder) return
    const o = completedOrder
    const W = 32
    const fmtRow = (left: string, right: string) => {
      const l = left.substring(0, W - right.length - 1)
      const spaces = W - l.length - right.length
      return l + ' '.repeat(Math.max(1, spaces)) + right
    }
    const divider = '-'.repeat(W)
    const solidDivider = '='.repeat(W)
    const centre = (str: string) => {
      const pad = Math.max(0, Math.floor((W - str.length) / 2))
      return ' '.repeat(pad) + str
    }
    const fmtDate = new Date().toLocaleDateString('en-SS', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const fmtTime = new Date().toLocaleTimeString('en-SS', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    const pmLabel =
      o.paymentMethod === 'cash'
        ? 'CASH'
        : o.paymentMethod === 'card'
          ? 'BANK POS'
          : o.paymentMethod === 'transfer'
            ? 'TRANSFER'
            : o.paymentMethod.toUpperCase()
    const orderRef = `BSP-${o.order.id.slice(0, 8).toUpperCase()}`

    // Group items by name
    const grouped = new Map<string, { qty: number; total: number }>()
    o.items.forEach((i) => {
      const existing = grouped.get(i.name)
      if (existing) {
        existing.qty += i.quantity
        existing.total += i.total || i.price * i.quantity
      } else grouped.set(i.name, { qty: i.quantity, total: i.total || i.price * i.quantity })
    })
    const itemLines = Array.from(grouped.entries())
      .map(([name, { qty, total }]) => fmtRow(`${qty}x ${name}`, `N${total.toLocaleString()}`))
      .join('\n')

    const packLines = packItems
      .map((p) => fmtRow(`${p.qty}x Pack (${p.name})`, `N${(p.qty * p.price).toLocaleString()}`))
      .join('\n')
    const packLine = packLines ? '\n' + packLines : ''

    const fmtTotal = `N${o.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    const lines = [
      '',
      centre("KOLONDIRO"),
      centre('Lounge & Restaurant'),
      divider,
      fmtRow('Ref:', orderRef),
      fmtRow('Customer:', isTakeaway ? (o.customerName || 'Walk-in').substring(0, 20) : 'Counter'),
      fmtRow('Date:', fmtDate),
      fmtRow('Time:', fmtTime),
      fmtRow('Served by:', (profile?.full_name || 'Staff').substring(0, 20)),
      fmtRow('Payment:', pmLabel),
      fmtRow('Type:', isTakeaway ? 'TAKEAWAY' : 'CASH SALE'),
      divider,
      fmtRow('ITEM', 'AMOUNT'),
      divider,
      itemLines + packLine,
      solidDivider,
      fmtRow('TOTAL:', fmtTotal),
      ...(o.paymentMethod === 'cash' && o.change > 0
        ? [
            fmtRow(
              'Tendered:',
              `N${(o.total + o.change).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ),
            fmtRow(
              'Change:',
              `N${o.change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ),
          ]
        : []),
      solidDivider,
      '',
      centre('** PAYMENT CONFIRMED **'),
      '',
      centre('Thank you for visiting'),
      centre("Kolondiro!"),
      '',
    ].join('\n')

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Receipt - ${orderRef}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: auto; }
body { font-family: 'Courier New', Courier, monospace; font-size: 14px; font-weight: bold; color: #000; background: #fff; width: 62mm; margin: 0 auto; padding: 2mm 3mm; white-space: pre; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { body { width: 62mm; overflow: hidden; } html, body { height: auto; } * { break-inside: avoid; } @page { margin: 0; size: 80mm auto; } }
</style></head><body>${lines}</body></html>`

    const win = window.open(
      '',
      '_blank',
      'width=500,height=700,toolbar=no,menubar=no,scrollbars=no'
    )
    if (!win) return
    win.document.open('text/html', 'replace')
    win.document.write(html)
    win.document.close()
    win.onafterprint = () => win.close()
    win.onload = () => {
      setTimeout(() => {
        try {
          win.print()
        } catch {
          /* already closed */
        }
      }, 200)
    }
    setTimeout(() => {
      try {
        if (!win.closed) win.close()
      } catch {
        /* already closed */
      }
    }, 300000)
  }

  if (waitingForBar)
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-2xl p-6 text-center max-w-sm w-full border border-amber-500/30 space-y-4">
          <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
            <Clock size={32} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-white text-xl font-bold mb-1">Waiting for Barman</h3>
            <p className="text-gray-400 text-sm">
              {isTakeaway ? `Takeaway for ${customerName}` : 'Cash sale'} — drinks sent to bar
            </p>
            <p className="text-amber-400 text-xs mt-2">
              The barman must mark all drinks as ready before payment can be completed.
            </p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Bar Items</p>
            {orderItems
              .filter((i) => (i.menu_categories?.destination || 'bar') === 'bar')
              .map((item, idx) => (
                <div key={idx} className="flex justify-between text-sm text-gray-300 py-0.5">
                  <span>
                    {item.quantity}x {item.name}
                  </span>
                  <span className="text-amber-400">Pending...</span>
                </div>
              ))}
          </div>
          <p className="text-gray-600 text-xs">Total: SSP{total.toLocaleString()}</p>
        </div>
      </div>
    )

  if (success)
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-2xl p-6 text-center max-w-sm w-full border border-gray-800 space-y-4">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <div>
            <h3 className="text-white text-xl font-bold mb-1">Order Complete!</h3>
            <p className="text-gray-400 text-sm">
              {isTakeaway ? `Takeaway for ${customerName}` : 'Cash sale processed'}
            </p>
          </div>
          {paymentMethod === 'cash' && change > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <p className="text-amber-400 text-xs mb-1">Change to return</p>
              <p className="text-white text-2xl font-bold break-all">SSP{change.toLocaleString()}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={printCashReceipt}
              className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2.5 rounded-xl text-sm"
            >
              <Printer size={15} /> Print Receipt
            </button>
            <button
              onClick={onSuccess}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-2xl border border-gray-800 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${isTakeaway ? 'bg-blue-600' : 'bg-green-600'}`}
            >
              {isTakeaway ? (
                <Phone size={16} className="text-white" />
              ) : (
                <ShoppingBag size={16} className="text-white" />
              )}
            </div>
            <div>
              <h3 className="text-white font-bold">
                {isTakeaway ? 'Takeaway Order' : 'Cash Sale'}
              </h3>
              <p className="text-gray-400 text-xs">
                {isTakeaway ? 'Phone-in or walk-in takeaway' : 'Counter sale — pay immediately'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex md:hidden border-b border-gray-800 bg-gray-900 shrink-0">
          <button
            onClick={() => setActiveTab('menu')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'menu' ? 'text-white border-b-2 border-amber-500' : 'text-gray-500'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setActiveTab('order')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'order' ? 'text-white border-b-2 border-amber-500' : 'text-gray-500'}`}
          >
            Order {orderItems.length > 0 && `(${orderItems.length})`}
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div
            className={`${activeTab === 'menu' ? 'flex' : 'hidden'} md:flex flex-1 flex-col overflow-hidden border-r border-gray-800`}
          >
            <div className="p-3 border-b border-gray-800 shrink-0">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-gray-800 shrink-0">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {orderItems.length > 0 && (
              <div className="md:hidden shrink-0 p-2 border-t border-gray-800 bg-gray-900">
                <button
                  onClick={() => setActiveTab('order')}
                  className="w-full bg-amber-500 text-black font-bold rounded-xl py-2.5 text-sm"
                >
                  View Order ({orderItems.length} items) — SSP{total.toLocaleString()} →
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addItem(item)}
                    className="bg-gray-800 hover:bg-gray-700 rounded-xl p-3 text-left border border-gray-700 hover:border-amber-500/50 transition-colors"
                  >
                    <p className="text-white text-sm font-medium leading-tight">{item.name}</p>
                    <p className="text-amber-400 text-sm font-bold mt-1">
                      SSP{item.price.toLocaleString()}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {
                        (item as unknown as { menu_categories?: { name?: string } }).menu_categories
                          ?.name
                      }
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            className={`${activeTab === 'order' ? 'flex' : 'hidden'} md:flex w-full md:w-80 flex-col overflow-hidden shrink-0`}
          >
            {/* Scrollable order content — everything scrolls except the payment footer */}
            <div className="flex-1 overflow-y-auto">
              {isTakeaway && (
                <div className="p-3 border-b border-gray-800 space-y-2">
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name *"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                  />
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone number"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              {/* Order items */}
              <div className="p-3 space-y-2.5">
                {orderItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-600 text-sm">Tap items to add</div>
                ) : (
                  orderItems.map((item) => (
                    <div key={item.id} className="bg-gray-800 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white text-sm font-medium flex-1 mr-2">
                          {item.name}
                        </span>
                        <button
                          onClick={() =>
                            setOrderItems((prev) => prev.filter((i) => i.id !== item.id))
                          }
                          className="text-red-400 hover:text-red-300 shrink-0 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => removeItem(item.id)}
                            className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white active:scale-95 transition-transform"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="text-white text-base font-bold w-6 text-center">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => addItem(item as unknown as MenuItem)}
                            className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white active:scale-95 transition-transform"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <span className="text-amber-400 text-sm font-bold">
                          SSP{item.total.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Notes */}
              <div className="px-3 pb-2">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
              {/* Pack size selector for takeaway — multiple packs with quantities */}
              {isTakeaway && packSizes.length > 0 && orderItems.length > 0 && (
                <div className="px-3 py-2 border-t border-gray-800 shrink-0">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-1.5">
                    Takeaway Packs
                  </p>
                  <div className="space-y-1.5">
                    {packSizes.map((pack) => {
                      const qty = packQuantities[pack.id] || 0
                      return (
                        <div key={pack.id} className="flex items-center gap-2">
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() =>
                                setPackQuantities((prev) => ({
                                  ...prev,
                                  [pack.id]: Math.max(0, (prev[pack.id] || 0) - 1),
                                }))
                              }
                              disabled={qty === 0}
                              className="w-6 h-6 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 flex items-center justify-center text-white text-xs"
                            >
                              -
                            </button>
                            <span
                              className={`text-sm w-5 text-center ${qty > 0 ? 'text-white font-bold' : 'text-gray-600'}`}
                            >
                              {qty}
                            </span>
                            <button
                              onClick={() =>
                                setPackQuantities((prev) => ({
                                  ...prev,
                                  [pack.id]: (prev[pack.id] || 0) + 1,
                                }))
                              }
                              className="w-6 h-6 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white text-xs"
                            >
                              +
                            </button>
                          </div>
                          <span
                            className={`text-xs flex-1 ${qty > 0 ? 'text-white' : 'text-gray-500'}`}
                          >
                            {pack.name}
                          </span>
                          <span
                            className={`text-xs shrink-0 ${qty > 0 ? 'text-amber-400 font-bold' : 'text-gray-600'}`}
                          >
                            SSP{pack.price.toLocaleString()}
                            {qty > 1 ? ` × ${qty} = SSP${(pack.price * qty).toLocaleString()}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* end scrollable content */}

            {orderItems.length > 0 && (
              <div className="p-3 border-t border-gray-800 space-y-3 shrink-0">
                {packFee > 0 && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500">Items subtotal</span>
                    <span className="text-gray-400">SSP{itemsTotal.toLocaleString()}</span>
                  </div>
                )}
                {packItems.map((p) => (
                  <div key={p.id} className="flex justify-between items-center text-xs">
                    <span className="text-gray-500">
                      {p.qty}x {p.name}
                    </span>
                    <span className="text-gray-400">SSP{(p.qty * p.price).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Total</span>
                  <span className="text-amber-400 font-bold text-xl">
                    SSP{total.toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      ['cash', 'Cash', Banknote],
                      ['card', 'POS', CreditCard],
                      ['transfer', 'Transfer', Smartphone],
                      ['credit', 'Credit', Clock],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => setPaymentMethod(id)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-xl border-2 transition-all text-xs font-medium ${paymentMethod === id ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'cash' && (
                  <div className="space-y-2">
                    <input
                      type="number"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      placeholder="Amount tendered"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-amber-500"
                    />
                    <div className="grid grid-cols-4 gap-1">
                      {[2000, 5000, 10000, 20000].map((a) => (
                        <button
                          key={a}
                          onClick={() => setCashTendered(a.toString())}
                          className="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded-lg py-1.5 hover:text-white transition-colors"
                        >
                          SSP{(a / 1000).toFixed(0)}k
                        </button>
                      ))}
                    </div>
                    {cashTendered && parseFloat(cashTendered) >= total && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-2 text-center">
                        <p className="text-green-400 text-xs">Change</p>
                        <p className="text-white font-bold">SSP{change.toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                )}
                {paymentMethod === 'credit' && !isTakeaway && (
                  <div className="space-y-2">
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Customer name *"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                    />
                    <input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="Phone number"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                    />
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2">
                      <p className="text-amber-400 text-xs text-center">
                        This order will be added to the customer's tab
                      </p>
                    </div>
                  </div>
                )}
                {paymentMethod === 'credit' && isTakeaway && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2">
                    <p className="text-amber-400 text-xs text-center">
                      SSP{total.toLocaleString()} will be added to {customerName || 'customer'}'s tab
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const W = 32
                      const div = '-'.repeat(W)
                      const sol = '='.repeat(W)
                      const row = (l: string, r: string) => {
                        const left = l.substring(0, W - r.length - 1)
                        return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
                      }
                      const ctr = (s: string) =>
                        ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
                      const fmtDate = new Date().toLocaleDateString('en-SS', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })
                      const fmtTime = new Date().toLocaleTimeString('en-SS', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })
                      const lines = [
                        '',
                        ctr("KOLONDIRO"),
                        ctr('Lounge & Restaurant'),
                        ctr(isTakeaway ? '** TAKEAWAY BILL **' : '** CASH SALE BILL **'),
                        div,
                        row(
                          'Customer:',
                          isTakeaway ? (customerName || 'Walk-in').substring(0, 20) : 'Counter'
                        ),
                        row('Date:', fmtDate),
                        row('Time:', fmtTime),
                        row('Staff:', (profile?.full_name || 'Staff').substring(0, 22)),
                        div,
                        row('ITEM', 'AMOUNT'),
                        div,
                        ...orderItems.map((i) =>
                          row(`${i.quantity}x ${i.name}`, `N${i.total.toLocaleString()}`)
                        ),
                        ...packItems.map((p) =>
                          row(
                            `${p.qty}x Pack (${p.name})`,
                            `N${(p.qty * p.price).toLocaleString()}`
                          )
                        ),
                        sol,
                        row(
                          'TOTAL DUE:',
                          `N${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        ),
                        sol,
                        '',
                        ctr('** PAYMENT PENDING **'),
                        '',
                        ctr('Please pay at the counter'),
                        '',
                      ].join('\n')
                      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bill</title><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{height:auto;}body{font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#000;background:#fff;width:62mm;margin:0 auto;padding:2mm 3mm;white-space:pre;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@media print{body{width:62mm;overflow:hidden;}html,body{height:auto;}*{break-inside:avoid;}@page{margin:0;size:80mm auto;}}</style></head><body>${lines}</body></html>`
                      const w = window.open(
                        '',
                        '_blank',
                        'width=500,height=700,toolbar=no,menubar=no,scrollbars=no'
                      )
                      if (!w) return
                      w.document.open('text/html', 'replace')
                      w.document.write(html)
                      w.document.close()
                      w.onafterprint = () => w.close()
                      w.onload = () =>
                        setTimeout(() => {
                          try {
                            w.print()
                          } catch {
                            /* closed */
                          }
                        }, 200)
                    }}
                    className="flex items-center justify-center gap-1 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 font-medium rounded-xl py-3 px-3 text-sm transition-colors shrink-0"
                  >
                    <Printer size={14} />
                  </button>
                  <button
                    onClick={processOrder}
                    disabled={!canPay()}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 text-sm transition-colors"
                  >
                    {processing ? 'Processing...' : `Confirm SSP${total.toLocaleString()}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
