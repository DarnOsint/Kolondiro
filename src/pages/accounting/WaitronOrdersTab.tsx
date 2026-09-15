import { useState, useEffect, useCallback } from 'react'
import { Users, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getNetOrderAmount, getValidOrderItemCount, getValidOrderItems } from './orderAmounts'

const todayWAT = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })).toLocaleDateString(
    'en-CA'
  )

interface WaitronShift {
  staff_id: string
  staff_name: string
  role: string
  zone?: string
  clock_in: string
  clock_out?: string
}

interface WaitronOrder {
  id: string
  status?: string
  total_amount: number
  payment_method: string
  order_type: string
  created_at: string
  closed_at?: string
  tables?: { name: string; table_categories?: { name: string } } | null
  order_items?: Array<{
    quantity: number
    total_price: number
    destination?: string
    menu_items?: {
      name: string
      menu_categories?: { name: string; destination?: string } | null
    } | null
    modifier_notes?: string
    return_requested?: boolean
    return_accepted?: boolean
    status?: string
  }>
}

type StationKey = 'bar' | 'kitchen' | 'griller' | 'shisha' | 'games' | 'mixologist'
type BarBucket = 'drinks' | 'wine' | 'spirits'

const STATION_LABELS: Record<StationKey, string> = {
  bar: 'Bar',
  kitchen: 'Kitchen',
  griller: 'Grill',
  shisha: 'Shisha',
  games: 'Games',
  mixologist: 'Mixologist',
}

