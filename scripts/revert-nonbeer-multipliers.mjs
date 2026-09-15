const SUPABASE_URL = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'
const supabase = (await import('@supabase/supabase-js')).createClient(SUPABASE_URL, SERVICE_KEY)

const BEER = '2932e856-dc5d-4fcc-9810-7f079da41342'
const INDOOR = '53185934-6b8c-4310-84c5-579072fac337'
const NOOK = 'adf46085-5886-4ba2-8103-9d3f8658344e'
const DRY_RUN = process.argv.includes('--dry-run')
const ZONES = [INDOOR, NOOK]

// 1. All multipliers currently set in either zone
const { data: zp1 } = await supabase.from('menu_item_zone_prices').select('menu_item_id, category_id, units_per_sale').in('category_id', ZONES)
const { data: zpAll } = await supabase.from('menu_item_zone_prices').select('menu_item_id, category_id, units_per_sale')
const multItems = new Set()
for (const r of zp1 || []) if (Number(r.units_per_sale) > 1) multItems.add(r.menu_item_id)
const ids = [...multItems]
const { data: items } = await supabase.from('menu_items').select('id, name, category_id').in('id', ids)
const itemCat = new Map((items || []).map((it) => [it.id, it.category_id]))
const itemName = new Map((items || []).map((it) => [it.id, it.name]))

// Beer = keep 2 ; non-beer = set to 1
const beerIds = new Set((items || []).filter((it) => it.category_id === BEER).map((it) => it.id))
const beerList = (items || []).filter((it) => it.category_id === BEER)
const nonBeerList = (items || []).filter((it) => it.category_id !== BEER)

console.log('Items currently with units_per_sale>1:', ids.length)
console.log('  Beer (keep 2):', beerList.length)
console.log('  Non-beer (set 1):', nonBeerList.length)

// For each zone, what updates are needed
let updates = [] // {category_id, menu_item_id, units_per_sale}
for (const zone of ZONES) {
  for (const it of beerList) {
    // ensure beer stays 2
    const row = zpAll.find((r) => r.menu_item_id === it.id && r.category_id === zone)
    if (row && Number(row.units_per_sale) !== 2) updates.push({ category_id: zone, menu_item_id: it.id, units_per_sale: 2, name: it.name, reason: 'beer->2' })
  }
  for (const it of nonBeerList) {
    const row = zpAll.find((r) => r.menu_item_id === it.id && r.category_id === zone)
    if (row && Number(row.units_per_sale) !== 1) updates.push({ category_id: zone, menu_item_id: it.id, units_per_sale: 1, name: it.name, reason: 'nonbeer->1' })
  }
}
console.log('\nTotal updates needed:', updates.length)
const zoneName = { [INDOOR]: 'Indoor', [NOOK]: 'The Nook' }
const byZone = {}
for (const u of updates) { const k = zoneName[u.category_id]; byZone[k] = (byZone[k] || 0) + 1 }
console.log('By zone:', byZone)

if (DRY_RUN) { console.log('\nDRY RUN — sample of 12 updates:'); for (const u of updates.slice(0, 12)) console.log(`  ${zoneName[u.category_id]}: ${u.name} -> ${u.units_per_sale}`); process.exit(0) }

for (const u of updates) {
  const { error } = await supabase
    .from('menu_item_zone_prices')
    .update({ units_per_sale: u.units_per_sale })
    .eq('menu_item_id', u.menu_item_id)
    .eq('category_id', u.category_id)
  if (error) console.log('FAIL', u.category_id, u.menu_item_id, error.message)
}
console.log('\nDONE —', updates.length, 'updates applied')

// Verify
const { data: v1 } = await supabase.from('menu_item_zone_prices').select('menu_item_id, units_per_sale').eq('category_id', INDOOR)
const { data: v2 } = await supabase.from('menu_item_zone_prices').select('menu_item_id, units_per_sale').eq('category_id', NOOK)
const c1 = (v1 || []).filter((r) => Number(r.units_per_sale) > 1).length
const c2 = (v2 || []).filter((r) => Number(r.units_per_sale) > 1).length
console.log('Indoor items with units_per_sale>1 after:', c1)
console.log('Nook items with units_per_sale>1 after:', c2)
// confirm all remaining multipliers are beer
for (const [zn, v] of [[INDOOR, v1], [NOOK, v2]]) {
  const remain = (v || []).filter((r) => Number(r.units_per_sale) > 1).map((r) => r.menu_item_id)
  const bad = remain.filter((id) => !beerIds.has(id))
  console.log(zoneName[zn], 'remaining multiplier items all beer?', bad.length === 0)
}
