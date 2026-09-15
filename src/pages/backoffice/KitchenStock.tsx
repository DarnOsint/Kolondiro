import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronUp,
  Package,
  RefreshCw,
  Trash2,
  Settings,
  Edit3,
  Save,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const todayStr = () => new Date().toISOString().slice(0, 10)
const UNITS = ['portion', 'kg', 'g', 'litre', 'ml', 'piece', 'pack', 'tray', 'bowl', 'cup'] as const
const isManager = (role?: string) => ['owner', 'manager'].includes(role || '')

const normalizeUnit = (u: string) => (u || '').toString().trim().toLowerCase()
const convertQty = (qty: number, fromUnit: string, toUnit: string): number | null => {
  const from = normalizeUnit(fromUnit)
  const to = normalizeUnit(toUnit)
  if (!from || !to) return null
  if (from === to) return qty
  if (from === 'kg' && to === 'g') return qty * 1000
  if (from === 'g' && to === 'kg') return qty / 1000
  if (from === 'litre' && to === 'ml') return qty * 1000
  if (from === 'ml' && to === 'litre') return qty / 1000
  return null
}

interface Benchmark {
  item_name: string
  expected_yield: number
  tolerance_pct: number
  raw_qty?: number | null
  raw_unit: string
  cooked_qty?: number | null
  cooked_unit: string
  note?: string
  set_by?: string
  updated_at?: string
  item_name_bm?: string
}
interface StockEntry {
  id: string
  date: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold_qty: number
  void_qty: number
  closing_qty: number
  note?: string
  recorded_by?: string
  updated_at?: string
}
interface EnrichedEntry extends StockEntry {
  effective_sold: number
  auto_sold: number
  computed_variance: number
  status: StatusResult
  benchmark: Benchmark | null
}
interface StatusResult {
  key: 'ok' | 'commend' | 'warn' | 'alarm'
  label: string
  icon: string
  color: string
  bg: string
  border: string
  remark: string
}
interface EntryForm {
  item_name: string
  unit: string
  opening_qty: string
  received_qty: string
  void_qty: string
  closing_qty: string
  note: string
}
interface BmForm {
  raw_qty: string
  cooked_qty: string
  tolerance_pct: string
  raw_unit: string
  cooked_unit: string
  note: string
  item_name?: string
}
interface EditVals {
  opening_qty: number | string
  received_qty: number | string
  void_qty: number | string
  closing_qty: number | string
  note: string
}
interface Props {
  onBack: () => void
}

function getStatus(
  entry: { computed_variance: number; received_qty: number; effective_sold: number; unit: string },
  benchmark: Benchmark | null
): StatusResult {
  const v = entry.computed_variance

  const bmRawQty = Number(benchmark?.raw_qty ?? 1) || 1
  const bmCookedQty = (benchmark?.cooked_qty != null ? Number(benchmark.cooked_qty) : null) ?? null
  const ratio =
    bmCookedQty != null && bmRawQty > 0 ? bmCookedQty / bmRawQty : benchmark?.expected_yield

  if (benchmark && ratio && ratio > 0 && entry.received_qty > 0) {
    // Only apply the benchmark when we can express the received qty in the benchmark raw unit.
    const receivedInRawUnit = convertQty(entry.received_qty, entry.unit, benchmark.raw_unit) ?? null
    if (receivedInRawUnit == null) {
      // Unit mismatch: can't compute yield against benchmark reliably.
      return {
        key: 'warn',
        label: 'Unit mismatch',
        icon: '⚠️',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/40',
        remark: `Benchmark raw unit is ${benchmark.raw_unit} but this entry is in ${entry.unit}. Set matching units to enable yield analysis.`,
      }
    }

    const expectedSold = receivedInRawUnit * ratio
    const yieldPct = expectedSold > 0 ? (entry.effective_sold / expectedSold) * 100 : 100
    const tol = benchmark.tolerance_pct ?? 5
    if (yieldPct >= 100 - tol && yieldPct <= 100 + tol)
      return {
        key: 'ok',
        label: 'On Target',
        icon: '✅',
        color: 'text-green-400',
        bg: 'bg-green-500/10',
        border: 'border-green-500/30',
        remark: `Yield is ${yieldPct.toFixed(0)}% — right on target. Well done.`,
      }
    if (yieldPct > 100 + tol)
      return {
        key: 'commend',
        label: 'Commended',
        icon: '🌟',
        color: 'text-amber-300',
        bg: 'bg-amber-400/10',
        border: 'border-amber-400/30',
        remark: `Yield is ${yieldPct.toFixed(0)}% — above benchmark. Excellent kitchen efficiency!`,
      }
    if (yieldPct >= 100 - tol * 3)
      return {
        key: 'warn',
        label: 'Investigate',
        icon: '⚠️',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/40',
        remark: `Yield is ${yieldPct.toFixed(0)}% — below benchmark by ${(100 - yieldPct).toFixed(0)}%. Please investigate waste or portioning.`,
      }
    return {
      key: 'alarm',
      label: 'Alarm',
      icon: '🚨',
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/40',
      remark: `Yield is only ${yieldPct.toFixed(0)}% — well below benchmark. Urgent investigation required.`,
    }
  }
  if (Math.abs(v) < 0.01)
    return {
      key: 'ok',
      label: 'Balanced',
      icon: '✅',
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      border: 'border-green-500/30',
      remark: 'Stock fully accounted for.',
    }
  if (v > 0.5)
    return {
      key: 'commend',
      label: 'Surplus',
      icon: '🌟',
      color: 'text-amber-300',
      bg: 'bg-amber-400/10',
      border: 'border-amber-400/30',
      remark: `${v.toFixed(1)} ${entry.unit} surplus — stock is being used judiciously. Verify counts.`,
    }
  if (v < -0.01 && v > -2)
    return {
      key: 'warn',
      label: 'Investigate',
      icon: '⚠️',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/40',
      remark: `${Math.abs(v).toFixed(1)} ${entry.unit} unaccounted. Check wastage logs.`,
    }
  return {
    key: 'alarm',
    label: 'Alarm',
    icon: '🚨',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    remark: `${Math.abs(v).toFixed(1)} ${entry.unit} missing. Urgent: possible theft or significant waste.`,
  }
}

