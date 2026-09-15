import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { StayRow } from './types'

export default function RoomHistory() {
  const [history, setHistory] = useState<StayRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('room_stays')
      .select('*')
      .in('status', ['checked_out', 'overstay'])
      .order('actual_checkout_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) console.error('RoomHistory fetch error:', error.message)
        setHistory((data as StayRow[]) || [])
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="text-amber-500 text-center py-12">Loading...</div>

  const total = history.reduce((s, h) => s + (h.total_amount || 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-400 text-sm">{history.length} past stays</p>
        <p className="text-gray-500 text-xs">Total: ₦{total.toLocaleString()}</p>
      </div>
      {history.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No checkout history yet</div>
      ) : (
        history.map((stay) => (
          <div
            key={stay.id}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between"
          >
            <div>
              <p className="text-white font-semibold">{stay.guest_name}</p>
              <p className="text-gray-500 text-xs">
                {stay.room_name} · {stay.nights} night{stay.nights > 1 ? 's' : ''} · {stay.id_type}:{' '}
                {stay.id_number}
              </p>
              <p className="text-gray-600 text-xs mt-0.5">
                {new Date(stay.check_in_at).toLocaleDateString('en-NG')} →{' '}
                {new Date(stay.check_out_at).toLocaleDateString('en-NG')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-amber-400 font-bold">₦{stay.total_amount?.toLocaleString()}</p>
              <span
                className={`text-xs px-2 py-0.5 rounded-lg ${stay.status === 'overstay' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}
              >
                {stay.status === 'overstay' ? 'Overstay' : 'Checked Out'}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
