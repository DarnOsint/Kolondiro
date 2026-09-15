import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Clock,
  X,
} from 'lucide-react'

interface TillSession {
  id: string
  status: string
  opened_at: string
  closed_at?: string | null
  profiles?: { full_name: string; role: string } | null
  total_sales?: number
}
interface Payout {
  id: string
  amount: number
  reason: string
  category?: string
  created_at: string
  profiles?: { full_name: string } | null
}
interface TodayStats {
  totalRevenue: number
  totalPayouts: number
  cashRevenue: number
  cardRevenue: number
  openOrders: number
}
interface PayoutForm {
  amount: string
  reason: string
  category: string
}

interface Props {
  onClose?: () => void
}

const sessionStartIso = () => {
  const now = new Date()
  const lagosNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const start = new Date(lagosNow)
  start.setHours(8, 0, 0, 0)
  if (lagosNow.getHours() < 8) start.setDate(start.getDate() - 1)
  return start.toISOString()
}

const PETTY_CASH_LIMIT = 50000
const PETTY_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'transport', label: 'Transport' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'food', label: 'Food & Ingredients' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'staff_welfare', label: 'Staff Welfare' },
  { value: 'other', label: 'Other' },
]

export default function TillManagement({ onClose }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [sessions, setSessions] = useState<TillSession[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [todayStats, setTodayStats] = useState<TodayStats>({
    totalRevenue: 0,
    totalPayouts: 0,
    cashRevenue: 0,
    cardRevenue: 0,
    openOrders: 0,
  })
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'payouts'>('overview')
  const [payoutForm, setPayoutForm] = useState<PayoutForm>({
    amount: '',
    reason: '',
    category: 'general',
  })
  const [loading, setLoading] = useState(true)
  const [openingFloat, setOpeningFloat] = useState('')
  const [showOpenTill, setShowOpenTill] = useState(false)

  const fetchSessions = async () => {
    const { data } = await supabase
      .from('till_sessions')
      .select('*, profiles(full_name, role)')
      .order('opened_at', { ascending: false })
      .limit(20)
    if (data) setSessions(data)
  }
  const fetchPayouts = async () => {
    const { data } = await supabase
      .from('payouts')
      .select('*, profiles!payouts_staff_id_fkey(full_name)')
      .gte('created_at', sessionStartIso())
      .order('created_at', { ascending: false })
    if (data) setPayouts(data)
  }
  const fetchTodayStats = async () => {
    const startIso = sessionStartIso()
    const [ordersRes, payoutsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total_amount, payment_method, payment_status')
        .gte('created_at', startIso),
      supabase.from('payouts').select('amount').gte('created_at', startIso),
    ])
    const paidOrders = (ordersRes.data || []).filter(
      (o: { payment_status: string }) => o.payment_status === 'paid'
    )
    const totalRevenue = paidOrders.reduce(
      (s: number, o: { total_amount: number }) => s + (o.total_amount || 0),
      0
    )
    const cashRevenue = paidOrders
      .filter((o: { payment_method: string }) => o.payment_method === 'cash')
      .reduce((s: number, o: { total_amount: number }) => s + (o.total_amount || 0), 0)
    const cardRevenue = paidOrders
      .filter((o: { payment_method: string }) => o.payment_method === 'card')
      .reduce((s: number, o: { total_amount: number }) => s + (o.total_amount || 0), 0)
    const totalPayouts = (payoutsRes.data || []).reduce(
      (s: number, p: { amount: number }) => s + (p.amount || 0),
      0
    )
    const openOrders = (ordersRes.data || []).filter(
      (o: { payment_status: string }) => o.payment_status === 'unpaid'
    ).length
    setTodayStats({ totalRevenue, totalPayouts, cashRevenue, cardRevenue, openOrders })
  }

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchSessions(), fetchPayouts(), fetchTodayStats()])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const openSession = async () => {
    const float = parseFloat(openingFloat)
    if (isNaN(float) || float < 0) {
      toast.warning('Required', 'Enter a valid opening float amount')
      return
    }
    const { error } = await supabase.from('till_sessions').insert({
      id: crypto.randomUUID(),
      staff_id: profile?.id,
      opened_at: new Date().toISOString(),
      opening_float: float,
      status: 'open',
    })
    if (error) {
      toast.error('Error', error.message)
      return
    }
    setOpeningFloat('')
    setShowOpenTill(false)
    audit({
      action: 'TILL_OPENED',
      entity: 'till_sessions',
      entityName: profile?.full_name,
      newValue: { opening_float: float },
      performer: profile as any,
    })
    toast.success('Till Opened', `Opening float ₦${float.toLocaleString()} recorded`)
    fetchSessions()
  }

  const closeSession = async (session: TillSession) => {
    if (!window.confirm(`Close shift for ${session.profiles?.full_name}?`)) return
    await supabase
      .from('till_sessions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        total_sales: todayStats.totalRevenue,
      })
      .eq('id', session.id)
    audit({
      action: 'TILL_CLOSED',
      entity: 'till_sessions',
      entityId: session.id,
      entityName: session.profiles?.full_name,
      newValue: { total_sales: todayStats.totalRevenue },
      performer: profile as any,
    })
    fetchSessions()
  }

  const recordPayout = async () => {
    if (!payoutForm.amount || !payoutForm.reason) {
      toast.warning('Required', 'Please enter amount and reason')
      return
    }
    // Enforce petty cash limit client-side (DB trigger also enforces this)
    const remaining = PETTY_CASH_LIMIT - payouts.reduce((s, p) => s + (p.amount || 0), 0)
    if (parseFloat(payoutForm.amount) > remaining) {
      toast.error(
        'Limit Exceeded',
        `This would exceed today's ₦${PETTY_CASH_LIMIT.toLocaleString()} daily limit. ₦${remaining.toLocaleString()} remaining.`
      )
      return
    }
    const { error } = await supabase.from('payouts').insert({
      staff_id: profile!.id,
      amount: parseFloat(payoutForm.amount),
      reason: payoutForm.reason,
      category: payoutForm.category,
      approved_by: profile!.id,
    })
    if (!error) {
      audit({
        action: 'PAYOUT_RECORDED',
        entity: 'payouts',
        entityName: payoutForm.reason,
        newValue: { amount: parseFloat(payoutForm.amount), category: payoutForm.category },
        performer: profile as any,
      })
      setPayoutForm({ amount: '', reason: '', category: 'general' })
      fetchPayouts()
      fetchTodayStats()
      toast.success('Payout Recorded')
    }
  }

  const activeSessions = sessions.filter((s) => s.status === 'open')

  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-bold text-lg">Till Management</h3>
          <p className="text-gray-400 text-xs mt-0.5">Cash control and shift tracking</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-5 bg-gray-800 rounded-xl p-1">
        {(
          [
            ['overview', 'Overview'],
            ['sessions', 'Shifts'],
            ['payouts', 'Payouts'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === id ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                label: "Today's Revenue",
                value: `₦${todayStats.totalRevenue.toLocaleString()}`,
                icon: TrendingUp,
                color: 'text-green-400',
                bg: 'bg-green-400/10',
              },
              {
                label: 'Total Payouts',
                value: `₦${todayStats.totalPayouts.toLocaleString()}`,
                icon: TrendingDown,
                color: 'text-red-400',
                bg: 'bg-red-400/10',
              },
              {
                label: 'Cash Revenue',
                value: `₦${todayStats.cashRevenue.toLocaleString()}`,
                icon: DollarSign,
                color: 'text-amber-400',
                bg: 'bg-amber-400/10',
              },
              {
                label: 'Open Orders',
                value: todayStats.openOrders,
                icon: AlertCircle,
                color: 'text-blue-400',
                bg: 'bg-blue-400/10',
              },
            ].map((stat, i) => (
              <div key={i} className="bg-gray-800 rounded-xl p-4">
                <div className={`inline-flex p-2 rounded-lg ${stat.bg} mb-2`}>
                  <stat.icon size={16} className={stat.color} />
                </div>
                <p className="text-gray-400 text-xs">{stat.label}</p>
                <p className="text-white font-bold text-lg mt-0.5">{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
            <p className="text-amber-400 text-sm font-medium">Net Cash Position</p>
            <p className="text-white text-2xl font-bold mt-1">
              ₦{(todayStats.cashRevenue - todayStats.totalPayouts).toLocaleString()}
            </p>
            <p className="text-gray-400 text-xs mt-1">Cash Revenue minus Payouts</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm font-medium mb-2">
              Active Shifts ({activeSessions.length})
            </p>
            {activeSessions.length === 0 ? (
              <div className="bg-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
                No active shifts right now
              </div>
            ) : (
              activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between bg-gray-800 rounded-xl p-3 mb-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <div>
                      <p className="text-white text-sm font-medium">
                        {session.profiles?.full_name}
                      </p>
                      <p className="text-gray-400 text-xs flex items-center gap-1">
                        <Clock size={10} /> Since{' '}
                        {new Date(session.opened_at).toLocaleTimeString('en-NG', {
                          timeZone: 'Africa/Lagos',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => closeSession(session)}
                    className="text-red-400 hover:text-red-300 text-xs bg-red-400/10 px-2 py-1 rounded-lg"
                  >
                    Close Shift
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="space-y-2">
          <p className="text-gray-400 text-sm mb-3">All shifts today</p>
          <div className="flex justify-end mb-3">
            {!showOpenTill ? (
              <button
                onClick={() => setShowOpenTill(true)}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold px-4 py-2 rounded-xl transition-colors"
              >
                <DollarSign size={14} /> Open Till
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <input
                  type="number"
                  min={0}
                  placeholder="Opening float (₦)"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={openSession}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setShowOpenTill(false)}
                  className="text-gray-400 hover:text-white px-2"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
          {sessions.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">No shifts recorded today</div>
          ) : (
            sessions.map((session) => (
              <div key={session.id} className="bg-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{session.profiles?.full_name}</p>
                    <p className="text-gray-400 text-xs capitalize">{session.profiles?.role}</p>
                  </div>
                  {session.status === 'open' ? (
                    <span className="flex items-center gap-1 text-green-400 text-xs bg-green-400/10 px-2 py-1 rounded-lg">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-gray-400 text-xs bg-gray-700 px-2 py-1 rounded-lg">
                      <CheckCircle size={10} /> Closed
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span>
                    In:{' '}
                    {new Date(session.opened_at).toLocaleTimeString('en-NG', {
                      timeZone: 'Africa/Lagos',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </span>
                  {session.closed_at && (
                    <span>
                      Out:{' '}
                      {new Date(session.closed_at).toLocaleTimeString('en-NG', {
                        timeZone: 'Africa/Lagos',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'payouts' &&
        (() => {
          const dailyTotal = payouts.reduce((s, p) => s + (p.amount || 0), 0)
          const remaining = PETTY_CASH_LIMIT - dailyTotal
          const pct = Math.min((dailyTotal / PETTY_CASH_LIMIT) * 100, 100)
          const byCategory = PETTY_CATEGORIES.map((cat) => ({
            ...cat,
            total: payouts
              .filter((p) => (p.category || 'general') === cat.value)
              .reduce((s, p) => s + (p.amount || 0), 0),
          })).filter((c) => c.total > 0)
          return (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-white text-sm font-medium">Daily Petty Cash</p>
                  <p
                    className={`text-sm font-bold ${remaining < 10000 ? 'text-red-400' : 'text-amber-400'}`}
                  >
                    ₦{dailyTotal.toLocaleString()} / ₦{PETTY_CASH_LIMIT.toLocaleString()}
                  </p>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2 mb-1">
                  <div
                    className={`h-2 rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: pct + '%' }}
                  />
                </div>
                <p className="text-gray-500 text-xs">
                  ₦{remaining.toLocaleString()} remaining today
                </p>
              </div>
              {byCategory.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">By Category</p>
                  <div className="space-y-2">
                    {byCategory.map((cat) => (
                      <div key={cat.value} className="flex justify-between items-center">
                        <span className="text-gray-300 text-sm">{cat.label}</span>
                        <span className="text-red-400 text-sm font-medium">
                          ₦{cat.total.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-white font-medium mb-3">Record Expense</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Category</label>
                    <select
                      value={payoutForm.category}
                      onChange={(e) => setPayoutForm((p) => ({ ...p, category: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                    >
                      {PETTY_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Amount (₦)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={payoutForm.amount}
                      onChange={(e) => setPayoutForm((p) => ({ ...p, amount: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Bought cleaning supplies"
                      value={payoutForm.reason}
                      onChange={(e) => setPayoutForm((p) => ({ ...p, reason: e.target.value }))}
                      className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  {remaining < parseFloat(payoutForm.amount || '0') && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-red-400 text-xs">
                      ⚠️ This exceeds today's remaining petty cash limit
                    </div>
                  )}
                  <button
                    onClick={recordPayout}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg py-2 text-sm transition-colors"
                  >
                    Record Expense
                  </button>
                </div>
              </div>
              <div>
                <p className="text-gray-400 text-sm font-medium mb-2">Today's Expenses</p>
                {payouts.length === 0 ? (
                  <div className="text-center py-6 text-gray-500 text-sm">
                    No expenses recorded today
                  </div>
                ) : (
                  payouts.map((payout) => (
                    <div key={payout.id} className="bg-gray-800 rounded-xl p-3 mb-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-white text-sm font-medium">{payout.reason}</p>
                            <span className="text-xs px-2 py-0.5 rounded-lg bg-gray-700 text-gray-400 capitalize">
                              {payout.category || 'general'}
                            </span>
                          </div>
                          <p className="text-gray-400 text-xs">{payout.profiles?.full_name}</p>
                          <p className="text-gray-500 text-xs">
                            {new Date(payout.created_at).toLocaleTimeString('en-NG', {
                              timeZone: 'Africa/Lagos',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </p>
                        </div>
                        <p className="text-red-400 font-bold">
                          -₦{payout.amount?.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })()}
    </div>
  )
}
