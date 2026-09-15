import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Beer,
  RefreshCw,
  Save,
  Minus,
  Plus,
  ChevronDown,
  ChevronUp,
  Trash2,
  PlusCircle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import { fetchZoneUnitsPerSale, chillerQty } from '../../lib/zoneUnits'
import { useVisibilityInterval } from '../../hooks/useVisibilityInterval'

const todayStr = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

interface StockEntry {
  id?: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold_qty: number
  void_qty: number
  closing_qty: number
  note: string
}

interface Props {
  onBack: () => void
  embedded?: boolean
}

const buildAcceptedReturnsMap = (
  rows: Array<{ item_name: string | null; quantity: number | null; status: string | null }>
) => {
  const map: Record<string, number> = {}
  for (const row of rows) {
    if (row.status !== 'accepted') continue
    if (!row.item_name) continue
    map[row.item_name] = (map[row.item_name] || 0) + (row.quantity || 0)
  }
  return map
}

// Stepper: +/- buttons + tappable number that opens a picker
function Stepper({
  value,
  onChange,
  label,
  color = 'text-white',
}: {
  value: number
  onChange: (v: number) => void
  label: string
  color?: string
}) {
  const [showPicker, setShowPicker] = useState(false)
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 active:scale-95 flex items-center justify-center text-white transition-all"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className={`w-12 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-sm font-bold ${color} hover:border-amber-500 transition-colors`}
        >
          {value}
        </button>
        <button
          onClick={() => onChange(value + 1)}
          className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 active:scale-95 flex items-center justify-center text-white transition-all"
        >
          <Plus size={16} />
        </button>
      </div>
      {showPicker && (
        <select
          value={value}
          onChange={(e) => {
            onChange(parseInt(e.target.value))
            setShowPicker(false)
          }}
          onBlur={() => setShowPicker(false)}
          autoFocus
          className="w-20 bg-gray-800 border border-amber-500 text-white rounded-lg px-2 py-1 text-sm text-center focus:outline-none"
        >
          {Array.from({ length: 501 }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// Notes with quick-select presets
const NOTE_PRESETS = ['Broken bottle', 'Expired', 'Given out free', 'Damaged label', 'Spillage']

export default function BarChillerStock({ onBack, embedded = false }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [date, setDate] = useState(todayStr())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [menuDrinks, setMenuDrinks] = useState<Array<{ name: string; unit: string }>>([])
  const [stockData, setStockData] = useState<Record<string, StockEntry>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [savedVoidQty, setSavedVoidQty] = useState<Record<string, number>>({})
  const [pendingVoidQty, setPendingVoidQty] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')

  // Load bar menu items
  useEffect(() => {
    supabase
      .from('menu_items')
      .select('name, menu_categories(destination)')
      .eq('is_available', true)
      .order('name')
      .then(({ data }) => {
        if (data) {
          const drinks = (
            data as unknown as Array<{
              name: string
              menu_categories: { destination: string } | null
            }>
          )
            .filter((i) => i.menu_categories?.destination === 'bar')
            .map((i) => ({ name: i.name, unit: 'bottles' }))
          setMenuDrinks(drinks)
        }
      })
  }, [])

  // Load sold quantities from POS — count all items in open/paid orders
  // (bar items are removed from chiller the moment the order is confirmed)
  const loadSoldQty = useCallback(async (d: string) => {
    const dayStart = new Date(d + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const [{ data }, { data: acceptedReturns }, zoneUnits] = await Promise.all([
      supabase
        .from('order_items')
        .select(
          'quantity, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(category_id))'
        )
        .eq('destination', 'bar')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString()),
      supabase
        .from('returns_log')
        .select('item_name, quantity, status')
        .eq('status', 'accepted')
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString()),
      fetchZoneUnitsPerSale(),
    ])
    if (!data) return
    const map: Record<string, number> = {}
    for (const item of data as unknown as Array<{
      quantity: number
      status: string
      return_accepted?: boolean
      menu_item_id?: string | null
      menu_items: { name: string } | null
      orders: { status: string; tables?: { category_id?: string | null } | null } | null
    }>) {
      // Exclude returned items
      if (item.return_accepted) continue
      // Exclude items from cancelled orders
      if (item.orders?.status === 'cancelled') continue
      // Exclude cancelled order items
      if (item.status === 'cancelled') continue
      const name = item.menu_items?.name
      if (name) {
        const units = chillerQty(
          item.quantity,
          zoneUnits,
          item.menu_item_id,
          item.orders?.tables?.category_id ?? null
        )
        map[name] = (map[name] || 0) + units
      }
    }
    const acceptedMap = buildAcceptedReturnsMap(
      (acceptedReturns || []) as Array<{
        item_name: string | null
        quantity: number | null
        status: string | null
      }>
    )
    for (const [name, qty] of Object.entries(acceptedMap)) {
      if (!(name in map)) continue
      map[name] = Math.max(0, (map[name] || 0) - qty)
    }
    setSoldMap(map)
  }, [])

  // Load existing entries for the day
  // Helper: fetch sold map for an arbitrary date (used for carry-over accuracy)
  const fetchSoldMapForDate = useCallback(async (d: string) => {
    const dayStart = new Date(d + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const [{ data }, { data: acceptedReturns }, zoneUnits] = await Promise.all([
      supabase
        .from('order_items')
        .select(
          'quantity, return_accepted, menu_item_id, menu_items(name), orders(status, tables(category_id))'
        )
        .eq('destination', 'bar')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString()),
      supabase
        .from('returns_log')
        .select('item_name, quantity, status')
        .eq('status', 'accepted')
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString()),
      fetchZoneUnitsPerSale(),
    ])
    const map: Record<string, number> = {}
    if (data) {
      for (const item of data as unknown as Array<{
        quantity: number
        return_accepted?: boolean
        menu_item_id?: string | null
        menu_items: { name: string } | null
        orders: { status: string; tables?: { category_id?: string | null } | null } | null
      }>) {
        if (item.return_accepted) continue
        if (item.orders?.status === 'cancelled') continue
        const name = item.menu_items?.name
        if (name) {
          const units = chillerQty(
            item.quantity,
            zoneUnits,
            item.menu_item_id,
            item.orders?.tables?.category_id ?? null
          )
          map[name] = (map[name] || 0) + units
        }
      }
    }
    const acceptedMap = buildAcceptedReturnsMap(
      (acceptedReturns || []) as Array<{
        item_name: string | null
        quantity: number | null
        status: string | null
      }>
    )
    for (const [name, qty] of Object.entries(acceptedMap)) {
      if (!(name in map)) continue
      map[name] = Math.max(0, (map[name] || 0) - qty)
    }
    return map
  }, [])

  const loadEntries = useCallback(
    async (d: string) => {
      setLoading(true)
      await loadSoldQty(d)
      // Also fetch yesterday's sold map to prevent stale carry-over when prior-day entries weren't saved after late sales
      const prevDay = new Date(d)
      prevDay.setDate(prevDay.getDate() - 1)
      const prevDayStr = prevDay.toISOString().slice(0, 10)
      const prevSoldMap = await fetchSoldMapForDate(prevDayStr)

      // Find the most recent stock entry ever saved for each item (no date limit)
      const { data: prevData } = await supabase
        .from('bar_chiller_stock')
        .select('date, item_name, opening_qty, received_qty, sold_qty, void_qty, closing_qty')
        .lt('date', d)
        .order('date', { ascending: false })

      // For each item, find the most recent entry and compute its closing
      const prevClosing: Record<string, number> = {}
      const seenItems = new Set<string>()
      if (prevData) {
        // Data is sorted by date desc — first occurrence of each item is the most recent
        for (const row of prevData as Array<{
          date: string
          item_name: string
          opening_qty: number
          received_qty: number
          sold_qty: number
          void_qty: number
          closing_qty: number
        }>) {
          if (seenItems.has(row.item_name)) continue
          seenItems.add(row.item_name)

          // Always compute closing from formula — never trust stored closing_qty
          // Use live POS sold data, fallback to saved sold_qty
          const actualSold = prevSoldMap[row.item_name] ?? row.sold_qty ?? 0
          prevClosing[row.item_name] = Math.max(
            0,
            row.opening_qty + row.received_qty - actualSold - row.void_qty
          )
        }
      }

      // Load today's entries and pending management approvals
      const dayStart = new Date(d)
      dayStart.setHours(8, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const [{ data: todayData }, { data: pendingRequests }] = await Promise.all([
        supabase.from('bar_chiller_stock').select('*').eq('date', d).order('item_name'),
        supabase
          .from('void_requests')
          .select('item_name, quantity')
          .eq('station', 'bar')
          .eq('status', 'pending')
          .gte('requested_at', dayStart.toISOString())
          .lt('requested_at', dayEnd.toISOString()),
      ])
      const existing: Record<string, StockEntry> = {}
      if (todayData) {
        for (const row of todayData as Array<StockEntry & { id: string }>) {
          existing[row.item_name] = row
        }
      }
      const pendingMap: Record<string, number> = {}
      for (const req of (pendingRequests || []) as Array<{ item_name: string; quantity: number }>) {
        pendingMap[req.item_name] = (pendingMap[req.item_name] || 0) + (req.quantity || 0)
      }

      // Build stock data — start from menu drinks, then add any chiller entries not in menu
      const stock: Record<string, StockEntry> = {}
      for (const drink of menuDrinks) {
        const carryOver = prevClosing[drink.name]
        if (existing[drink.name]) {
          const entry = { ...existing[drink.name] }
          if (carryOver !== undefined && carryOver > 0) {
            entry.opening_qty = carryOver
          }
          stock[drink.name] = entry
        } else {
          stock[drink.name] = {
            item_name: drink.name,
            unit: drink.unit,
            opening_qty: carryOver || 0,
            received_qty: 0,
            sold_qty: 0,
            void_qty: 0,
            closing_qty: 0,
            note: '',
          }
        }
      }
      // Include chiller entries that exist in DB but aren't in the bar menu
      for (const [name, entry] of Object.entries(existing)) {
        if (!stock[name]) {
          const carryOver = prevClosing[name]
          const e = { ...entry }
          if (carryOver !== undefined && carryOver > 0) {
            e.opening_qty = carryOver
          }
          stock[name] = e
        }
      }
      setStockData(stock)
      // Track original void quantities to detect new voids on save
      const origVoids: Record<string, number> = {}
      for (const [name, entry] of Object.entries(stock)) {
        origVoids[name] = entry.void_qty
      }
      setSavedVoidQty(origVoids)
      setPendingVoidQty(pendingMap)
      setHasChanges(false)
      setLoading(false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadSoldQty, menuDrinks]
  )

  useEffect(() => {
    if (menuDrinks.length > 0) loadEntries(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, menuDrinks])

  // Keep saved chiller rows aligned with the live filtered sales count for the selected day.
  useEffect(() => {
    // Intentionally no interval here; handled by visibility-aware polling below to cut egress.
  }, [stockData, soldMap, date, savedVoidQty])

  useVisibilityInterval(
    async () => {
      if (!navigator.onLine) return
      for (const [name, entry] of Object.entries(stockData)) {
        if (!entry.id) continue
        const posSold = soldMap[name] || 0
        const approvedVoid = savedVoidQty[name] ?? entry.void_qty ?? 0
        const closing = Math.max(0, entry.opening_qty + entry.received_qty - posSold - approvedVoid)
        if (posSold > 0 || entry.received_qty > 0 || approvedVoid > 0) {
          await supabase
            .from('bar_chiller_stock')
            .update({
              sold_qty: posSold,
              closing_qty: closing,
              updated_at: new Date().toISOString(),
            })
            .eq('id', entry.id)
        }
      }
    },
    10 * 60 * 1000,
    [stockData, soldMap, date, savedVoidQty],
    { runOnMount: true }
  )

  const updateField = (itemName: string, field: keyof StockEntry, value: number | string) => {
    setStockData((prev) => ({
      ...prev,
      [itemName]: { ...prev[itemName], [field]: value },
    }))
    setHasChanges(true)
  }

  const handleSaveAll = async () => {
    setSaving(true)
    let saved = 0
    for (const [name, entry] of Object.entries(stockData)) {
      // Save entries that have any activity (including POS sold)
      const actualSoldCheck = soldMap[name] || 0
      if (
        entry.opening_qty === 0 &&
        entry.received_qty === 0 &&
        entry.closing_qty === 0 &&
        entry.void_qty === 0 &&
        actualSoldCheck === 0 &&
        !entry.id
      )
        continue

      const actualSold = soldMap[name] || entry.sold_qty || 0
      const approvedVoid = savedVoidQty[name] || 0
      const requestedVoid = Math.max(0, Number(entry.void_qty) || 0)
      // Always save auto-computed closing so it carries over correctly
      const autoClosing = Math.max(
        0,
        entry.opening_qty + entry.received_qty - actualSold - approvedVoid
      )
      const row = {
        date,
        item_name: name,
        unit: entry.unit || 'bottles',
        opening_qty: entry.opening_qty,
        received_qty: entry.received_qty,
        sold_qty: actualSold,
        void_qty: approvedVoid,
        closing_qty: autoClosing,
        note: entry.note || null,
        recorded_by: profile?.id,
        updated_at: new Date().toISOString(),
      }

      if (entry.id) {
        await supabase.from('bar_chiller_stock').update(row).eq('id', entry.id)
        await audit({
          action: 'update',
          entity: 'bar_chiller_stock',
          entityId: entry.id,
          entityName: name,
          newValue: row,
          performer: profile ?? undefined,
        })
      } else {
        const { data: inserted } = await supabase
          .from('bar_chiller_stock')
          .insert(row)
          .select('id')
          .single()
        const newId = inserted?.id
        await audit({
          action: 'create',
          entity: 'bar_chiller_stock',
          entityId: newId,
          entityName: name,
          newValue: row,
          performer: profile ?? undefined,
        })
      }
      // Create void request for any newly added void quantities
      const prevVoid = savedVoidQty[name] || 0
      const prevPending = pendingVoidQty[name] || 0
      if (requestedVoid > prevVoid + prevPending) {
        const delta = requestedVoid - prevVoid - prevPending
        await supabase.from('void_requests').insert({
          id: crypto.randomUUID(),
          item_name: name,
          quantity: delta,
          reason: entry.note || 'Not specified',
          station: 'bar',
          requested_by: profile?.id,
          requested_by_name: profile?.full_name,
          status: 'pending',
          requested_at: new Date().toISOString(),
        })
      }
      saved++
    }
    setSaving(false)
    setHasChanges(false)
    toast.success('Saved', `${saved} item${saved !== 1 ? 's' : ''} updated`)
    loadEntries(date)
  }

  const totalOpening = Object.values(stockData).reduce((s, e) => s + e.opening_qty, 0)
  const totalReceived = Object.values(stockData).reduce((s, e) => s + e.received_qty, 0)
  const totalSold = Object.values(stockData).reduce(
    (s, e) => s + (soldMap[e.item_name] || e.sold_qty || 0),
    0
  )
  const totalVoid = Object.values(stockData).reduce((s, e) => s + e.void_qty, 0)
  const totalPendingVoid = Object.values(pendingVoidQty).reduce((s, qty) => s + qty, 0)
  const totalClosing = Math.max(0, totalOpening + totalReceived - totalSold - totalVoid)

  const handleDelete = async (itemName: string) => {
    if (!isManager) return
    const entry = stockData[itemName]
    setStockData((prev) => {
      const copy = { ...prev }
      delete copy[itemName]
      return copy
    })
    setHasChanges(true)
    if (entry?.id) {
      await supabase.from('bar_chiller_stock').delete().eq('id', entry.id)
      await audit({
        action: 'delete',
        entity: 'bar_chiller_stock',
        entityId: entry.id,
        entityName: itemName,
        oldValue: entry,
        performer: profile ?? undefined,
      })
    }
    toast.success('Removed', `${itemName} removed from ${date}`)
  }

  const handleAddItem = () => {
    if (!isManager) return
    const name = prompt('New item name')
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return
    if (stockData[trimmed]) {
      toast.info('Exists', `${trimmed} already in list`)
      return
    }
    setStockData((prev) => ({
      ...prev,
      [trimmed]: {
        item_name: trimmed,
        unit: 'bottles',
        opening_qty: 0,
        received_qty: 0,
        sold_qty: 0,
        void_qty: 0,
        closing_qty: 0,
        note: '',
      },
    }))
    setHasChanges(true)
  }

  // Only show items that have stock entries or were sold today — hide empty items
  const activeMenuDrinks = menuDrinks.filter(
    (d) =>
      stockData[d.name]?.opening_qty > 0 ||
      stockData[d.name]?.received_qty > 0 ||
      soldMap[d.name] > 0 ||
      stockData[d.name]?.void_qty > 0 ||
      pendingVoidQty[d.name] > 0
  )

  const filtered = search
    ? activeMenuDrinks.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : activeMenuDrinks

  const drinks = filtered.map((d) => ({
    ...d,
    ...(stockData[d.name] || {
      opening_qty: 0,
      received_qty: 0,
      sold_qty: 0,
      void_qty: 0,
      closing_qty: 0,
      note: '',
    }),
    autoSold: soldMap[d.name] || 0,
  }))

  return (
    <div className="min-h-full bg-gray-950">
      {/* Header */}
      {!embedded && (
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-white font-bold">Bar Chiller Stock</h1>
            <p className="text-gray-400 text-xs">Tap +/- to enter stock counts</p>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drink…"
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500 w-48"
          />
          {isManager && (
            <button
              onClick={handleAddItem}
              className="flex items-center gap-1 text-sm bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded-xl hover:border-amber-500"
            >
              <PlusCircle size={16} /> Add Item
            </button>
          )}
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
      )}

      {embedded && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-3">
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <button onClick={() => loadEntries(date)} className="text-gray-400 hover:text-white p-2">
            <RefreshCw size={16} />
          </button>
        </div>
      )}

      <div className="p-4 max-w-2xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-6 gap-2 mb-4">
          {[
            { label: 'Opening', value: totalOpening, color: 'text-white' },
            { label: 'Received', value: totalReceived, color: 'text-green-400' },
            { label: 'Sold (POS)', value: totalSold, color: 'text-blue-400' },
            { label: 'Void', value: totalVoid, color: 'text-red-400' },
            { label: 'Pending', value: totalPendingVoid, color: 'text-amber-400' },
            { label: 'Closing', value: totalClosing, color: 'text-cyan-400' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center"
            >
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>

        {/* Save button — sticky when changes exist */}
        {hasChanges && (
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-3 text-sm mb-4 transition-colors sticky top-0 z-10"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        )}

        {/* Drink list */}
        {loading ? (
          <div className="text-center py-16 text-amber-500">Loading drinks...</div>
        ) : drinks.length === 0 ? (
          <div className="text-center py-16">
            <Beer size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No bar drinks found in menu</p>
          </div>
        ) : (
          <div className="space-y-2">
            {drinks.map((drink) => {
              const isExpanded = expanded === drink.name
              const sold = drink.autoSold || drink.sold_qty || 0
              const pendingVoid = pendingVoidQty[drink.name] || 0
              const rawExpected = drink.opening_qty + drink.received_qty - sold - drink.void_qty
              const effectiveClosing = Math.max(0, rawExpected)
              const variance = 0
              const hasActivity =
                drink.opening_qty > 0 ||
                drink.received_qty > 0 ||
                effectiveClosing > 0 ||
                drink.void_qty > 0 ||
                pendingVoid > 0 ||
                sold > 0

              return (
                <div
                  key={drink.name}
                  className={`bg-gray-900 border rounded-xl overflow-hidden ${
                    hasActivity && variance > 2
                      ? 'border-red-500/40'
                      : hasActivity && variance > 0.5
                        ? 'border-amber-500/30'
                        : 'border-gray-800'
                  }`}
                >
                  {/* Collapsed row — item name + key numbers + expand */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : drink.name)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{drink.name}</p>
                      {hasActivity ? (
                        <p className="text-gray-500 text-xs">
                          Open: {drink.opening_qty} + Rcvd: {drink.received_qty} − Sold: {sold} =
                          Left: {effectiveClosing}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {sold > 0 && <span className="text-xs font-bold text-red-400">−{sold}</span>}
                      {isExpanded ? (
                        <ChevronUp size={14} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-500" />
                      )}
                    </div>
                  </button>

                  {/* Expanded — stepper controls */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-gray-800 space-y-4">
                      {/* Steppers row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-gray-500 text-[9px] uppercase tracking-wider">
                            Opening
                          </span>
                          <div className="w-12 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-sm font-bold text-white">
                            {drink.opening_qty}
                          </div>
                          <span className="text-gray-600 text-[8px]">auto from yesterday</span>
                        </div>
                        {isManager ? (
                          <Stepper
                            label="Received"
                            value={drink.received_qty}
                            onChange={(v) => updateField(drink.name, 'received_qty', v)}
                            color="text-green-400"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-gray-500 text-[9px] uppercase tracking-wider">
                              Received
                            </span>
                            <div className="w-12 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-sm font-bold text-green-400">
                              {drink.received_qty}
                            </div>
                            <span className="text-gray-600 text-[8px]">from store</span>
                          </div>
                        )}
                        <Stepper
                          label="Void/Broken"
                          value={drink.void_qty}
                          onChange={(v) => updateField(drink.name, 'void_qty', v)}
                          color="text-red-400"
                        />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-gray-500 text-[9px] uppercase tracking-wider">
                            Closing
                          </span>
                          <div className="w-12 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-sm font-bold text-cyan-400">
                            {effectiveClosing}
                          </div>
                          <span className="text-gray-600 text-[8px]">auto-computed</span>
                        </div>
                      </div>

                      {/* Sold (auto) */}
                      <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-gray-400 text-xs">Sold (from POS)</span>
                        <span className="text-blue-400 text-sm font-bold">{sold}</span>
                      </div>

                      {/* Warning if formula produces negative */}
                      {rawExpected < 0 && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                          <p className="text-red-400 text-xs font-medium">
                            ⚠ More sold ({sold}) than available ({drink.opening_qty} +{' '}
                            {drink.received_qty})
                          </p>
                          <p className="text-red-400/70 text-xs mt-0.5">
                            {drink.opening_qty === 0
                              ? 'No previous stock data found — this may be the first time tracking this item.'
                              : 'Stock may have been added without recording it as Received.'}
                          </p>
                        </div>
                      )}

                      {/* Formula breakdown */}
                      <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-gray-400 text-xs">
                          Closing = Open + Rcvd − Sold − Void
                        </span>
                        <span className="text-cyan-400 text-sm font-bold">
                          {drink.opening_qty} + {drink.received_qty} − {sold} − {drink.void_qty} ={' '}
                          {effectiveClosing}
                        </span>
                      </div>

                      {pendingVoid > 0 && (
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                          <p className="text-amber-400 text-xs font-medium">
                            {pendingVoid} pending void{pendingVoid > 1 ? 's' : ''} awaiting
                            management approval
                          </p>
                          <p className="text-amber-400/70 text-xs mt-0.5">
                            Stock stays in chiller until management approves the void.
                          </p>
                        </div>
                      )}

                      {isManager && (
                        <button
                          onClick={() => handleDelete(drink.name)}
                          className="w-full flex items-center justify-center gap-2 bg-gray-800 border border-red-600/40 text-red-300 rounded-lg py-2 text-xs hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 size={14} /> Delete entry
                        </button>
                      )}

                      {/* Notes — quick-select presets */}
                      <div>
                        <p className="text-gray-500 text-[9px] uppercase tracking-wider mb-1.5">
                          Notes
                        </p>
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {NOTE_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              onClick={() => {
                                const current = stockData[drink.name]?.note || ''
                                const newNote = current ? `${current}, ${preset}` : preset
                                updateField(drink.name, 'note', newNote)
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                                (stockData[drink.name]?.note || '').includes(preset)
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-gray-800 text-gray-400 hover:text-white'
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        {stockData[drink.name]?.note && (
                          <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                            <span className="text-amber-400 text-xs italic flex-1">
                              {stockData[drink.name].note}
                            </span>
                            <button
                              onClick={() => updateField(drink.name, 'note', '')}
                              className="text-gray-500 hover:text-red-400 text-xs ml-2"
                            >
                              Clear
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
