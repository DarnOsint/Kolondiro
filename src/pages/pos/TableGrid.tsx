import { useState, useEffect, useRef } from 'react'
import { Users, Lock, Link2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  type TableLayout,
  type ZoneBounds,
  ZONE_COLORS,
  ZONE_FILL_OCCUPIED,
  DEFAULT_ZONE_COLOR,
  CANVAS_W,
  getZoneColor,
  normalizeZoneBounds,
  getZoneBoundingBox,
  parseFloorPlanData,
} from '../../lib/floorPlanTypes'

interface TableCategory {
  id: string
  name: string
}

interface Table {
  id: string
  name: string
  capacity?: number
  category_id?: string
  status: 'available' | 'occupied' | string
  table_categories?: TableCategory
}

interface TableGridProps {
  tables: Table[]
  onSelectTable: (table: Table) => void
  selectedTable: Table | null
  assignedTableIds: string[] | null
  assignedZoneNames?: string[] | null
  tableStaffMap?: Record<string, string>
  currentStaffId?: string | null
  currentRole?: string | null
  joinMode?: boolean
  joinSelectedIds?: string[]
  activeJoins?: Record<string, string[]>
}

const BYPASS_ROLES = ['owner', 'manager', 'accountant', 'supervisor']

const ALL_CATEGORIES = ['All', 'Outdoor', 'Indoor', 'VIP Lounge', 'The Nook'] as const

