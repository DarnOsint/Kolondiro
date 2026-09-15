import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function TableView() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!tableId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('tables')
        .select('id, name, category_id, table_categories(id, name)')
        .eq('id', tableId)
        .single()
      if (fetchError) throw fetchError
      const table = data as any
      const zoneId = table.table_categories?.id || table.category_id
      if (!zoneId) {
        setError('This table has no zone configured. Please ask your waiter.')
        return
      }
      navigate(`/zone/${zoneId}`, { replace: true })
    } catch {
      setError('Invalid QR code. Please ask your waiter for assistance.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  if (loading) {
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500 text-sm">Loading…</div>
      </div>
    )
  }

  if (!error) return null

  return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center">
        <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-white font-bold mb-2">Could not open menu</p>
        <p className="text-gray-500 text-sm mb-4">{error}</p>
        <button
          onClick={load}
          className="bg-amber-500 text-black font-bold px-5 py-2.5 rounded-xl inline-flex items-center gap-2"
        >
          <RefreshCw size={15} /> Try Again
        </button>
      </div>
    </div>
  )
}
