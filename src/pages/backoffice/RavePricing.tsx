import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Save, Music } from 'lucide-react'
import { useToast } from '../../context/ToastContext'

interface MenuItem {
  id: string
  name: string
  price: number
  rave_price?: number | null
  menu_categories?: { name?: string; destination?: string } | null
}

interface Props {
  onBack: () => void
}

export default function RavePricing({ onBack }: Props) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [orig, setOrig] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('All')
  const [menuCategories, setMenuCategories] = useState<string[]>([])

  const fetchAll = async () => {
    const itemsRes = await supabase
      .from('menu_items')
      .select('id, name, price, rave_price, menu_categories(name, destination)')
      .order('name')
    const menuItems = (itemsRes.data || []) as MenuItem[]
    setItems(menuItems)
    const origMap: Record<string, number | null> = {}
    menuItems.forEach((item) => {
      origMap[item.id] = item.rave_price ?? null
    })
    setOrig(origMap)
    setMenuCategories([
      'All',
      ...new Set(menuItems.map((i) => i.menu_categories?.name).filter(Boolean)),
    ] as string[])
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const setRavePrice = (itemId: string, value: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, rave_price: value ? parseFloat(value) : null } : item
      )
    )
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      const changed = items.filter((item) => {
        const original = orig[item.id] ?? null
        const current = item.rave_price ?? null
        return original !== current
      })
      if (changed.length === 0) {
        toast.success('No changes to save')
        setSaving(false)
        return
      }
      const results = await Promise.all(
        changed.map((item) =>
          supabase
            .from('menu_items')
            .update({ rave_price: item.rave_price ?? null })
            .eq('id', item.id)
        )
      )
      const err = results.find((r) => r.error)
      if (err) throw err.error
      const newOrig: Record<string, number | null> = { ...orig }
      changed.forEach((item) => {
        newOrig[item.id] = item.rave_price ?? null
      })
      setOrig(newOrig)
      toast.success(`${changed.length} rave price${changed.length > 1 ? 's' : ''} saved`)
    } catch (err) {
      toast.error('Error', 'Failed to save: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const clearAll = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('menu_items')
        .update({ rave_price: null })
        .not('rave_price', 'is', null)
      if (error) throw error
      setItems((prev) => prev.map((item) => ({ ...item, rave_price: null })))
      toast.success('All rave prices cleared')
    } catch (err) {
      toast.error('Error', 'Failed to clear: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const filtered = items
    .filter((i) => filterCat === 'All' || i.menu_categories?.name === filterCat)
    .filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()))

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold flex items-center gap-2">
              <Music size={18} className="text-pink-400" /> Rave Pricing
            </h1>
            <p className="text-gray-400 text-xs">
              Set menu prices that activate when Rave Mode is toggled on
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearAll}
            disabled={saving}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium px-4 py-2 rounded-xl text-sm transition-colors"
          >
            Clear All
          </button>
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-2 bg-pink-600 hover:bg-pink-500 disabled:bg-gray-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save All Rave Prices'}
          </button>
        </div>
      </div>
      <div className="p-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items…"
          className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-4 py-2.5 mb-3 focus:outline-none focus:border-pink-500"
        />
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {menuCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${filterCat === cat ? 'bg-pink-600 text-white' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No menu items found</div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-400 text-xs uppercase tracking-wide px-4 py-3 font-medium">
                      Item
                    </th>
                    <th className="text-left text-gray-400 text-xs uppercase tracking-wide px-4 py-3 font-medium">
                      Base ₦
                    </th>
                    <th className="text-left text-pink-400 text-xs uppercase tracking-wide px-4 py-3 font-medium">
                      Rave ₦
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) => (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-800 last:border-0 ${idx % 2 === 0 ? '' : 'bg-gray-800/30'}`}
                    >
                      <td className="px-4 py-3">
                        <p className="text-white text-sm font-medium">{item.name}</p>
                        <p className="text-gray-500 text-xs">{item.menu_categories?.name}</p>
                      </td>
                      <td className="px-4 py-3 text-amber-400 text-sm font-bold">
                        ₦{item.price.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.rave_price ?? ''}
                          onChange={(e) => setRavePrice(item.id, e.target.value)}
                          placeholder="—"
                          className="w-28 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-pink-500 placeholder-gray-600"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
