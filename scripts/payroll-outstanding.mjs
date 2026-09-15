import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://qdibeyhdrcrddckouqmc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'
)

const normalize = (s) => (s || '').toLowerCase().trim()

// ── 1. Recon outstanding (matches PayrollTab lines 124-141) ──
const month = '2026-05'
const { data: reconEntries } = await supabase
  .from('settings')
  .select('id, value')
  .ilike('id', `recon_${month}-%`)

const reconOutstanding = {}
for (const entry of reconEntries || []) {
  try {
    const recon = JSON.parse(entry.value)
    if (recon.outstanding) {
      for (const [name, amt] of Object.entries(recon.outstanding)) {
        const key = normalize(name)
        if (amt > 0) reconOutstanding[key] = (reconOutstanding[key] || 0) + amt
      }
    }
  } catch { /* */ }
}

console.log('═══ RECON OUTSTANDING (sum of daily recon for May) ═══')
let totalRecon = 0
for (const [name, amt] of Object.entries(reconOutstanding).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(35)} N${amt.toLocaleString()}`)
  totalRecon += amt
}
console.log(`  ${''.padEnd(35)} ─────────`)
console.log(`  TOTAL RECON OUTSTANDING:${''.padEnd(13)} N${totalRecon.toLocaleString()}`)

// ── 2. Credit debts (matches PayrollTab lines 143-160) ──
const monthStartISO = new Date('2026-05-01T08:00:00+01:00').toISOString()
const monthEnd = new Date('2026-06-01T08:00:00+01:00')
const { data: unpaidDebts } = await supabase
  .from('debtors')
  .select('name, current_balance, recorded_by_name')
  .in('status', ['outstanding', 'partial'])
  .in('debt_type', ['credit_order', 'table_order', 'fridge'])
  .gte('created_at', monthStartISO)
  .lt('created_at', monthEnd.toISOString())

const creditByStaff = {}
for (const d of unpaidDebts || []) {
  const key = normalize(d.recorded_by_name || 'Unknown')
  creditByStaff[key] = (creditByStaff[key] || 0) + Number(d.current_balance || 0)
}

console.log('\n═══ CREDIT DEBTS (unpaid, May) ═══')
let totalCredit = 0
for (const [name, amt] of Object.entries(creditByStaff).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(35)} N${amt.toLocaleString()}`)
  totalCredit += amt
}
console.log(`  ${''.padEnd(35)} ─────────`)
console.log(`  TOTAL CREDIT DEBTS:${''.padEnd(16)} N${totalCredit.toLocaleString()}`)

// ── 3. Combined auto_outstanding per waitron ──
const allNames = new Set([...Object.keys(reconOutstanding), ...Object.keys(creditByStaff)])
console.log('\n═══ TOTAL AUTO OUTSTANDING PER WAITRON ═══')
console.log(`  ${'WAITRON'.padEnd(35)} RECON    CREDIT   TOTAL`)
console.log(`  ${''.padEnd(68)}`)
let grandTotal = 0
for (const name of [...allNames].sort()) {
  const r = reconOutstanding[name] || 0
  const c = creditByStaff[name] || 0
  const total = r + c
  if (total > 0) {
    console.log(`  ${name.padEnd(35)} N${String(r.toLocaleString()).padStart(8)} N${String(c.toLocaleString()).padStart(7)} N${String(total.toLocaleString()).padStart(8)}`)
    grandTotal += total
  }
}
console.log(`  ${''.padEnd(68)}`)
console.log(`  ${''.padEnd(35)} ${''.padStart(8,'─')} ${''.padStart(7,'─')} ${''.padStart(8,'─')}`)
console.log(`  GRAND TOTAL AUTO OUTSTANDING:${''.padEnd(11)} N${grandTotal.toLocaleString()}`)

// ── 4. Saved payroll entries (manual outstanding + docking) ──
const { data: payroll } = await supabase
  .from('payroll')
  .select('staff_name, role, base_salary, outstanding, docking')
  .eq('month', month)

console.log('\n═══ SAVED PAYROLL ENTRIES (manual) ═══')
let totalManual = 0
let totalDocking = 0
for (const p of payroll || []) {
  if (p.outstanding || p.docking) {
    console.log(`  ${(p.staff_name || '?').padEnd(35)} manual_owing: N${Number(p.outstanding||0).toLocaleString()}  docking: N${Number(p.docking||0).toLocaleString()}`)
    totalManual += Number(p.outstanding || 0)
    totalDocking += Number(p.docking || 0)
  }
}
console.log(`  TOTAL MANUAL OUTSTANDING:${''.padEnd(13)} N${totalManual.toLocaleString()}`)
console.log(`  TOTAL DOCKING:${''.padEnd(22)} N${totalDocking.toLocaleString()}`)
