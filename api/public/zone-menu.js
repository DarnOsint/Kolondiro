/**
 * Public zone menu resolver for customer QR scans.
 *
 * Uses Supabase service role to avoid RLS issues on public pages.
 *
 * Env:
 *  - VITE_SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY

const sb = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
}

export default async function handler(req, res) {
  if (!sb) return res.status(500).json({ error: 'Server not configured' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const zoneParam = (req.query?.zone || req.query?.zoneId || '').toString().trim()
    if (!zoneParam) return res.status(400).json({ error: 'Missing zone' })

    // Resolve zone
    let zone = null
    if (isUuidLike(zoneParam)) {
      const z = await sb.from('table_categories').select('id, name').eq('id', zoneParam).maybeSingle()
      if (z.data && !z.error) zone = z.data
    }
    if (!zone) {
      const z = await sb
        .from('table_categories')
        .select('id, name')
        .ilike('name', zoneParam)
        .maybeSingle()
      if (z.data && !z.error) zone = z.data
    }

    // Back-compat: if this is a table id accidentally passed as zone
    if (!zone && isUuidLike(zoneParam)) {
      const t = await sb
        .from('tables')
        .select('id, category_id, table_categories(id, name)')
        .eq('id', zoneParam)
        .maybeSingle()
      const redirectZoneId = t.data?.table_categories?.id || t.data?.category_id || null
      if (redirectZoneId) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300')
        return res.status(200).json({ redirectZoneId })
      }
    }

    if (!zone) return res.status(404).json({ error: 'Zone not found' })

    const [menuRes, zonePriceRes, raveModeRes] = await Promise.all([
      sb
        .from('menu_items')
        .select('id, name, price, rave_price, description, image_url, menu_categories(name, destination)')
        .order('name'),
      sb.from('menu_item_zone_prices').select('menu_item_id, category_id, price').eq('category_id', zone.id),
      sb.from('settings').select('value').eq('id', 'rave_mode').single(),
    ])

    if (menuRes.error) throw menuRes.error
    if (zonePriceRes.error) throw zonePriceRes.error

    const raveActive = raveModeRes.data?.value === 'true'
    const baseMenu = menuRes.data || []
    const priceRows = zonePriceRes.data || []
    const zonePriceByItem = new Map()
    for (const row of priceRows) {
      if (row?.menu_item_id && row.price != null) zonePriceByItem.set(row.menu_item_id, Number(row.price))
    }

    const menu = baseMenu.map((item) => {
      let price = zonePriceByItem.has(item.id) ? zonePriceByItem.get(item.id) : item.price
      if (raveActive && item.rave_price != null) {
        price = item.rave_price
      }
      return {
        ...item,
        price,
        hasZonePrice: zonePriceByItem.has(item.id),
      }
    })

    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=3600')
    return res.status(200).json({ zone, menu, zonePrices: priceRows.length })
  } catch (err) {
    const msg = err?.message || String(err)
    return res.status(500).json({ error: msg })
  }
}
