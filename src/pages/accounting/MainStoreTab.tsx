import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, RefreshCw, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'

type InventoryItem = {
  id: string
  item_name: string
  category: string | null
  unit: string
  current_stock: number
  minimum_stock: number
  cost_price: number | null
}

export default function MainStoreTab() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('inventory')
      .select('id, item_name, category, unit, current_stock, minimum_stock, cost_price')
      .eq('is_active', true)
      .order('item_name')
    setItems((data || []) as InventoryItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('acct-main-store')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchData)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) => i.item_name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)
    )
  }, [items, search])

  const outOfStock = items.filter((i) => i.current_stock <= 0).length
  const lowStock = items.filter(
    (i) => i.current_stock > 0 && i.current_stock <= i.minimum_stock
  ).length
  const totalValue = items.reduce((s, i) => s + (i.current_stock || 0) * (i.cost_price || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-amber-400" />
          <p className="text-white font-bold">Main Store (View Only)</p>
        </div>
        <button onClick={fetchData} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Total Items', value: items.length, color: 'text-white' },
          {
            label: 'Out of Stock',
            value: outOfStock,
            color: outOfStock > 0 ? 'text-red-400' : 'text-green-400',
          },
          {
            label: 'Low Stock',
            value: lowStock,
            color: lowStock > 0 ? 'text-amber-400' : 'text-green-400',
          },
          {
            label: 'Stock Value',
            value: `₦${totalValue.toLocaleString()}`,
            color: 'text-purple-400',
          },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
          >
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
        />
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-left px-2 py-2">Category</th>
                <th className="text-right px-2 py-2">Stock</th>
                <th className="text-right px-2 py-2">Min</th>
                <th className="text-left px-2 py-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                  <td className="text-white px-3 py-2 font-medium">{item.item_name}</td>
                  <td className="text-gray-400 px-2 py-2">{item.category || '—'}</td>
                  <td
                    className={`text-right px-2 py-2 font-bold ${item.current_stock <= 0 ? 'text-red-400' : item.current_stock <= item.minimum_stock ? 'text-amber-400' : 'text-green-400'}`}
                  >
                    {item.current_stock}
                  </td>
                  <td className="text-gray-500 text-right px-2 py-2">{item.minimum_stock}</td>
                  <td className="text-gray-500 px-2 py-2">{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
