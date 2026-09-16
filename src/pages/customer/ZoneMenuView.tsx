import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AlertCircle, RefreshCw, Search, UtensilsCrossed, Wine } from 'lucide-react'

type MenuItem = {
  id: string
  name: string
  price: number
  rave_price?: number | null
  menu_categories?: { name?: string | null; destination?: string | null } | null
}

type ZonePriceRow = {
  menu_item_id: string
  category_id: string
  price: number
}

type TableCategory = {
  id: string
  name: string
}

type MenuTab = 'food' | 'drinks' | 'other'

const TAB_LABELS: Record<MenuTab, string> = { food: 'Food', drinks: 'Drinks', other: 'Other' }

function getItemTab(item: MenuItem): MenuTab {
  const dest = item.menu_categories?.destination?.toLowerCase() || ''
  if (dest === 'kitchen' || dest === 'griller') return 'food'
  if (dest === 'bar' || dest === 'mixologist') return 'drinks'
  return 'other'
}

export default function ZoneMenuView() {
  const { zoneId } = useParams<{ zoneId: string }>()
  const navigate = useNavigate()
  const [zone, setZone] = useState<TableCategory | null>(null)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'api' | 'supabase' | 'unknown'>('unknown')
  const [debugApiError, setDebugApiError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<MenuTab>('food')
  const [search, setSearch] = useState('')

  const debug = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1'
    } catch {
      return false
    }
  }, [])

  const normalizeMenu = (items: unknown): MenuItem[] => {
    if (!Array.isArray(items)) return []
    return (items as any[]).map((item) => ({
      id: String(item?.id ?? ''),
      name: String(item?.name ?? ''),
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : 0,
      menu_categories: item?.menu_categories ?? null,
    }))
  }

  const resolveZone = async (): Promise<TableCategory | null> => {
    if (!zoneId) return null
    const direct = await supabase
      .from('table_categories')
      .select('id, name')
      .eq('id', zoneId)
      .single()
    if (!direct.error && direct.data) return direct.data as TableCategory

    const byName = await supabase
      .from('table_categories')
      .select('id, name')
      .ilike('name', zoneId)
      .maybeSingle()
    if (!byName.error && byName.data) return byName.data as TableCategory

    const tableRes = await supabase
      .from('tables')
      .select('id, category_id, table_categories(id, name)')
      .eq('id', zoneId)
      .maybeSingle()
    if (!tableRes.error && tableRes.data) {
      const zid = (tableRes.data as any).table_categories?.id || (tableRes.data as any).category_id
      if (zid) {
        navigate(`/zone/${zid}`, { replace: true })
        return null
      }
    }
    return null
  }

  const load = async () => {
    if (!zoneId) return
    setLoading(true)
    setError(null)
    setDebugApiError(null)
    setDataSource('unknown')
    try {
      try {
        const resp = await fetch(
          `/api/public/zone-menu?zone=${encodeURIComponent(zoneId)}&t=${Date.now()}`
        )
        if (resp.ok) {
          const json = (await resp.json()) as
            | { redirectZoneId?: string | null; zone?: TableCategory; menu?: MenuItem[] }
            | { error?: string }
          if ('redirectZoneId' in json && json.redirectZoneId) {
            navigate(`/zone/${json.redirectZoneId}`, { replace: true })
            return
          }
          if ('zone' in json && json.zone && Array.isArray((json as any).menu)) {
            setZone(json.zone)
            setMenu(normalizeMenu((json as any).menu))
            setDataSource('api')
            setLoading(false)
            return
          }
          if (debug && 'error' in json && (json as any).error) {
            setDebugApiError(String((json as any).error))
          }
        } else if (debug) {
          try {
            const j = await resp.json()
            setDebugApiError(String((j as any)?.error ?? resp.statusText))
          } catch {
            setDebugApiError(resp.statusText || `HTTP ${resp.status}`)
          }
        }
      } catch {
        /* fall back to client-side Supabase */
      }

      const resolved = await resolveZone()
      if (!resolved) throw new Error('zone_not_found')

      const [menuRes, zonePriceRes, raveModeRes] = await Promise.all([
        supabase
          .from('menu_items')
          .select('id, name, price, rave_price, menu_categories(name, destination)')
          .order('name'),
        supabase
          .from('menu_item_zone_prices')
          .select('menu_item_id, category_id, price')
          .eq('category_id', resolved.id),
        supabase.from('settings').select('value').eq('id', 'rave_mode').single(),
      ])

      if (menuRes.error) throw menuRes.error
      if (!resolved) throw new Error('zone_not_found')
      setZone(resolved)

      const raveActive = raveModeRes.data?.value === 'true'
      const baseMenu = (menuRes.data || []) as MenuItem[]
      const priceRows = (zonePriceRes.data || []) as unknown as ZonePriceRow[]
      const zonePriceByItem = new Map<string, number>()
      for (const row of priceRows) {
        if (row?.menu_item_id && row.price != null) {
          zonePriceByItem.set(row.menu_item_id, Number(row.price))
        }
      }

      setMenu(
        baseMenu.map((item) => {
          let price = Number.isFinite(zonePriceByItem.get(item.id))
            ? (zonePriceByItem.get(item.id) as number)
            : Number.isFinite(Number(item.price))
              ? Number(item.price)
              : 0
          if (raveActive && item.rave_price != null) {
            price = item.rave_price
          }
          return { ...item, price }
        })
      )
      setDataSource('supabase')
    } catch {
      setError('Could not load prices. Please refresh.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    setActiveTab('food')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId])

  const tabs = useMemo(() => {
    const has = { food: false, drinks: false, other: false } as Record<MenuTab, boolean>
    for (const item of menu) {
      has[getItemTab(item)] = true
    }
    const available: MenuTab[] = []
    if (has.food) available.push('food')
    if (has.drinks) available.push('drinks')
    if (has.other) available.push('other')
    return available
  }, [menu])

  const currentItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return menu.filter((item) => getItemTab(item) === activeTab)
    return menu.filter(
      (item) => getItemTab(item) === activeTab && item.name.toLowerCase().includes(q)
    )
  }, [menu, activeTab, search])

  const grouped = useMemo(() => {
    const byCat = new Map<string, MenuItem[]>()
    for (const item of currentItems) {
      const cat = item.menu_categories?.name || 'Other'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(item)
    }
    return byCat
  }, [currentItems])

  const sections = useMemo(() => {
    const out: Array<{ title: string; items: MenuItem[] }> = []
    // Show categories in deterministic order (food cats first, then drinks, etc.)
    const sorted = Array.from(grouped.keys()).sort((a, b) => {
      const wa = getCategoryWeight(a)
      const wb = getCategoryWeight(b)
      if (wa !== wb) return wa - wb
      return a.localeCompare(b)
    })
    for (const cat of sorted) {
      const items = grouped.get(cat) || []
      if (items.length) out.push({ title: cat, items })
    }
    return out
  }, [grouped])

  if (loading) {
    return (
      <div className="min-h-full bg-black flex items-center justify-center p-6">
        <RefreshCw size={20} className="text-amber-500 animate-spin" />
        <span className="text-gray-400 text-sm ml-3">Loading…</span>
      </div>
    )
  }

  if (error || !zoneId) {
    return (
      <div className="min-h-full bg-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <AlertCircle size={36} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-bold mb-2">Could not load</p>
          <p className="text-gray-500 text-sm mb-4">{error || 'Invalid link.'}</p>
          <button
            onClick={load}
            className="bg-amber-500 text-black font-bold px-5 py-2.5 rounded-xl inline-flex items-center gap-2"
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-black flex flex-col">
      {/* ─── Header ─── */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
              <UtensilsCrossed size={17} className="text-black" />
            </div>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-sm leading-tight">Kolondiro&apos;s Place</h1>
              <p className="text-amber-400 text-xs font-medium truncate">{zone?.name || 'Menu'}</p>
            </div>
          </div>
          <button
            onClick={load}
            className="text-zinc-500 hover:text-white p-2 bg-zinc-800 rounded-xl border border-zinc-700"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* ─── Tab bar ─── */}
      <div className="sticky top-[61px] z-20 border-b border-zinc-800 bg-zinc-950/95">
        <div className="max-w-xl mx-auto px-4 pt-3 flex gap-2">
          {tabs.map((tab) => {
            const active = activeTab === tab
            const Icon = tab === 'food' ? UtensilsCrossed : Wine
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                  active
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-700'
                }`}
              >
                <Icon size={15} />
                {TAB_LABELS[tab]}
              </button>
            )
          })}
        </div>

        {/* ─── Search bar ─── */}
        <div className="max-w-xl mx-auto w-full px-4 pb-4 pt-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* ─── Items ─── */}
      <div className="flex-1 max-w-xl mx-auto w-full px-4 py-5">
        {currentItems.length === 0 ? (
          <div className="py-16 text-center text-zinc-600 text-sm">
            {search.trim()
              ? 'No matching items'
              : `No ${TAB_LABELS[activeTab].toLowerCase()} items available`}
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.title}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-300 font-extrabold tracking-wider text-xs uppercase">
                    {section.title}
                    <span className="text-[10px] text-amber-500/60 font-semibold">
                      {section.items.length}
                    </span>
                  </span>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>

                {/* Items as 2-column grid */}
                <div className="grid grid-cols-2 gap-2">
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 min-h-[44px]"
                    >
                      <span className="text-white text-sm font-medium leading-tight truncate">
                        {item.name}
                      </span>
                      <span className="text-amber-400 font-bold text-sm shrink-0 tabular-nums">
                        SSP{item.price.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Footer note ─── */}
      <div className="border-t border-zinc-800 px-4 py-3">
        <div className="max-w-xl mx-auto">
          <p className="text-zinc-600 text-[11px] text-center">
            Prices checked via QR · Orders placed through your waitron
          </p>
        </div>
      </div>

      {/* ─── Debug ─── */}
      {debug ? (
        <div className="border-t border-zinc-800 px-4 pb-4 pt-2">
          <div className="max-w-xl mx-auto bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-[11px] text-zinc-500 space-y-1">
            <div>
              zoneId: {zoneId} · {zone?.id || '—'} ({zone?.name || '—'}) · source: {dataSource}
            </div>
            <div>
              items: {menu.length} · food: {menu.filter((i) => getItemTab(i) === 'food').length} ·
              drinks: {menu.filter((i) => getItemTab(i) === 'drinks').length}
              {debugApiError ? (
                <span className="text-red-400"> · apiError: {debugApiError}</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryWeight(name: string): number {
  const n = String(name || '')
    .toLowerCase()
    .trim()
  if (!n) return 99
  if (
    n.includes('food') ||
    n.includes('grill') ||
    n.includes('soup') ||
    n.includes('pasta') ||
    n.includes('rice') ||
    n.includes('salad') ||
    n.includes('starter') ||
    n.includes('breakfast') ||
    n.includes('main')
  )
    return 0
  if (
    n.includes('drink') ||
    n.includes('soft') ||
    n.includes('wine') ||
    n.includes('spirit') ||
    n.includes('beer') ||
    n.includes('liquor') ||
    n.includes('liqueur') ||
    n.includes('energy') ||
    n.includes('shot') ||
    n.includes('soda') ||
    n.includes('juice') ||
    n.includes('water')
  )
    return 1
  if (n.includes('cocktail') || n.includes('mocktail')) return 2
  if (n.includes('milkshake') || n.includes('smoothie') || n.includes('punch')) return 3
  return 4
}
