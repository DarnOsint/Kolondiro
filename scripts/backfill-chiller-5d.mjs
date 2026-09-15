#!/usr/bin/env node
/**
 * Backfill: correct bar_chiller_stock sold_qty / closing_qty for the past N business days.
 *
 * The app's chiller "sold" figure (what the barman sees in the KDS and what the
 * nightly carry-over cron commits) under-counted 2-drink items because the
 * units_per_sale multiplier was not applied. This script recomputes each day's
 * sold from live POS order_items — applying the zone-aware units_per_sale
 * multiplier AND subtracting accepted returns (matching BarChillerStock) — and
 * writes the corrected sold_qty + closing_qty onto the existing stock rows.
 *
 * It only CORRECTS existing bar_chiller_stock rows; it never creates new ones,
 * so it won't invent stock that wasn't tracked.
 *
 * Usage:
 *   node scripts/backfill-chiller-5d.mjs [DAYS] [--dry-run]
 *   Defaults to 5 business days ending "yesterday" (per the 8am WAT boundary).
 *   Pass --dry-run to preview exactly what would change without writing.
 *
 * NOTE: For items sold on a day that had no existing chiller row, this creates
 * a new row (opening=0, received=0, sold=<actual>, void=0, closing=0) — the
 * same values the in-app save would write — so the stored register reflects
 * the real sold quantity everywhere the DB row is read.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const SUPABASE_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Day helpers (8am WAT boundary, matching the rest of the app) ──────────
function watNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
}

function toDateStr(d) {
  return d.toLocaleDateString('en-CA')
}

function prevBusinessDateStr(dateObj) {
  const d = new Date(dateObj)
  // Business day starts at 08:00 WAT; before that we still belong to "yesterday"
  if (d.getHours() < 8) d.setDate(d.getDate() - 1)
  return toDateStr(d)
}

// ── Build the list of target business days (oldest → newest) ─────────────
const daysArg = parseInt(process.argv[2], 10)
const daysCount = Number.isFinite(daysArg) && daysArg >= 1 ? daysArg : 5
const DRY_RUN = process.argv.includes('--dry-run')

const now = watNow()
const todayDate = new Date(now)
if (now.getHours() < 8) todayDate.setDate(todayDate.getDate() - 1)
const todayStr = toDateStr(todayDate) // today (business), we do NOT backfill it
// "yesterday" is the most recent complete business day
const yesterdayStr = prevBusinessDateStr(new Date(todayDate.getTime() - 24 * 60 * 60 * 1000))

const targetDays = []
for (let i = 0; i < daysCount; i++) {
  const d = new Date(todayDate)
  d.setDate(d.getDate() - (i + 1))
  targetDays.push(toDateStr(d))
}
targetDays.sort()

console.log(`Business today: ${todayStr} (not backfilled)`)
console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Backfilling ${targetDays.length} days: ${targetDays.join(', ')}`)
console.log('--------------------------------------------------------------')

// Fetch zone-units map once (key = `${menu_item_id}:${category_id}` → units_per_sale>1)
const { data: zonePriceRes, error: zoneErr } = await supabase
  .from('menu_item_zone_prices')
  .select('menu_item_id, category_id, units_per_sale')
if (zoneErr) {
  console.error('FATAL: could not fetch menu_item_zone_prices:', zoneErr.message)
  process.exit(1)
}
const zoneUnits = {}
for (const row of zonePriceRes || []) {
  const units = Number(row.units_per_sale)
  if (Number.isFinite(units) && units > 1) {
    zoneUnits[`${String(row.menu_item_id)}:${String(row.category_id)}`] = units
  }
}
const lineUnits = (menuItemId, categoryId) => {
  const units = zoneUnits[`${String(menuItemId || '')}:${String(categoryId || '')}`]
  return Number.isFinite(units) && units > 1 ? units : 1
}

let totalUpdated = 0
let totalCreated = 0
let totalRows = 0

for (const dayStr of targetDays) {
  const dayStart = new Date(dayStr + 'T08:00:00+01:00')
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const [soldRes, retRes] = await Promise.all([
    supabase
      .from('order_items')
      .select(
        'quantity, status, return_accepted, menu_item_id, menu_items(name), orders(status, tables(category_id))'
      )
      .eq('destination', 'bar')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString()),
    supabase
      .from('returns_log')
      .select('item_name, quantity, status')
      .eq('status', 'accepted')
      .gte('requested_at', dayStart.toISOString())
      .lt('requested_at', dayEnd.toISOString()),
  ])

  // 1) Zone-aware sold map (mirrors BarChillerStock loadSoldQty)
  const soldMap = {}
  for (const item of soldRes.data || []) {
    if (item.return_accepted) continue
    if (item.orders?.status === 'cancelled') continue
    if (item.status === 'cancelled') continue
    const name = item.menu_items?.name
    if (!name) continue
    const categoryId = item.orders?.tables?.category_id ?? null
    const units = (Number(item.quantity) || 0) * lineUnits(item.menu_item_id, categoryId)
    soldMap[name] = (soldMap[name] || 0) + units
  }

  // 2) Subtract accepted returns (raw quantity, same as BarChillerStock)
  const retMap = {}
  for (const r of retRes.data || []) {
    if (r.status !== 'accepted' || !r.item_name) continue
    retMap[r.item_name] = (retMap[r.item_name] || 0) + (Number(r.quantity) || 0)
  }
  for (const [name, qty] of Object.entries(retMap)) {
    if (name in soldMap) soldMap[name] = Math.max(0, (soldMap[name] || 0) - qty)
  }

  // 3) Update existing and create missing rows for the day
  const { data: rows } = await supabase
    .from('bar_chiller_stock')
    .select('id, item_name, opening_qty, received_qty, sold_qty, void_qty')
    .eq('date', dayStr)

  console.log(`\n── ${dayStr} ── (${rows?.length || 0} existing stock rows)`)
  const rowByName = {}
  for (const r of rows || []) rowByName[r.item_name] = r

  const allNames = new Set([...Object.keys(soldMap), ...Object.keys(rowByName)])
  let dayUpdated = 0
  let dayCreated = 0

  for (const name of allNames) {
    const posSold = Math.round((soldMap[name] || 0) * 100) / 100
    const existing = rowByName[name]

    if (existing) {
      const closing = Math.max(
        0,
        (Number(existing.opening_qty) || 0) +
          (Number(existing.received_qty) || 0) -
          posSold -
          (Number(existing.void_qty) || 0)
      )
      const curSold = Number(existing.sold_qty) || 0
      const curClosing = Number(existing.closing_qty ?? closing) || 0
      if (curSold === posSold && curClosing === closing) continue
      if (DRY_RUN) {
        console.log(`  [upd] ${name}: sold ${curSold} → ${posSold}`)
        dayUpdated++
        continue
      }
      const { error } = await supabase
        .from('bar_chiller_stock')
        .update({ sold_qty: posSold, closing_qty: closing, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) {
        console.log(`  ❌ ${name}: update failed — ${error.message}`)
      } else {
        console.log(`  [upd] ${name}: sold ${curSold} → ${posSold}`)
        dayUpdated++
      }
      continue
    }

    // Item was sold but has no chiller row for this day — create one so the
    // stored register captures the real sold quantity.
    if (posSold <= 0) continue // nothing actually sold — skip empty rows
    const closing = Math.max(0, 0 - posSold - 0) // opening=0, received=0, void=0
    const unit = 'bottles'
    if (DRY_RUN) {
      console.log(`  [new] ${name}: sold ${posSold} (would create row)`)
      dayCreated++
      continue
    }
    const { error } = await supabase.from('bar_chiller_stock').insert({
      date: dayStr,
      item_name: name,
      unit,
      opening_qty: 0,
      received_qty: 0,
      sold_qty: posSold,
      void_qty: 0,
      closing_qty: closing,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      console.log(`  ❌ ${name}: insert failed — ${error.message}`)
    } else {
      console.log(`  [new] ${name}: sold ${posSold}`)
      dayCreated++
    }
  }
  totalUpdated += dayUpdated
  totalCreated += dayCreated
  totalRows += (rows || []).length
}

console.log('\n--------------------------------------------------------------')
console.log(
  `${DRY_RUN ? '[DRY-RUN] ' : ''}Done. ${totalUpdated} row(s) updated + ${totalCreated} row(s) created across ${targetDays.length} days (~${totalRows} existing rows).`
)