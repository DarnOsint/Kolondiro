import { useState, useEffect, useCallback } from 'react'
import { Refrigerator, Plus, RefreshCw, Printer, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { audit } from '../../../lib/audit'
import type { Profile } from '../../../types'

interface FridgeEntry {
  id: string
  item_name: string
  quantity: number
  cost_price: number
  total_cost: number
  waitron_name: string
  waitron_id: string
  recorded_by_name: string
  created_at: string
}

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

export default function KitchenFridgeTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayWAT())
  const [entries, setEntries] = useState<FridgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [foodItems, setFoodItems] = useState<Array<{ id: string; name: string; price: number }>>([])
  const [waitrons, setWaitrons] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState({ item: '', waitron: '', qty: '1' })
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async (d: string) => {
    setLoading(true)
    const dayStart = new Date(d + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [{ data: entries }, { data: menu }, { data: staff }] = await Promise.all([
      supabase
        .from('kitchen_fridge_log')
        .select(
          'id, item_name, quantity, cost_price, total_cost, waitron_name, waitron_id, recorded_by_name, created_at'
        )
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('menu_items')
        .select('id, name, price, menu_categories(destination)')
        .eq('is_available', true),
      supabase
        .from('attendance')
        .select('staff_id, staff_name')
        .or('clock_out.is.null')
        .order('staff_name'),
    ])

    setEntries((entries || []) as FridgeEntry[])

    const foods = ((menu || []) as any[])
      .filter(
        (i) =>
          i.menu_categories?.destination === 'kitchen' ||
          i.menu_categories?.destination === 'griller'
      )
      .map((i) => ({ id: i.id, name: i.name, price: i.price }))
    setFoodItems(foods)

    const unique = new Map<string, string>()
    ;((staff || []) as Array<{ staff_id: string; staff_name: string }>).forEach((s) =>
      unique.set(s.staff_id, s.staff_name)
    )
    setWaitrons(Array.from(unique.entries()).map(([id, name]) => ({ id, name })))

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(date)
  }, [date, fetchData])

  const addEntry = async () => {
    const food = foodItems.find((f) => f.name === form.item)
    const waitron = waitrons.find((w) => w.id === form.waitron)
    if (!food) {
      toast.warning('Required', 'Select a food item')
      return
    }
    if (!waitron) {
      toast.warning('Required', 'Select the waitron')
      return
    }
    const qty = parseInt(form.qty) || 1
    const totalCost = food.price * qty

    setSaving(true)
    // Record in fridge log
    const { error } = await supabase.from('kitchen_fridge_log').insert({
      item_name: food.name,
      menu_item_id: food.id,
      quantity: qty,
      cost_price: food.price,
      total_cost: totalCost,
      waitron_id: waitron.id,
      waitron_name: waitron.name,
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    })
    if (error) {
      toast.error('Error', error.message)
      setSaving(false)
      return
    }

    // Auto-add as debt against the waitron
    const { data: existingDebtor } = await supabase
      .from('debtors')
      .select('id, balance, current_balance')
      .eq('name', waitron.name)
      .eq('debt_type', 'fridge')
      .eq('status', 'outstanding')
      .limit(1)

    if (existingDebtor && existingDebtor.length > 0) {
      await supabase
        .from('debtors')
        .update({
          balance: (existingDebtor[0].balance || 0) + totalCost,
          current_balance: (existingDebtor[0].current_balance || 0) + totalCost,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDebtor[0].id)
    } else {
      await supabase.from('debtors').insert({
        name: waitron.name,
        phone: '',
        debt_type: 'fridge',
        credit_limit: totalCost,
        balance: totalCost,
        current_balance: totalCost,
        amount_paid: 0,
        status: 'outstanding',
        is_active: true,
        notes: 'Kitchen fridge — unsold food',
        recorded_by: profile?.id,
        recorded_by_name: profile?.full_name,
      })
    }

    await audit({
      action: 'FRIDGE_ITEM_RECORDED',
      entity: 'kitchen_fridge_log',
      entityName: `${qty}x ${food.name}`,
      newValue: { item: food.name, qty, cost: totalCost, waitron: waitron.name },
      performer: profile as Profile,
    })

    toast.success(
      'Recorded',
      `${qty}x ${food.name} (SSP${totalCost.toLocaleString()}) charged to ${waitron.name}`
    )
    setShowAdd(false)
    setForm({ item: '', waitron: '', qty: '1' })
    setSaving(false)
    fetchData(date)
  }

  const totalCost = entries.reduce((s, e) => s + (e.total_cost || 0), 0)
  const totalItems = entries.reduce((s, e) => s + (e.quantity || 0), 0)

  // Group by waitron
  const byWaitron: Record<string, { count: number; cost: number }> = {}
  entries.forEach((e) => {
    if (!byWaitron[e.waitron_name]) byWaitron[e.waitron_name] = { count: 0, cost: 0 }
    byWaitron[e.waitron_name].count += e.quantity
    byWaitron[e.waitron_name].cost += e.total_cost
  })

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const r = (l: string, rv: string) => {
      const left = l.substring(0, W - rv.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - rv.length)) + rv
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('KITCHEN FRIDGE LOG'),
      div,
      r(
        'Date:',
        new Date(date).toLocaleDateString('en-SS', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      ),
      r('Total Items:', String(totalItems)),
      r('Total Cost:', `N${totalCost.toLocaleString()}`),
      div,
      '',
      ...entries.map((e) =>
        [
          r(`${e.quantity}x ${e.item_name}`, `N${e.total_cost.toLocaleString()}`),
          `  Waitron: ${e.waitron_name}`,
          '',
        ].join('\n')
      ),
      div,
      ctr('BY WAITRON'),
      div,
      ...Object.entries(byWaitron).map(([name, v]) =>
        r(name, `${v.count} items N${v.cost.toLocaleString()}`)
      ),
      sol,
      r('TOTAL:', `N${totalCost.toLocaleString()}`),
      sol,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kitchen Fridge</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
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
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-white font-bold text-lg flex items-center gap-2">
          <Refrigerator size={18} className="text-cyan-400" /> Kitchen Refrigerator
        </h3>
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
        <button onClick={() => fetchData(date)} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs px-3 py-2 rounded-xl"
        >
          <Plus size={13} /> Record Item
        </button>
        {entries.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-white text-xl font-bold">{entries.length}</p>
          <p className="text-gray-500 text-[9px] uppercase tracking-wider">Entries</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-cyan-400 text-xl font-bold">{totalItems}</p>
          <p className="text-gray-500 text-[9px] uppercase tracking-wider">Items</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-red-400 text-xl font-bold">SSP{totalCost.toLocaleString()}</p>
          <p className="text-gray-500 text-[9px] uppercase tracking-wider">Total Cost</p>
        </div>
      </div>

      {/* By Waitron summary */}
      {Object.keys(byWaitron).length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-white text-sm font-bold mb-2">Charged by Waitron</p>
          {Object.entries(byWaitron)
            .sort((a, b) => b[1].cost - a[1].cost)
            .map(([name, v]) => (
              <div
                key={name}
                className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0"
              >
                <span className="text-gray-300 text-sm">{name}</span>
                <span className="text-red-400 text-sm font-bold">
                  {v.count} items · SSP{v.cost.toLocaleString()}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Entries list */}
      {loading ? (
        <div className="text-cyan-400 text-center py-8">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <Refrigerator size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            No fridge entries for {date === todayWAT() ? 'today' : date}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-white font-semibold text-sm">
                  {e.quantity}x {e.item_name}
                </p>
                <p className="text-gray-400 text-xs">
                  Waitron: {e.waitron_name} · by {e.recorded_by_name}
                </p>
                <p className="text-gray-500 text-xs">
                  {new Date(e.created_at).toLocaleTimeString('en-SS', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'Africa/Lagos',
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-red-400 font-bold">SSP{e.total_cost.toLocaleString()}</p>
                <p className="text-gray-500 text-xs">SSP{e.cost_price.toLocaleString()}/each</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Record Unsold Food</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="text-gray-500 text-xs mb-4">
              This will be charged as debt against the waitron's name.
            </p>
            <div className="space-y-3">
              <select
                value={form.item}
                onChange={(e) => setForm((f) => ({ ...f, item: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">Select food item...</option>
                {foodItems.map((f) => (
                  <option key={f.id} value={f.name}>
                    {f.name} — SSP{f.price.toLocaleString()}
                  </option>
                ))}
              </select>
              <select
                value={form.waitron}
                onChange={(e) => setForm((f) => ({ ...f, waitron: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">Select waitron...</option>
                {waitrons.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Quantity"
                value={form.qty}
                min="1"
                onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm"
              />
              {form.item && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                  <p className="text-red-400 font-bold">
                    SSP
                    {(
                      (foodItems.find((f) => f.name === form.item)?.price || 0) *
                      (parseInt(form.qty) || 1)
                    ).toLocaleString()}
                  </p>
                  <p className="text-gray-500 text-xs">will be charged to waitron</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={addEntry}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-red-500 text-white font-bold rounded-xl text-sm hover:bg-red-400 disabled:opacity-50"
              >
                {saving ? 'Recording...' : 'Record & Charge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
