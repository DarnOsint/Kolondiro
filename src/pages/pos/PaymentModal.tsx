import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { audit } from '../../lib/audit'
import { useAuth } from '../../context/AuthContext'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { offlineUpdateNoReturn } from '../../lib/offlineWrite'
import {
  X,
  Banknote,
  CreditCard,
  Smartphone,
  CheckCircle,
  Clock,
  Beer,
  Printer,
} from 'lucide-react'
import ReceiptModal from './ReceiptModal'
import type { Table, Profile, ItemDestination } from '../../types'
import { useToast } from '../../context/ToastContext'
import { buildOrderTicketHTML, type TicketItem } from '../../lib/orderTicket'

interface OrderItemExtended {
  id: string
  order_id?: string
  menu_item_id?: string
  quantity: number
  unit_price?: number
  total_price: number
  status?: string
  destination?: string
  modifier_notes?: string | null
  extra_charge?: number
  created_at?: string
  menu_items?: { name: string } | null
  return_requested?: boolean
  return_accepted?: boolean
  return_reason?: string | null
}
interface OrderExtended {
  id: string
  table_id?: string | null
  total_amount: number
  payment_method?: string | null
  status: string
  order_type: string
  created_at: string
  closed_at?: string | null
  notes?: string | null
  order_items?: OrderItemExtended[]
  customer_name?: string
  customer_phone?: string
  tables?: { name: string } | null
  profiles?: { full_name: string } | null
}
interface SplitPayment {
  person: number
  total: number
  method: string
  items: string[]
  change: number
}
interface Props {
  order: OrderExtended
  table: Table
  onSuccess: () => void
  onClose: () => void
}

const normalizeDestination = (
  dest?: string | null,
  name?: string | null,
  catName?: string | null
): ItemDestination => {
  const d = (dest || '').trim().toLowerCase()
  const lowerName = (name || '').toLowerCase()
  const lowerCat = (catName || '').toLowerCase()

  const isMixologistItem =
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
    lowerName.includes('punch') ||
    lowerCat.includes('chapman') ||
    lowerCat.includes('sunrise') ||
    lowerCat.includes('colada') ||
    lowerCat.includes('mojito') ||
    lowerCat.includes('cocktail') ||
    lowerCat.includes('mocktail') ||
    lowerCat.includes('milkshake') ||
    lowerCat.includes('smoothie') ||
    lowerCat.includes('punch')

  if (d === 'kitchen' || lowerCat.includes('kitchen') || lowerName.includes('kitchen'))
    return 'kitchen'
  if (
    d === 'griller' ||
    d === 'grill' ||
    d === 'grilling' ||
    lowerCat.includes('grill') ||
    lowerName.includes('grill')
  )
    return 'griller'
  if (
    d === 'shisha' ||
    d === 'hookah' ||
    lowerCat.includes('shisha') ||
    lowerName.includes('shisha')
  )
    return 'shisha'
  if (d === 'games' || d === 'game' || d === 'games_master' || lowerCat.includes('game'))
    return 'games'
  if (d === 'mixologist' || d === 'cocktail' || d === 'cocktails' || isMixologistItem)
    return 'mixologist'
  return 'bar'
}

const getStationItemTime = (item: OrderItemExtended, fallbackCreatedAt: string): string =>
  item.created_at || fallbackCreatedAt

const getLatestPendingBatch = (
  items: OrderItemExtended[],
  station: 'kitchen' | 'griller',
  orderCreatedAt: string,
  lastPrintedAt: string | null
): OrderItemExtended[] => {
  const stationPending = items
    .filter((item) => {
      const isStation =
        normalizeDestination(
          item.destination || (item.menu_items as any)?.menu_categories?.destination || 'bar',
          item.menu_items?.name,
          (item.menu_items as any)?.menu_categories?.name
        ) === station
      return isStation && item.status === 'pending'
    })
    .sort(
      (a, b) =>
        new Date(getStationItemTime(a, orderCreatedAt)).getTime() -
        new Date(getStationItemTime(b, orderCreatedAt)).getTime()
    )

  if (!stationPending.length) return []

  if (lastPrintedAt) {
    const unprinted = stationPending.filter(
      (item) =>
        new Date(getStationItemTime(item, orderCreatedAt)).getTime() >
        new Date(lastPrintedAt).getTime()
    )
    if (unprinted.length) return unprinted
  }

  const latestTime = getStationItemTime(stationPending[stationPending.length - 1], orderCreatedAt)
  return stationPending.filter((item) => getStationItemTime(item, orderCreatedAt) === latestTime)
}

