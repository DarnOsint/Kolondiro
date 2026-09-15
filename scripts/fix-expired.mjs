import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'

const supabase = createClient(supabaseUrl, serviceKey)

const start = '2026-05-01T00:00:00.000Z'
const end = '2026-05-23T23:59:59.000Z'

const { data: expired, error } = await supabase
  .from('returns_log')
  .select('*')
  .eq('status', 'expired')
  .gte('resolved_at', start)
  .lte('resolved_at', end)
  .order('resolved_at', { ascending: false })

if (error) {
  console.error('Query error:', error)
  process.exit(1)
}

console.log(`Fixing ${expired.length} expired returns...\n`)

let fixedCount = 0
let errorCount = 0

for (const r of expired) {
  try {
    // 1. Set return_accepted = true on the order item (permanently removes from bill)
    const { error: oiErr } = await supabase
      .from('order_items')
      .update({ return_accepted: true, return_accepted_at: new Date().toISOString() })
      .eq('id', r.order_item_id)
    if (oiErr) throw oiErr

    // 2. Recalculate order total excluding this item
    const { data: remaining, error: remErr } = await supabase
      .from('order_items')
      .select('total_price, extra_charge, status, return_accepted')
      .eq('order_id', r.order_id)
    if (remErr) throw remErr

    const newTotal = (remaining || [])
      .filter((ri) => {
        if ((ri.status || '').toLowerCase() === 'cancelled') return false
        return !ri.return_accepted
      })
      .reduce((s, ri) => s + (ri.total_price || 0) + (ri.extra_charge || 0), 0)

    const { error: orderErr } = await supabase
      .from('orders')
      .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
      .eq('id', r.order_id)
    if (orderErr) throw orderErr

    // 3. Update linked credit debtors if any
    const { data: debtors } = await supabase
      .from('debtors')
      .select('id, amount_paid')
      .eq('order_id', r.order_id)
      .eq('debt_type', 'credit_order')
      .eq('is_active', true)

    for (const debtor of debtors || []) {
      const amountPaid = Number(debtor.amount_paid || 0)
      const currentBalance = Math.max(0, newTotal - amountPaid)
      const status = currentBalance <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'outstanding'
      await supabase
        .from('debtors')
        .update({
          credit_limit: newTotal,
          current_balance: currentBalance,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', debtor.id)
    }

    const date = new Date(r.resolved_at).toLocaleDateString('en-NG')
    console.log(`✅ ${date} | ${r.quantity}x ${r.item_name} | Order total recalculated to N${newTotal.toLocaleString()}`)
    fixedCount++
  } catch (e) {
    console.error(`❌ Failed for ${r.item_name} (id: ${r.order_item_id}):`, e.message)
    errorCount++
  }
}

console.log(`\nDone. Fixed: ${fixedCount}, Errors: ${errorCount}`)
