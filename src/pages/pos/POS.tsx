import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import {
  setPrintServerUrl,
  setStationPrinterUrl,
  printToStation,
  printHtmlToStation,
  getStationPrinterUrl,
  printViaNetwork,
  isNetworkPrinterAvailable,
} from '../../lib/networkPrinter'
import { buildOrderTicket, buildOrderTicketHTML, type TicketItem } from '../../lib/orderTicket'
import type { ItemDestination } from '../../types'
import { HelpTooltip } from '../../components/HelpTooltip'
import { audit } from '../../lib/audit'
import { useAuth } from '../../context/AuthContext'
import { sendPushToStaff, usePushNotifications } from '../../hooks/usePushNotifications'
import {
  LogOut,
  Beer,
  RefreshCw,
  ShoppingBag,
  Phone,
  History,
  Printer,
  TrendingUp,
  Clock,
  Link2,
  Unlink,
  X,
  Check,
  Search,
  Music,
} from 'lucide-react'
import TableGrid from './TableGrid'
import CoversModal from './CoversModal'
import OrderPanel from './OrderPanel'
import ReceiptModal from './ReceiptModal'
import PaymentModal from './PaymentModal'
import CashSaleModal from './CashSaleModal'
import CustomerOrderAlerts from '../../components/CustomerOrderAlerts'
import WaiterCalls from '../management/WaiterCalls'
import type { Table, MenuItem, Order, OrderItem, Profile } from '../../types'
import { useToast } from '../../context/ToastContext'
import { localBulkPut, localGetAll } from '../../lib/db'
import { offlineInsertNoReturn, offlineUpdateNoReturn } from '../../lib/offlineWrite'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'

const normalizeDestination = (
  dest?: string | null,
  name?: string,
  catName?: string
): ItemDestination => {
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
  if (isMixologistItem) return 'mixologist'

  const d = (dest || '').trim().toLowerCase()
  if (d === 'kitchen') return 'kitchen'
  if (d === 'griller' || d === 'grill' || d === 'grilling') return 'griller'
  if (d === 'shisha' || d === 'hookah') return 'shisha'
  if (d === 'games' || d === 'game' || d === 'games_master') return 'games'
  if (d === 'mixologist' || d === 'cocktail' || d === 'cocktails') return 'mixologist'
  if (d === 'bar') return 'bar'
  return 'bar'
}

const currentBusinessDateWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

interface ZonePrice {
  menu_item_id: string
  category_id: string
  price: number
}
interface MenuItemWithZone extends MenuItem {
  hasZonePrice?: boolean
  current_stock?: number | null
}

interface ShiftOrder {
  id: string
  total_amount?: number
  closed_at: string
  tables?: { name: string } | null
  order_items: {
    quantity: number
    total_price?: number | null
    status?: string | null
    return_requested?: boolean | null
    return_accepted?: boolean | null
    menu_items?: { name: string } | null
  }[]
  netTotal?: number
}
interface ShiftStats {
  clockIn?: string
  ordersCount: number
  totalSales: number
  totalItems: number
  uniqueTables: number
  recentOrders: ShiftOrder[]
}

interface HistoryOrder {
  id: string
  total_amount: number
  payment_method?: string | null
  status: string
  order_type: string
  created_at: string
  closed_at?: string | null
  customer_name?: string | null
  staff_id?: string | null
  table_id?: string | null
  notes?: string | null
  tables?: { name: string } | null
  order_items?: (OrderItem & { menu_items?: { name: string } | null })[]
}

interface OrderPayload {
  table: Table
  items: {
    id: string
    name: string
    price: number
    quantity: number
    total: number
    menu_categories?: { name?: string; destination?: string } | null
    modifier_notes?: string
    extra_charge?: number
    destination?: string
  }[]
  notes: string
  total: number
}

interface BarIssueLogRow {
  id: string
  issue_date: string
  order_id: string
  order_item_id: string
  table_id?: string | null
  table_name?: string | null
  waitron_id?: string | null
  waitron_name?: string | null
  menu_item_id?: string | null
  item_name: string
  quantity: number
  unit_price: number
  total_price: number
  station: 'bar'
  source: 'pos_order'
  recorded_by?: string | null
  recorded_by_name?: string | null
  created_at: string
}

