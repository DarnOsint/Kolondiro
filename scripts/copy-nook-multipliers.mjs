const SUPABASE_URL = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'
const supabase = (await import('@supabase/supabase-js')).createClient(SUPABASE_URL, SERVICE_KEY)

const INDOOR = '53185934-6b8c-4310-84c5-579072fac337'
const NOOK = 'adf46085-5886-4ba2-8103-9d3f8658344e'
const DRY_RUN = process.argv.includes('--dry-run')

const select = (from) => supabase.from(from).select('*')

const { data: indoorRows, error } = await supabase
  .from('menu_item_zone_prices')
  .select('menu_item_id, category_id, price, units_per_sale')
  .eq('category_id', INDOOR)
if (error) throw new Error('fetch indoor: ' + error.message)

const { data: nookRows } = await supabase
  .from('menu_item_zone_prices')
  .select('menu_item_id, category_id, units_per_sale, price')
  .eq('category_id', NOOK)

const nookByItem = new Map((nookRows || []).map((r) => [r.menu_item_id, r]))
let toInsert = []
let toUpdate = []
for (const r of indoorRows || []) {
  const u = Number(r.units_per_sale)
  if (!Number.isFinite(u) || u <= 1) continue
  const existing = nookByItem.get(r.menu_item_id)
  if (!existing) {
    toInsert.push({ menu_item_id: r.menu_item_id, category_id: NOOK, price: r.price, units_per_sale: r.units_per_sale })
  } else if (Number(existing.units_per_sale) !== u) {
    toUpdate.push({ menu_item_id: r.menu_item_id, units_per_sale: r.units_per_sale, price: existing.price ?? r.price })
  }
}

console.log(`Indoor rows with units_per_sale>1: ${indoorRows.filter(r=>Number(r.units_per_sale)>1).length}`)
console.log(`to INSERT into Nook: ${toInsert.length}`)
console.log(`to UPDATE (existing wrong Nook value): ${toUpdate.length}`)
if (DRY_RUN) { console.log('DRY RUN — no changes made'); process.exit(0) }

for (const row of toInsert) {
  const { error: e } = await supabase.from('menu_item_zone_prices').insert(row)
  if (e) console.log('INSERT fail', row.menu_item_id, e.message)
}
for (const u of toUpdate) {
  const { error: e } = await supabase.from('menu_item_zone_prices').update({ units_per_sale: u.units_per_sale }).eq('menu_item_id', u.menu_item_id).eq('category_id', NOOK)
  if (e) console.log('UPDATE fail', u.menu_item_id, e.message)
}
console.log(`DONE — inserted ${toInsert.length}, updated ${toUpdate.length}`)

// verify
const { data: nookNow } = await supabase.from('menu_item_zone_prices').select('menu_item_id, units_per_sale').eq('category_id', NOOK)
const n2 = (nookNow||[]).filter(r=>Number(r.units_per_sale)>1)
console.log('Nook rows now with units_per_sale>1:', n2.length)
