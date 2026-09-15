import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://qdibeyhdrcrddckouqmc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'
)

// ── Helpers ──────────────────────────────────────────────
const isPaidOrClosed = (o) => {
  const s = (o.status || '').toLowerCase()
  return s === 'paid' || s === 'closed'
}

const getValidOrderItems = (items) =>
  (items || []).filter((i) => {
    if (!i) return false
    return (
      !i.return_requested &&
      !i.return_accepted &&
      (i.status || '').toLowerCase() !== 'cancelled'
    )
  })

const getNetOrderAmount = (order) =>
  getValidOrderItems(order.order_items || []).reduce(
    (s, i) => s + (i.total_price || 0) + (i.extra_charge || 0),
    0
  )

function getWaitronRemittance(paymentMethod, netAmount) {
  const method = (paymentMethod || '').toLowerCase().replace(/\s+/g, '_')
  if (method === 'cash') return { cash: netAmount, transfer: 0 }
  if (method === 'bank_pos' || method === 'transfer') return { cash: 0, transfer: netAmount }
  return { cash: netAmount / 2, transfer: netAmount / 2 }
}

// ── Fetch all recon entries in the range ─────────────────
const start = '2026-05-01'
const end = '2026-05-23'

const { data: reconSettings, error: reconErr } = await supabase
  .from('settings')
  .select('id, value')
  .gte('id', `recon_${start}`)
  .lte('id', `recon_${end}`)

if (reconErr) {
  console.error('Error fetching recons:', reconErr)
  process.exit(1)
}

console.log(`Found ${reconSettings.length} recon entries in May 1-23\n`)

let updatedCount = 0

for (const entry of reconSettings) {
  const dateStr = entry.id.replace('recon_', '')
  console.log(`\n── ${dateStr} ──`)

  let recon
  try {
    recon = JSON.parse(entry.value)
  } catch {
    console.log('  ⚠ Could not parse, skipping')
    continue
  }

  // Build day boundaries (8am WAT to 8am WAT next day — matches the app's trading day)
  const dayStart = new Date(dateStr + 'T08:00:00+01:00')
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  // Query paid/closed orders for this day range.
  // Paid orders use closed_at (matches Accounting.tsx line 207 logic).
  const { data: orders, error: ordErr } = await supabase
    .from('orders')
    .select(
      `id, total_amount, payment_method, status, created_at, closed_at,
       order_items(id, total_price, extra_charge, status, return_requested, return_accepted),
       profiles!inner(full_name)`
    )
    .or(
      `and(status.eq.paid,closed_at.gte.${dayStart.toISOString()},closed_at.lt.${dayEnd.toISOString()}),and(status.neq.paid,created_at.gte.${dayStart.toISOString()},created_at.lt.${dayEnd.toISOString()})`
    )

  if (ordErr) {
    console.log(`  ⚠ Query error: ${ordErr.message}`)
    continue
  }

  // Calculate per-waitron expected totals (same logic as Accounting.tsx)
  const wMap = {}
  for (const o of orders || []) {
    if (!isPaidOrClosed(o)) continue
    const name = o.profiles?.full_name || 'Unknown'
    if (!wMap[name]) {
      wMap[name] = { cashExpected: 0, transferExpected: 0 }
    }
    const netAmount = getNetOrderAmount(o)
    const remittance = getWaitronRemittance(o.payment_method, netAmount)
    wMap[name].cashExpected += remittance.cash
    wMap[name].transferExpected += remittance.transfer
  }

  // Recalculate outstanding using the saved cashCollected / transferReceipts
  const oldOutstanding = recon.outstanding || {}
  const newOutstanding = {}
  const newExcess = {}

  const allNames = new Set([
    ...Object.keys(wMap),
    ...Object.keys(recon.cashCollected || {}),
    ...Object.keys(recon.transferReceipts || {}),
  ])

  for (const name of allNames) {
    const cashExpected = wMap[name]?.cashExpected || 0
    const transferExpected = wMap[name]?.transferExpected || 0
    const expectedTotal = cashExpected + transferExpected
    const cashCollected = recon.cashCollected?.[name] || 0
    const transferReceipts = recon.transferReceipts?.[name] || 0
    const remittedTotal = cashCollected + transferReceipts

    const shortage = Math.max(0, expectedTotal - remittedTotal)
    const excess = Math.max(0, remittedTotal - expectedTotal)

    if (shortage > 0) newOutstanding[name] = shortage
    if (excess > 0) newExcess[name] = excess
  }

  // Log the changes
  const oldTotal = Object.values(oldOutstanding).reduce((s, v) => s + (v || 0), 0)
  const newTotal = Object.values(newOutstanding).reduce((s, v) => s + (v || 0), 0)
  const diff = oldTotal - newTotal

  console.log(`  Old outstanding total: N${oldTotal.toLocaleString()}`)
  console.log(`  New outstanding total: N${newTotal.toLocaleString()}`)
  console.log(`  Difference: N${diff.toLocaleString()}`)

  if (diff > 0) {
    // Show per-waitron breakdown
    for (const [name, amt] of Object.entries(oldOutstanding)) {
      const newAmt = newOutstanding[name] || 0
      if (amt !== newAmt) {
        console.log(`  ${name}: N${amt.toLocaleString()} → N${newAmt.toLocaleString()} (${(amt - newAmt) > 0 ? '-' : ''}N${Math.abs(amt - newAmt).toLocaleString()})`)
      }
    }

    // Update the saved recon
    recon.outstanding = newOutstanding
    recon.excess = newExcess
    const { error: updErr } = await supabase
      .from('settings')
      .update({ value: JSON.stringify(recon), updated_at: new Date().toISOString() })
      .eq('id', entry.id)

    if (updErr) {
      console.log(`  ❌ Update failed: ${updErr.message}`)
    } else {
      console.log(`  ✅ Updated outstanding reduced by N${diff.toLocaleString()}`)
      updatedCount++
    }
  } else if (diff === 0) {
    console.log(`  No change needed`)
  } else {
    console.log(`  ⚠ Outstanding increased by N${Math.abs(diff).toLocaleString()} (unexpected)`)
  }
}

console.log(`\n── Done ──`)
console.log(`Updated ${updatedCount} recon entries`)