/** Desktop menu browser — shown in the left 3/4 when a table is selected */
function DesktopMenuBrowser({
  menuItems,
  onAddItem,
}: {
  menuItems: MenuItem[]
  onAddItem: (item: MenuItem) => void
}) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const categories = [
    'All',
    ...new Set(
      menuItems
        .map((i) => (i as unknown as { menu_categories?: { name?: string } }).menu_categories?.name)
        .filter(Boolean) as string[]
    ),
  ]
  const filtered = menuItems.filter((item) => {
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat =
      activeCategory === 'All' ||
      (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name ===
        activeCategory
    return matchSearch && matchCat
  })
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1.5 px-4 py-2.5 overflow-x-auto border-b border-gray-800 shrink-0 bg-gray-900/50">
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
      <div className="flex px-4 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-amber-500 transition-colors">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-500 hover:text-white">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {filtered.map((item) => {
            return (
              <button
                key={item.id}
                onClick={() => onAddItem(item)}
                className="rounded-xl overflow-hidden text-left transition-all border active:scale-[0.97] bg-gray-800 hover:bg-gray-700 border-gray-700 hover:border-amber-500/50"
              >
                <div className="p-3">
                  <p className="text-white text-sm font-medium leading-tight truncate">
                    {item.name}
                  </p>
                  <p className="text-amber-400 text-sm font-bold mt-1">SSP{item.price.toFixed(2)}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function POS() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  usePushNotifications(profile?.id)
  const isWaitron = profile?.role === 'waitron'

  const [tables, setTables] = useState<Table[]>([])
  const [menuItems, setMenuItems] = useState<MenuItemWithZone[]>([])
  const [zonePrices, setZonePrices] = useState<ZonePrice[]>([])
  const [raveMode, setRaveMode] = useState(false)
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [pendingTable, setPendingTable] = useState<Table | null>(null)
  const [pendingCovers, setPendingCovers] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState<
    | (Order & {
        order_items?: (OrderItem & {
          menu_items?: {
            name: string
            price: number
            menu_categories?: { name?: string; destination?: string } | null
          } | null
        })[]
      })
    | null
  >(null)
  const [assignedTableIds, setAssignedTableIds] = useState<string[] | null>(null)
  const [assignedZoneNames, setAssignedZoneNames] = useState<string[] | null>(null)
  const [defaultZone, setDefaultZone] = useState<string>('All')
  const [posTab, setPosTab] = useState<'tables' | 'history' | 'shift'>('tables')
  const [stationModes, setStationModes] = useState<Record<string, string>>({})
  const [printCopiesConfig, setPrintCopiesConfig] = useState<Record<string, number>>({})
  const [joinMode, setJoinMode] = useState(false)
  const [joinSelection, setJoinSelection] = useState<Table[]>([])
  // Active joins: maps primary table ID → array of secondary table IDs
  const [activeJoins, setActiveJoins] = useState<Record<string, string[]>>({})
  const [orderHistory, setOrderHistory] = useState<HistoryOrder[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [reprintOrder, setReprintOrder] = useState<HistoryOrder | null>(null)
  const [shiftStats, setShiftStats] = useState<ShiftStats | null>(null)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [isClockedIn, setIsClockedIn] = useState<boolean | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showCashSale, setShowCashSale] = useState(false)
  const [cashSaleType, setCashSaleType] = useState<'cash' | 'takeaway'>('cash')

  // Load printer URLs from settings — supports both legacy individual settings
  // and the new network_printers JSON config
  useEffect(() => {
    supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'print_server_url',
        'kitchen_printer_url',
        'griller_printer_url',
        'network_printers',
        'station_modes',
        'print_copies',
      ])
      .then(({ data }) => {
        if (!data) return
        for (const row of data) {
          if (row.id === 'print_server_url' && row.value) setPrintServerUrl(row.value)
          if (row.id === 'kitchen_printer_url' && row.value)
            setStationPrinterUrl('kitchen', row.value)
          if (row.id === 'griller_printer_url' && row.value)
            setStationPrinterUrl('griller', row.value)
          if (row.id === 'station_modes' && row.value) {
            try {
              setStationModes(JSON.parse(row.value))
            } catch {
              /* */
            }
          }
          if (row.id === 'print_copies' && row.value) {
            try {
              setPrintCopiesConfig(JSON.parse(row.value))
            } catch {
              /* */
            }
          }
          // Load from network_printers config (overrides individual settings)
          if (row.id === 'network_printers' && row.value) {
            try {
              const printers = JSON.parse(row.value) as Array<{
                label: string
                ip: string
                port: number
                enabled: boolean
              }>
              for (const p of printers) {
                if (!p.enabled) continue
                const url = `http://${p.ip}:${p.port === 9100 ? 6543 : p.port}`
                if (p.label === 'receipt') setPrintServerUrl(url)
                if (p.label === 'kitchen') setStationPrinterUrl('kitchen', url)
                if (p.label === 'griller') setStationPrinterUrl('griller', url)
                if (p.label === 'bar') setStationPrinterUrl('bar', url)
              }
            } catch {
              /* invalid JSON */
            }
          }
        }
      })
    // Load active table joins
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'active_table_joins')
      .single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            setActiveJoins(JSON.parse(data.value))
          } catch {
            /* invalid JSON */
          }
        }
      })
  }, [])

  const saveJoins = async (joins: Record<string, string[]>) => {
    setActiveJoins(joins)
    await supabase.from('settings').upsert(
      {
        id: 'active_table_joins',
        value: JSON.stringify(joins),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
  }

  const handleJoinConfirm = async () => {
    if (joinSelection.length < 2) {
      toast.error('Select at least 2 tables', 'Tap tables you want to join together')
      return
    }
    const primary = joinSelection[0]
    const secondaryIds = joinSelection.slice(1).map((t) => t.id)
    // Mark all secondary tables as occupied
    for (const id of secondaryIds) {
      await supabase.from('tables').update({ status: 'occupied' }).eq('id', id)
    }
    const newJoins = { ...activeJoins, [primary.id]: secondaryIds }
    await saveJoins(newJoins)
    const joinedNames = joinSelection.map((t) => t.name).join(' + ')
    toast.success('Tables Joined', joinedNames)
    await audit({
      action: 'TABLES_JOINED',
      entity: 'table',
      entityId: primary.id,
      entityName: joinedNames,
      newValue: { primary: primary.name, joined: joinSelection.slice(1).map((t) => t.name) },
      performer: profile as Profile,
    })
    setJoinMode(false)
    setJoinSelection([])
    void fetchTables()
  }

  const handleUnjoin = async (primaryId: string) => {
    const secondaryIds = activeJoins[primaryId] || []
    // Release secondary tables if they have no open orders of their own
    for (const id of secondaryIds) {
      const { data: openOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('table_id', id)
        .eq('status', 'open')
        .limit(1)
      if (!openOrders || openOrders.length === 0) {
        await supabase.from('tables').update({ status: 'available' }).eq('id', id)
      }
    }
    const newJoins = { ...activeJoins }
    delete newJoins[primaryId]
    await saveJoins(newJoins)
    toast.success('Tables Unjoined')
    void fetchTables()
  }

  // Get display name for a table including joined tables
  const _getTableDisplayName = (table: Table): string => {
    const joined = activeJoins[table.id]
    if (!joined || joined.length === 0) return table.name
    const joinedNames = joined.map((id) => tables.find((t) => t.id === id)?.name).filter(Boolean)
    return `${table.name} + ${joinedNames.join(' + ')}`
  }

  useEffect(() => {
    fetchTables()
    fetchMenu()
    fetchZonePrices()
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'rave_mode')
      .single()
      .then(({ data }) => {
        if (data?.value === 'true') setRaveMode(true)
      })
    const channel = supabase
      .channel('tables-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => {
        fetchTables()
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: 'id=eq.rave_mode' },
        (payload) => {
          const newVal = payload.new as { value?: string }
          setRaveMode(newVal?.value === 'true')
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Realtime: refresh active order when order_items or orders change
  // This catches manager DB edits, bar return acceptances, etc.
  useEffect(() => {
    const current = activeOrderRef.current
    if (!current?.id) return

    const refreshActiveOrder = () => {
      const cur = activeOrderRef.current
      if (!cur?.id) return
      supabase
        .from('orders')
        .select(
          `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, total_amount,
          order_items(id, order_id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
            menu_items(name, price, menu_categories(name, destination)))`
        )
        .eq('id', cur.id)
        .single()
        .then(({ data }) => {
          if (data) setActiveOrder(data as any)
        })
    }

    const ch = supabase
      .channel(`active-order-sync-${current.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${current.id}` },
        refreshActiveOrder
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${current.id}` },
        refreshActiveOrder
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [activeOrder?.id])

  // Safety net polling: only while tab is active and an order is open.
  useVisibilityInterval(
    () => {
      const cur = activeOrderRef.current
      if (!cur?.id) return
      supabase
        .from('orders')
        .select(
          `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, total_amount,
        order_items(id, order_id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
          menu_items(name, price, menu_categories(name, destination)))`
        )
        .eq('id', cur.id)
        .single()
        .then(({ data }) => {
          if (data) setActiveOrder(data as any)
        })
    },
    15_000,
    [activeOrder?.id]
  )

  useEffect(() => {
    if (!profile) return
    fetchAssignedTables(profile.role, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const fetchAssignedTables = async (role: string, staffId: string) => {
    if (['owner', 'manager', 'accountant'].includes(role)) {
      setAssignedTableIds(null)
      setAssignedZoneNames(null)
      setIsClockedIn(true)
      return
    }

    // Allow overnight shifts: treat any open attendance row (clock_out is null) as clocked-in,
    // even if the attendance.date is yesterday.
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id, clock_in, date')
      .eq('staff_id', staffId)
      .or('clock_out.is.null')
      .order('clock_in', { ascending: false })
      .limit(1)
    // Only update if we haven't already confirmed clocked-in — prevents mid-session flicker
    const clockedIn = attendance !== null && attendance.length > 0
    setIsClockedIn((prev) => {
      // Once clocked in, don't flip to false due to a network hiccup
      if (prev === true && !clockedIn) return true
      return clockedIn
    })

    const { data: zoneData } = await supabase
      .from('zone_assignments')
      .select('category_id')
      .eq('staff_id', staffId)
      .eq('is_active', true)

    const { data: directTables } = await supabase
      .from('tables')
      .select('id, category_id')
      .eq('assigned_staff', staffId)
    const directIds = (directTables || []).map((t: { id: string }) => t.id)

    if ((!zoneData || zoneData.length === 0) && directIds.length === 0) {
      // No assignments — restrict to nothing (empty arrays = no access)
      setAssignedTableIds([])
      setAssignedZoneNames([])
      return
    }

    const categoryIds = zoneData ? zoneData.map((z: { category_id: string }) => z.category_id) : []

    // Also include category IDs from directly assigned tables
    const directCategoryIds = (directTables || [])
      .map((t: { category_id: string }) => t.category_id)
      .filter(Boolean)
    const allCategoryIds = [...new Set([...categoryIds, ...directCategoryIds])]

    // Fetch all tables in assigned zones
    let zoneIds: string[] = []
    if (categoryIds.length > 0) {
      const { data: zoneTableData } = await supabase
        .from('tables')
        .select('id')
        .in('category_id', categoryIds)
      zoneIds = (zoneTableData || []).map((t: { id: string }) => t.id)
    }

    const combined = [...new Set([...zoneIds, ...directIds])]
    setAssignedTableIds(combined.length > 0 ? combined : [])

    // Resolve zone names from DB — don't rely on tables state which may not be loaded yet
    const { data: categoryData } = await supabase
      .from('table_categories')
      .select('id, name')
      .in('id', allCategoryIds)
    const uniqueZoneNames = (categoryData || []).map((c: { name: string }) => c.name)
    setAssignedZoneNames(uniqueZoneNames.length > 0 ? uniqueZoneNames : [])

    // Auto-open the waitron's zone tab
    if (uniqueZoneNames.length === 1) {
      setDefaultZone(uniqueZoneNames[0])
    } else if (uniqueZoneNames.length > 0) {
      setDefaultZone(uniqueZoneNames[0])
    }
  }

  const activeOrderRef = useRef<typeof activeOrder>(null)
  useEffect(() => {
    activeOrderRef.current = activeOrder
  }, [activeOrder])

  const fullRefresh = () => {
    fetchTables()
    if (profile) fetchAssignedTables(profile.role, profile.id)
    const current = activeOrderRef.current
    if (current) {
      supabase
        .from('orders')
        .select(
          `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, total_amount,
          order_items(id, order_id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
            menu_items(name, price, menu_categories(name, destination)))`
        )
        .eq('id', current.id)
        .single()
        .then(({ data }) => {
          if (data) setActiveOrder(data as any)
        })
    }
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fullRefresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchShiftStats = async () => {
    setShiftLoading(true)
    // Allow overnight shifts: use the open attendance record (clock_out null) as window start.
    // Fallback to today 00:00 WAT if none.
    const today = new Date(Date.now() + 60 * 60 * 1000).toISOString().split('T')[0]
    const { data: attendanceOpen } = await supabase
      .from('attendance')
      .select('clock_in, date')
      .eq('staff_id', profile?.id)
      .or('clock_out.is.null')
      .order('clock_in', { ascending: false })
      .limit(1)
    const activeClockIn = attendanceOpen?.[0]?.clock_in
    const windowStartIso = activeClockIn
      ? new Date(activeClockIn).toISOString()
      : new Date(today).toISOString()
    const [attendanceRes, ordersRes] = await Promise.all([
      // keep a single attendance record for UI display (open shift if available)
      supabase
        .from('attendance')
        .select('clock_in, date')
        .eq('staff_id', profile?.id)
        .or('clock_out.is.null')
        .order('clock_in', { ascending: false })
        .limit(1),
      supabase
        .from('orders')
        .select(
          `id, total_amount, closed_at, tables(name),
          order_items(
            quantity,
            total_price,
            status,
            return_requested,
            return_accepted,
            menu_items(name)
          )`
        )
        .eq('staff_id', profile?.id)
        .eq('status', 'paid')
        .gte('closed_at', windowStartIso),
    ])
    const attendance = attendanceRes.data?.[0] as { clock_in: string } | undefined
    const orders = (ordersRes.data || []) as unknown as ShiftOrder[]

    const filteredOrders = orders.map((o) => {
      const items = o.order_items.filter(
        (i) =>
          !i.return_requested &&
          !i.return_accepted &&
          (i.status || '').toLowerCase() !== 'cancelled'
      )
      const netTotal = items.reduce((s, i) => s + (i.total_price ?? 0), 0)
      return { ...o, order_items: items, netTotal }
    })

    const totalSales = filteredOrders.reduce((s, o) => s + (o.netTotal || 0), 0)
    const totalItems = filteredOrders.reduce(
      (s, o) => s + o.order_items.reduce((ss, i) => ss + (i.quantity || 0), 0),
      0
    )
    const uniqueTables = new Set(orders.map((o) => o.tables?.name).filter(Boolean)).size
    setShiftStats({
      clockIn: attendance?.clock_in,
      ordersCount: orders.length,
      totalSales,
      totalItems,
      uniqueTables,
      recentOrders: filteredOrders.slice(0, 5),
    })
    setShiftLoading(false)
  }

  const fetchHistory = async () => {
    setHistoryLoading(true)
    // Include overnight: start from open clock-in if present, else today's 00:00
    const { data: attendanceOpen } = await supabase
      .from('attendance')
      .select('clock_in')
      .eq('staff_id', profile?.id)
      .or('clock_out.is.null')
      .order('clock_in', { ascending: false })
      .limit(1)
    const windowStart = attendanceOpen?.[0]?.clock_in
      ? new Date(attendanceOpen[0].clock_in)
      : (() => {
          const t = new Date()
          t.setHours(8, 0, 0, 0)
          if (new Date().getHours() < 8) t.setDate(t.getDate() - 1)
          return t
        })()
    const { data } = await supabase
      .from('orders')
      .select(
        `id, total_amount, closed_at, created_at, payment_method, order_type, status, customer_name,
        tables(name),
        order_items(id, menu_item_id, quantity, total_price, status, return_requested, return_accepted, destination, modifier_notes, extra_charge, created_at,
          menu_items(name))`
      )
      .eq('status', 'paid')
      .eq('staff_id', profile?.id)
      .gte('closed_at', windowStart.toISOString())
      .order('closed_at', { ascending: false })
      .limit(60)
    setOrderHistory((data || []) as any as HistoryOrder[])
    setHistoryLoading(false)
  }

  const [tableStaffMap, setTableStaffMap] = useState<Record<string, string>>({})

  const logBarIssues = async (
    sourceItems: OrderPayload['items'],
    persistedRows: Array<{
      id: string
      order_id: string
      menu_item_id?: string | null
      quantity: number
      unit_price: number
      total_price: number
      destination?: string | null
      modifier_notes?: string | null
      created_at: string
    }>,
    table: Table,
    orderId: string
  ) => {
    const issueDate = currentBusinessDateWAT()
    const rows: BarIssueLogRow[] = []

    for (let i = 0; i < Math.min(sourceItems.length, persistedRows.length); i++) {
      const source = sourceItems[i]
      const persisted = persistedRows[i]
      const station = normalizeDestination(
        source.destination || source.menu_categories?.destination,
        source.name,
        source.menu_categories?.name
      )
      if (station !== 'bar') continue
      if (!persisted.menu_item_id) continue

      rows.push({
        id: crypto.randomUUID(),
        issue_date: issueDate,
        order_id: orderId,
        order_item_id: persisted.id,
        table_id: table.id,
        table_name: table.name,
        waitron_id: profile?.id ?? null,
        waitron_name: profile?.full_name ?? null,
        menu_item_id: persisted.menu_item_id ?? null,
        item_name: source.name,
        quantity: persisted.quantity,
        unit_price: persisted.unit_price || 0,
        total_price: persisted.total_price || 0,
        station: 'bar',
        source: 'pos_order',
        recorded_by: profile?.id ?? null,
        recorded_by_name: profile?.full_name ?? null,
        created_at: persisted.created_at,
      })
    }

    if (rows.length === 0) return

    const { error } = await supabase
      .from('bar_issue_log')
      .upsert(rows, { onConflict: 'order_item_id' })
    if (error) {
      console.warn('bar_issue_log insert failed:', error.message)
    }
  }

  const fetchTables = async () => {
    const [tablesRes, openOrdersRes] = await Promise.all([
      supabase
        .from('tables')
        .select(
          'id, name, status, category_id, capacity, assigned_staff, table_categories(id, name, hire_fee)'
        )
        .order('name'),
      supabase
        .from('orders')
        .select('table_id, staff_id')
        .eq('status', 'open')
        .not('table_id', 'is', null),
    ])
    if (!tablesRes.error) {
      setTables((tablesRes.data || []) as any as Table[])
      if (tablesRes.data) {
        void localBulkPut('tables', tablesRes.data as Array<{ id: string }>)
      }
    } else if (!navigator.onLine) {
      const cached = await localGetAll<any>('tables')
      if (cached.length > 0) setTables(cached as any)
    }
    // Build map: table_id → staff_id (who is serving each occupied table)
    if (!openOrdersRes.error && openOrdersRes.data) {
      const map: Record<string, string> = {}
      for (const o of openOrdersRes.data) {
        if (o.table_id && o.staff_id) map[o.table_id] = o.staff_id
      }
      setTableStaffMap(map)
    }
    setLoading(false)
  }

  const fetchMenu = async () => {
    const businessDate = currentBusinessDateWAT()
    const prevBusinessDate = (() => {
      const d = new Date(businessDate + 'T00:00:00+01:00')
      d.setDate(d.getDate() - 1)
      return d.toLocaleDateString('en-CA')
    })()
    const [menuRes, invRes, chillerRes, chillerPrevRes] = await Promise.all([
      supabase
        .from('menu_items')
        .select(
          'id, name, price, rave_price, category_id, description, image_url, is_available, menu_categories(name, destination)'
        )
        .order('name'),
      supabase
        .from('inventory')
        .select('menu_item_id, item_name, current_stock')
        .eq('is_active', true),
      supabase.from('bar_chiller_stock').select('item_name, closing_qty').eq('date', businessDate),
      supabase
        .from('bar_chiller_stock')
        .select('item_name, opening_qty, received_qty, sold_qty, void_qty, closing_qty')
        .eq('date', prevBusinessDate)
        .order('item_name'),
    ])
    if (!menuRes.error) {
      if (menuRes.data) {
        void localBulkPut('menu_items', menuRes.data as Array<{ id: string }>)
      }
      const invMap: Record<string, number> = {}
      const invByName: Record<string, number> = {}
      if (invRes.data)
        invRes.data.forEach(
          (i: { menu_item_id: string | null; item_name: string; current_stock: number }) => {
            if (i.menu_item_id) invMap[i.menu_item_id] = i.current_stock
            invByName[i.item_name] = i.current_stock
          }
        )
      const chillerTodayMap: Record<string, number> = {}
      if (chillerRes.data) {
        chillerRes.data.forEach((row: { item_name: string; closing_qty: number | null }) => {
          chillerTodayMap[row.item_name] = row.closing_qty ?? 0
        })
      }
      const chillerCarryMap: Record<string, number> = {}
      const seen = new Set<string>()
      if (chillerPrevRes.data) {
        chillerPrevRes.data.forEach(
          (row: {
            item_name: string
            opening_qty: number | null
            received_qty: number | null
            sold_qty: number | null
            void_qty: number | null
            closing_qty: number | null
          }) => {
            if (seen.has(row.item_name)) return
            seen.add(row.item_name)
            const fallbackClosing = Math.max(
              0,
              (row.opening_qty || 0) +
                (row.received_qty || 0) -
                (row.sold_qty || 0) -
                (row.void_qty || 0)
            )
            chillerCarryMap[row.item_name] = row.closing_qty ?? fallbackClosing
          }
        )
      }
      setMenuItems(
        (menuRes.data || []).map((item: any) => ({
          ...item,
          current_stock:
            normalizeDestination(
              item.menu_categories?.destination,
              item.name,
              item.menu_categories?.name
            ) === 'bar'
              ? (chillerTodayMap[item.name] ??
                chillerCarryMap[item.name] ??
                invByName[item.name] ??
                invMap[item.id] ??
                null)
              : (invMap[item.id] ?? null),
        }))
      )
    } else if (!navigator.onLine) {
      const cached = await localGetAll<any>('menu_items')
      if (cached.length > 0) {
        setMenuItems(
          cached.map((item: any) => ({
            ...item,
            current_stock: item.current_stock ?? null,
          })) as any
        )
      }
    }
  }

  const fetchZonePrices = async () => {
    const { data, error } = await supabase
      .from('menu_item_zone_prices')
      .select('menu_item_id, category_id, price')
    if (!error) {
      setZonePrices(data || [])
      if (data) {
        void localBulkPut(
          'menu_item_zone_prices',
          data.map((zp: any) => ({
            ...zp,
            id: `${zp.menu_item_id}:${zp.category_id}`,
          })) as Array<{ id: string }>
        )
      }
    } else if (!navigator.onLine) {
      const cached = await localGetAll<any>('menu_item_zone_prices')
      if (cached.length > 0) {
        setZonePrices(
          cached.map((zp: any) => ({
            menu_item_id: zp.menu_item_id,
            category_id: zp.category_id,
            price: zp.price,
          })) as any
        )
      }
    }
  }

  const getMenuItemsWithZonePrices = (table: Table | null): MenuItemWithZone[] => {
    if (!table) return menuItems
    const categoryId = (table as unknown as { table_categories?: { id: string } }).table_categories
      ?.id
    return menuItems.map((item) => {
      const zonePrice = zonePrices.find(
        (zp) => zp.menu_item_id === item.id && zp.category_id === categoryId
      )
      let price = zonePrice ? zonePrice.price : item.price
      if (raveMode && item.rave_price != null) {
        price = item.rave_price
      }
      return { ...item, price, hasZonePrice: !!zonePrice }
    })
  }

  const handleSelectTable = async (table: Table) => {
    // Join mode: toggle table selection instead of opening order
    if (joinMode) {
      setJoinSelection((prev) => {
        const exists = prev.find((t) => t.id === table.id)
        if (exists) return prev.filter((t) => t.id !== table.id)
        return [...prev, table]
      })
      return
    }

    if (!navigator.onLine) {
      // Offline: we can't query existing open orders; allow selecting and creating a new one.
      setActiveOrder(null)
      setShowPayment(false)
      setPendingTable(table)
      return
    }

    // Always check DB for open orders — don't trust table.status alone
    // (table may be 'available' but have an orphaned open order, or vice versa)
    const { data: openOrders } = await supabase
      .from('orders')
      .select(
        `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, covers, total_amount,
        order_items(id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
          menu_items(name, price, menu_categories(name, destination)))`
      )
      .eq('table_id', table.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
    if (openOrders && openOrders.length > 0) {
      // Heal table status if it was wrong
      if (table.status !== 'occupied') {
        void supabase.from('tables').update({ status: 'occupied' }).eq('id', table.id)
      }
      setActiveOrder(openOrders[0] as any)
      setSelectedTable(table)
      setShowPayment(false)
      return
    }
    // No open order — new table, ask for covers
    setActiveOrder(null)
    setShowPayment(false)
    setPendingTable(table)
  }

  const handleCoversConfirmed = (covers: number) => {
    if (!pendingTable) return
    setPendingCovers(covers)
    setSelectedTable(pendingTable)
    setPendingTable(null)
  }

  const handleCoversCancel = () => {
    setPendingTable(null)
  }

  /** Send order tickets to configured station printers (kitchen/griller/bar) */
  const printStationTickets = async (
    items: Array<{
      quantity: number
      name: string
      modifier_notes?: string | null
      destination: ItemDestination
      unit_price?: number
      total_price?: number
      extra_charge?: number
    }>,
    tableName: string,
    orderRef: string,
    staffName: string,
    createdAt: string
  ) => {
    const stations: ItemDestination[] = ['kitchen', 'griller', 'bar', 'mixologist', 'games']
    for (const station of stations) {
      const mode = stationModes[station] || 'display'
      // For bar: skip printing if display-only
      // For kitchen/griller: ALWAYS print if a printer is configured (they need physical tickets)
      if (station === 'bar' && mode === 'display') continue
      const stationUrl = getStationPrinterUrl(station)
      // If no dedicated station printer, fall back to main print server
      if (!stationUrl) {
        const available = await isNetworkPrinterAvailable()
        if (!available) continue
      }

      const stationItems: TicketItem[] = items
        .filter((i) => normalizeDestination(i.destination) === station)
        .map((i) => ({
          quantity: i.quantity,
          name: i.name,
          modifier_notes: i.modifier_notes,
          unit_price: i.unit_price ?? null,
          total_price: (i.total_price ?? 0) + (i.extra_charge ?? 0),
        }))
      if (stationItems.length === 0) continue

      const ticketData = {
        station,
        tableName,
        orderRef,
        staffName,
        items: stationItems,
        createdAt,
      }
      const escPosTicket = buildOrderTicket(ticketData)
      const htmlTicket = buildOrderTicketHTML(ticketData)

      // Print the configured number of copies — kitchen/griller default to 2
      const defaultCopies = station === 'kitchen' || station === 'griller' ? 2 : 1
      const configuredRaw = printCopiesConfig[station]
      const configured = Number(configuredRaw)
      const copies =
        Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : defaultCopies
      // Try ESC/POS first, fall back to HTML if it fails
      try {
        if (stationUrl) {
          await printToStation(station, escPosTicket, copies)
        } else {
          await printViaNetwork(escPosTicket)
        }
      } catch {
        if (stationUrl) {
          printHtmlToStation(station, htmlTicket, copies).catch(() => {})
        }
      }
    }
  }

  const orderPanelAddItemRef = useRef<((item: MenuItem) => void) | null>(null)
  const placingOrderRef = useRef(false)
  const notifyMixologists = async (tableName: string) => {
    if (!navigator.onLine) return
    try {
      const cacheKey = 'mixologist_staff_cache_v1'
      const raw = localStorage.getItem(cacheKey)
      const cached = raw ? (JSON.parse(raw) as { at: number; ids: string[] }) : null
      let ids = cached?.ids || []
      if (
        !cached ||
        !cached.at ||
        Date.now() - cached.at > 6 * 60 * 60 * 1000 ||
        ids.length === 0
      ) {
        const { data } = await supabase
          .from('profiles')
          .select('id')
          .eq('role', 'mixologist')
          .eq('is_active', true)
          .limit(10)
        ids = (data || []).map((r: any) => r.id).filter(Boolean)
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), ids }))
      }
      await Promise.all(
        ids.map((id) =>
          sendPushToStaff(
            id,
            '🍸 New Mixologist Order',
            `${tableName} has new cocktails to accept`,
            { screen: 'mixologist_kds' }
          )
        )
      )
    } catch {
      /* best-effort */
    }
  }

  const handlePlaceOrder = async ({ table, items, notes, total }: OrderPayload) => {
    if (placingOrderRef.current) return
    placingOrderRef.current = true
    try {
      if (activeOrder) {
        const newTotal = (activeOrder.total_amount || 0) + total
        await supabase
          .from('orders')
          .update({
            total_amount: newTotal,
            notes: notes || activeOrder.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeOrder.id)
        const newItems = items.map((item) => {
          const isPack = (item.modifier_notes || '').startsWith('Takeaway Pack')
          return {
            id: crypto.randomUUID(),
            order_id: activeOrder.id,
            menu_item_id: Object.prototype.hasOwnProperty.call(item, 'menu_item_id')
              ? (item as unknown as { menu_item_id: string | null }).menu_item_id
              : item.id,
            quantity: item.quantity,
            unit_price: item.price,
            total_price: item.total,
            status: isPack ? 'pending' : 'pending',
            destination: isPack
              ? 'kitchen'
              : normalizeDestination(
                  item.menu_categories?.destination,
                  item.name,
                  item.menu_categories?.name
                ),
            modifier_notes: item.modifier_notes || null,
            extra_charge: item.extra_charge || 0,
            created_at: new Date().toISOString(),
          }
        })
        for (const item of newItems) {
          const { error } = await supabase.from('order_items').insert(item)
          if (error) {
            toast.error('Error', 'Error adding items: ' + error.message)
            return
          }
        }
        const hasMixo = newItems.some(
          (i) => String(i.destination || '').toLowerCase() === 'mixologist'
        )
        if (hasMixo) void notifyMixologists(table.name)
        await logBarIssues(items, newItems, table, activeOrder.id)
        printStationTickets(
          items.map((i) => ({
            quantity: i.quantity,
            name: i.name,
            modifier_notes: i.modifier_notes || null,
            unit_price: i.price,
            total_price: i.total,
            extra_charge: i.extra_charge || 0,
            destination: normalizeDestination(
              i.destination || i.menu_categories?.destination,
              i.name,
              i.menu_categories?.name
            ),
          })),
          table.name,
          activeOrder.id.slice(0, 8).toUpperCase(),
          profile?.full_name || '',
          new Date().toISOString()
        )
        await audit({
          action: 'ORDER_UPDATED',
          entity: 'order',
          entityId: activeOrder.id,
          entityName: 'Table ' + table.name,
          newValue: { addedItems: items.length, newTotal },
          performer: profile as Profile,
        })
        const { data: refreshed } = await supabase
          .from('orders')
          .select(
            `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, total_amount,
            order_items(id, order_id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
              menu_items(name, price, menu_categories(name, destination)))`
          )
          .eq('id', activeOrder.id)
          .single()
        if (refreshed) setActiveOrder(refreshed as any)
        setShowPayment(true)
        return
      }

      // Last-chance DB check — prevent duplicate open orders on same table
      const { data: existingOpen } = await supabase
        .from('orders')
        .select(
          `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, total_amount,
          order_items(id, order_id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
            menu_items(name, price, menu_categories(name, destination)))`
        )
        .eq('table_id', table.id)
        .eq('status', 'open')
        .limit(1)
      if (existingOpen && existingOpen.length > 0) {
        setActiveOrder(existingOpen[0] as any)
        setShowPayment(true)
        return
      }

      const orderId = crypto.randomUUID()
      const hireFeeAmt =
        (table as unknown as { table_categories?: { hire_fee?: number | null } }).table_categories
          ?.hire_fee || 0
      const orderRecord = {
        id: orderId,
        table_id: table.id,
        staff_id: profile!.id,
        order_type: 'table',
        status: 'open',
        total_amount: total + hireFeeAmt,
        notes,
        covers: pendingCovers,
        created_at: new Date().toISOString(),
      }
      const { error: orderError } = navigator.onLine
        ? await supabase.from('orders').insert(orderRecord)
        : await offlineInsertNoReturn('orders', orderRecord as any)
      setPendingCovers(null)
      if (orderError) {
        console.error('Order error:', orderError)
        toast.error('Error', 'Error creating order: ' + orderError.message)
        return
      }
      const newOrder = { id: orderId } as Order

      // Auto-add hire fee as first line item if this zone charges one
      const hireFee = (table as unknown as { table_categories?: { hire_fee?: number | null } })
        .table_categories?.hire_fee
      const baseItems =
        hireFee && hireFee > 0
          ? [
              {
                id: crypto.randomUUID(),
                order_id: orderId,
                menu_item_id: null,
                quantity: 1,
                unit_price: hireFee,
                total_price: hireFee,
                status: 'delivered', // hire fee is charged immediately, not a kitchen item
                destination: 'bar',
                modifier_notes: `Zone hire fee — ${table.table_categories?.name || 'The Nook'}`,
                extra_charge: 0,
                created_at: new Date().toISOString(),
                is_hire_fee: true,
              },
            ]
          : []

      const orderItemRows = [
        ...baseItems,
        ...items.map((item) => {
          const isPack = (item.modifier_notes || '').startsWith('Takeaway Pack')
          return {
            id: crypto.randomUUID(),
            order_id: (newOrder as Order).id,
            menu_item_id: Object.prototype.hasOwnProperty.call(item, 'menu_item_id')
              ? (item as unknown as { menu_item_id: string | null }).menu_item_id
              : item.id,
            quantity: item.quantity,
            unit_price: item.price,
            total_price: item.total,
            status: isPack ? 'pending' : 'pending',
            destination: isPack
              ? 'kitchen'
              : normalizeDestination(
                  item.menu_categories?.destination,
                  item.name,
                  item.menu_categories?.name
                ),
            modifier_notes: item.modifier_notes || null,
            extra_charge: item.extra_charge || 0,
            created_at: new Date().toISOString(),
          }
        }),
      ]
      for (const item of orderItemRows) {
        const { error } = navigator.onLine
          ? await supabase.from('order_items').insert(item)
          : await offlineInsertNoReturn('order_items', item as any)
        if (error) {
          toast.error('Error', 'Error adding items: ' + error.message)
          return
        }
      }
      const hasMixo = orderItemRows.some(
        (i) => String((i as any).destination || '').toLowerCase() === 'mixologist'
      )
      if (hasMixo) void notifyMixologists(table.name)
      if (!navigator.onLine) {
        // Persist occupied state locally and queue update; remote will be updated on sync.
        void offlineUpdateNoReturn('tables', table.id, { status: 'occupied' } as any)
      }
      await logBarIssues(items, orderItemRows.slice(baseItems.length), table, orderId)
      printStationTickets(
        items.map((i) => ({
          quantity: i.quantity,
          name: i.name,
          modifier_notes: i.modifier_notes || null,
          unit_price: i.price,
          total_price: i.total,
          extra_charge: i.extra_charge || 0,
          destination: normalizeDestination(
            i.destination || i.menu_categories?.destination,
            i.name,
            i.menu_categories?.name
          ),
        })),
        table.name,
        (newOrder as Order).id.slice(0, 8).toUpperCase(),
        profile?.full_name || '',
        new Date().toISOString()
      )
      await audit({
        action: 'ORDER_CREATED',
        entity: 'order',
        entityId: (newOrder as Order).id,
        entityName: 'Table ' + table.name,
        newValue: { total, items: items.length, table: table.name },
        performer: profile as Profile,
      })
      await supabase.from('tables').update({ status: 'occupied' }).eq('id', table.id)
      // Reload the newly created order so PaymentModal has full order_items
      const { data: freshOrder } = await supabase
        .from('orders')
        .select(
          `id, created_at, status, table_id, staff_id, order_type, payment_method, customer_name, notes, covers, total_amount,
          order_items(id, menu_item_id, quantity, status, destination, modifier_notes, extra_charge, unit_price, total_price, return_requested, return_accepted, return_reason, created_at,
            menu_items(name, price, menu_categories(name, destination)))`
        )
        .eq('id', (newOrder as Order).id)
        .single()
      if (freshOrder) {
        setActiveOrder(freshOrder as any)
        setShowPayment(true)
      }
      // Refresh table grid in background — don't await so it doesn't block modal
      void fetchTables()
    } catch (err) {
      console.error('handlePlaceOrder error:', err)
      toast.error('Error', 'Order failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      placingOrderRef.current = false
    }
  }

  const openCashSale = (type: 'cash' | 'takeaway') => {
    setCashSaleType(type)
    setShowCashSale(true)
  }

  useEffect(() => {
    if (isWaitron && posTab !== 'tables') setPosTab('tables')
  }, [isWaitron, posTab])


  if (isClockedIn === false)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
            <LogOut size={28} className="text-red-400" />
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-black font-bold text-lg">B</span>
          </div>
          <h2 className="text-lg font-bold text-red-400 mb-2">You are not clocked in</h2>
          <p className="text-gray-400 text-sm mb-2">
            Please ask your manager to clock you in before you can access the POS.
          </p>
          <button
            onClick={signOut}
            className="mt-6 flex items-center gap-2 mx-auto bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>
    )

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col">
      <WaiterCalls />
      <CustomerOrderAlerts profile={profile} assignedTableIds={assignedTableIds || []} />

      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
              <Beer size={15} className="text-black" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-white font-bold text-sm">Kolondiro Place</h1>
              <p className="text-gray-400 text-xs">Point of Sale</p>
            </div>
            <span className="sm:hidden text-white font-bold text-sm">POS</span>
            {raveMode && (
              <span className="flex items-center gap-1 bg-pink-600 text-white text-xs font-bold px-2.5 py-1 rounded-xl animate-pulse">
                <Music size={12} /> RAVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => openCashSale('cash')}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-2.5 py-2 rounded-xl transition-colors"
            >
              <ShoppingBag size={13} />
              <span className="hidden sm:inline">Cash Sale</span>
            </button>
            <button
              onClick={() => openCashSale('takeaway')}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-2.5 py-2 rounded-xl transition-colors"
            >
              <Phone size={13} />
              <span className="hidden sm:inline">Takeaway</span>
            </button>
            <button
              onClick={() => {
                if (joinMode) {
                  setJoinMode(false)
                  setJoinSelection([])
                } else {
                  setJoinMode(true)
                  setJoinSelection([])
                }
              }}
              className={`flex items-center gap-1 text-xs font-bold px-2.5 py-2 rounded-xl transition-colors ${
                joinMode
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
            >
              {joinMode ? <X size={13} /> : <Link2 size={13} />}
              <span className="hidden sm:inline">{joinMode ? 'Cancel' : 'Join'}</span>
            </button>
            <button
              onClick={fullRefresh}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white active:rotate-180 transition-transform duration-300"
            >
              <RefreshCw size={15} />
            </button>
            <div className="hidden sm:block text-right">
              <p className="text-white text-xs">{profile?.full_name}</p>
              <p className="text-amber-500 text-xs capitalize">{profile?.role}</p>
            </div>
            <HelpTooltip
              storageKey="pos"
              tips={[
                {
                  id: 'pos-clockin',
                  title: 'Clock In Required',
                  description:
                    'You must be clocked in by a manager before accessing the POS. If you see a locked screen, contact your shift manager. The manager also assigns you a POS machine terminal at clock-in — this links all your sales to that device for end-of-shift reconciliation.',
                },
                {
                  id: 'pos-tables',
                  title: 'Table Grid',
                  description:
                    'Your assigned tables are shown here colour-coded by zone. Green = available, amber/coloured = occupied. Tap an occupied table to add more items or proceed to payment. Tables outside your assigned zone are greyed out. Use the zone filter tabs to focus on your area.',
                },
                {
                  id: 'pos-search',
                  title: 'Menu Search',
                  description:
                    'Type any item name in the search bar to filter the menu instantly. Use it together with category tabs — select Drinks first, then type "chap" to find Chapman immediately.',
                },
                {
                  id: 'pos-cashsale',
                  title: 'Cash Sale',
                  description:
                    'For counter walk-ins who pay immediately. No table needed — pick items and process payment on the spot. Inventory is depleted at payment, not at order time.',
                },
                {
                  id: 'pos-takeaway',
                  title: 'Takeaway',
                  description:
                    'For phone-in or walk-in orders to go. Enter the customer name and phone number, select items, and process payment. The order appears on the relevant KDS screens.',
                },
                {
                  id: 'pos-zonepricing',
                  title: 'Zone Pricing & Hire Fee',
                  description:
                    'Drink prices vary by zone — Outdoor, Indoor, VIP Lounge, and The Nook each have their own tier. Food is always fixed price. The correct price is applied automatically. If a zone has a hire fee (e.g. The Nook), a banner reminds you to add it to the bill.',
                },
                {
                  id: 'pos-payment',
                  title: 'Processing Payment',
                  description:
                    'Tap Pay on any open order. Choose Cash, Bank POS, Transfer, or Credit (runs a tab). Split Bill divides the order between multiple people, each paying separately. Run Tab keeps the order open to add more items later. Inventory is depleted at the point of payment.',
                },
                {
                  id: 'pos-void',
                  title: 'Voiding an Item',
                  description:
                    'Tap the minus/delete button on any existing order item. A manager PIN is required. Once confirmed, the item is deleted from the database, the order total is reduced, and the KDS ticket is updated. Voids cannot be processed while the payment screen is open.',
                },
                {
                  id: 'pos-split',
                  title: 'Split Payment',
                  description:
                    'Use Split Bill to divide the check between 2–6 people. Assign items to each person, then collect payment from each one in turn using any payment method. All splits must be completed before the order closes.',
                },
                {
                  id: 'pos-credit',
                  title: 'Credit / Account Payment',
                  description:
                    'Selecting Credit creates a debtor record for the customer. If the customer already has an account (matched by phone number), their existing balance is increased rather than creating a duplicate entry.',
                },
                {
                  id: 'pos-shift',
                  title: 'My Shift Tab',
                  description:
                    'Your shift summary — clock-in time, POS machine assigned, orders closed, tables served, and total sales. Refreshes in real time. Use this before clocking out to verify your figures match the till.',
                },
              ]}
            />
            <button
              onClick={signOut}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      <div className="flex border-b border-gray-800 bg-gray-900 px-4">
        {(isWaitron
          ? ([['tables', Beer, 'Tables']] as const)
          : ([
              ['tables', Beer, 'Tables'],
              ['history', History, 'My Orders'],
              ['shift', TrendingUp, 'My Shift'],
            ] as const)
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => {
              setPosTab(id)
              if (id === 'history') fetchHistory()
              if (id === 'shift') fetchShiftStats()
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${posTab === id ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-500 hover:text-white'}`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {posTab === 'tables' && (
          <div className={`flex flex-1 flex-col overflow-hidden`}>
            {/* Join mode banner */}
            {joinMode && (
              <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Link2 size={16} className="text-amber-400" />
                  <span className="text-amber-400 text-sm font-bold">
                    Join Tables — tap{' '}
                    {joinSelection.length < 2
                      ? `${2 - joinSelection.length} more`
                      : 'tables to add, or confirm'}
                  </span>
                  {joinSelection.length > 0 && (
                    <span className="text-amber-300 text-xs bg-amber-500/20 px-2 py-0.5 rounded-lg">
                      {joinSelection.map((t) => t.name).join(' + ')}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleJoinConfirm}
                  disabled={joinSelection.length < 2}
                  className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-xs px-3 py-1.5 rounded-xl transition-colors"
                >
                  <Check size={13} /> Join {joinSelection.length} Tables
                </button>
              </div>
            )}

            {/* Active joins indicator */}
            {Object.keys(activeJoins).length > 0 && !joinMode && (
              <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-3 overflow-x-auto shrink-0">
                <Link2 size={13} className="text-gray-500 shrink-0" />
                {Object.entries(activeJoins).map(([primaryId, secondaryIds]) => {
                  const primary = tables.find((t) => t.id === primaryId)
                  if (!primary) return null
                  const names = [
                    primary.name,
                    ...secondaryIds
                      .map((id) => tables.find((t) => t.id === id)?.name)
                      .filter(Boolean),
                  ]
                  return (
                    <div
                      key={primaryId}
                      className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1 shrink-0"
                    >
                      <span className="text-amber-400 text-xs font-medium">
                        {names.join(' + ')}
                      </span>
                      <button
                        onClick={() => handleUnjoin(primaryId)}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                        title="Unjoin tables"
                      >
                        <Unlink size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {!selectedTable ? (
              <TableGrid
                tables={tables}
                onSelectTable={handleSelectTable}
                selectedTable={selectedTable}
                assignedTableIds={assignedTableIds}
                assignedZoneNames={assignedZoneNames}
                defaultCategory={defaultZone}
                tableStaffMap={tableStaffMap}
                currentStaffId={profile?.id || null}
                currentRole={profile?.role || null}
                joinMode={joinMode}
                joinSelectedIds={joinSelection.map((t) => t.id)}
                activeJoins={activeJoins}
              />
            ) : (
              <div className="hidden md:flex flex-1 flex-col overflow-hidden">
                <DesktopMenuBrowser
                  menuItems={getMenuItemsWithZonePrices(selectedTable) as MenuItem[]}
                  onAddItem={(item) => {
                    orderPanelAddItemRef.current?.(item)
                  }}
                />
              </div>
            )}
          </div>
        )}

        {posTab === 'shift' && (
          <div className="flex-1 overflow-y-auto">
            {shiftLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={20} className="animate-spin text-amber-500" />
              </div>
            ) : !shiftStats ? (
              <div className="text-center py-16">
                <Clock size={32} className="text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No shift data available</p>
              </div>
            ) : (
              <div className="max-w-lg mx-auto p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-white text-lg font-bold">My Shift Summary</h2>
                    <p className="text-gray-500 text-xs">
                      {profile?.full_name} —{' '}
                      {new Date().toLocaleDateString('en-SS', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <button onClick={fetchShiftStats} className="text-gray-500 hover:text-white p-2">
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={() => {
                      if (!shiftStats) return
                      const W = 40
                      const div = '-'.repeat(W)
                      const sol = '='.repeat(W)
                      const row = (l: string, r: string) => {
                        const left = l.substring(0, W - r.length - 1)
                        return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
                      }
                      const ctr = (s: string) =>
                        ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
                      const fmt = (n: number) => `N${n.toLocaleString()}`
                      const fmtDate = new Date().toLocaleDateString('en-SS', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })

                      const lines: string[] = [
                        '',
                        ctr("KOLONDIRO"),
                        ctr('SHIFT SUMMARY'),
                        div,
                        row('Waitron:', profile?.full_name || 'Staff'),
                        row('Date:', fmtDate),
                        ...(shiftStats.clockIn
                          ? [
                              row(
                                'Clock In:',
                                new Date(shiftStats.clockIn).toLocaleTimeString('en-SS', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                })
                              ),
                            ]
                          : []),
                        row(
                          'Printed:',
                          new Date().toLocaleTimeString('en-SS', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })
                        ),
                        div,
                        ctr('SALES SUMMARY'),
                        div,
                        row('Total Orders:', String(shiftStats.ordersCount)),
                        row('Total Items:', String(shiftStats.totalItems)),
                        row('Tables Served:', String(shiftStats.uniqueTables)),
                        sol,
                        row('TOTAL SALES:', fmt(shiftStats.totalSales)),
                        sol,
                        '',
                        ctr('ORDER BREAKDOWN'),
                        div,
                      ]

                      shiftStats.recentOrders.forEach((o, idx) => {
                        const time = new Date(o.closed_at).toLocaleTimeString('en-SS', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })
                        lines.push(
                          row(`${idx + 1}. ${o.tables?.name || 'Cash Sale'}`, fmt(o.netTotal || 0))
                        )
                        lines.push(row(`   ${time}`, ''))
                        o.order_items.forEach((i) => {
                          lines.push(
                            row(
                              `   ${i.quantity}x ${i.menu_items?.name || 'Item'}`,
                              fmt(i.total_price || 0)
                            )
                          )
                        })
                        lines.push('')
                      })

                      lines.push(sol)
                      lines.push(row('TOTAL:', fmt(shiftStats.totalSales)))
                      lines.push(sol)
                      lines.push('')
                      lines.push(ctr('*** END OF SUMMARY ***'))
                      lines.push('')

                      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Shift Summary — ${profile?.full_name}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre;}@media print{body{width:80mm;}@page{margin:0;size:80mm auto;}}</style></head><body>${lines.join('\n')}</body></html>`
                      const w = window.open('', '_blank', 'width=400,height=600,toolbar=no')
                      if (!w) return
                      w.document.open('text/html', 'replace')
                      w.document.write(html)
                      w.document.close()
                      w.onload = () =>
                        setTimeout(() => {
                          try {
                            w.print()
                          } catch {
                            /* ignore */
                          }
                          w.close()
                        }, 200)
                    }}
                    className="text-xs bg-amber-500 text-black px-3 py-1.5 rounded-lg font-semibold hover:bg-amber-400"
                  >
                    Print Summary
                  </button>
                </div>

                {/* Clock info */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                        <Clock size={18} className="text-green-400" />
                      </div>
                      <div>
                        <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                          Clocked In
                        </p>
                        <p className="text-white font-bold text-lg">
                          {shiftStats.clockIn
                            ? new Date(shiftStats.clockIn).toLocaleTimeString('en-SS', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              })
                            : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider">On Shift</p>
                      <p className="text-white font-bold text-lg">
                        {shiftStats.clockIn
                          ? (() => {
                              const mins = Math.floor(
                                (Date.now() - new Date(shiftStats.clockIn).getTime()) / 60000
                              )
                              const h = Math.floor(mins / 60)
                              const m = mins % 60
                              return h > 0 ? `${h}h ${m}m` : `${m} min`
                            })()
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Total Sales — hero stat */}
                <div className="bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-amber-500/30 rounded-2xl p-5 mb-4 text-center">
                  <p className="text-amber-400/70 text-[10px] uppercase tracking-widest mb-1">
                    Total Sales
                  </p>
                  <p className="text-amber-400 text-4xl font-bold tracking-tight">
                    SSP
                    {shiftStats.totalSales.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                {/* Performance stats */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {(
                    [
                      {
                        label: 'Orders',
                        value: shiftStats.ordersCount,
                        color: 'text-blue-400',
                        bg: 'bg-blue-500/10',
                        border: 'border-blue-500/20',
                      },
                      {
                        label: 'Tables',
                        value: shiftStats.uniqueTables,
                        color: 'text-green-400',
                        bg: 'bg-green-500/10',
                        border: 'border-green-500/20',
                      },
                      {
                        label: 'Items',
                        value: shiftStats.totalItems,
                        color: 'text-purple-400',
                        bg: 'bg-purple-500/10',
                        border: 'border-purple-500/20',
                      },
                    ] as const
                  ).map(({ label, value, color, bg, border }) => (
                    <div
                      key={label}
                      className={`${bg} border ${border} rounded-2xl p-3 text-center`}
                    >
                      <p className={`text-2xl font-bold ${color}`}>{value}</p>
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider mt-0.5">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Recent orders breakdown */}
                {shiftStats.recentOrders.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-[10px] uppercase tracking-widest mb-3">
                      Recent Orders
                    </p>
                    <div className="space-y-2">
                      {shiftStats.recentOrders.map((order) => {
                        const itemCount = order.order_items.reduce(
                          (s, i) => s + (i.quantity || 0),
                          0
                        )
                        return (
                          <div
                            key={order.id}
                            className="bg-gray-900 border border-gray-800 rounded-xl p-3"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <p className="text-white text-sm font-semibold">
                                {order.tables?.name || 'Cash Sale'}
                              </p>
                              <p className="text-amber-400 font-bold text-sm">
                                SSP{(order.netTotal || 0).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-gray-500 text-xs">
                                {new Date(order.closed_at).toLocaleTimeString('en-SS', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                                {' · '}
                                {itemCount} item{itemCount !== 1 ? 's' : ''}
                              </p>
                            </div>
                            {order.order_items.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-gray-800 space-y-0.5">
                                {order.order_items.map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="text-gray-400">
                                      {item.quantity}x{' '}
                                      {item.menu_items?.name ||
                                        (item as unknown as { modifier_notes?: string })
                                          .modifier_notes ||
                                        'Item'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {posTab === 'history' && (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-lg mx-auto p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-white text-lg font-bold">My Orders</h2>
                  <p className="text-gray-500 text-xs">
                    Today's closed orders — {orderHistory.length} total
                  </p>
                </div>
                <button onClick={fetchHistory} className="text-gray-500 hover:text-white p-2">
                  <RefreshCw size={14} />
                </button>
              </div>
              {historyLoading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw size={20} className="animate-spin text-amber-500" />
                </div>
              ) : orderHistory.length === 0 ? (
                <div className="text-center py-16">
                  <History size={32} className="text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No orders closed today</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orderHistory.map((order) => {
                    const pmRaw = (order.payment_method || '').toLowerCase()
                    const pmLabel =
                      pmRaw === 'cash'
                        ? 'Cash'
                        : pmRaw === 'card'
                          ? 'Bank POS'
                          : pmRaw === 'credit'
                            ? 'Credit'
                            : pmRaw.startsWith('transfer')
                              ? 'Transfer'
                              : pmRaw === 'split'
                                ? 'Split'
                                : pmRaw || '—'
                    const activeItems = (order.order_items || []).filter(
                      (i) =>
                        !(i as unknown as { return_requested?: boolean }).return_requested &&
                        !(i as unknown as { return_accepted?: boolean }).return_accepted
                    )
                    const itemCount = activeItems.reduce((s, i) => s + (i.quantity || 0), 0)
                    const displayTotal = activeItems.reduce((s, i) => s + (i.total_price || 0), 0)
                    return (
                      <div
                        key={order.id}
                        className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
                      >
                        {/* Order header */}
                        <div className="px-4 py-3 flex items-center justify-between">
                          <div>
                            <p className="text-white font-semibold text-sm">
                              {order.tables?.name ||
                                (order as unknown as { customer_name?: string }).customer_name ||
                                (order.order_type === 'takeaway' ? 'Takeaway' : 'Cash Sale')}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-gray-500 text-xs">
                                {new Date(
                                  (order as unknown as { closed_at: string }).closed_at
                                ).toLocaleTimeString('en-SS', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                              </span>
                              <span className="text-gray-700 text-xs">|</span>
                              <span className="text-gray-400 text-xs">{pmLabel}</span>
                              <span className="text-gray-700 text-xs">|</span>
                              <span className="text-gray-500 text-xs">
                                {itemCount} item{itemCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                          <div className="text-right flex items-center gap-3">
                            <p className="text-amber-400 font-bold">
                              SSP{displayTotal.toLocaleString()}
                            </p>
                            <button
                              onClick={() => setReprintOrder(order)}
                              className="flex items-center gap-1 text-gray-500 hover:text-white text-xs px-2 py-1 bg-gray-800 rounded-lg transition-colors"
                            >
                              <Printer size={11} /> Reprint
                            </button>
                          </div>
                        </div>
                        {/* Item breakdown — only active items (not returned) */}
                        {activeItems.length > 0 && (
                          <div className="px-4 py-2.5 bg-gray-950 border-t border-gray-800">
                            <table className="w-full text-xs">
                              <tbody>
                                {activeItems.map((item) => (
                                  <tr key={item.id}>
                                    <td className="text-gray-500 py-0.5 pr-2 w-8 text-right">
                                      {item.quantity}x
                                    </td>
                                    <td className="text-gray-300 py-0.5">
                                      {(item as unknown as { menu_items?: { name: string } })
                                        .menu_items?.name ||
                                        (item as unknown as { modifier_notes?: string })
                                          .modifier_notes ||
                                        'Item'}
                                    </td>
                                    <td className="text-gray-400 py-0.5 text-right pl-2">
                                      SSP{(item.total_price || 0).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Desktop: compact order sidebar (1/4 width) */}
        {selectedTable && !showPayment && (
          <div
            className="hidden md:flex w-1/4 min-w-[280px] max-w-[360px] border-l border-gray-800 flex-col overflow-hidden"
            style={{ height: '100%' }}
          >
            <OrderPanel
              table={selectedTable}
              menuItems={getMenuItemsWithZonePrices(selectedTable) as MenuItem[]}
              paymentInProgress={showPayment}
              profile={profile}
              onPlaceOrder={handlePlaceOrder}
              activeOrder={activeOrder}
              compact
              onRegisterAddItem={(addFn) => {
                orderPanelAddItemRef.current = addFn
              }}
              onClose={() => {
                setSelectedTable(null)
                setActiveOrder(null)
              }}
            />
          </div>
        )}

        {/* Mobile: full-screen overlay */}
        {selectedTable && !showPayment && (
          <div className="md:hidden fixed inset-0 z-50 bg-gray-950 flex flex-col overflow-hidden">
            <OrderPanel
              table={selectedTable}
              menuItems={getMenuItemsWithZonePrices(selectedTable) as MenuItem[]}
              paymentInProgress={showPayment}
              profile={profile}
              onPlaceOrder={handlePlaceOrder}
              activeOrder={activeOrder}
              onClose={() => {
                setSelectedTable(null)
                setActiveOrder(null)
              }}
            />
          </div>
        )}
      </div>

      {showPayment && activeOrder && selectedTable && (
        <PaymentModal
          order={activeOrder}
          table={selectedTable}
          onSuccess={async () => {
            // Release joined tables if this was a primary table
            if (selectedTable && activeJoins[selectedTable.id]) {
              await handleUnjoin(selectedTable.id)
            }
            setShowPayment(false)
            setActiveOrder(null)
            setSelectedTable(null)
            fetchTables()
          }}
          onClose={() => {
            setShowPayment(false)
            setActiveOrder(null)
            setSelectedTable(null)
          }}
        />
      )}

      {showCashSale && (
        <CashSaleModal
          type={cashSaleType}
          menuItems={menuItems as MenuItem[]}
          staffId={profile!.id}
          onSuccess={() => setShowCashSale(false)}
          onClose={() => setShowCashSale(false)}
        />
      )}

      {reprintOrder && (
        <ReceiptModal
          order={reprintOrder as unknown as import('../../types').Order}
          table={
            reprintOrder.tables
              ? (reprintOrder.tables as unknown as import('../../types').Table)
              : ({
                  name:
                    (reprintOrder as unknown as { customer_name?: string }).customer_name ||
                    'Cash Sale',
                } as import('../../types').Table)
          }
          items={(reprintOrder.order_items || []) as import('../../types').OrderItem[]}
          staffName={profile?.full_name || ''}
          autoPrint={false}
          onClose={() => setReprintOrder(null)}
        />
      )}

      {/* Covers modal — shown when waitron selects an available table */}
      {pendingTable && (
        <CoversModal
          tableName={pendingTable.name}
          onConfirm={handleCoversConfirmed}
          onCancel={handleCoversCancel}
        />
      )}
    </div>
  )
}