export default function TableGrid({
  tables,
  onSelectTable,
  selectedTable,
  assignedTableIds,
  assignedZoneNames = null,
  defaultCategory = 'All',
  tableStaffMap = {},
  currentStaffId = null,
  currentRole = null,
  joinMode = false,
  joinSelectedIds = [],
  activeJoins = {},
}: TableGridProps & { defaultCategory?: string }) {
  // null = unrestricted (owner/manager), array = restricted to those zones only
  const visibleCategories: string[] =
    assignedZoneNames === null
      ? [...ALL_CATEGORIES]
      : assignedZoneNames.length === 0
        ? [] // no zones assigned — show nothing
        : assignedZoneNames.length === 1
          ? assignedZoneNames
          : ['All', ...assignedZoneNames]

  const [activeCategory, setActiveCategory] = useState<string>(
    defaultCategory && visibleCategories.includes(defaultCategory)
      ? defaultCategory
      : visibleCategories[0]
  )
  const [tableLayouts, setTableLayouts] = useState<Record<string, TableLayout>>({})
  const [zoneBounds, setZoneBounds] = useState<Record<string, ZoneBounds[]>>({})
  const [hasLayout, setHasLayout] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // Load saved floor plan layout
  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'floor_plan_layout')
      .single()
      .then(({ data }) => {
        const parsed = parseFloorPlanData(data?.value)
        if (Object.keys(parsed.tables).length > 0) {
          setTableLayouts(parsed.tables)
          // Normalize zones to arrays
          const normalized: Record<string, ZoneBounds[]> = {}
          for (const [k, v] of Object.entries(parsed.zones)) {
            normalized[k] = normalizeZoneBounds(v)
          }
          setZoneBounds(normalized)
          setHasLayout(true)
        }
      })
  }, [])

  const [containerHeight, setContainerHeight] = useState(0)

  // Measure container for responsive scaling
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
        setContainerHeight(entry.contentRect.height)
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const scale = containerWidth > 0 ? containerWidth / CANVAS_W : 0.5

  const filtered =
    activeCategory === 'All'
      ? tables
      : tables.filter((t) => t.table_categories?.name === activeCategory)

  // Render a single zone's floor plan (used by both "All" and individual zone views)
  const renderZoneFloorPlan = (zoneName: string, zoneTables: Table[], zoneScale: number) => {
    const sections = zoneBounds[zoneName]
    if (!sections || sections.length === 0) return null
    const bbox = getZoneBoundingBox(sections)
    const c = ZONE_COLORS[zoneName] || DEFAULT_ZONE_COLOR
    const occupiedCount = zoneTables.filter((t) => t.status === 'occupied').length

    return (
      <div key={zoneName}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.stroke }} />
          <span style={{ color: c.text }} className="text-sm font-bold uppercase tracking-wide">
            {zoneName}
          </span>
          <span className="text-gray-600 text-xs">
            ({occupiedCount}/{zoneTables.length} occupied)
          </span>
        </div>
        <div
          className="relative select-none"
          style={{
            width: bbox.w * zoneScale,
            height: bbox.h * zoneScale,
            marginBottom: 8,
          }}
        >
          {/* Zone section backgrounds */}
          {sections.map((sec, idx) => (
            <div
              key={`sec-${idx}`}
              style={{
                position: 'absolute',
                left: (sec.x - bbox.x) * zoneScale,
                top: (sec.y - bbox.y) * zoneScale,
                width: sec.w * zoneScale,
                height: sec.h * zoneScale,
                background: c.fill,
                border: `1.5px solid ${c.stroke}30`,
                borderRadius: 14 * zoneScale,
                zIndex: 0,
                pointerEvents: 'none',
              }}
            />
          ))}
          {zoneTables.map((table) => {
            const layout = tableLayouts[table.id]
            if (!layout) return null
            const tc = getZoneColor(zoneName)
            const isOccupied = table.status === 'occupied'
            const isSelected = selectedTable?.id === table.id
            const isAssigned = assignedTableIds === null || assignedTableIds.includes(table.id)
            const servingStaffId = tableStaffMap[table.id]
            const canBypass = currentRole && BYPASS_ROLES.includes(currentRole)
            const isOtherWaitronTable =
              isOccupied &&
              servingStaffId &&
              currentStaffId &&
              servingStaffId !== currentStaffId &&
              !canBypass
            const isClickable = joinMode ? isAssigned : isAssigned && !isOtherWaitronTable
            const occupiedFill = ZONE_FILL_OCCUPIED[zoneName] || tc.stroke
            const isJoinSelected = joinSelectedIds.includes(table.id)
            const isJoinedSecondary = Object.values(activeJoins).some((ids) =>
              ids.includes(table.id)
            )

            // Position relative to zone bounding box
            const relX = (layout.x - bbox.x) * zoneScale
            const relY = (layout.y - bbox.y) * zoneScale

            return (
              <button
                key={table.id}
                onClick={() => (isClickable ? onSelectTable(table) : undefined)}
                disabled={!isClickable}
                title={
                  isOtherWaitronTable
                    ? 'Being served by another waitron'
                    : !isAssigned
                      ? 'Not assigned to you'
                      : `${table.name} — ${table.capacity} seats`
                }
                style={{
                  position: 'absolute',
                  left: Math.max(0, relX),
                  top: Math.max(0, relY),
                  width: layout.w * zoneScale,
                  height: layout.h * zoneScale,
                  borderRadius: layout.shape === 'circle' ? '50%' : 10 * zoneScale,
                  background: isJoinSelected
                    ? 'rgba(245,158,11,0.35)'
                    : isOccupied
                      ? occupiedFill
                      : tc.fill.replace('0.08', '0.2'),
                  border: `${2 * zoneScale}px solid ${
                    isJoinSelected
                      ? '#f59e0b'
                      : isJoinedSecondary
                        ? '#f59e0b80'
                        : isSelected
                          ? '#f59e0b'
                          : tc.stroke
                  }`,
                  boxShadow: isJoinSelected
                    ? `0 0 0 ${3 * zoneScale}px rgba(245,158,11,0.5)`
                    : isSelected
                      ? `0 0 0 ${3 * zoneScale}px rgba(245,158,11,0.4)`
                      : 'none',
                  zIndex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isClickable ? 'pointer' : 'not-allowed',
                  opacity: isClickable ? 1 : 0.3,
                  filter: isClickable ? 'none' : 'grayscale(1)',
                  transition: 'box-shadow 0.15s, opacity 0.15s',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    color: isOccupied ? '#fff' : tc.text,
                    fontSize: Math.max(9, 12 * zoneScale),
                    fontWeight: 700,
                    lineHeight: 1.2,
                    textAlign: 'center',
                  }}
                >
                  {table.name}
                </span>
                <span
                  style={{
                    color: isOccupied ? 'rgba(255,255,255,0.7)' : 'rgba(156,163,175,0.7)',
                    fontSize: Math.max(7, 9 * zoneScale),
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2 * zoneScale,
                  }}
                >
                  <Users size={Math.max(7, 9 * zoneScale)} />
                  {table.capacity}
                </span>
                {isOtherWaitronTable && (
                  <Lock
                    size={Math.max(8, 10 * zoneScale)}
                    style={{
                      position: 'absolute',
                      top: 3 * zoneScale,
                      right: 3 * zoneScale,
                      color: '#f87171',
                    }}
                  />
                )}
                {!isAssigned && !isOtherWaitronTable && (
                  <Lock
                    size={Math.max(7, 9 * zoneScale)}
                    style={{
                      position: 'absolute',
                      top: 3 * zoneScale,
                      right: 3 * zoneScale,
                      color: '#6b7280',
                    }}
                  />
                )}
                {(isJoinedSecondary || activeJoins[table.id]) && (
                  <Link2
                    size={Math.max(8, 10 * zoneScale)}
                    style={{
                      position: 'absolute',
                      bottom: 3 * zoneScale,
                      right: 3 * zoneScale,
                      color: '#f59e0b',
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Floor plan view
  if (hasLayout) {
    // "All" view: each zone rendered as a separate section
    if (activeCategory === 'All') {
      const zoneNames = visibleCategories.filter((c) => c !== 'All')
      return (
        <div className="flex flex-col h-full">
          <div className="flex gap-2 p-4 overflow-x-auto border-b border-gray-800">
            {visibleCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? 'bg-amber-500 text-black'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4" ref={containerRef}>
            {zoneNames.map((zoneName) => {
              const zoneTables = tables.filter((t) => t.table_categories?.name === zoneName)
              if (zoneTables.length === 0) return null
              const sections = zoneBounds[zoneName]
              if (!sections || sections.length === 0) return null
              const bbox = getZoneBoundingBox(sections)
              // In "All" view, fit to width (zones stack vertically so height scrolls)
              const zoneScale = containerWidth > 0 ? (containerWidth - 32) / bbox.w : 0.5
              return renderZoneFloorPlan(zoneName, zoneTables, zoneScale)
            })}
          </div>
        </div>
      )
    }

    // Single zone view — scale to fill available space (fit both width and height)
    const singleSections = zoneBounds[activeCategory]
    const singleBbox = singleSections ? getZoneBoundingBox(singleSections) : null
    const singleZoneScale = (() => {
      if (!singleBbox || containerWidth <= 0) return scale
      const padW = 32
      const padH = 48 // extra padding for zone header text
      const scaleX = (containerWidth - padW) / singleBbox.w
      const scaleY = containerHeight > 0 ? (containerHeight - padH) / singleBbox.h : scaleX
      return Math.min(scaleX, scaleY)
    })()

    return (
      <div className="flex flex-col h-full">
        {visibleCategories.length > 1 && (
          <div className="flex gap-2 p-4 overflow-x-auto border-b border-gray-800">
            {visibleCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? 'bg-amber-500 text-black'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto p-4" ref={containerRef}>
          {renderZoneFloorPlan(activeCategory, filtered, singleZoneScale)}
        </div>
      </div>
    )
  }

  // Fallback: original grid view (no floor plan saved yet)
  const categoryColors: Record<string, { bg: string; border: string; text: string; dot: string }> =
    {
      Outdoor: {
        bg: 'bg-green-500/10',
        border: 'border-green-500/30',
        text: 'text-green-400',
        dot: 'bg-green-500',
      },
      Indoor: {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        text: 'text-blue-400',
        dot: 'bg-blue-500',
      },
      'VIP Lounge': {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        text: 'text-amber-400',
        dot: 'bg-amber-500',
      },
      'The Nook': {
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/30',
        text: 'text-purple-400',
        dot: 'bg-purple-500',
      },
    }
  const occupiedColors: Record<string, string> = {
    Outdoor: 'bg-green-500',
    Indoor: 'bg-blue-500',
    'VIP Lounge': 'bg-amber-500',
    'The Nook': 'bg-purple-500',
  }
  const fallbackZones = visibleCategories.filter((c) => c !== 'All')
  const grouped = fallbackZones.reduce<Record<string, Table[]>>((acc, cat) => {
    acc[cat] = filtered.filter((t) => t.table_categories?.name === cat)
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      {visibleCategories.length > 1 && (
        <div className="flex gap-2 p-4 overflow-x-auto border-b border-gray-800">
          {visibleCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? 'bg-amber-500 text-black'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {Object.entries(grouped).map(([category, categoryTables]) => {
          if (categoryTables.length === 0) return null
          const colors = categoryColors[category]
          return (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2 h-2 rounded-full ${colors?.dot}`} />
                <h3 className={`text-sm font-semibold ${colors?.text}`}>{category}</h3>
                <span className="text-gray-600 text-xs">
                  ({categoryTables.filter((t) => t.status === 'occupied').length}/
                  {categoryTables.length} occupied)
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {categoryTables.map((table) => {
                  const isOccupied = table.status === 'occupied'
                  const isSelected = selectedTable?.id === table.id
                  const isAssigned =
                    assignedTableIds === null || assignedTableIds.includes(table.id)
                  const occupiedColor = occupiedColors[category]
                  const servingStaffId = tableStaffMap[table.id]
                  const canBypass = currentRole && BYPASS_ROLES.includes(currentRole)
                  const isOtherWaitronTable =
                    isOccupied &&
                    servingStaffId &&
                    currentStaffId &&
                    servingStaffId !== currentStaffId &&
                    !canBypass
                  const isClickable = isAssigned && !isOtherWaitronTable

                  return (
                    <button
                      key={table.id}
                      onClick={() => (isClickable ? onSelectTable(table) : undefined)}
                      disabled={!isClickable}
                      title={
                        isOtherWaitronTable
                          ? 'Being served by another waitron'
                          : !isAssigned
                            ? 'Not assigned to you'
                            : ''
                      }
                      className={`
                        relative p-3 rounded-xl border-2 transition-all text-left
                        ${!isClickable ? 'opacity-30 cursor-not-allowed grayscale' : ''}
                        ${isSelected ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-gray-950' : ''}
                        ${
                          isOccupied
                            ? `${occupiedColor} border-transparent text-white`
                            : `${colors?.bg} ${colors?.border} hover:border-opacity-60`
                        }
                      `}
                    >
                      <p
                        className={`text-xs font-bold ${isOccupied ? 'text-white' : colors?.text}`}
                      >
                        {table.name}
                      </p>
                      <div
                        className={`flex items-center gap-1 mt-1 ${isOccupied ? 'text-white/80' : 'text-gray-500'}`}
                      >
                        <Users size={10} />
                        <span className="text-xs">{table.capacity}</span>
                      </div>
                      {isOccupied && !isOtherWaitronTable && (
                        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/50" />
                      )}
                      {isOtherWaitronTable && (
                        <div className="absolute top-1 right-1">
                          <Lock size={8} className="text-red-400" />
                        </div>
                      )}
                      {!isAssigned && !isOtherWaitronTable && (
                        <div className="absolute top-1 right-1">
                          <Lock size={8} className="text-gray-500" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