export default function PaymentModal({ order: orderProp, table, onSuccess, onClose }: Props) {
  const [order, setOrder] = useState(orderProp)
  // Sync when parent refreshes the order (realtime DB update)
  useEffect(() => {
    setOrder(orderProp)
  }, [orderProp])
  const { profile } = useAuth()
  const toast = useToast()

  const refreshOrder = async () => {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*, menu_items(name, price, menu_categories(name, destination)))')
      .eq('id', order.id)
      .single()
    if (data) {
      setOrder(data as unknown as OrderExtended)
      const items = (data as any).order_items || []
      const isKitchen = (i: any) =>
        normalizeDestination(
          i.destination || i.menu_items?.menu_categories?.destination || 'bar',
          i.menu_items?.name,
          i.menu_items?.menu_categories?.name
        ) === 'kitchen'
      const isGrill = (i: any) =>
        normalizeDestination(
          i.destination || i.menu_items?.menu_categories?.destination || 'bar',
          i.menu_items?.name,
          i.menu_items?.menu_categories?.name
        ) === 'griller'
      setKitchenPendingCount(
        items.filter((i: any) => isKitchen(i) && i.status === 'pending').length
      )
      setGrillPendingCount(items.filter((i: any) => isGrill(i) && i.status === 'pending').length)
      setKitchenTotalCount(items.filter(isKitchen).length)
      setGrillTotalCount(items.filter(isGrill).length)
    }
  }

  useEffect(() => {
    if (!order.id) return

    const channel = supabase
      .channel(`payment-modal-order-${order.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${order.id}` },
        () => {
          void refreshOrder()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'returns_log', filter: `order_id=eq.${order.id}` },
        () => {
          void refreshOrder()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` },
        () => {
          void refreshOrder()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])
  const [paymentMethod, setPaymentMethod] = useState<string>('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [paidOrder, setPaidOrder] = useState<OrderExtended | null>(null)
  const [debtorName, setDebtorName] = useState(order?.customer_name || '')
  const [debtorPhone, setDebtorPhone] = useState(order?.customer_phone || '')
  const [dueDate, setDueDate] = useState('')
  const [splitMode, setSplitMode] = useState(false)
  const [numPeople, setNumPeople] = useState(2)
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>({})
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([])
  const [currentSplitPerson, setCurrentSplitPerson] = useState(0)
  const [returningItemId, setReturningItemId] = useState<string | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const [returnQty, setReturnQty] = useState(1)
  const [splitPayMethod, setSplitPayMethod] = useState('cash')
  const [splitCash, setSplitCash] = useState('')
  const [bankAccounts, setBankAccounts] = useState<
    { id: string; bank_name: string; account_number: string; account_name: string }[]
  >([])
  const [selectedBankId, setSelectedBankId] = useState<string>('')
  const [tipAmount, setTipAmount] = useState('')
  const [amountReceived, setAmountReceived] = useState('')
  const [cashSplit, setCashSplit] = useState('')
  const [secondarySplit, setSecondarySplit] = useState('')
  const [kitchenPendingCount, setKitchenPendingCount] = useState(0)
  const [grillPendingCount, setGrillPendingCount] = useState(0)
  const [kitchenTotalCount, setKitchenTotalCount] = useState(0)
  const [grillTotalCount, setGrillTotalCount] = useState(0)
  const [lastPrintedKitchenAt, setLastPrintedKitchenAt] = useState<string | null>(null)
  const [lastPrintedGrillAt, setLastPrintedGrillAt] = useState<string | null>(null)

  // keep station counts in sync on initial load and when items change
  useEffect(() => {
    const items = (order?.order_items as any[]) || []
    const isKitchen = (i: any) =>
      normalizeDestination(
        i.destination || i.menu_items?.menu_categories?.destination || 'bar',
        i.menu_items?.name,
        i.menu_items?.menu_categories?.name
      ) === 'kitchen'
    const isGrill = (i: any) =>
      normalizeDestination(
        i.destination || i.menu_items?.menu_categories?.destination || 'bar',
        i.menu_items?.name,
        i.menu_items?.menu_categories?.name
      ) === 'griller'
    setKitchenTotalCount(items.filter(isKitchen).length)
    setGrillTotalCount(items.filter(isGrill).length)
    const orderCreatedAt = order?.created_at || new Date().toISOString()
    setKitchenPendingCount(
      getLatestPendingBatch(items, 'kitchen', orderCreatedAt, lastPrintedKitchenAt).length
    )
    setGrillPendingCount(
      getLatestPendingBatch(items, 'griller', orderCreatedAt, lastPrintedGrillAt).length
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.order_items, lastPrintedKitchenAt, lastPrintedGrillAt])

  useState(() => {
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_number, account_name')
      .eq('is_active', true)
      .order('created_at')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setBankAccounts(data)
          setSelectedBankId(data[0].id)
        }
      })
  })

  const billableItems = (order?.order_items || []).filter(
    (i) => !i.return_requested && !i.return_accepted
  )
  const returnedItems = (order?.order_items || []).filter(
    (i) => i.return_requested || i.return_accepted
  )
  // Calculate subtotal from items directly — never trust stored total_amount alone
  // (stored total may not be updated yet after a bar return acceptance)
  const activeItemsTotal = billableItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const returnedTotal = returnedItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const subtotal = activeItemsTotal
  const total = subtotal
  const change = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0

  const requestReturn = async (itemId: string) => {
    const item = (order?.order_items || []).find((i) => i.id === itemId)
    if (!item) return
    const reason = returnReason || 'No reason given'
    const qtyToReturn = Math.min(returnQty, item.quantity)
    const unitPrice = item.quantity > 0 ? (item.total_price || 0) / item.quantity : 0
    const isPartial = qtyToReturn < item.quantity
    const itemDest =
      (item as unknown as { menu_items?: { menu_categories?: { destination?: string } } })
        .menu_items?.menu_categories?.destination ||
      item.destination ||
      'bar'

    // Kitchen and griller orders cannot be returned
    if (itemDest === 'kitchen' || itemDest === 'griller') {
      toast.error('Cannot Return', 'Kitchen and grill orders are final and cannot be returned.')
      return
    }

    // Check station mode — if printer-only (no screen), auto-accept since nobody is there to approve
    let autoAccept = false
    if (itemDest === 'kitchen' || itemDest === 'griller') {
      const { data: modeRow } = await supabase
        .from('settings')
        .select('value')
        .eq('id', 'station_modes')
        .single()
      if (modeRow?.value) {
        try {
          const modes = JSON.parse(modeRow.value)
          if (modes[itemDest] === 'printer') autoAccept = true
        } catch {
          /* ignore */
        }
      }
    }

    if (isPartial) {
      // Split: reduce original item quantity, create a new row for the returned portion
      const remainQty = item.quantity - qtyToReturn
      await supabase
        .from('order_items')
        .update({
          quantity: remainQty,
          total_price: Math.round(unitPrice * remainQty),
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)

      // Create new row for the returned portion
      const newId = crypto.randomUUID()
      await supabase.from('order_items').insert({
        id: newId,
        order_id: order.id,
        menu_item_id: (item as any).menu_item_id || null,
        quantity: qtyToReturn,
        unit_price: unitPrice,
        total_price: Math.round(unitPrice * qtyToReturn),
        status: item.status,
        destination: item.destination,
        modifier_notes: (item as any).modifier_notes || null,
        extra_charge: 0,
        created_at: (item as any).created_at || new Date().toISOString(),
        return_requested: true,
        return_reason: reason,
        return_requested_at: new Date().toISOString(),
        ...(autoAccept
          ? { return_accepted: true, return_accepted_at: new Date().toISOString() }
          : {}),
      })

      // Log to returns_log with the new split row ID
      await supabase.from('returns_log').insert({
        order_id: order.id,
        order_item_id: newId,
        item_name:
          item.menu_items?.name ||
          (item as unknown as { modifier_notes?: string }).modifier_notes ||
          'Item',
        quantity: qtyToReturn,
        item_total: Math.round(unitPrice * qtyToReturn),
        table_name: table?.name ?? null,
        waitron_id: profile?.id ?? null,
        waitron_name: profile?.full_name ?? null,
        return_reason: reason,
        status: autoAccept ? 'bar_accepted' : 'pending',
        requested_at: new Date().toISOString(),
        ...(autoAccept ? { resolved_at: new Date().toISOString() } : {}),
      })
    } else {
      // Full return — mark entire item
      await supabase
        .from('order_items')
        .update({
          return_requested: true,
          return_reason: reason,
          return_requested_at: new Date().toISOString(),
          ...(autoAccept
            ? { return_accepted: true, return_accepted_at: new Date().toISOString() }
            : {}),
        })
        .eq('id', itemId)

      await supabase
        .from('returns_log')
        .delete()
        .eq('order_item_id', itemId)
        .eq('status', 'pending')

      // Log to returns_log for manager/accountant review
      await supabase.from('returns_log').insert({
        order_id: order.id,
        order_item_id: itemId,
        item_name:
          item.menu_items?.name ||
          (item as unknown as { modifier_notes?: string }).modifier_notes ||
          'Item',
        quantity: item.quantity,
        item_total: item.total_price || 0,
        table_name: table?.name ?? null,
        waitron_id: profile?.id ?? null,
        waitron_name: profile?.full_name ?? null,
        return_reason: reason,
        status: autoAccept ? 'bar_accepted' : 'pending',
        requested_at: new Date().toISOString(),
        ...(autoAccept ? { resolved_at: new Date().toISOString() } : {}),
      })
    }

    // Notify bar staff about the return request (for bar items that aren't auto-accepted)
    if (!autoAccept && itemDest === 'bar') {
      const { data: barStaff } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'bar')
        .eq('is_active', true)
      if (barStaff) {
        const itemName =
          item.menu_items?.name ||
          (item as unknown as { modifier_notes?: string }).modifier_notes ||
          'Item'
        for (const staff of barStaff) {
          sendPushToStaff(
            staff.id,
            '↩ Return Requested',
            `${qtyToReturn}x ${itemName} — ${table?.name || 'Table'} — Reason: ${reason}`
          ).catch(() => {})
        }
      }
    }

    // If auto-accepted, recalculate order total immediately
    if (autoAccept) {
      const { data: remaining } = await supabase
        .from('order_items')
        .select('total_price, return_accepted')
        .eq('order_id', order.id)
      const newTotal = (remaining || [])
        .filter((r: { return_accepted?: boolean }) => !r.return_accepted)
        .reduce((s: number, r: { total_price: number }) => s + (r.total_price || 0), 0)
      await supabase
        .from('orders')
        .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
        .eq('id', order.id)
      toast.success(
        'Auto-accepted',
        `${itemDest === 'kitchen' ? 'Kitchen' : 'Grill'} station is printer-only — return auto-accepted, awaiting manager approval`
      )
    }

    setReturningItemId(null)
    setReturnReason('')
    await refreshOrder()
  }

  const cancelReturn = async (itemId: string) => {
    // Only cancel if barman hasn't already accepted — check returns_log status first
    const { data: logEntry } = await supabase
      .from('returns_log')
      .select('status')
      .eq('order_item_id', itemId)
      .order('requested_at', { ascending: false })
      .limit(1)
      .single()
    if (logEntry?.status === 'accepted') {
      toast.error('Cannot cancel', 'Bar has already accepted this return')
      return
    }
    await supabase
      .from('order_items')
      .update({
        return_requested: false,
        return_accepted: false,
        return_reason: null,
        return_requested_at: null,
      })
      .eq('id', itemId)
    // Remove pending log entry
    await supabase.from('returns_log').delete().eq('order_item_id', itemId).eq('status', 'pending')
    await refreshOrder()
  }

  const canProcess = () => {
    if (processing) return false
    if (paymentMethod === 'cash') return parseFloat(cashTendered) >= total
    if (paymentMethod === 'cash+transfer' || paymentMethod === 'cash+card') {
      const c = parseFloat(cashSplit || '0')
      const s = parseFloat(secondarySplit || '0')
      return c + s >= total && c >= 0 && s >= 0
    }
    if (paymentMethod === 'credit') return debtorName.trim().length > 0
    return true
  }

  const printPreReceipt = async () => {
    const orderRef = `BSP-${String(order.id).slice(0, 8).toUpperCase()}`
    const date = new Date().toLocaleDateString('en-SS', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const time = new Date().toLocaleTimeString('en-SS', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

    // Fetch bank accounts for transfer details
    const { data: bankData } = await supabase
      .from('bank_accounts')
      .select('bank_name, account_number, account_name')
      .eq('is_active', true)
      .order('created_at')
    const banks = (bankData || []) as {
      bank_name: string
      account_number: string
      account_name: string
    }[]

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

    const activeItems = billableItems
    const adjustedTotal = activeItems.reduce((sum, i) => sum + (i.total_price || 0), 0)

    // Group items by name
    const grouped = new Map<string, { qty: number; total: number }>()
    activeItems.forEach((item) => {
      const name =
        item.menu_items?.name ||
        (item as unknown as { modifier_notes?: string }).modifier_notes ||
        'Item'
      const existing = grouped.get(name)
      if (existing) {
        existing.qty += item.quantity
        existing.total += item.total_price || 0
      } else grouped.set(name, { qty: item.quantity, total: item.total_price || 0 })
    })
    const itemLines = Array.from(grouped.entries())
      .map(([name, { qty, total }]) => fmtRow(`${qty}x ${name}`, `N${total.toLocaleString()}`))
      .join('\n')

    const returnedGrouped = new Map<string, number>()
    returnedItems.forEach((item) => {
      const name =
        item.menu_items?.name ||
        (item as unknown as { modifier_notes?: string }).modifier_notes ||
        'Item'
      returnedGrouped.set(name, (returnedGrouped.get(name) || 0) + item.quantity)
    })
    const returnedLines = Array.from(returnedGrouped.entries())
      .map(([name, qty]) => fmtRow(`${qty}x ${name} [RETURNED]`, 'N0'))
      .join('\n')

    const bankLines =
      banks.length > 0
        ? [
            divider,
            centre('-- PAYMENT DETAILS --'),
            ...banks.flatMap((b) => [
              fmtRow('Bank:', b.bank_name),
              fmtRow('Account:', b.account_number),
              fmtRow('Name:', b.account_name),
              '',
            ]),
          ]
        : []

    const receipt = [
      '',
      centre("KOLONDIRO"),
      centre('Lounge & Restaurant'),
      divider,
      fmtRow('Ref:', orderRef),
      fmtRow('Table:', table.name),
      fmtRow('Date:', date),
      fmtRow('Time:', time),
      fmtRow('Served by:', profile?.full_name || 'Staff'),
      divider,
      fmtRow('ITEM', 'AMOUNT'),
      divider,
      itemLines,
      ...(returnedLines ? [returnedLines] : []),
      solidDivider,
      fmtRow(
        'TOTAL:',
        `N${adjustedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      ),
      solidDivider,
      '',
      centre('** PRE-PAYMENT RECEIPT **'),
      centre('Payment not yet confirmed.'),
      ...bankLines,
      '',
      centre('Thank you for visiting'),
      centre("Kolondiro"),
      '',
    ].join('\n')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pre-Payment Receipt</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: auto; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 14px;
      font-weight: bold;
      color: #000;
      background: #fff;
      width: 62mm;
      margin: 0 auto;
      padding: 2mm 3mm;
      white-space: pre;
      line-height: 1.25;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print {
      body { width: 62mm; overflow: hidden; }
      html, body { height: auto; }
      * { break-inside: avoid; }
      @page { margin: 0; size: 80mm auto; }
    }
  </style>
</head>
<body>${receipt}</body>
</html>`

    // Always open the browser/OS print dialog — this is the venue's normal print
    // interface. (A separate optional network-thermal path could be added later,
    // but staff print through the standard OS print dialog.)
    const win = window.open(
      '',
      '_blank',
      'width=500,height=700,toolbar=no,menubar=no,scrollbars=no'
    )
    if (win) {
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
  }

  const printAllForStation = (station: 'kitchen' | 'griller') => {
    const stationItems = (order?.order_items || []).filter(
      (i) =>
        normalizeDestination(
          i.destination || (i as any)?.menu_items?.menu_categories?.destination || 'bar',
          (i as any)?.menu_items?.name,
          (i as any)?.menu_items?.menu_categories?.name
        ) === station
    )
    if (stationItems.length === 0) {
      toast.info('No items', `No ${station} items to print.`)
      return
    }
    const stationLabel = station === 'kitchen' ? 'Kitchen — All Items' : 'Grill — All Items'
    const ticket: TicketItem[] = stationItems.map((i) => ({
      quantity: i.quantity,
      name:
        i.menu_items?.name ||
        (i as unknown as { modifier_notes?: string }).modifier_notes ||
        'Item',
      modifier_notes: (i as unknown as { modifier_notes?: string }).modifier_notes || null,
      unit_price: (i as unknown as { unit_price?: number | null }).unit_price ?? null,
      total_price:
        ((i as unknown as { total_price?: number | null }).total_price || 0) +
        ((i as unknown as { extra_charge?: number | null }).extra_charge || 0),
    }))
    const html = buildOrderTicketHTML({
      station: stationLabel,
      tableName: table?.name || 'Counter',
      orderRef: (order?.id || '').slice(0, 8).toUpperCase(),
      staffName: profile?.full_name || '',
      items: ticket,
      createdAt: new Date().toISOString(),
    })
    const copies = 2
    for (let c = 0; c < copies; c++) {
      const w = window.open('', '_blank', 'width=420,height=640,toolbar=no,menubar=no')
      if (!w) continue
      w.document.open('text/html', 'replace')
      w.document.write(html)
      w.document.close()
      w.onload = () =>
        setTimeout(() => {
          try {
            w.print()
          } catch {
            /* ignore */
          } finally {
            w.close()
          }
        }, 150)
    }
    // After printing full docket, advance the station's last-printed marker
    if (station === 'kitchen') setLastPrintedKitchenAt(new Date().toISOString())
    else setLastPrintedGrillAt(new Date().toISOString())
  }

  const printPendingForStation = (station: 'kitchen' | 'griller') => {
    const lastPrinted =
      station === 'kitchen'
        ? lastPrintedKitchenAt
        : station === 'griller'
          ? lastPrintedGrillAt
          : null
    const orderCreatedAt = order?.created_at || new Date().toISOString()
    const pending = getLatestPendingBatch(
      order?.order_items || [],
      station,
      orderCreatedAt,
      lastPrinted
    )
    if (pending.length === 0) {
      toast.info('No pending items', `No waiting ${station} items to print.`)
      return
    }
    const stationLabel =
      station === 'kitchen' ? 'Kitchen — New Items Only' : 'Grill — New Items Only'
    const ticket: TicketItem[] = pending.map((i) => ({
      quantity: i.quantity,
      name:
        i.menu_items?.name ||
        (i as unknown as { modifier_notes?: string }).modifier_notes ||
        'Item',
      modifier_notes: (i as unknown as { modifier_notes?: string }).modifier_notes || null,
      unit_price: (i as unknown as { unit_price?: number | null }).unit_price ?? null,
      total_price:
        ((i as unknown as { total_price?: number | null }).total_price || 0) +
        ((i as unknown as { extra_charge?: number | null }).extra_charge || 0),
    }))
    const html = buildOrderTicketHTML({
      station: stationLabel,
      tableName: table?.name || 'Counter',
      orderRef: (order?.id || '').slice(0, 8).toUpperCase(),
      staffName: profile?.full_name || '',
      items: ticket,
      createdAt: new Date().toISOString(),
    })
    const copies = 2
    for (let c = 0; c < copies; c++) {
      const w = window.open('', '_blank', 'width=420,height=640,toolbar=no,menubar=no')
      if (!w) continue
      w.document.open('text/html', 'replace')
      w.document.write(html)
      w.document.close()
      w.onload = () =>
        setTimeout(() => {
          try {
            w.print()
          } catch {
            /* ignore */
          } finally {
            w.close()
          }
        }, 150)
    }
    // Move marker so subsequent "New" prints only later additions
    const latestPrintedAt = getStationItemTime(pending[pending.length - 1], orderCreatedAt)
    if (station === 'kitchen') setLastPrintedKitchenAt(latestPrintedAt)
    else setLastPrintedGrillAt(latestPrintedAt)
  }

  const orderItems = billableItems
  const getPersonItems = (idx: number) =>
    orderItems.filter((item) => itemAssignments[item.id] === idx)
  const getPersonTotal = (idx: number) =>
    getPersonItems(idx).reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
  const unassignedItems = orderItems.filter((item) => itemAssignments[item.id] === undefined)
  const allAssigned = unassignedItems.length === 0

  const processSplitPayment = async () => {
    const personTotal = getPersonTotal(currentSplitPerson)
    if (personTotal === 0) {
      toast.warning('No Items', 'No items assigned to this person')
      return
    }
    if (splitPayMethod === 'cash' && parseFloat(splitCash) < personTotal) {
      toast.warning('Insufficient Cash', 'Cash tendered is less than amount due')
      return
    }
    const newPayment: SplitPayment = {
      person: currentSplitPerson + 1,
      total: personTotal,
      method: splitPayMethod,
      items: getPersonItems(currentSplitPerson).map((i) => i.menu_items?.name || 'Item'),
      change: splitPayMethod === 'cash' ? parseFloat(splitCash) - personTotal : 0,
    }
    const updatedPayments = [...splitPayments, newPayment]
    setSplitPayments(updatedPayments)
    setSplitCash('')
    const paidPeople = updatedPayments.map((p) => p.person)
    const allPeople = Array.from({ length: numPeople }, (_, i) => i + 1)
    if (allPeople.every((p) => paidPeople.includes(p))) {
      const primaryMethod = updatedPayments[0].method
      if (!navigator.onLine) {
        const closedAt = new Date().toISOString()
        await offlineUpdateNoReturn('orders', order.id, {
          status: 'paid',
          payment_method: primaryMethod,
          closed_at: closedAt,
          total_amount: total,
          notes:
            (order.notes || '') +
            ' [Split: ' +
            updatedPayments.map((p) => 'P' + p.person + '=' + p.method).join(', ') +
            ']',
        } as any)
        // Do not auto-deliver station items on payment.
        // Stations (kitchen/grill/bar/mixologist/etc) control readiness, and waitron can mark served.
        await offlineUpdateNoReturn('tables', table.id, {
          status: 'available',
          assigned_staff: null,
        } as any)
        setPaidOrder({ ...order, payment_method: 'split' })
        setSuccess(true)
        setShowReceipt(true)
        toast.success('Offline Payment', 'Saved offline. Will sync when internet returns.')
        return
      }
      await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: primaryMethod,
          closed_at: new Date().toISOString(),
          notes:
            (order.notes || '') +
            ' [Split: ' +
            updatedPayments.map((p) => 'P' + p.person + '=' + p.method).join(', ') +
            ']',
        })
        .eq('id', order.id)
      // Do not auto-deliver station items on payment. Stations manage acceptance/ready.
      await supabase
        .from('tables')
        .update({ status: 'available', assigned_staff: null })
        .eq('id', table.id)
      await audit({
        action: 'ORDER_PAID',
        entity: 'order',
        entityId: order.id,
        entityName: 'Order #' + (order.id || '').slice(0, 8),
        newValue: {
          total: order.total_amount,
          payment_method: 'split',
          splits: updatedPayments.length,
        },
        performer: profile as Profile,
      })
      setPaidOrder({ ...order, payment_method: 'split' })
      setSuccess(true)
      setShowReceipt(true)
    } else {
      const nextPerson = allPeople.find((p) => !paidPeople.includes(p))!
      setCurrentSplitPerson(nextPerson - 1)
      setSplitPayMethod('cash')
    }
  }

  const processPayment = async () => {
    if (paymentMethod === 'run_tab') {
      onClose()
      return
    }
    setProcessing(true)
    try {
      if (!navigator.onLine) {
        if (paymentMethod === 'credit') {
          toast.error('Offline', 'Credit payments require internet. Use cash/card/transfer.')
          return
        }

        const resolvedMethod =
          paymentMethod === 'transfer'
            ? `transfer:${bankAccounts.find((b) => b.id === selectedBankId)?.bank_name || 'Bank Transfer'}`
            : paymentMethod === 'cash+transfer'
              ? `cash+transfer:${parseFloat(cashSplit || '0')}+${parseFloat(secondarySplit || '0')}`
              : paymentMethod === 'cash+card'
                ? `cash+card:${parseFloat(cashSplit || '0')}+${parseFloat(secondarySplit || '0')}`
                : paymentMethod

        const closedAt = new Date().toISOString()
        await offlineUpdateNoReturn('orders', order.id, {
          status: 'paid',
          payment_method: resolvedMethod,
          closed_at: closedAt,
          total_amount: total,
        } as any)

        // Do not auto-deliver station items on payment.
        await offlineUpdateNoReturn('tables', table.id, {
          status: 'available',
          assigned_staff: null,
        } as any)

        setPaidOrder({ ...order, payment_method: resolvedMethod } as typeof order)
        setSuccess(true)
        setShowReceipt(true)
        toast.success('Offline Payment', 'Saved offline. Will sync when internet returns.')
        return
      }

      // Verify total against server-side order_items sum before processing
      // Excludes returned/return-requested items from the billable total
      const { data: serverItems } = await supabase
        .from('order_items')
        .select('total_price, return_requested, return_accepted')
        .eq('order_id', order.id)
      if (serverItems && serverItems.length > 0) {
        const serverTotal = serverItems
          .filter(
            (i: { return_requested?: boolean; return_accepted?: boolean }) =>
              !i.return_requested && !i.return_accepted
          )
          .reduce((s: number, i: { total_price: number }) => s + (i.total_price || 0), 0)
        if (Math.abs(serverTotal - total) > 1) {
          // Update order total to reflect actual billable amount
          await supabase.from('orders').update({ total_amount: serverTotal }).eq('id', order.id)
          setOrder({ ...order, total_amount: serverTotal })
        }
      }

      if (paymentMethod === 'credit') {
        const { error: creditOrderErr } = await supabase
          .from('orders')
          .update({
            status: 'paid',
            payment_method: 'credit',
            customer_name: debtorName,
            customer_phone: debtorPhone,
            closed_at: new Date().toISOString(),
          })
          .eq('id', order.id)
        if (creditOrderErr) throw creditOrderErr
        await supabase
          .from('order_items')
          .update({ status: 'delivered' })
          .eq('order_id', order.id)
          .neq('destination', 'bar')
        await supabase
          .from('tables')
          .update({ status: 'available', assigned_staff: null })
          .eq('id', table.id)
        // Deduplicate debtors — match by phone first, then name
        const { data: _existingDebtors } = await (debtorPhone
          ? supabase
              .from('debtors')
              .select('id, current_balance')
              .eq('phone', debtorPhone)
              .eq('is_active', true)
              .limit(1)
          : supabase
              .from('debtors')
              .select('id, current_balance')
              .ilike('name', debtorName)
              .eq('is_active', true)
              .limit(1))
        // Always create a separate entry for each credit order — never lump
        await supabase.from('debtors').insert({
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          name: debtorName,
          phone: debtorPhone,
          debt_type: 'credit_order',
          order_id: order.id,
          credit_limit: total,
          current_balance: total,
          amount_paid: 0,
          status: 'outstanding',
          is_active: true,
          due_date: dueDate || null,
          notes: `Credit order — ${table?.name || 'Counter'} — by ${profile?.full_name || 'Staff'}`,
          recorded_by: profile?.id,
          recorded_by_name: profile?.full_name,
        })
        await audit({
          action: 'ORDER_PAID',
          entity: 'order',
          entityId: order.id,
          entityName: 'Order #' + (order.id || '').slice(0, 8),
          newValue: { total: order.total_amount, payment_method: paymentMethod },
          performer: profile as Profile,
        })
        setPaidOrder({ ...order, payment_method: 'credit' })
        setSuccess(true)
        setShowReceipt(true)
        setProcessing(false)
        return
      }
      // Use direct Supabase calls for payment — offlineUpdate's .single() can silently
      // fail (PGRST116) causing realtime events to not fire on Management/Executive
      const { error: orderErr } = await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method:
            paymentMethod === 'transfer'
              ? `transfer:${bankAccounts.find((b) => b.id === selectedBankId)?.bank_name || 'Bank Transfer'}`
              : paymentMethod === 'cash+transfer'
                ? `cash+transfer:${parseFloat(cashSplit || '0')}+${parseFloat(secondarySplit || '0')}`
                : paymentMethod === 'cash+card'
                  ? `cash+card:${parseFloat(cashSplit || '0')}+${parseFloat(secondarySplit || '0')}`
                  : paymentMethod,
          closed_at: new Date().toISOString(),
        })
        .eq('id', order.id)
      if (orderErr) throw orderErr
      // Do not auto-deliver station items on payment. Stations manage acceptance/ready.
      await supabase
        .from('tables')
        .update({ status: 'available', assigned_staff: null })
        .eq('id', table.id)
      await audit({
        action: 'ORDER_PAID',
        entity: 'order',
        entityId: order.id,
        entityName: 'Order #' + (order.id || '').slice(0, 8),
        newValue: { total: order.total_amount, payment_method: paymentMethod },
        performer: profile as Profile,
      })
      // Record tip if entered
      const tipVal = parseFloat(tipAmount)
      if (tipVal > 0 && profile?.id) {
        await supabase.from('tips').insert({
          order_id: order.id,
          waitron_id: profile.id,
          waitron_name: profile.full_name,
          table_id: table.id,
          table_name: table.name,
          order_total: total,
          amount_received: parseFloat(amountReceived) || total + tipVal,
          tip_amount: tipVal,
          payment_method:
            paymentMethod === 'transfer'
              ? `transfer:${bankAccounts.find((b) => b.id === selectedBankId)?.bank_name || 'Bank Transfer'}`
              : paymentMethod === 'cash+transfer'
                ? `cash+transfer:${parseFloat(cashSplit || '0')}+${parseFloat(secondarySplit || '0')}`
                : paymentMethod === 'cash+card'
                  ? `cash+card:${parseFloat(cashSplit || '0')}+${parseFloat(secondarySplit || '0')}`
                  : paymentMethod,
          shift_date: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10), // WAT = UTC+1
          status: 'pending',
        })
      }
      setPaidOrder({ ...order, payment_method: paymentMethod } as typeof order)
      setSuccess(true)
      setShowReceipt(true)
    } catch (err) {
      const msg = (err as { message?: string })?.message || String(err)
      toast.error('Payment Failed', msg || 'Please try again.')
      console.error('Payment error:', err)
    } finally {
      setProcessing(false)
    }
  }

  const splitColors = [
    'bg-blue-500/20 border-blue-500/30 text-blue-300',
    'bg-purple-500/20 border-purple-500/30 text-purple-300',
    'bg-green-500/20 border-green-500/30 text-green-300',
    'bg-pink-500/20 border-pink-500/30 text-pink-300',
    'bg-amber-500/20 border-amber-500/30 text-amber-300',
  ]
  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote, color: 'text-green-400' },
    { id: 'card', label: 'Bank POS', icon: CreditCard, color: 'text-blue-400' },
    { id: 'transfer', label: 'Bank Transfer', icon: Smartphone, color: 'text-amber-400' },
    { id: 'credit', label: 'Pay Later (Debt)', icon: Clock, color: 'text-red-400' },
    { id: 'run_tab', label: 'Run Tab', icon: Beer, color: 'text-amber-400' },
    { id: 'cash+transfer', label: 'Cash + Transfer', icon: Smartphone, color: 'text-amber-400' },
    { id: 'cash+card', label: 'Cash + POS', icon: CreditCard, color: 'text-blue-400' },
  ]

  if (splitMode && !success)
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-2">
        <div className="bg-gray-950 rounded-2xl w-full max-w-lg border border-gray-800 flex flex-col max-h-[95vh]">
          <div className="flex items-center justify-between p-4 border-b border-gray-800">
            <div>
              <h3 className="text-white font-bold">Split Bill — {table?.name}</h3>
              <p className="text-gray-400 text-xs">Total: SSP{total.toLocaleString()}</p>
            </div>
            <button onClick={() => setSplitMode(false)} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="p-4 border-b border-gray-800">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Number of people</p>
            <div className="flex gap-2">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setNumPeople(n)
                    setItemAssignments({})
                    setSplitPayments([])
                    setCurrentSplitPerson(0)
                  }}
                  className={`w-10 h-10 rounded-xl font-bold text-sm transition-colors ${numPeople === n ? 'bg-amber-500 text-black' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">
              Assign items to each person
            </p>
            {unassignedItems.length > 0 && (
              <p className="text-amber-400 text-xs mb-3">
                {unassignedItems.length} unassigned item(s)
              </p>
            )}
            <div className="space-y-2">
              {orderItems.map((item) => (
                <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-medium">
                        {item.menu_items?.name ||
                          (item as unknown as { modifier_notes?: string }).modifier_notes ||
                          'Item'}
                      </p>
                      <p className="text-gray-500 text-xs">
                        SSP{((item.total_price || 0) + (item.extra_charge || 0)).toLocaleString()}
                      </p>
                    </div>
                    {itemAssignments[item.id] !== undefined && (
                      <span
                        className={`text-xs px-2 py-1 rounded-lg border ${splitColors[itemAssignments[item.id] % splitColors.length]}`}
                      >
                        Person {itemAssignments[item.id] + 1}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {Array.from({ length: numPeople }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setItemAssignments((prev) => ({ ...prev, [item.id]: i }))}
                        className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${itemAssignments[item.id] === i ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                      >
                        P{i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {allAssigned && (
              <div className="mt-4 space-y-2">
                <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Summary</p>
                {Array.from({ length: numPeople }, (_, i) => {
                  const paid = splitPayments.find((p) => p.person === i + 1)
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between rounded-xl p-3 border ${paid ? 'bg-green-500/10 border-green-500/20' : currentSplitPerson === i ? 'bg-amber-500/10 border-amber-500/30' : 'bg-gray-900 border-gray-800'}`}
                    >
                      <span className="text-white text-sm font-medium">Person {i + 1}</span>
                      <div className="text-right">
                        <p className="text-white font-bold">
                          SSP{getPersonTotal(i).toLocaleString()}
                        </p>
                        {paid && <p className="text-green-400 text-xs">Paid · {paid.method}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {allAssigned && splitPayments.length < numPeople && (
              <div className="mt-4 bg-gray-900 border border-amber-500/30 rounded-xl p-4 space-y-3">
                <p className="text-amber-400 text-sm font-bold">
                  Collecting from Person {currentSplitPerson + 1} — SSP
                  {getPersonTotal(currentSplitPerson).toLocaleString()}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods
                    .filter((m) => m.id !== 'credit' && m.id !== 'run_tab')
                    .map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSplitPayMethod(m.id)}
                        className={`py-2 rounded-xl text-sm font-medium border transition-colors ${splitPayMethod === m.id ? 'bg-amber-500 text-black border-amber-500' : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-amber-500/50'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                </div>
                {splitPayMethod === 'cash' && (
                  <input
                    type="number"
                    value={splitCash}
                    onChange={(e) => setSplitCash(e.target.value)}
                    placeholder="Cash tendered"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  />
                )}
                <button
                  onClick={processSplitPayment}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3"
                >
                  Confirm Payment
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )

  if (success && !showReceipt)
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
        <div className="bg-gray-900 rounded-2xl p-8 text-center max-w-sm w-full border border-gray-800">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <h3 className="text-white text-xl font-bold mb-1">Payment Successful!</h3>
          <p className="text-gray-400 text-sm mb-1">{table.name} is now free</p>
          <p className="text-gray-500 text-xs capitalize">
            {paymentMethod === 'credit'
              ? 'Recorded as debt'
              : `Paid via ${paymentMethod === 'card' ? 'Bank POS' : paymentMethod === 'transfer' ? 'Bank Transfer' : 'Cash'}`}
          </p>
          {paymentMethod === 'cash' && change > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mt-4">
              <p className="text-amber-400 text-xs mb-1">Change to return</p>
              <p className="text-white text-xl font-bold break-all break-all">
                SSP{change.toLocaleString()}
              </p>
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setShowReceipt(true)}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3 text-sm"
            >
              🧾 Print Receipt
            </button>
            <button
              onClick={onSuccess}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl py-3 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )

  if (showReceipt && paidOrder)
    return (
      <ReceiptModal
        order={paidOrder as unknown as import('../../types').Order}
        table={table}
        items={billableItems as import('../../types').OrderItem[]}
        staffName={profile?.full_name || 'Staff'}
        tipAmount={parseFloat(tipAmount) || 0}
        amountReceived={parseFloat(amountReceived) || 0}
        onClose={() => {
          setShowReceipt(false)
          onSuccess()
        }}
      />
    )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800 overflow-y-auto max-h-[90vh]">
        <div className="flex flex-col gap-3 p-5 border-b border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-white font-bold text-lg">Process Payment</h3>
            <p className="text-gray-400 text-sm">{table.name}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={printPreReceipt}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium px-3 py-2 rounded-xl border border-gray-700 transition-colors shrink-0"
              title="Print receipt for customer to review before payment"
            >
              <Printer size={13} /> Print
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white shrink-0">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Station print buttons */}
        <div className="px-5 pb-3 border-b border-gray-800">
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => printAllForStation('kitchen')}
              className="flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-[11px] font-medium py-2 rounded-lg border border-gray-700 transition-colors"
            >
              Kitchen ({kitchenTotalCount})
            </button>
            <button
              onClick={() => printPendingForStation('kitchen')}
              className={`flex items-center justify-center gap-1 text-[11px] font-bold py-2 rounded-lg border transition-colors ${kitchenPendingCount > 0 ? 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500' : 'bg-emerald-900/30 text-emerald-400 border-emerald-800 hover:bg-emerald-800/40'}`}
            >
              Kitchen New{' '}
              {kitchenPendingCount > 0 && (
                <span className="bg-white text-emerald-700 text-[10px] font-black px-1.5 rounded-full ml-0.5">
                  {kitchenPendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => printAllForStation('griller')}
              className="flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-[11px] font-medium py-2 rounded-lg border border-gray-700 transition-colors"
            >
              Grill ({grillTotalCount})
            </button>
            <button
              onClick={() => printPendingForStation('griller')}
              className={`flex items-center justify-center gap-1 text-[11px] font-bold py-2 rounded-lg border transition-colors ${grillPendingCount > 0 ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-500' : 'bg-amber-900/30 text-amber-400 border-amber-800 hover:bg-amber-800/40'}`}
            >
              Grill New{' '}
              {grillPendingCount > 0 && (
                <span className="bg-white text-amber-700 text-[10px] font-black px-1.5 rounded-full ml-0.5">
                  {grillPendingCount}
                </span>
              )}
            </button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-3 uppercase tracking-wide">Order Summary</p>
            <div className="space-y-2 mb-3">
              {billableItems.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-300">
                    {item.quantity}x {item.menu_items?.name}
                  </span>
                  <span className="text-gray-400">SSP{item.total_price?.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
              <span className="text-white font-bold">Total</span>
              <span className="text-amber-400 font-bold text-xl break-all">
                SSP{total.toLocaleString()}
              </span>
            </div>
          </div>

          <div>
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Payment Method</p>
            <div className="grid grid-cols-4 gap-2">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => setPaymentMethod(method.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${paymentMethod === method.id ? 'bg-gray-800 border-amber-500' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}
                >
                  <method.icon
                    size={22}
                    className={paymentMethod === method.id ? method.color : 'text-gray-500'}
                  />
                  <span
                    className={`text-xs font-medium text-center leading-tight ${paymentMethod === method.id ? 'text-white' : 'text-gray-500'}`}
                  >
                    {method.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Amount Tendered (SSP)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-2xl font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[2000, 5000, 10000, 20000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setCashTendered(amount.toString())}
                    className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg py-2 transition-colors"
                  >
                    SSP{amount.toLocaleString()}
                  </button>
                ))}
              </div>
              {cashTendered && parseFloat(cashTendered) >= total && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                  <p className="text-green-400 text-xs">Change to return</p>
                  <p className="text-white text-xl font-bold break-all">
                    SSP{change.toLocaleString()}
                  </p>
                </div>
              )}
              {cashTendered && parseFloat(cashTendered) < total && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <p className="text-red-400 text-xs">Short by</p>
                  <p className="text-white text-xl font-bold break-all">
                    SSP{(total - parseFloat(cashTendered)).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}
          {(paymentMethod === 'cash+transfer' || paymentMethod === 'cash+card') && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                    Cash Received (SSP)
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={cashSplit}
                    onChange={(e) => setCashSplit(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-lg font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                    {paymentMethod === 'cash+transfer'
                      ? 'Transfer Received (SSP)'
                      : 'POS Received (SSP)'}
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={secondarySplit}
                    onChange={(e) => setSecondarySplit(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-lg font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 text-sm text-gray-300">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="text-white font-bold">SSP{total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Entered</span>
                  <span className="text-amber-400 font-bold">
                    SSP
                    {(
                      parseFloat(cashSplit || '0') + parseFloat(secondarySplit || '0')
                    ).toLocaleString()}
                  </span>
                </div>
                {parseFloat(cashSplit || '0') + parseFloat(secondarySplit || '0') < total && (
                  <p className="text-red-400 text-xs mt-2">
                    Short — enter full amount before confirming.
                  </p>
                )}
              </div>
            </div>
          )}
          {paymentMethod === 'card' && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
              <CreditCard size={28} className="text-blue-400 mx-auto mb-2" />
              <p className="text-blue-400 font-medium">Bank POS</p>
              <p className="text-gray-400 text-sm mt-1">
                Process SSP{total.toLocaleString()} on the POS terminal, then confirm below.
              </p>
            </div>
          )}
          {paymentMethod === 'transfer' &&
            (() => {
              const selectedBank = bankAccounts.find((b) => b.id === selectedBankId)
              return (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Smartphone size={20} className="text-amber-400" />
                    <p className="text-amber-400 font-medium">Bank Transfer</p>
                  </div>
                  {bankAccounts.length > 1 && (
                    <div className="mb-3">
                      <p className="text-gray-400 text-xs mb-2">Select bank account:</p>
                      <div className="space-y-2">
                        {bankAccounts.map((bank) => (
                          <button
                            key={bank.id}
                            onClick={() => setSelectedBankId(bank.id)}
                            className={`w-full text-left rounded-xl p-2.5 border transition-colors ${selectedBankId === bank.id ? 'bg-amber-500/20 border-amber-500/50' : 'bg-gray-800 border-gray-700 hover:border-amber-500/30'}`}
                          >
                            <p
                              className={`text-sm font-semibold ${selectedBankId === bank.id ? 'text-amber-400' : 'text-white'}`}
                            >
                              {bank.bank_name}
                            </p>
                            <p className="text-gray-400 text-xs">{bank.account_number}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedBank && (
                    <div className="bg-gray-800 rounded-xl p-3 space-y-1">
                      <p className="text-gray-400 text-xs">
                        Transfer SSP{total.toLocaleString()} to:
                      </p>
                      <p className="text-white font-bold text-sm">{selectedBank.bank_name}</p>
                      <p className="text-amber-400 font-mono font-bold">
                        {selectedBank.account_number}
                      </p>
                      <p className="text-gray-300 text-sm">{selectedBank.account_name}</p>
                      <p className="text-gray-500 text-xs pt-1">
                        Confirm transfer before proceeding.
                      </p>
                    </div>
                  )}
                  {bankAccounts.length === 0 && (
                    <p className="text-gray-400 text-sm text-center">
                      No bank accounts configured. Ask the owner to add bank accounts in the
                      Executive dashboard.
                    </p>
                  )}
                </div>
              )
            })()}
          {paymentMethod === 'credit' && (
            <div className="space-y-3">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <Clock size={28} className="text-red-400 mx-auto mb-2" />
                <p className="text-red-400 font-medium">Pay Later</p>
                <p className="text-gray-400 text-sm mt-1">
                  Order will be recorded as a debt. Enter customer details below.
                </p>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Customer Name *
                </label>
                <input
                  value={debtorName}
                  onChange={(e) => setDebtorName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Phone
                </label>
                <input
                  value={debtorPhone}
                  onChange={(e) => setDebtorPhone(e.target.value)}
                  placeholder="08xxxxxxxxx"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Due Date (optional)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500"
                />
              </div>
            </div>
          )}

          {/* Returned items section — all destinations */}
          {(order?.order_items || []).length > 0 && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <p className="text-gray-300 font-semibold text-sm mb-3">↩ Returned Items</p>
              {['bar', 'mixologist'].map((dest) => {
                const destItems = returnedItems.filter((i) => {
                  const itemDest =
                    (
                      i as unknown as {
                        menu_items?: { menu_categories?: { destination?: string } }
                      }
                    ).menu_items?.menu_categories?.destination || i.destination
                  return itemDest === dest
                })
                if (destItems.length === 0) return null
                const destLabel = dest === 'bar' ? 'Bar' : dest === 'kitchen' ? 'Kitchen' : 'Grill'
                return (
                  <div key={dest} className="mb-3 last:mb-0">
                    <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">
                      {destLabel}
                    </p>
                    <div className="space-y-2">
                      {destItems.map((item) => {
                        const isReturned = item.return_accepted
                        const isPending = item.return_requested && !item.return_accepted
                        const isRequesting = returningItemId === item.id
                        return (
                          <div
                            key={item.id}
                            className={`rounded-lg px-3 py-2 flex items-center justify-between gap-2 ${isReturned ? 'bg-red-500/10 border border-red-500/20' : isPending ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-gray-800'}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-sm font-medium truncate ${isReturned ? 'line-through text-gray-500' : 'text-white'}`}
                              >
                                {item.quantity}x{' '}
                                {item.menu_items?.name ||
                                  (item as unknown as { modifier_notes?: string }).modifier_notes ||
                                  'Item'}
                              </p>
                              {isPending && (
                                <p className="text-amber-400 text-xs">
                                  ⏳ Awaiting {destLabel.toLowerCase()} confirmation...
                                </p>
                              )}
                              {isReturned && (
                                <p className="text-green-400 text-xs">
                                  ✓ Bar accepted — awaiting management approval
                                </p>
                              )}
                              {item.return_reason && (isPending || isReturned) && (
                                <p className="text-gray-500 text-xs italic">
                                  "{item.return_reason}"
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!isReturned && !isPending && !isRequesting && (
                                <button
                                  onClick={() => {
                                    setReturningItemId(item.id)
                                    setReturnQty(1)
                                    setReturnReason('')
                                  }}
                                  className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 px-2 py-1 rounded-lg transition-colors"
                                >
                                  Return
                                </button>
                              )}
                              {isPending && (
                                <button
                                  onClick={() => cancelReturn(item.id)}
                                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 px-2 py-1 rounded-lg transition-colors"
                                >
                                  Cancel
                                </button>
                              )}
                              {isReturned && (
                                <span className="text-red-400 text-xs font-bold">
                                  -N{(item.total_price || 0).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {/* Inline return form with quantity selector */}
              {returningItemId &&
                (() => {
                  const retItem = (order?.order_items || []).find((i) => i.id === returningItemId)
                  const maxQty = retItem?.quantity || 1
                  return (
                    <div className="mt-3 space-y-2 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                      <p className="text-white text-sm font-semibold">
                        Return: {retItem?.menu_items?.name || 'Item'}
                      </p>
                      {maxQty > 1 && (
                        <div className="flex items-center gap-3">
                          <span className="text-gray-400 text-xs">Qty to return:</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setReturnQty(Math.max(1, returnQty - 1))}
                              className="w-8 h-8 rounded-lg bg-gray-700 text-white text-sm flex items-center justify-center hover:bg-gray-600"
                            >
                              -
                            </button>
                            <span className="w-10 text-center text-white font-bold">
                              {returnQty}
                            </span>
                            <button
                              onClick={() => setReturnQty(Math.min(maxQty, returnQty + 1))}
                              className="w-8 h-8 rounded-lg bg-gray-700 text-white text-sm flex items-center justify-center hover:bg-gray-600"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-gray-500 text-xs">of {maxQty}</span>
                        </div>
                      )}
                      <input
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        placeholder="Reason for return (optional)..."
                        className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-400"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            requestReturn(returningItemId)
                            setReturningItemId(null)
                            setReturnReason('')
                            setReturnQty(1)
                          }}
                          className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-semibold py-2 rounded-lg transition-colors"
                        >
                          Return {returnQty} item{returnQty > 1 ? 's' : ''}
                        </button>
                        <button
                          onClick={() => {
                            setReturningItemId(null)
                            setReturnReason('')
                            setReturnQty(1)
                          }}
                          className="bg-gray-700 hover:bg-gray-600 text-gray-400 text-sm px-3 py-2 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                })()}
              {returnedTotal > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between text-sm">
                  <span className="text-gray-400">Returns deducted:</span>
                  <span className="text-red-400 font-bold">-N{returnedTotal.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {/* Tip section — only for non-credit, non-tab payments */}
          {paymentMethod !== 'credit' && paymentMethod !== 'run_tab' && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-green-400 text-sm font-semibold">💚 Tip Recording</p>
                <p className="text-gray-500 text-xs">Optional — enter if customer tipped</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Amount Received (SSP)</label>
                  <input
                    type="number"
                    placeholder={total.toFixed(0)}
                    value={amountReceived}
                    onChange={(e) => {
                      setAmountReceived(e.target.value)
                      const received = parseFloat(e.target.value)
                      if (!isNaN(received) && received > total) {
                        setTipAmount((received - total).toFixed(0))
                      } else {
                        setTipAmount('')
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Tip Amount (SSP)</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    className="w-full bg-gray-800 border border-green-500/40 text-green-400 font-bold rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>
              {parseFloat(tipAmount) > 0 && (
                <div className="flex items-center justify-between bg-green-500/10 rounded-lg px-3 py-2">
                  <p className="text-green-400 text-xs">Tip will be recorded against your name</p>
                  <p className="text-green-400 font-bold">
                    SSP{parseFloat(tipAmount).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            onClick={processPayment}
            disabled={!canProcess()}
            className={`w-full ${paymentMethod === 'credit' ? 'bg-red-500 hover:bg-red-400' : 'bg-amber-500 hover:bg-amber-400'} disabled:bg-gray-800 disabled:text-gray-600 text-black font-bold rounded-xl py-4 text-lg transition-colors`}
          >
            {processing
              ? 'Processing...'
              : paymentMethod === 'run_tab'
                ? 'Run Tab — Continue Ordering'
                : paymentMethod === 'credit'
                  ? `Record SSP${total.toLocaleString()} as Debt`
                  : `Confirm SSP${total.toLocaleString()} Payment`}
          </button>
        </div>
      </div>
    </div>
  )
}
