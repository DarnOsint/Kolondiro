import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Bell, CheckCircle, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

interface WaiterCall {
  id: string
  table_name: string
  waitron_id: string
  waitron_name: string | null
  called_at: string
  status: 'pending' | 'acknowledged' | 'dismissed'
}

export default function WaiterCalls() {
  const { profile } = useAuth()
  const toast = useToast()
  const [calls, setCalls] = useState<WaiterCall[]>([])

  const fetchCalls = useCallback(async () => {
    let query = supabase
      .from('waiter_calls')
      .select('id, table_name, waitron_id, waitron_name, called_at, status')
      .eq('status', 'pending')
      .order('called_at', { ascending: false })

    if (profile?.role === 'waitron') {
      query = query.eq('waitron_id', profile.id)
    }

    const { data } = await query
    setCalls((data as WaiterCall[]) || [])
  }, [profile?.id, profile?.role])

  useEffect(() => {
    fetchCalls()
    const channel = supabase
      .channel('waiter-calls-' + profile?.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, fetchCalls)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchCalls])

  const acknowledge = async (id: string) => {
    await supabase
      .from('waiter_calls')
      .update({
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: profile?.full_name,
      })
      .eq('id', id)
    fetchCalls()
  }

  const dismiss = async (id: string) => {
    const { error } = await supabase
      .from('waiter_calls')
      .update({ status: 'dismissed' })
      .eq('id', id)
    if (error) {
      toast.error('Error', 'Failed to dismiss call: ' + error.message)
      return
    }
    fetchCalls()
  }

  if (calls.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-xs w-full">
      {calls.map((call) => (
        <div
          key={call.id}
          className="bg-gray-900 border border-amber-500/50 rounded-2xl p-4 shadow-xl shadow-black/50"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <Bell size={16} className="text-amber-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Customer Calling</p>
                <p className="text-amber-400 text-xs">{call.table_name}</p>
                {profile?.role !== 'waitron' && call.waitron_name && (
                  <p className="text-gray-500 text-xs">Assigned: {call.waitron_name}</p>
                )}
              </div>
            </div>
            <p className="text-gray-500 text-xs shrink-0">
              {new Date(call.called_at).toLocaleTimeString('en-NG', {
                timeZone: 'Africa/Lagos',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => acknowledge(call.id)}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1 transition-colors"
            >
              <CheckCircle size={13} /> On my way
            </button>
            <button
              onClick={() => dismiss(call.id)}
              className="bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs py-2 px-3 rounded-lg transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
