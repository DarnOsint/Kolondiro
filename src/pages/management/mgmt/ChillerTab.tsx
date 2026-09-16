import { useState, useEffect, useCallback } from 'react'
import { Beer, RefreshCw, Printer, Search, Save, Plus, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { audit } from '../../../lib/audit'
import { fetchZoneUnitsPerSale, chillerQty } from '../../../lib/zoneUnits'
import type { Profile } from '../../../types'

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

interface Row {
  id?: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold: number // live from POS
  void_qty: number
  closing: number // auto-computed
  note: string
}

export default function ChillerTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayWAT())
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [edited, setEdited] = useState<Record<string, Partial<Row>>>({})
  const [salesStats, setSalesStats] = useState<{
    revenue: number
    qty: number
    byZone: Record<string, number>
  }>({ revenue: 0, qty: 0, byZone: {} })
  const [showAdd, setShowAdd] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', qty: '', unit: 'bottles' })

  const fetchData = useCallback(async (d: string) => {
    setLoading(true)
    setEdited({})

    // 8am-8am window
    const dayStart = new Date(d + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [{ data: entries }, { data: soldData }, zoneUnits] = await Promise.all([
      supabase
        .from('bar_chiller_stock')
        .select('id, item_name, unit, opening_qty, received_qty, void_qty, note')
        .eq('date', d)
        .order('item_name'),
      supabase
        .from('order_items')
        .select(
          'quantity, unit_price, total_price, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(name, category_id, table_categories(name)))'
        )
        .eq('destination', 'bar')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString()),
      fetchZoneUnitsPerSale(),
    ])

    // Build sold map + revenue map + zone breakdown from live POS
    const soldMap: Record<string, number> = {}
    let totalSalesRevenue = 0
    let totalSalesQty = 0
    const zoneRevenue: Record<string, number> = {}
    if (soldData) {
      for (const item of soldData as unknown as Array<{
        quantity: number
        unit_price: number
        total_price: number
        status: string
        return_accepted?: boolean
        menu_item_id?: string | null
        menu_items: { name: string } | null
        orders: {
          status: string
          tables?: {
            name: string
            category_id?: string | null
            table_categories?: { id?: string; name: string } | null
          } | null
        } | null
      }>) {
        if (item.return_accepted) continue
        if (item.orders?.status === 'cancelled') continue
        if (item.status === 'cancelled') continue
        const name = item.menu_items?.name
        const rev = item.total_price || (item.unit_price || 0) * (item.quantity || 0)
        const zone = item.orders?.tables?.table_categories?.name || 'Takeaway'
        const categoryId = item.orders?.tables?.category_id ?? null
        if (name) {
          const units = chillerQty(item.quantity, zoneUnits, item.menu_item_id, categoryId)
          soldMap[name] = (soldMap[name] || 0) + units
          totalSalesRevenue += rev
          totalSalesQty += units
          zoneRevenue[zone] = (zoneRevenue[zone] || 0) + rev
        }
      }
    }
    setSalesStats({ revenue: totalSalesRevenue, qty: totalSalesQty, byZone: zoneRevenue })

    // Build rows from DB entries + overlay live sold
    const display: Row[] = (
      (entries || []) as Array<{
        id: string
        item_name: string
        unit: string
        opening_qty: number
        received_qty: number
        void_qty: number
        note: string
      }>
    ).map((e) => {
      const sold = soldMap[e.item_name] || 0
      return {
        id: e.id,
        item_name: e.item_name,
        unit: e.unit,
        opening_qty: e.opening_qty,
        received_qty: e.received_qty,
        sold,
        void_qty: e.void_qty,
        closing: Math.max(0, e.opening_qty + e.received_qty - sold - e.void_qty),
        note: e.note || '',
      }
    })

    // Add synthetic rows for items sold but not in stock register
    const entryNames = new Set(display.map((r) => r.item_name))
    for (const [name, qty] of Object.entries(soldMap)) {
      if (!entryNames.has(name)) {
        display.push({
          item_name: name,
          unit: 'bottles',
          opening_qty: 0,
          received_qty: 0,
          sold: qty,
          void_qty: 0,
          closing: 0,
          note: 'Sold without stock entry',
        })
      }
    }

    display.sort((a, b) => a.item_name.localeCompare(b.item_name))
    setRows(display)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(date)
  }, [date, fetchData])

  const getRow = (name: string) => {
    const base = rows.find((r) => r.item_name === name)
    const edits = edited[name]
    if (!base) return null
    const merged = { ...base, ...edits }
    merged.closing = Math.max(
      0,
      merged.opening_qty + merged.received_qty - merged.sold - merged.void_qty
    )
    return merged
  }

  const updateField = (name: string, field: string, value: number | string) => {
    setEdited((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || {}), [field]: value },
    }))
  }

  const hasEdits = Object.keys(edited).length > 0

  const saveAll = async () => {
    setSaving(true)
    let count = 0
    for (const [name, _edits] of Object.entries(edited)) {
      const row = getRow(name)
      if (!row) continue
      const payload = {
        date,
        item_name: name,
        unit: row.unit || 'bottles',
        opening_qty: row.opening_qty,
        received_qty: row.received_qty,
        sold_qty: row.sold,
        void_qty: row.void_qty,
        closing_qty: row.closing,
        note: row.note || null,
        recorded_by: profile?.id,
        updated_at: new Date().toISOString(),
      }
      if (row.id) {
        await supabase.from('bar_chiller_stock').update(payload).eq('id', row.id)
      } else {
        await supabase.from('bar_chiller_stock').insert(payload)
      }
      count++
    }
    await audit({
      action: 'CHILLER_MGMT_EDIT',
      entity: 'bar_chiller_stock',
      entityName: `${count} items on ${date}`,
      newValue: edited,
      performer: profile as Profile,
    })
    setSaving(false)
    setEdited({})
    toast.success('Saved', `${count} item${count !== 1 ? 's' : ''} updated`)
    fetchData(date)
  }

  const addItem = async () => {
    const name = newItem.name.trim()
    const qty = parseInt(newItem.qty) || 0
    if (!name) {
      toast.warning('Required', 'Enter item name')
      return
    }
    if (rows.find((r) => r.item_name.toLowerCase() === name.toLowerCase())) {
      toast.warning('Exists', `${name} is already in the chiller`)
      return
    }
    setSaving(true)
    try {
      // 1. Add to chiller for today
      await supabase.from('bar_chiller_stock').insert({
        date,
        item_name: name,
        unit: newItem.unit,
        opening_qty: qty,
        received_qty: 0,
        sold_qty: 0,
        void_qty: 0,
        closing_qty: qty,
        recorded_by: profile?.id,
        updated_at: new Date().toISOString(),
      })

      // 2. Check if item exists in inventory — if not, create it
      const { data: invExists } = await supabase
        .from('inventory')
        .select('id')
        .eq('item_name', name)
        .limit(1)
      if (!invExists || invExists.length === 0) {
        await supabase.from('inventory').insert({
          item_name: name,
          category: 'Drinks',
          unit: newItem.unit,
          current_stock: qty,
          minimum_stock: 5,
          cost_price: 0,
          selling_price: 0,
          is_active: true,
        })
      }

      // 3. Check if item exists in bar menu — if not, create it
      const { data: menuExists } = await supabase
        .from('menu_items')
        .select('id')
        .eq('name', name)
        .limit(1)
      let menuItemId = menuExists?.[0]?.id
      if (!menuItemId) {
        const { data: catData } = await supabase
          .from('menu_categories')
          .select('id')
          .eq('name', 'Drinks')
          .eq('destination', 'bar')
          .single()
        if (catData) {
          const { data: inserted } = await supabase
            .from('menu_items')
            .insert({ name, category_id: catData.id, price: 0, is_available: true })
            .select('id')
            .single()
          menuItemId = inserted?.id
          // Link inventory to menu item
          if (menuItemId) {
            await supabase
              .from('inventory')
              .update({ menu_item_id: menuItemId })
              .eq('item_name', name)
          }
        }
      }

      // 4. Log restock
      if (qty > 0) {
        const { data: invRow } = await supabase
          .from('inventory')
          .select('id')
          .eq('item_name', name)
          .single()
        if (invRow) {
          await supabase.from('restock_log').insert({
            inventory_id: invRow.id,
            item_name: name,
            quantity_added: qty,
            previous_stock: 0,
            new_stock: qty,
            cost_price_per_unit: 0,
            total_cost: 0,
            payment_method: 'cash',
            condition: 'good',
            notes: 'Added via management chiller',
            restocked_by: profile?.id,
            restocked_by_name: profile?.full_name,
            restocked_at: new Date().toISOString(),
          })
        }
      }

      await audit({
        action: 'CHILLER_ITEM_ADDED',
        entity: 'bar_chiller_stock',
        entityName: name,
        newValue: { quantity: qty, unit: newItem.unit, date },
        performer: profile as Profile,
      })

      toast.success('Added', `${name} added to chiller, inventory, and menu`)
      setShowAdd(false)
      setNewItem({ name: '', qty: '', unit: 'bottles' })
      fetchData(date)
    } catch (e: any) {
      toast.error('Error', e?.message || 'Failed to add item')
    }
    setSaving(false)
  }

  const filtered = search
    ? rows.filter((r) => r.item_name.toLowerCase().includes(search.toLowerCase()))
    : rows

  // Compute totals from merged data (edits applied)
  const totals = filtered.reduce(
    (t, r) => {
      const m = getRow(r.item_name) || r
      return {
        opening: t.opening + m.opening_qty,
        received: t.received + m.received_qty,
        sold: t.sold + m.sold,
        void_qty: t.void_qty + m.void_qty,
        closing: t.closing + m.closing,
      }
    },
    { opening: 0, received: 0, sold: 0, void_qty: 0, closing: 0 }
  )

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const r = (l: string, rv: string) => {
      const left = l.substring(0, W - rv.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - rv.length)) + rv
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(date).toLocaleDateString('en-SS', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('BAR CHILLER REPORT'),
      div,
      r('Date:', fmtDate),
      r('Items:', String(rows.length)),
      div,
      r('Opening:', String(totals.opening)),
      r('Received:', String(totals.received)),
      r('Sold:', String(totals.sold)),
      r('Void:', String(totals.void_qty)),
      r('Closing:', String(totals.closing)),
      sol,
      div,
      ctr('ITEM BREAKDOWN'),
      div,
      ...rows.map((row) => {
        const m = getRow(row.item_name) || row
        return [
          r(
            m.item_name,
            `O:${m.opening_qty} R:${m.received_qty} S:${m.sold} V:${m.void_qty} C:${m.closing}`
          ),
          m.note ? `  ${m.note}` : '',
          '',
        ]
          .filter(Boolean)
          .join('\n')
      }),
      div,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Chiller — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    w.onload = () =>
      setTimeout(() => {
        try {
          w.print()
        } catch {
          /* */
        }
      }, 200)
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
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
            setDate(d.toLocaleDateString('en-CA'))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white"
        >
          Prev Day
        </button>
        <button onClick={() => fetchData(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
        {hasEdits && (
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-4 py-2 rounded-xl"
          >
            <Save size={13} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white font-bold text-xs px-3 py-2 rounded-xl"
        >
          <Plus size={13} /> Add Item
        </button>
        {rows.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {/* Add Item Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Add Item to Chiller</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="text-gray-500 text-xs mb-4">
              This will also add the item to the drink menu and main store inventory.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Item name"
                value={newItem.name}
                onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <input
                type="number"
                placeholder="Opening quantity"
                value={newItem.qty}
                onChange={(e) => setNewItem((p) => ({ ...p, qty: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <select
                value={newItem.unit}
                onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="bottles">Bottles</option>
                <option value="crates">Crates</option>
                <option value="packs">Packs</option>
                <option value="pieces">Pieces</option>
                <option value="cartons">Cartons</option>
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={addItem}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-amber-500 text-black font-bold rounded-xl text-sm hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <Beer size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No chiller data for {date}</p>
        </div>
      ) : (
        <>
          {/* Sales Revenue Banner */}
          {salesStats.revenue > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-amber-400 text-xs font-bold uppercase tracking-wider">
                    Bar Sales Revenue
                  </p>
                  <p className="text-white text-2xl font-black mt-1">
                    SSP{salesStats.revenue.toLocaleString()}
                  </p>
                  <p className="text-gray-400 text-xs">{salesStats.qty} drinks sold</p>
                </div>
              </div>
              {Object.keys(salesStats.byZone).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-amber-500/20">
                  {Object.entries(salesStats.byZone)
                    .sort((a, b) => b[1] - a[1])
                    .map(([zone, rev]) => (
                      <div key={zone} className="text-center">
                        <p className="text-amber-400 font-bold text-sm">SSP{rev.toLocaleString()}</p>
                        <p className="text-gray-500 text-[9px] uppercase tracking-wider">{zone}</p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* KPI strip */}
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              { label: 'Opening', value: totals.opening, color: 'text-white' },
              { label: 'Received', value: totals.received, color: 'text-green-400' },
              { label: 'Sold', value: totals.sold, color: 'text-blue-400' },
              { label: 'Void', value: totals.void_qty, color: 'text-red-400' },
              { label: 'Closing', value: totals.closing, color: 'text-cyan-400' },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center"
              >
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-gray-500 text-[9px] uppercase tracking-wider">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-2 py-2">Open</th>
                  <th className="text-right px-2 py-2">Rcvd</th>
                  <th className="text-right px-2 py-2">Sold</th>
                  <th className="text-right px-2 py-2">Void</th>
                  <th className="text-right px-2 py-2">Close</th>
                  <th className="text-left px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const m = getRow(row.item_name) || row
                  const isEdited = !!edited[row.item_name]
                  return (
                    <tr
                      key={row.id || row.item_name}
                      className={`border-t border-gray-800 ${isEdited ? 'bg-amber-500/5' : 'hover:bg-gray-800/50'}`}
                    >
                      <td className="text-white px-3 py-2 font-medium">{m.item_name}</td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          value={m.opening_qty}
                          onChange={(e) =>
                            updateField(m.item_name, 'opening_qty', Number(e.target.value) || 0)
                          }
                          className="w-14 bg-gray-800 border border-gray-700 text-white text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          value={m.received_qty}
                          onChange={(e) =>
                            updateField(m.item_name, 'received_qty', Number(e.target.value) || 0)
                          }
                          className="w-14 bg-gray-800 border border-gray-700 text-green-400 text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-green-500"
                        />
                      </td>
                      <td className="text-blue-400 text-right px-2 py-2 font-medium">
                        {m.sold || '–'}
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          value={m.void_qty}
                          onChange={(e) =>
                            updateField(m.item_name, 'void_qty', Number(e.target.value) || 0)
                          }
                          className="w-14 bg-gray-800 border border-gray-700 text-red-400 text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-red-500"
                        />
                      </td>
                      <td
                        className={`text-right px-2 py-2 font-bold ${m.sold > 0 ? 'text-amber-400' : 'text-cyan-400'}`}
                      >
                        {m.closing}
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          value={m.note}
                          placeholder="–"
                          onChange={(e) => updateField(m.item_name, 'note', e.target.value)}
                          className="w-24 bg-gray-800 border border-gray-700 text-gray-400 rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500 truncate"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                  <td className="text-white px-3 py-2">TOTAL</td>
                  <td className="text-white text-right px-2 py-2">{totals.opening}</td>
                  <td className="text-green-400 text-right px-2 py-2">{totals.received}</td>
                  <td className="text-blue-400 text-right px-2 py-2">{totals.sold}</td>
                  <td className="text-red-400 text-right px-2 py-2">{totals.void_qty}</td>
                  <td className="text-cyan-400 text-right px-2 py-2">{totals.closing}</td>
                  <td className="px-2 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
