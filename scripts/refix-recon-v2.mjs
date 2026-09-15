import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://qdibeyhdrcrddckouqmc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'
)

// ── Step 1: Get the 17 expired returns ──────────────────
const { data: expired, error: expErr } = await supabase
  .from('returns_log')
  .select('*')
  .eq('status', 'expired')
  .gte('resolved_at', '2026-05-01T00:00:00.000Z')
  .lte('resolved_at', '2026-05-23T23:59:59.000Z')

if (expErr) { console.error(expErr); process.exit(1) }
console.log(`Found ${expired.length} expired returns\n`)

// ── Step 2: For each, get the order and its payment method ──
const adjustments = [] // { date, waitron_name, amount }

for (const r of expired) {
  const { data: order } = await supabase
    .from('orders')
    .select('payment_method, closed_at')
    .eq('id', r.order_id)
    .single()

  if (!order) {
    console.log(`⚠ Order not found for ${r.item_name}`)
    continue
  }

  // Determine which day this order was accounted in (using closed_at for paid, created_at as fallback)
  const dateStr = r.resolved_at.slice(0, 10)

  adjustments.push({
    date: dateStr,
    waitron_name: r.waitron_name || 'Unknown',
    amount: Number(r.item_total || 0),
    item: `${r.quantity}x ${r.item_name}`,
  })

  console.log(`  ${dateStr} | ${r.waitron_name || '?'} | N${Number(r.item_total).toLocaleString()} | ${r.quantity}x ${r.item_name}`)
}

// ── Step 3: Group by (date, waitron) and apply to recon entries ──
const grouped = {}
for (const a of adjustments) {
  const key = `${a.date}::${a.waitron_name}`
  if (!grouped[key]) grouped[key] = { date: a.date, waitron: a.waitron_name, total: 0, items: [] }
  grouped[key].total += a.amount
  grouped[key].items.push(a.item)
}

console.log(`\nGrouped into ${Object.keys(grouped).length} (date, waitron) pairs\n`)

let updatedCount = 0

for (const [, adj] of Object.entries(grouped)) {
  // Fetch the recon entry for this date
  const { data: reconSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('id', `recon_${adj.date}`)
    .single()

  if (!reconSetting?.value) {
    console.log(`  No recon entry for ${adj.date}, skipping`)
    continue
  }

  let recon
  try { recon = JSON.parse(reconSetting.value) } catch { continue }

  const oldOutstanding = recon.outstanding?.[adj.waitron] || 0
  const newOutstanding = Math.max(0, oldOutstanding - adj.total)

  if (oldOutstanding === newOutstanding) {
    console.log(`  ${adj.date} | ${adj.waitron}: outstanding already N${oldOutstanding.toLocaleString()} (no change needed)`)
    continue
  }

  // Update outstanding
  if (newOutstanding > 0) {
    recon.outstanding[adj.waitron] = newOutstanding
  } else {
    delete recon.outstanding[adj.waitron]
  }

  // If the reduction created excess, adjust excess too
  const oldExcess = recon.excess?.[adj.waitron] || 0
  if (oldOutstanding > 0 && oldOutstanding - adj.total < 0) {
    // Outstanding went to 0 and some overflow becomes excess
    const overflow = Math.abs(oldOutstanding - adj.total)
    recon.excess[adj.waitron] = (recon.excess[adj.waitron] || 0) + overflow
    console.log(`  ${adj.date} | ${adj.waitron}: N${oldOutstanding.toLocaleString()} → N0 (N${overflow.toLocaleString()} overflow moved to excess)`)
  } else {
    console.log(`  ${adj.date} | ${adj.waitron}: N${oldOutstanding.toLocaleString()} → N${newOutstanding.toLocaleString()} (-N${(oldOutstanding - newOutstanding).toLocaleString()})`)
  }

  const { error: updErr } = await supabase
    .from('settings')
    .update({ value: JSON.stringify(recon), updated_at: new Date().toISOString() })
    .eq('id', `recon_${adj.date}`)

  if (updErr) {
    console.log(`    ❌ Update failed: ${updErr.message}`)
  } else {
    updatedCount++
  }
}

console.log(`\n── Done ──`)
console.log(`Updated ${updatedCount} recon entries`)
