/**
 * api/cron/chiller-carryover.js
 * Runs daily at 08:05 WAT (07:05 UTC) — after the 8am session boundary.
 * 1. Updates yesterday's bar_chiller_stock with actual POS sold data
 * 2. Creates today's entries with opening = yesterday's closing
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const isCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = req.headers['x-internal-secret'] === process.env.INTERNAL_API_SECRET
  if (!isCron && !isInternal) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Determine yesterday and today based on 8am WAT boundary
    const watNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    const todayDate = new Date(watNow)
    if (watNow.getHours() < 8) todayDate.setDate(todayDate.getDate() - 1)
    const yesterdayDate = new Date(todayDate)
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)

    const today = todayDate.toLocaleDateString('en-CA')
    const yesterday = yesterdayDate.toLocaleDateString('en-CA')

    // Step 1: Get yesterday's actual POS sold
    const dayStart = new Date(yesterday + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [soldRes, zonePriceRes] = await Promise.all([
      supabase
        .from('order_items')
        .select(
          'quantity, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(category_id))'
        )
        .eq('destination', 'bar')
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString()),
      supabase
        .from('menu_item_zone_prices')
        .select('menu_item_id, category_id, units_per_sale'),
    ])

    // Build { menu_item_id: { category_id: units_per_sale } } map for zone-aware deduction.
    const zoneUnits = {}
    for (const row of (zonePriceRes.data || [])) {
      const units = Number(row.units_per_sale)
      if (Number.isFinite(units) && units > 1) {
        const key = `${String(row.menu_item_id)}:${String(row.category_id)}`
        zoneUnits[key] = units
      }
    }
    const lineUnits = (menuItemId, categoryId) => {
      const units = zoneUnits[`${String(menuItemId || '')}:${String(categoryId || '')}`]
      return Number.isFinite(units) && units > 1 ? units : 1
    }

    const soldMap = {}
    for (const item of (soldRes.data || [])) {
      if (item.return_accepted) continue
      if (item.orders?.status === 'cancelled') continue
      if (item.status === 'cancelled') continue
      const name = item.menu_items?.name
      if (!name) continue
      const categoryId = item.orders?.tables?.category_id ?? null
      const units = (Number(item.quantity) || 0) * lineUnits(item.menu_item_id, categoryId)
      soldMap[name] = (soldMap[name] || 0) + units
    }

    // Step 2: Update yesterday's entries with correct sold/closing
    const { data: yEntries } = await supabase
      .from('bar_chiller_stock')
      .select('id, item_name, opening_qty, received_qty, void_qty')
      .eq('date', yesterday)

    let updated = 0
    for (const e of (yEntries || [])) {
      const posSold = soldMap[e.item_name] || 0
      const closing = Math.max(0, e.opening_qty + e.received_qty - posSold - e.void_qty)
      await supabase.from('bar_chiller_stock')
        .update({ sold_qty: posSold, closing_qty: closing, updated_at: new Date().toISOString() })
        .eq('id', e.id)
      updated++
    }

    // Step 3: Check if today already has entries
    const { data: todayExisting } = await supabase
      .from('bar_chiller_stock')
      .select('id')
      .eq('date', today)
      .limit(1)

    let created = 0
    if (!todayExisting || todayExisting.length === 0) {
      // Create today from yesterday's closing
      const { data: fixedYest } = await supabase
        .from('bar_chiller_stock')
        .select('item_name, unit, closing_qty')
        .eq('date', yesterday)

      const todayRows = (fixedYest || [])
        .filter(r => r.closing_qty > 0)
        .map(r => ({
          date: today,
          item_name: r.item_name,
          unit: r.unit || 'bottles',
          opening_qty: r.closing_qty,
          received_qty: 0,
          sold_qty: 0,
          void_qty: 0,
          closing_qty: r.closing_qty,
          updated_at: new Date().toISOString(),
        }))

      if (todayRows.length > 0) {
        const { error } = await supabase.from('bar_chiller_stock').insert(todayRows)
        if (error) {
          console.error('[chiller-carryover] Insert error:', error.message)
        } else {
          created = todayRows.length
        }
      }
    }

    const totalOpening = created > 0
      ? (yEntries || []).reduce((s, e) => {
          const posSold = soldMap[e.item_name] || 0
          return s + Math.max(0, e.opening_qty + e.received_qty - posSold - e.void_qty)
        }, 0)
      : 'skipped (already exists)'

    console.log(`[chiller-carryover] OK — updated ${updated} yesterday, created ${created} today, opening: ${totalOpening}`)
    return res.status(200).json({
      success: true,
      yesterday,
      today,
      updatedYesterday: updated,
      createdToday: created,
      todayOpening: totalOpening,
    })
  } catch (err) {
    console.error('[chiller-carryover] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
