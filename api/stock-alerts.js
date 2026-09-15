/**
 * api/stock-alerts.js
 * Checks inventory for low/out-of-stock items and sends push notifications
 * to all owner + manager staff.
 *
 * Called from:
 *  1. Vercel cron — daily at 07:00 WAT (06:00 UTC) — opening time check
 *  2. Inventory.jsx — after every restock or stock level edit
 *  3. api/cron/stock-check.js — scheduled cron wrapper
 *
 * POST (from UI): { trigger: 'manual' | 'restock' | 'edit', item_id?: string }
 * GET  (from cron): triggered by cron secret header
 *
 * Deduplication: uses a simple in-memory cooldown via a Supabase settings row
 * so we don't spam alerts if called multiple times in quick succession.
 * Cooldown: 30 minutes per item per alert type.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET
const CRON_SECRET     = process.env.CRON_SECRET
const COOLDOWN_MS     = 30 * 60 * 1000 // 30 minutes

async function sendRolePush(roles, title, body, data = {}) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  await fetch(`${baseUrl}/api/push-roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify({ roles, title, body, data }),
  })
}

async function checkAndAlert(specificItemId = null) {
  // Fetch all inventory items (or just the specific one)
  let query = supabase.from('inventory').select('*')
  if (specificItemId) query = query.eq('id', specificItemId)
  const { data: items } = await query

  if (!items?.length) return { outOfStock: [], lowStock: [] }

  const outOfStock = items.filter(i => (i.current_stock || 0) <= 0)
  const lowStock   = items.filter(i =>
    (i.current_stock || 0) > 0 &&
    (i.current_stock || 0) <= (i.minimum_stock || 10)
  )

  // Load last alert times from settings table
  const alertKey = 'stock_alert_last_sent'
  const { data: settingRow } = await supabase
    .from('settings')
    .select('value')
    .eq('id', alertKey)
    .single()

  let lastAlerts = {}
  try { lastAlerts = JSON.parse(settingRow?.value || '{}') } catch (_e) { /* ignore */ }

  const now = Date.now()
  const newAlerts = { ...lastAlerts }
  let alertsFired = 0

  // Out of stock alerts — high priority
  for (const item of outOfStock) {
    const key = `out_${item.id}`
    if (lastAlerts[key] && now - lastAlerts[key] < COOLDOWN_MS) continue

    await sendRolePush(
      ['owner', 'manager'],
      `🔴 Out of Stock: ${item.item_name}`,
      `${item.item_name} is completely out of stock. Current: 0 ${item.unit}. Restock immediately.`,
      { type: 'stock_alert', level: 'out', item_id: item.id, item_name: item.item_name }
    )
    newAlerts[key] = now
    alertsFired++
  }

  // Low stock alerts
  for (const item of lowStock) {
    const key = `low_${item.id}`
    if (lastAlerts[key] && now - lastAlerts[key] < COOLDOWN_MS) continue

    const pct = Math.round((item.current_stock / item.minimum_stock) * 100)
    await sendRolePush(
      ['owner', 'manager'],
      `🟡 Low Stock: ${item.item_name}`,
      `${item.item_name} is low — ${item.current_stock} ${item.unit} remaining (min: ${item.minimum_stock}). ${pct}% of minimum threshold.`,
      { type: 'stock_alert', level: 'low', item_id: item.id, item_name: item.item_name }
    )
    newAlerts[key] = now
    alertsFired++
  }

  // Clear alert entries for items that are now healthy (back above minimum)
  const healthyIds = items
    .filter(i => (i.current_stock || 0) > (i.minimum_stock || 10))
    .map(i => i.id)

  for (const id of healthyIds) {
    delete newAlerts[`out_${id}`]
    delete newAlerts[`low_${id}`]
  }

  // Save updated alert timestamps
  if (alertsFired > 0 || healthyIds.length > 0) {
    await supabase.from('settings').upsert({
      id: alertKey,
      value: JSON.stringify(newAlerts),
      updated_at: new Date().toISOString(),
    })
  }

  return {
    outOfStock: outOfStock.map(i => i.item_name),
    lowStock: lowStock.map(i => i.item_name),
    alertsFired,
  }
}

export default async function handler(req, res) {
  // Allow cron (GET with cron secret) or internal POST
  const isCron = req.method === 'GET' &&
    req.headers['authorization'] === `Bearer ${CRON_SECRET}`
  const isInternal = req.method === 'POST' &&
    req.headers['x-internal-secret'] === INTERNAL_SECRET

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const itemId = req.body?.item_id || null
    const result = await checkAndAlert(itemId)
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    console.error('stock-alerts error:', err)
    return res.status(500).json({ error: err.message })
  }
}