const blankForm: EntryForm = {
  item_name: '',
  unit: 'portion',
  opening_qty: '',
  received_qty: '',
  void_qty: '',
  closing_qty: '',
  note: '',
}
const blankBm: BmForm = {
  raw_qty: '1',
  cooked_qty: '',
  tolerance_pct: '5',
  raw_unit: 'kg',
  cooked_unit: 'portion',
  note: '',
}

export default function KitchenStock({ onBack }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const canManage = isManager(profile?.role)

  const [date, setDate] = useState(todayStr())
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [benchmarks, setBenchmarks] = useState<Record<string, Benchmark>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [entrySearch, setEntrySearch] = useState('')
  const [menuItems, setMenuItems] = useState<string[]>([])
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<EditVals>({
    opening_qty: 0,
    received_qty: 0,
    void_qty: 0,
    closing_qty: 0,
    note: '',
  })
  const [showBenchmarkFor, setShowBenchmarkFor] = useState<string | null>(null)
  const [bmForm, setBmForm] = useState<BmForm>(blankBm)
  const [tab, setTab] = useState<'register' | 'benchmarks'>('register')
  const [form, setForm] = useState<EntryForm>(blankForm)
  const [formError, setFormError] = useState<string | null>(null)
  const ff = (v: Partial<EntryForm>) => setForm((p) => ({ ...p, ...v }))
  const bf = (v: Partial<BmForm>) => setBmForm((p) => ({ ...p, ...v }))

  useEffect(() => {
    supabase
      .from('menu_items')
      .select('name')
      .eq('is_available', true)
      .then(({ data }) => setMenuItems((data || []).map((i: { name: string }) => i.name)))
  }, [])

  const loadBenchmarks = useCallback(async () => {
    const { data } = await supabase.from('kitchen_stock_benchmarks').select('*')
    const map: Record<string, Benchmark> = {}
    ;(data || []).forEach((b: Benchmark) => {
      map[b.item_name] = b
    })
    setBenchmarks(map)
  }, [])

  const loadSoldQty = useCallback(async (d: string) => {
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('status', 'paid')
      .gte('created_at', `${d}T07:00:00.000Z`)
      .lt('created_at', new Date(new Date(`${d}T07:00:00.000Z`).getTime() + 86400000).toISOString())
    if (!orders?.length) {
      setSoldMap({})
      return
    }
    const { data: items } = await supabase
      .from('order_items')
      .select('quantity, menu_items(name)')
      .in(
        'order_id',
        orders.map((o: { id: string }) => o.id)
      )
      .eq('destination', 'kitchen')
    const map: Record<string, number> = {}
    ;(items || ([] as any[])).forEach(
      (i: { quantity: number; menu_items?: { name?: string } | null }) => {
        const n = i.menu_items?.name
        if (n) map[n] = (map[n] || 0) + i.quantity
      }
    )
    setSoldMap(map)
  }, [])

  const loadEntries = useCallback(
    async (d: string) => {
      setLoading(true)
      await Promise.all([loadSoldQty(d), loadBenchmarks()])
      const { data } = await supabase
        .from('kitchen_stock')
        .select('*')
        .eq('date', d)
        .order('item_name')
      setEntries((data || []) as StockEntry[])
      setLoading(false)
    },
    [loadSoldQty, loadBenchmarks]
  )

  useEffect(() => {
    loadEntries(date)
  }, [date, loadEntries])

  const enriched: EnrichedEntry[] = entries.map((e) => {
    const effective_sold = e.sold_qty > 0 ? e.sold_qty : soldMap[e.item_name] || 0
    const auto_sold = soldMap[e.item_name] || 0
    const computed_variance =
      e.opening_qty + e.received_qty - (effective_sold + e.void_qty + e.closing_qty)
    const bm = benchmarks[e.item_name] || null
    const base = { ...e, effective_sold, auto_sold, computed_variance }
    return { ...base, status: getStatus(base, bm), benchmark: bm }
  })

  const alarmCount = enriched.filter((e) => e.status.key === 'alarm').length
  const warnCount = enriched.filter((e) => e.status.key === 'warn').length
  const commendCount = enriched.filter((e) => e.status.key === 'commend').length
  const okCount = enriched.filter((e) => e.status.key === 'ok').length

  const handleAdd = async () => {
    setFormError(null)
    if (!form.item_name.trim()) {
      setFormError('Item name is required.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('kitchen_stock').insert({
      date,
      item_name: form.item_name.trim(),
      unit: form.unit,
      opening_qty: parseFloat(form.opening_qty) || 0,
      received_qty: parseFloat(form.received_qty) || 0,
      sold_qty: soldMap[form.item_name] || 0,
      void_qty: parseFloat(form.void_qty) || 0,
      closing_qty: parseFloat(form.closing_qty) || 0,
      note: form.note.trim() || null,
      recorded_by: profile?.id,
    })
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setForm(blankForm)
    setShowAdd(false)
    loadEntries(date)
  }

  const startEdit = (entry: StockEntry) => {
    setEditingId(entry.id)
    setEditVals({
      opening_qty: entry.opening_qty,
      received_qty: entry.received_qty,
      void_qty: entry.void_qty,
      closing_qty: entry.closing_qty,
      note: entry.note || '',
    })
  }

  const saveEdit = async (id: string) => {
    const { error } = await supabase
      .from('kitchen_stock')
      .update({
        opening_qty: parseFloat(String(editVals.opening_qty)) || 0,
        received_qty: parseFloat(String(editVals.received_qty)) || 0,
        void_qty: parseFloat(String(editVals.void_qty)) || 0,
        closing_qty: parseFloat(String(editVals.closing_qty)) || 0,
        note: editVals.note || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) {
      toast.error('Error', 'Failed to save edit: ' + error.message)
      return
    }
    setEditingId(null)
    loadEntries(date)
  }

  const syncSold = async (entry: StockEntry) => {
    await supabase
      .from('kitchen_stock')
      .update({ sold_qty: soldMap[entry.item_name] || 0, updated_at: new Date().toISOString() })
      .eq('id', entry.id)
    loadEntries(date)
  }

  const deleteEntry = async (id: string) => {
    if (!confirm('Delete this stock entry?')) return
    const { error } = await supabase.from('kitchen_stock').delete().eq('id', id)
    if (error) {
      toast.error('Error', 'Failed to delete item: ' + error.message)
      return
    }
    loadEntries(date)
  }

  const openBenchmark = (itemName: string) => {
    const ex = benchmarks[itemName]
    const rawQty = ex?.raw_qty != null ? String(ex.raw_qty) : '1'
    const cookedQty =
      ex?.cooked_qty != null
        ? String(ex.cooked_qty)
        : String((Number(ex?.expected_yield || 0) || 0) * (Number(rawQty) || 1) || '')
    setBmForm({
      raw_qty: rawQty,
      cooked_qty: cookedQty,
      tolerance_pct: String(ex?.tolerance_pct ?? '5'),
      raw_unit: ex?.raw_unit ?? 'kg',
      cooked_unit: ex?.cooked_unit ?? 'portion',
      note: ex?.note ?? '',
    })
    setShowBenchmarkFor(itemName)
  }

  const saveBenchmark = async () => {
    if (!bmForm.raw_qty || !bmForm.cooked_qty) return
    const itemName = showBenchmarkFor === '__new__' ? bmForm.item_name : showBenchmarkFor
    if (!itemName) return
    const rawQty = parseFloat(bmForm.raw_qty)
    const cookedQty = parseFloat(bmForm.cooked_qty)
    if (!rawQty || rawQty <= 0 || !cookedQty || cookedQty <= 0) {
      toast.warning('Invalid benchmark', 'Enter a valid raw quantity and expected cooked quantity')
      return
    }
    const expectedYield = cookedQty / rawQty
    const { error } = await supabase.from('kitchen_stock_benchmarks').upsert(
      {
        item_name: itemName,
        raw_qty: rawQty,
        cooked_qty: cookedQty,
        expected_yield: expectedYield,
        tolerance_pct: parseFloat(bmForm.tolerance_pct) || 5,
        raw_unit: bmForm.raw_unit,
        cooked_unit: bmForm.cooked_unit,
        note: bmForm.note || null,
        set_by: profile?.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'item_name' }
    )
    if (error) {
      toast.error('Error', 'Failed to save benchmark: ' + error.message)
      return
    }
    setShowBenchmarkFor(null)
    loadBenchmarks()
    loadEntries(date)
  }

  const deleteBenchmark = async (itemName: string) => {
    if (!confirm(`Remove benchmark for ${itemName}?`)) return
    const { error: bErr } = await supabase
      .from('kitchen_stock_benchmarks')
      .delete()
      .eq('item_name', itemName)
    if (bErr) console.error('Failed to delete benchmark:', bErr.message)
    loadBenchmarks()
    loadEntries(date)
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-800">
            <ArrowLeft size={20} className="text-gray-400" />
          </button>
          <div className="flex-1">
            <h1 className="text-white font-bold text-base">Kitchen Stock Register</h1>
            <p className="text-gray-500 text-xs">Reconciliation · Benchmarks · Yield Analysis</p>
          </div>
          <button onClick={() => loadEntries(date)} className="p-2 rounded-xl hover:bg-gray-800">
            <RefreshCw size={16} className="text-gray-400" />
          </button>
        </div>
        <div className="flex gap-1 mt-3">
          {(
            [
              ['register', 'Daily Register'],
              ['benchmarks', 'Benchmarks'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${tab === id ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'register' && (
        <div className="px-4 pt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              className="bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500 flex-1 min-w-[140px]"
            />
            {[
              {
                count: alarmCount,
                icon: '🚨',
                label: 'Alarm',
                color: 'bg-red-500/10 border-red-500/30 text-red-400',
              },
              {
                count: warnCount,
                icon: '⚠️',
                label: 'Investigate',
                color: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
              },
              {
                count: okCount,
                icon: '✅',
                label: 'OK',
                color: 'bg-green-500/10 border-green-500/30 text-green-400',
              },
              {
                count: commendCount,
                icon: '🌟',
                label: 'Commend',
                color: 'bg-amber-300/10 border-amber-300/30 text-amber-300',
              },
            ]
              .filter((p) => p.count > 0)
              .map((p) => (
                <div
                  key={p.label}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold ${p.color}`}
                >
                  <span>{p.icon}</span>
                  {p.count} {p.label}
                </div>
              ))}
          </div>

          {enriched.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Items', value: enriched.length, color: 'text-white' },
                {
                  label: 'Received',
                  value: enriched.reduce((s, e) => s + e.received_qty, 0).toFixed(1),
                  color: 'text-blue-400',
                },
                {
                  label: 'Sold',
                  value: enriched.reduce((s, e) => s + e.effective_sold, 0).toFixed(1),
                  color: 'text-amber-400',
                },
                {
                  label: 'Variance',
                  value: enriched.reduce((s, e) => s + e.computed_variance, 0).toFixed(1),
                  color:
                    enriched.reduce((s, e) => s + e.computed_variance, 0) < -0.01
                      ? 'text-red-400'
                      : 'text-green-400',
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center"
                >
                  <p className={`text-base font-black ${c.color}`}>{c.value}</p>
                  <p className="text-gray-600 text-[10px] mt-0.5">{c.label}</p>
                </div>
              ))}
            </div>
          )}

          <input
            value={entrySearch}
            onChange={(e) => setEntrySearch(e.target.value)}
            placeholder="Search items…"
            className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-500"
          />
          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>
          ) : enriched.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
              <Package size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 text-sm font-medium">No entries for this date</p>
              <p className="text-gray-600 text-xs mt-1">Add items received in the kitchen today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {enriched
                .filter(
                  (e) =>
                    !entrySearch || e.item_name.toLowerCase().includes(entrySearch.toLowerCase())
                )
                .map((entry) => {
                  const st = entry.status
                  const expanded = expandedId === entry.id
                  const editing = editingId === entry.id
                  return (
                    <div
                      key={entry.id}
                      className={`bg-gray-900 border rounded-2xl overflow-hidden ${st.border}`}
                    >
                      <div className={`px-4 py-1.5 flex items-center justify-between ${st.bg}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{st.icon}</span>
                          <span className={`text-xs font-bold ${st.color}`}>{st.label}</span>
                        </div>
                        {entry.benchmark && (
                          <span className="text-gray-500 text-[10px]">
                            Benchmark: {entry.benchmark.raw_qty ?? 1} {entry.benchmark.raw_unit} →{' '}
                            {entry.benchmark.cooked_qty ?? entry.benchmark.expected_yield}{' '}
                            {entry.benchmark.cooked_unit} (×{entry.benchmark.expected_yield} per 1{' '}
                            {entry.benchmark.raw_unit}) ±{entry.benchmark.tolerance_pct}%
                          </span>
                        )}
                      </div>
                      <button
                        className="w-full px-4 py-3 flex items-center gap-3 text-left"
                        onClick={() => setExpandedId(expanded ? null : entry.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold truncate">
                            {entry.item_name}
                          </p>
                          <p className="text-gray-500 text-xs mt-0.5">
                            In: {(entry.opening_qty + entry.received_qty).toFixed(1)} {entry.unit}
                            &nbsp;·&nbsp;Sold: {entry.effective_sold.toFixed(
                              1
                            )}&nbsp;·&nbsp;Left: {entry.closing_qty.toFixed(1)}
                          </p>
                        </div>
                        <div className="text-right shrink-0 mr-1">
                          <p className={`text-sm font-bold ${st.color}`}>
                            {entry.computed_variance > 0 ? '+' : ''}
                            {entry.computed_variance.toFixed(1)}
                          </p>
                          <p className="text-gray-600 text-xs">variance</p>
                        </div>
                        {expanded ? (
                          <ChevronUp size={16} className="text-gray-500 shrink-0" />
                        ) : (
                          <ChevronDown size={16} className="text-gray-500 shrink-0" />
                        )}
                      </button>
                      {expanded && (
                        <div className="border-t border-gray-800 px-4 py-4 space-y-3">
                          <div
                            className={`rounded-xl px-3 py-2.5 text-xs font-medium ${st.bg} ${st.color} ${st.border} border`}
                          >
                            {st.icon} {st.remark}
                          </div>
                          {editing && canManage ? (
                            <div className="space-y-2">
                              <p className="text-amber-400 text-xs font-semibold">
                                Editing entry — all fields unlocked
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {(
                                  [
                                    ['Opening Stock', 'opening_qty'],
                                    ['Received Today', 'received_qty'],
                                    ['Void / Wastage', 'void_qty'],
                                    ['Closing Count', 'closing_qty'],
                                  ] as const
                                ).map(([label, key]) => (
                                  <div key={key}>
                                    <label className="text-gray-500 text-xs block mb-1">
                                      {label} ({entry.unit})
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.5"
                                      value={String(editVals[key])}
                                      onChange={(e) =>
                                        setEditVals((p) => ({ ...p, [key]: e.target.value }))
                                      }
                                      className="w-full bg-gray-800 border border-amber-500/50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                                    />
                                  </div>
                                ))}
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs block mb-1">Note</label>
                                <input
                                  type="text"
                                  value={editVals.note}
                                  onChange={(e) =>
                                    setEditVals((p) => ({ ...p, note: e.target.value }))
                                  }
                                  placeholder="Reason for edit…"
                                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveEdit(entry.id)}
                                  className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-2 text-xs transition-colors"
                                >
                                  <Save size={13} /> Save Changes
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl py-2 text-xs transition-colors"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {[
                                  ['Opening Stock', `${entry.opening_qty} ${entry.unit}`],
                                  ['Received Today', `${entry.received_qty} ${entry.unit}`],
                                  ['Sold (from POS)', `${entry.auto_sold} ${entry.unit}`],
                                  ['Void / Wastage', `${entry.void_qty} ${entry.unit}`],
                                  ['Closing Count', `${entry.closing_qty} ${entry.unit}`],
                                  [
                                    'Total Available',
                                    `${(entry.opening_qty + entry.received_qty).toFixed(1)} ${entry.unit}`,
                                  ],
                                ].map(([label, val]) => (
                                  <div key={label} className="bg-gray-800 rounded-xl px-3 py-2">
                                    <p className="text-gray-500 text-xs">{label}</p>
                                    <p className="text-white font-semibold mt-0.5">{val}</p>
                                  </div>
                                ))}
                              </div>
                              {entry.benchmark &&
                                entry.received_qty > 0 &&
                                (() => {
                                  const bm = entry.benchmark
                                  const receivedInRawUnit =
                                    convertQty(entry.received_qty, entry.unit, bm.raw_unit) ?? null
                                  if (receivedInRawUnit == null)
                                    return (
                                      <div className="bg-gray-800 rounded-xl px-3 py-3 space-y-1.5">
                                        <p className="text-gray-400 text-xs font-semibold mb-1">
                                          Yield Analysis
                                        </p>
                                        <p className="text-amber-400 text-xs">
                                          Unit mismatch: this entry is in {entry.unit} but benchmark
                                          is in {bm.raw_unit}. Set matching units to enable yield
                                          analysis.
                                        </p>
                                      </div>
                                    )

                                  const bmRawQty = Number(bm.raw_qty ?? 1) || 1
                                  const bmCookedQty =
                                    (bm.cooked_qty != null ? Number(bm.cooked_qty) : null) ?? null
                                  const ratio =
                                    bmCookedQty != null && bmRawQty > 0
                                      ? bmCookedQty / bmRawQty
                                      : bm.expected_yield
                                  const expectedSold = receivedInRawUnit * ratio
                                  const yieldPct =
                                    expectedSold > 0
                                      ? ((entry.effective_sold / expectedSold) * 100).toFixed(1)
                                      : '—'
                                  return (
                                    <div className="bg-gray-800 rounded-xl px-3 py-3 space-y-1.5">
                                      <p className="text-gray-400 text-xs font-semibold mb-2">
                                        Yield Analysis
                                      </p>
                                      {[
                                        ['Raw Input', `${receivedInRawUnit} ${bm.raw_unit}`],
                                        [
                                          'Expected Output',
                                          `${expectedSold.toFixed(1)} ${bm.cooked_unit}`,
                                        ],
                                        [
                                          'Actual Output',
                                          `${entry.effective_sold} ${bm.cooked_unit}`,
                                        ],
                                        ['Yield %', `${yieldPct}%`],
                                      ].map(([l, v]) => (
                                        <div key={l} className="flex justify-between text-xs">
                                          <span className="text-gray-500">{l}</span>
                                          <span
                                            className={`font-semibold ${l === 'Yield %' ? st.color : 'text-white'}`}
                                          >
                                            {v}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )
                                })()}
                              <div className="bg-gray-800 rounded-xl px-3 py-2 text-xs text-gray-500 font-mono">
                                ({entry.opening_qty} + {entry.received_qty}) −{' '}
                                {entry.effective_sold} − {entry.void_qty} − {entry.closing_qty}
                                {' = '}
                                <span className={st.color}>
                                  {entry.computed_variance.toFixed(1)}
                                </span>
                              </div>
                              {entry.note && (
                                <p className="text-gray-500 text-xs italic">Note: {entry.note}</p>
                              )}
                            </>
                          )}
                          {!editing && (
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => syncSold(entry)}
                                className="flex-1 text-xs bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-xl py-2 font-medium"
                              >
                                Sync POS Sales
                              </button>
                              {canManage && (
                                <>
                                  <button
                                    onClick={() => openBenchmark(entry.item_name)}
                                    className="flex items-center gap-1 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2 font-medium"
                                  >
                                    <Settings size={12} /> Benchmark
                                  </button>
                                  <button
                                    onClick={() => startEdit(entry)}
                                    className="flex items-center gap-1 text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-xl px-3 py-2"
                                  >
                                    <Edit3 size={12} /> Edit
                                  </button>
                                  <button
                                    onClick={() => deleteEntry(entry.id)}
                                    className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}

          {showAdd && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
              <p className="text-white font-semibold text-sm">Add Stock Entry</p>
              {formError && (
                <p className="text-red-400 text-xs bg-red-500/10 rounded-xl px-3 py-2">
                  {formError}
                </p>
              )}
              <div>
                <label className="text-gray-500 text-xs block mb-1">Item Name</label>
                <input
                  list="kitchen-items"
                  value={form.item_name}
                  onChange={(e) => ff({ item_name: e.target.value })}
                  placeholder="e.g. Jollof Rice, Beef Stew"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
                <datalist id="kitchen-items">
                  {menuItems.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Unit</label>
                  <select
                    value={form.unit}
                    onChange={(e) => ff({ unit: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Opening Stock</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.opening_qty}
                    onChange={(e) => ff({ opening_qty: e.target.value })}
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Received Today</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.received_qty}
                    onChange={(e) => ff({ received_qty: e.target.value })}
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Void / Wastage</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.void_qty}
                    onChange={(e) => ff({ void_qty: e.target.value })}
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Physical Closing Count</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.closing_qty}
                  onChange={(e) => ff({ closing_qty: e.target.value })}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => ff({ note: e.target.value })}
                  placeholder="e.g. half bag spoiled"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              {form.item_name && (
                <div className="bg-gray-800 rounded-xl px-3 py-2 text-xs text-gray-400">
                  POS sold today:{' '}
                  <span className="text-white font-medium">
                    {soldMap[form.item_name] || 0} {form.unit}
                  </span>
                  {(soldMap[form.item_name] || 0) > 0 && ' — auto-synced'}
                  {benchmarks[form.item_name] && (
                    <span className="ml-2 text-amber-400">· Benchmark set ✓</span>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowAdd(false)
                    setFormError(null)
                  }}
                  className="flex-1 bg-gray-800 text-gray-300 rounded-2xl py-3 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold rounded-2xl py-3 text-sm transition-colors"
                >
                  {saving ? 'Saving…' : 'Add Entry'}
                </button>
              </div>
            </div>
          )}

          {!showAdd && (
            <>
              <button
                onClick={() => setShowAdd(true)}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-2xl py-4 text-sm transition-colors"
              >
                <Plus size={18} /> Add Stock Entry
              </button>
              {!canManage && (
                <p className="text-center text-gray-600 text-xs">
                  Entries are locked once submitted — contact a manager to make corrections.
                </p>
              )}
            </>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 space-y-2">
            <p className="text-gray-400 text-xs font-semibold">Status Guide</p>
            {[
              { icon: '🌟', label: 'Commend', desc: 'Yield exceeds benchmark — judiciously used' },
              { icon: '✅', label: 'On Target', desc: 'Within tolerance band — all good' },
              {
                icon: '⚠️',
                label: 'Investigate',
                desc: 'Below benchmark — check portioning/wastage',
              },
              { icon: '🚨', label: 'Alarm', desc: 'Significant shortfall — urgent investigation' },
            ].map((s) => (
              <div key={s.label} className="flex items-start gap-2.5">
                <span className="text-sm mt-0.5">{s.icon}</span>
                <div>
                  <p className="text-gray-300 text-xs font-medium">{s.label}</p>
                  <p className="text-gray-600 text-xs">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'benchmarks' && (
        <div className="px-4 pt-4 space-y-3">
          <div className="bg-gray-900 border border-amber-500/20 rounded-2xl px-4 py-3">
            <p className="text-amber-400 text-xs font-semibold mb-1">What is a benchmark?</p>
            <p className="text-gray-400 text-xs leading-relaxed">
              A benchmark tells the system how much cooked output (portions) to expect from a given
              raw input (kg, pack, etc.). For example:{' '}
              <span className="text-white font-medium">1 kg beef = 8 portions</span>. The system
              will then calculate expected yield daily and flag deviations.
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => {
                setBmForm(blankBm)
                setShowBenchmarkFor('__new__')
              }}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-2xl py-3 text-sm transition-colors"
            >
              <Plus size={16} /> Add New Benchmark
            </button>
          )}
          {Object.keys(benchmarks).length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
              <Settings size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 text-sm font-medium">No benchmarks set yet</p>
              <p className="text-gray-600 text-xs mt-1">
                Set expected yield per ingredient for automatic scoring
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.values(benchmarks).map((bm) => (
                <div
                  key={bm.item_name}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-bold">{bm.item_name}</p>
                      <p className="text-gray-400 text-xs mt-1">
                        <span className="text-amber-400 font-semibold">
                          {bm.raw_qty ?? 1} {bm.raw_unit}
                        </span>
                        {' → '}
                        <span className="text-green-400 font-semibold">
                          {bm.cooked_qty ?? bm.expected_yield} {bm.cooked_unit}
                        </span>
                        <span className="text-gray-600 ml-2">
                          ({bm.expected_yield} {bm.cooked_unit}/1 {bm.raw_unit})
                        </span>
                        <span className="text-gray-600 ml-2">±{bm.tolerance_pct}% tolerance</span>
                      </p>
                      {bm.note && <p className="text-gray-600 text-xs mt-1 italic">{bm.note}</p>}
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openBenchmark(bm.item_name)}
                          className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl transition-colors"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => deleteBenchmark(bm.item_name)}
                          className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showBenchmarkFor && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4 py-4">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="text-white font-bold text-sm">Set Benchmark</h2>
                <p className="text-gray-500 text-xs mt-0.5">
                  {showBenchmarkFor === '__new__' ? 'New item' : showBenchmarkFor}
                </p>
              </div>
              <button
                onClick={() => setShowBenchmarkFor(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {showBenchmarkFor === '__new__' && (
                <div>
                  <label className="text-gray-400 text-xs block mb-1">Item Name</label>
                  <input
                    list="kitchen-items-bm"
                    value={bmForm.item_name || ''}
                    onChange={(e) => bf({ item_name: e.target.value })}
                    placeholder="e.g. Beef, Rice, Chicken"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                  <datalist id="kitchen-items-bm">
                    {menuItems.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>
              )}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-400">
                Set the benchmark as: <strong>raw quantity</strong> →{' '}
                <strong>expected cooked output</strong>.
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="col-span-2">
                    <label className="text-gray-400 text-xs block mb-1">Raw quantity</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={bmForm.raw_qty}
                      onChange={(e) => bf({ raw_qty: e.target.value })}
                      placeholder="e.g. 10"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-base tracking-wide focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">Raw unit</label>
                    <select
                      value={bmForm.raw_unit}
                      onChange={(e) => bf({ raw_unit: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-amber-500"
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="text-center text-gray-500 text-lg font-bold">→</div>

                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="col-span-2">
                    <label className="text-gray-400 text-xs block mb-1">
                      Expected cooked output
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={bmForm.cooked_qty}
                      onChange={(e) => bf({ cooked_qty: e.target.value })}
                      placeholder="e.g. 80"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-base tracking-wide focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">Cooked unit</label>
                    <select
                      value={bmForm.cooked_unit}
                      onChange={(e) => bf({ cooked_unit: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-amber-500"
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Derived yield</label>
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm">
                  {(() => {
                    const rq = parseFloat(bmForm.raw_qty)
                    const cq = parseFloat(bmForm.cooked_qty)
                    const ok = rq > 0 && cq > 0
                    const y = ok ? cq / rq : 0
                    return ok
                      ? `${y.toFixed(2)} ${bmForm.cooked_unit} per 1 ${bmForm.raw_unit}`
                      : '—'
                  })()}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Tolerance % (±)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="30"
                    value={bmForm.tolerance_pct}
                    onChange={(e) => bf({ tolerance_pct: e.target.value })}
                    className="flex-1 accent-amber-500"
                  />
                  <span className="text-white font-bold text-sm w-10 text-right">
                    {bmForm.tolerance_pct}%
                  </span>
                </div>
                <p className="text-gray-600 text-xs mt-1">
                  Within ±{bmForm.tolerance_pct}% = ✅ OK · Below{' '}
                  {100 - Number(bmForm.tolerance_pct)}% = ⚠️ Investigate · Below{' '}
                  {100 - Number(bmForm.tolerance_pct) * 3}% = 🚨 Alarm
                </p>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={bmForm.note}
                  onChange={(e) => bf({ note: e.target.value })}
                  placeholder="e.g. Based on supplier spec, 500g portions"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
            <div className="border-t border-gray-800 p-4 shrink-0 bg-gray-900">
              <button
                onClick={saveBenchmark}
                disabled={
                  !bmForm.raw_qty ||
                  !bmForm.cooked_qty ||
                  (showBenchmarkFor === '__new__' && !bmForm.item_name)
                }
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-black rounded-2xl py-3 text-sm transition-colors"
              >
                Save Benchmark
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
