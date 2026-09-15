import { supabase } from './supabase'

export type ZoneUnitsMap = Record<string, number>

export const zoneUnitsKey = (
  menuItemId: string | null | undefined,
  categoryId: string | null | undefined
): string => `${menuItemId || ''}:${categoryId || ''}`

let cache: { data: ZoneUnitsMap; fetchedAt: number } | null = null
const CACHE_TTL_MS = 60_000

export async function fetchZoneUnitsPerSale(): Promise<ZoneUnitsMap> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data
  try {
    const { data, error } = await supabase
      .from('menu_item_zone_prices')
      .select('menu_item_id, category_id, units_per_sale')
    if (error) throw error
    const map: ZoneUnitsMap = {}
    for (const row of (data || []) as Array<{
      menu_item_id: string
      category_id: string
      units_per_sale?: number | null
    }>) {
      const units = Number(row.units_per_sale)
      if (Number.isFinite(units) && units > 1) {
        map[zoneUnitsKey(row.menu_item_id, row.category_id)] = units
      }
    }
    cache = { data: map, fetchedAt: Date.now() }
    return map
  } catch {
    return cache?.data ?? {}
  }
}

export function lineUnits(
  zoneUnits: ZoneUnitsMap | null | undefined,
  menuItemId: string | null | undefined,
  categoryId: string | null | undefined
): number {
  if (!zoneUnits) return 1
  return zoneUnits[zoneUnitsKey(menuItemId, categoryId)] ?? 1
}

export function chillerQty(
  quantity: number | null | undefined,
  zoneUnits: ZoneUnitsMap | null | undefined,
  menuItemId: string | null | undefined,
  categoryId: string | null | undefined
): number {
  return (quantity || 0) * lineUnits(zoneUnits, menuItemId, categoryId)
}
