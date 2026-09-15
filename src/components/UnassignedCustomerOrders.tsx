import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { AlertTriangle, UserPlus, Clock } from 'lucide-react'

interface Waitron {
  id: string
  full_name: string
  role: string
}

export default function UnassignedCustomerOrders() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([])
  const [waitrons, setWaitrons] = useState<Waitron[]>([])
  const [assigning, setAssigning] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => Date.now())

  const fetchData = async () => {
    try {
      const today = new Date()
      today.setHours(8, 0, 0, 0)
      const { data: pending } = await supabase
        .from('customer_orders')
        .select('*, tables(id, name, assigned_staff, table_categories(name))')
        .eq('status', 'pending')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: true })
      setOrders(
        ((pending || []) as Record<string, unknown>[]).filter(
          (o) => !(o.tables as Record<string, unknown>)?.assigned_staff
        )
      )

      const { data: att } = await supabase
        .from('attendance')
        .select('staff_id, profiles!attendance_staff_id_fkey(id, full_name, role)')
        .eq('date', new Date().toISOString().split('T')[0])
        .or('clock_out.is.null')
      setWaitrons(
        ((att || []) as Record<string, unknown>[])
          .filter((a) => (a.profiles as Waitron)?.role === 'waitron')
          .map((a) => a.profiles as Waitron)
      )
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    void fetchData()
    const ch = supabase
      .channel('unassigned-customer-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders' }, fetchData)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  const assignWaitron = async (order: Record<string, unknown>, waitronId: string) => {
    const waitron = waitrons.find((w) => w.id === waitronId)
    if (!waitron) return
    setAssigning((p) => ({ ...p, [order.id as string]: true }))
    await supabase
      .from('tables')
      .update({ assigned_staff: waitronId })
      .eq('id', (order.tables as Record<string, string>).id)
    await fetchData()
    setAssigning((p) => ({ ...p, [order.id as string]: false }))
  }

  if (!orders.length) return null

  return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-red-400" />
        <span className="text-red-400 text-sm font-bold">
          {orders.length} unattended customer order{orders.length !== 1 ? 's' : ''} — no waitron
          assigned
        </span>
      </div>
      {orders.map((order) => (
        <div key={order.id as string} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-bold text-sm">{order.table_name as string}</span>
            <span className="text-gray-500 text-xs flex items-center gap-1">
              <Clock size={10} />
              {Math.floor((now - new Date(order.created_at as string).getTime()) / 60000)}m ago
            </span>
          </div>
          <p className="text-gray-500 text-xs mb-2">
            {(order.items as unknown[])?.length} item
            {(order.items as unknown[])?.length !== 1 ? 's' : ''} · ₦
            {(order.total_amount as number)?.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <UserPlus size={13} className="text-gray-500 shrink-0" />
            <select
              onChange={(e) => e.target.value && assignWaitron(order, e.target.value)}
              disabled={assigning[order.id as string]}
              defaultValue=""
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            >
              <option value="">Assign waitron...</option>
              {waitrons.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </div>
  )
}