const normalizeDestination = (
  dest?: string | null,
  name?: string | null,
  catName?: string | null
): StationKey => {
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

const getBarBucket = (name?: string | null, catName?: string | null): BarBucket => {
  const lowerName = (name || '').toLowerCase()
  const lowerCat = (catName || '').toLowerCase()
  const isWine =
    lowerCat.includes('wine') ||
    lowerName.includes('wine') ||
    lowerCat.includes('champagne') ||
    lowerName.includes('champagne') ||
    lowerCat.includes('prosecco') ||
    lowerName.includes('prosecco') ||
    lowerCat.includes('sparkling') ||
    lowerName.includes('sparkling')
  if (isWine) return 'wine'
  if (lowerCat.includes('spirit') || lowerName.includes('spirit')) return 'spirits'
  return 'drinks'
}

const sessionWindow = (dateStr: string) => {
  // 8am–8am WAT window, independent of device timezone
  const start = new Date(`${dateStr}T08:00:00+01:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

export default function WaitronOrdersTab() {
  const [date, setDate] = useState(todayWAT())
  const [shifts, setShifts] = useState<WaitronShift[]>([])
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null)
  const [orders, setOrders] = useState<WaitronOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)

  const fetchShifts = useCallback(async (d: string) => {
    setLoading(true)
    const { start, end } = sessionWindow(d)
    const [{ data: attendance }, { data: salesStaff }] = await Promise.all([
      supabase
        .from('attendance')
        .select('staff_id, staff_name, role, clock_in, clock_out')
        .or(
          `and(clock_in.gte.${start.toISOString()},clock_in.lt.${end.toISOString()}),and(clock_in.lt.${end.toISOString()},clock_out.is.null)`
        )
        .order('clock_in', { ascending: true }),
      // Include staff who made sales even if they were not clocked in (missing attendance row).
      // This fixes "sales exist but staff not listed" in Accounting → Waitron Orders.
      supabase
        .from('orders')
        .select('staff_id, profiles(full_name)')
        .not('staff_id', 'is', null)
        .or(
          `and(status.eq.paid,closed_at.gte.${start.toISOString()},closed_at.lt.${end.toISOString()}),and(status.eq.open,created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()})`
        )
        .limit(500),
    ])

    // Deduplicate by staff_id, keep latest attendance entry when present.
    const unique = new Map<string, WaitronShift>()
    for (const s of (attendance || []) as WaitronShift[]) {
      unique.set(s.staff_id, s)
    }
    for (const row of (salesStaff || []) as Array<{
      staff_id: string | null
      profiles?: { full_name?: string | null } | null
    }>) {
      const staffId = row.staff_id
      if (!staffId) continue
      if (unique.has(staffId)) continue
      unique.set(staffId, {
        staff_id: staffId,
        staff_name: row.profiles?.full_name || 'Unknown',
        role: 'sales',
        clock_in: start.toISOString(),
        clock_out: end.toISOString(),
      })
    }

    setShifts(Array.from(unique.values()))
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchShifts(date)
    setSelectedStaff(null)
    setOrders([])
  }, [date, fetchShifts])

  const fetchOrders = async (staffId: string) => {
    setSelectedStaff(staffId)
    setOrdersLoading(true)
    const { start: dayStart, end: dayEnd } = sessionWindow(date)
    const { data } = await supabase
      .from('orders')
      .select(
        'id, status, total_amount, payment_method, order_type, created_at, closed_at, tables(name, table_categories(name)), order_items(quantity, total_price, destination, modifier_notes, return_requested, return_accepted, status, menu_items(name, menu_categories(name, destination)))'
      )
      .eq('staff_id', staffId)
      .or(
        `and(status.eq.paid,closed_at.gte.${dayStart.toISOString()},closed_at.lt.${dayEnd.toISOString()}),and(status.eq.open,created_at.gte.${dayStart.toISOString()},created_at.lt.${dayEnd.toISOString()})`
      )
      .order('created_at', { ascending: true })
    setOrders((data || []) as unknown as WaitronOrder[])
    setOrdersLoading(false)
  }

  const selectedShift = shifts.find((s) => s.staff_id === selectedStaff)
  const validItems = (items: WaitronOrder['order_items']) =>
    getValidOrderItems({ order_items: items })
  const paidOrders = orders.filter((o) => o.status === 'paid')
  const openOrders = orders.filter((o) => o.status !== 'paid')
  const totalSales = orders.reduce((s, o) => s + getNetOrderAmount(o), 0)
  const totalItems = orders.reduce((s, o) => s + getValidOrderItemCount(o), 0)
  const paidSales = paidOrders.reduce((s, o) => s + getNetOrderAmount(o), 0)
  const openSales = openOrders.reduce((s, o) => s + getNetOrderAmount(o), 0)

  const printWaitronReport = () => {
    if (!selectedShift || orders.length === 0) return
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(date).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const summary = {
      bar: {
        totalAmount: 0,
        totalQty: 0,
        items: new Map<string, { qty: number; amount: number }>(),
        drinks: {
          totalAmount: 0,
          totalQty: 0,
          items: new Map<string, { qty: number; amount: number }>(),
        },
        wine: {
          totalAmount: 0,
          totalQty: 0,
          items: new Map<string, { qty: number; amount: number }>(),
        },
        spirits: {
          totalAmount: 0,
          totalQty: 0,
          items: new Map<string, { qty: number; amount: number }>(),
        },
      },
      kitchen: {
        totalAmount: 0,
        totalQty: 0,
        items: new Map<string, { qty: number; amount: number }>(),
      },
      griller: {
        totalAmount: 0,
        totalQty: 0,
        items: new Map<string, { qty: number; amount: number }>(),
      },
      shisha: {
        totalAmount: 0,
        totalQty: 0,
        items: new Map<string, { qty: number; amount: number }>(),
      },
      games: {
        totalAmount: 0,
        totalQty: 0,
        items: new Map<string, { qty: number; amount: number }>(),
      },
      mixologist: {
        totalAmount: 0,
        totalQty: 0,
        items: new Map<string, { qty: number; amount: number }>(),
      },
    }

    const addToBucket = (
      bucket: {
        totalAmount: number
        totalQty: number
        items: Map<string, { qty: number; amount: number }>
      },
      label: string,
      qty: number,
      amount: number
    ) => {
      bucket.totalQty += qty
      bucket.totalAmount += amount
      const existing = bucket.items.get(label) || { qty: 0, amount: 0 }
      existing.qty += qty
      existing.amount += amount
      bucket.items.set(label, existing)
    }

    for (const order of orders) {
      for (const item of validItems(order.order_items)) {
        const itemName = item.menu_items?.name || item.modifier_notes || 'Item'
        const categoryName = item.menu_items?.menu_categories?.name || ''
        const station = normalizeDestination(
          item.destination || item.menu_items?.menu_categories?.destination,
          item.menu_items?.name,
          categoryName
        )
        const qty = item.quantity || 0
        const amount = item.total_price || 0

        if (station === 'bar') {
          const bucket = getBarBucket(item.menu_items?.name, categoryName)
          addToBucket(summary.bar, itemName, qty, amount)
          addToBucket(summary.bar[bucket], itemName, qty, amount)
          continue
        }

        addToBucket(summary[station], itemName, qty, amount)
      }
    }

    const renderBucket = (bucket: {
      totalAmount: number
      totalQty: number
      items: Map<string, { qty: number; amount: number }>
    }) =>
      Array.from(bucket.items.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, data]) => row(`  ${data.qty}x ${name}`, `N${data.amount.toLocaleString()}`))
        .join('\n')

    const sectionBlocks: string[] = []
    ;(['bar', 'kitchen', 'griller', 'shisha', 'games', 'mixologist'] as StationKey[]).forEach(
      (station) => {
        const bucket = summary[station]
        if (bucket.totalQty === 0) return

        if (station === 'bar') {
          const barSections: string[] = [
            STATION_LABELS.bar.toUpperCase(),
            row('  Total Qty:', String(bucket.totalQty)),
            row('  Total Sales:', `N${bucket.totalAmount.toLocaleString()}`),
          ]

          ;(['drinks', 'wine', 'spirits'] as BarBucket[]).forEach((barBucket) => {
            const barSummary = summary.bar[barBucket]
            if (barSummary.totalQty === 0) return
            barSections.push(div)
            barSections.push(
              (barBucket === 'drinks'
                ? 'Drinks'
                : barBucket === 'wine'
                  ? 'Wine'
                  : 'Spirits'
              ).toUpperCase()
            )
            barSections.push(row('  Qty:', String(barSummary.totalQty)))
            barSections.push(row('  Sales:', `N${barSummary.totalAmount.toLocaleString()}`))
            const lines = renderBucket(barSummary)
            if (lines) barSections.push(lines)
          })

          sectionBlocks.push(barSections.join('\n'))
          return
        }

        sectionBlocks.push(
          [
            STATION_LABELS[station].toUpperCase(),
            row('  Qty:', String(bucket.totalQty)),
            row('  Sales:', `N${bucket.totalAmount.toLocaleString()}`),
            renderBucket(bucket),
          ]
            .filter(Boolean)
            .join('\n')
        )
      }
    )

    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('WAITRON ORDER REPORT'),
      div,
      row('Waitron:', selectedShift.staff_name),
      row('Date:', fmtDate),
      row('Orders:', String(orders.length)),
      row('Total Sales:', `N${totalSales.toLocaleString()}`),
      row('Total Items:', String(totalItems)),
      div,
      ctr('SUMMARY BY STATION'),
      div,
      ...sectionBlocks.flatMap((block, index) => (index === 0 ? [block] : ['', block])),
      sol,
      row('TOTAL:', `N${totalSales.toLocaleString()}`),
      sol,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Waitron Report — ${selectedShift.staff_name}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
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
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayWAT()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setDate(todayWAT())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === todayWAT() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : shifts.length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No staff worked on {date}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Staff list */}
          <div className="space-y-2">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">
              {shifts.length} staff on {date}
            </p>
            {shifts.map((s) => (
              <button
                key={s.staff_id}
                onClick={() => fetchOrders(s.staff_id)}
                className={`w-full text-left bg-gray-900 border rounded-xl p-3 transition-colors ${selectedStaff === s.staff_id ? 'border-amber-500 bg-amber-500/5' : 'border-gray-800 hover:border-gray-700'}`}
              >
                <p className="text-white text-sm font-semibold">{s.staff_name}</p>
                <p className="text-gray-500 text-xs capitalize">{s.role}</p>
                <p className="text-gray-600 text-[10px]">
                  {new Date(s.clock_in).toLocaleTimeString('en-NG', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  {s.clock_out
                    ? ` — ${new Date(s.clock_out).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })}`
                    : ' (active)'}
                </p>
              </button>
            ))}
          </div>

          {/* Orders detail */}
          <div className="md:col-span-2">
            {!selectedStaff ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">Select a staff member to view their orders</p>
              </div>
            ) : ordersLoading ? (
              <div className="text-center py-12 text-amber-500">Loading orders...</div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-white font-bold">{selectedShift?.staff_name}</p>
                    <p className="text-gray-400 text-xs">
                      {orders.length} orders · ₦{totalSales.toLocaleString()} · {totalItems} items
                      {orders.length > 0
                        ? ` (paid ₦${paidSales.toLocaleString()} · open ₦${openSales.toLocaleString()})`
                        : ''}
                    </p>
                  </div>
                  {orders.length > 0 && (
                    <button
                      onClick={printWaitronReport}
                      className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors"
                    >
                      <Printer size={12} /> Print Report
                    </button>
                  )}
                </div>
                {orders.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-8">
                    No orders for this staff member on {date}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {orders.map((o, idx) => {
                      const zone = (o.tables as unknown as { table_categories?: { name: string } })
                        ?.table_categories?.name
                      const pm =
                        o.payment_method === 'cash'
                          ? 'Cash'
                          : o.payment_method === 'card'
                            ? 'Bank POS'
                            : o.payment_method === 'credit'
                              ? 'Credit'
                              : o.payment_method?.startsWith('transfer')
                                ? 'Transfer'
                                : o.payment_method || '—'
                      const statusLabel =
                        o.status === 'paid' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            PAID
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            OPEN
                          </span>
                        )
                      return (
                        <div
                          key={o.id}
                          className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
                        >
                          <div className="px-4 py-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 text-xs">{idx + 1}.</span>
                              <span className="text-white text-sm font-semibold">
                                {o.tables?.name || o.order_type}
                              </span>
                              {zone && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                                  {zone}
                                </span>
                              )}
                              {statusLabel}
                            </div>
                            <div className="text-right">
                              <p className="text-amber-400 font-bold text-sm">
                                ₦{getNetOrderAmount(o).toLocaleString()}
                              </p>
                              <p className="text-gray-500 text-[10px]">
                                {new Date(o.closed_at || o.created_at).toLocaleTimeString('en-NG', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                })}{' '}
                                · {pm}
                              </p>
                            </div>
                          </div>
                          <div className="px-4 py-2 bg-gray-950 border-t border-gray-800">
                            <table className="w-full text-xs">
                              <tbody>
                                {validItems(o.order_items).map((item, i) => (
                                  <tr key={i}>
                                    <td className="text-gray-500 py-0.5 pr-2 w-8 text-right">
                                      {item.quantity}x
                                    </td>
                                    <td className="text-gray-300 py-0.5">
                                      {item.menu_items?.name || item.modifier_notes || 'Item'}
                                    </td>
                                    <td className="text-gray-400 py-0.5 text-right pl-2">
                                      ₦{(item.total_price || 0).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
