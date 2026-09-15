import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import {
  ArrowLeft,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
  Save,
  CreditCard,
  Phone,
  Calendar,
  FileText,
  Banknote,
  Send,
  Loader2,
} from 'lucide-react'

interface Debtor {
  id: string
  name: string
  phone?: string
  email?: string
  debt_type?: string
  credit_limit: number
  current_balance: number
  amount_paid: number
  status: 'outstanding' | 'partial' | 'paid'
  due_date?: string
  notes?: string
  recorded_by?: string
  recorded_by_name?: string
  is_active: boolean
  created_at: string
}
interface DebtPayment {
  id: string
  debtor_id: string
  amount: number
  payment_method?: string
  payment_reference?: string
  notes?: string
  recorded_by?: string
  recorded_by_name?: string
  created_at: string
}
interface DebtorForm {
  name: string
  phone: string
  email: string
  debt_type: string
  credit_limit: string
  due_date: string
  notes: string
}
interface PayForm {
  amount: string
  payment_method: string
  payment_reference: string
  notes: string
}
interface Props {
  onBack?: () => void
  embedded?: boolean
}

const statusConfig = {
  outstanding: {
    label: 'Outstanding',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  partial: {
    label: 'Partial',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  paid: {
    label: 'Paid',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
  },
}
const debtTypeLabels: Record<string, string> = {
  table_order: 'Table Order',
  room_stay: 'Room Stay',
  bar_tab: 'Bar Tab',
}

export default function Debtors({ onBack, embedded = false }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [payments, setPayments] = useState<Record<string, DebtPayment[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('outstanding')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState<Debtor | null>(null)
  const [sendingStatement, setSendingStatement] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canEdit = ['owner', 'manager'].includes(profile?.role || '')
  const canPay = ['owner', 'manager', 'accountant'].includes(profile?.role || '')

  // Month-based filtering
  type OutstandingMonth = 'current' | 'previous' | 'custom'
  const [outstandingMonth, setOutstandingMonth] = useState<OutstandingMonth>('current')
  const [customYear, setCustomYear] = useState(new Date().getFullYear())
  const [customMonth, setCustomMonth] = useState(new Date().getMonth())

  const getMonthRange = (type: OutstandingMonth, year?: number, month?: number) => {
    if (type === 'current') {
      const now = new Date()
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      }
    }
    if (type === 'previous') {
      const now = new Date()
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      }
    }
    return {
      start: new Date(year!, month!, 1),
      end: new Date(year!, month! + 1, 0, 23, 59, 59, 999),
    }
  }

  const monthRange = getMonthRange(outstandingMonth, customYear, customMonth)
  const monthLabel =
    outstandingMonth === 'current'
      ? 'This Month'
      : outstandingMonth === 'previous'
        ? 'Previous Month'
        : new Date(customYear, customMonth).toLocaleDateString('en-NG', {
            month: 'long',
            year: 'numeric',
          })

  const navigateMonth = (dir: -1 | 1) => {
    let y = customYear
    let m = customMonth + dir
    if (m < 0) {
      m = 11
      y--
    } else if (m > 11) {
      m = 0
      y++
    }
    setCustomYear(y)
    setCustomMonth(m)
  }

  const blankForm: DebtorForm = {
    name: '',
    phone: '',
    email: '',
    debt_type: 'table_order',
    credit_limit: '',
    due_date: '',
    notes: '',
  }
  const blankPay: PayForm = { amount: '', payment_method: 'cash', payment_reference: '', notes: '' }
  const [form, setForm] = useState<DebtorForm>(blankForm)
  const [payForm, setPayForm] = useState<PayForm>(blankPay)
  const [debtorItems, setDebtorItems] = useState<Record<string, string[]>>({})
  const f = (v: Partial<DebtorForm>) => setForm((p) => ({ ...p, ...v }))
  const pf = (v: Partial<PayForm>) => setPayForm((p) => ({ ...p, ...v }))

  useEffect(() => {
    fetchAll()
  }, [])

  const fetchAll = async () => {
    const { data } = await supabase
      .from('debtors')
      .select(
        'id, name, phone, email, debt_type, credit_limit, current_balance, amount_paid, status, due_date, notes, recorded_by, recorded_by_name, is_active, created_at, order_id'
      )
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    setDebtors((data || []) as Debtor[])
    if (data?.length) {
      const { data: pmts } = await supabase
        .from('debt_payments')
        .select(
          'id, debtor_id, amount, payment_method, payment_reference, notes, recorded_by, recorded_by_name, created_at'
        )
        .in(
          'debtor_id',
          data.map((d: { id: string }) => d.id)
        )
        .order('created_at', { ascending: false })
      const map: Record<string, DebtPayment[]> = {}
      ;(pmts || []).forEach((p: DebtPayment) => {
        if (!map[p.debtor_id]) map[p.debtor_id] = []
        map[p.debtor_id].push(p)
      })
      setPayments(map)
      // Fetch order items for each debtor with order_id
      const orderIds = data.filter((d: any) => d.order_id).map((d: any) => d.order_id)
      if (orderIds.length > 0) {
        const { data: ois } = await supabase
          .from('order_items')
          .select('order_id, quantity, menu_items(name)')
          .in('order_id', orderIds)
        const oiMap: Record<string, string[]> = {}
        for (const oi of (ois || []) as any[]) {
          if (!oiMap[oi.order_id]) oiMap[oi.order_id] = []
          oiMap[oi.order_id].push(`${oi.quantity}x ${oi.menu_items?.name || 'Item'}`)
        }
        setDebtorItems(oiMap)
      }
    }
    setLoading(false)
  }

  const sendStatement = async (debtorId: string, trigger = 'manual') => {
    if (trigger === 'manual') setSendingStatement(debtorId)
    try {
      await fetch('/api/send-statement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET,
        },
        body: JSON.stringify({ debtor_id: debtorId, trigger }),
      })
    } catch {
      /* silent */
    }
    if (trigger === 'manual') setSendingStatement(null)
  }

  const saveDebtor = async () => {
    if (!form.name || !form.credit_limit)
      return toast.warning('Required', 'Name and amount are required')
    setSaving(true)
    try {
      const { error } = await supabase.from('debtors').insert({
        name: form.name,
        phone: form.phone,
        email: form.email,
        debt_type: form.debt_type,
        credit_limit: parseFloat(form.credit_limit),
        current_balance: parseFloat(form.credit_limit),
        amount_paid: 0,
        due_date: form.due_date || null,
        notes: form.notes,
        status: 'outstanding',
        is_active: true,
        recorded_by: profile?.id,
        recorded_by_name: profile?.full_name,
      })
      if (error) throw error
      const { data: newDebtor } = await supabase
        .from('debtors')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      audit({
        action: 'DEBTOR_CREATED',
        entity: 'debtors',
        entityName: form.name,
        newValue: { credit_limit: parseFloat(form.credit_limit), type: form.debt_type },
        performer: profile as any,
      })
      if (newDebtor?.id) sendStatement(newDebtor.id, 'credit_sale')
      await fetchAll()
      setShowAddModal(false)
      setForm(blankForm)
    } catch (err) {
      toast.error(
        'Error',
        'Error saving debtor: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setSaving(false)
    }
  }

  const recordPayment = async (debtor: Debtor) => {
    if (!payForm.amount || parseFloat(payForm.amount) <= 0)
      return toast.warning('Required', 'Enter a valid amount')
    const amount = parseFloat(payForm.amount)
    if (amount > debtor.current_balance)
      return toast.info(
        'Notice',
        'Amount exceeds balance of ' + debtor.current_balance.toLocaleString()
      )
    setSaving(true)
    const newAmountPaid = (debtor.amount_paid || 0) + amount
    const newBalance = debtor.current_balance - amount
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'
    try {
      const { error: pmtError } = await supabase.from('debt_payments').insert({
        debtor_id: debtor.id,
        amount,
        payment_method: payForm.payment_method,
        payment_reference: payForm.payment_reference,
        notes: payForm.notes,
        recorded_by: profile?.id,
        recorded_by_name: profile?.full_name,
      })
      if (pmtError) throw pmtError
      const { error: updError } = await supabase
        .from('debtors')
        .update({
          amount_paid: newAmountPaid,
          current_balance: newBalance,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', debtor.id)
      if (updError) throw updError
      audit({
        action: 'DEBT_PAYMENT',
        entity: 'debtors',
        entityId: debtor.id,
        entityName: debtor.name,
        newValue: { amount, method: payForm.payment_method, newBalance, newStatus },
        performer: profile as any,
      })
      await fetchAll()
      sendStatement(debtor.id, 'payment')
      setShowPaymentModal(null)
      setPayForm(blankPay)
    } catch (err) {
      toast.error('Error', 'Payment failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const markPaid = async (debtor: Debtor) => {
    if (!confirm('Mark ' + debtor.name + ' as fully paid?')) return
    const { error } = await supabase
      .from('debtors')
      .update({
        amount_paid: debtor.credit_limit,
        current_balance: 0,
        status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', debtor.id)
    if (error) {
      toast.error('Error', error instanceof Error ? error.message : String(error))
      return
    }
    fetchAll()
  }

  const isOverdue = (debtor: Debtor) => {
    if (!debtor.due_date || debtor.status === 'paid') return false
    return new Date(debtor.due_date) < new Date()
  }

  const filtered = debtors.filter((d) => {
    const matchSearch =
      d.name?.toLowerCase().includes(search.toLowerCase()) || d.phone?.includes(search)
    const matchStatus = filterStatus === 'all' || d.status === filterStatus
    const dDate = new Date(d.created_at)
    const matchMonth = dDate >= monthRange.start && dDate <= monthRange.end
    return matchSearch && matchStatus && matchMonth
  })
  const totalOutstanding = debtors
    .filter((d) => d.status !== 'paid')
    .reduce((s, d) => s + (d.current_balance || 0), 0)

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-amber-500 animate-pulse">Loading debtors...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950">
      {!embedded && (
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-white">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-white font-bold">Debtor Tracking</h1>
              <p className="text-gray-400 text-xs">
                {debtors.filter((d) => d.status !== 'paid').length} active
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm"
            >
              <Plus size={16} /> Add Debtor
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
        {(['outstanding', 'partial', 'paid'] as const).map((s) => (
          <div key={s} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${statusConfig[s].color}`}>
              {filtered.filter((d) => d.status === s).length}
            </p>
            <p className="text-gray-500 text-xs mt-0.5 capitalize">{s}</p>
          </div>
        ))}
      </div>

      <div className="px-4 pb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-sm flex items-center gap-2 flex-wrap">
            <span>{monthLabel}:</span>
            <span className="text-red-400 font-bold">₦{totalOutstanding.toLocaleString()}</span>
            <span className="text-gray-600">({filtered.length} entries)</span>
          </p>
          {embedded && canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl text-sm"
            >
              <Plus size={14} /> Add
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
        {/* Month filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['current', 'previous', 'custom'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setOutstandingMonth(m)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors ${outstandingMonth === m ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400'}`}
            >
              {m === 'current' ? 'This Month' : m === 'previous' ? 'Prev Month' : 'Custom'}
            </button>
          ))}
          {outstandingMonth === 'custom' && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigateMonth(-1)}
                className="p-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-white text-xs font-medium min-w-[100px] text-center">
                {monthLabel}
              </span>
              <button
                onClick={() => navigateMonth(1)}
                className="p-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {['all', 'outstanding', 'partial', 'paid'].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors ${filterStatus === s ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8 space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No debtors found</div>
        ) : (
          filtered.map((debtor) => {
            const cfg = statusConfig[debtor.status] || statusConfig.outstanding
            const overdue = isOverdue(debtor)
            const debtorPayments = payments[debtor.id] || []
            const isExpanded = expandedId === debtor.id
            const pct =
              debtor.credit_limit > 0
                ? Math.round((debtor.amount_paid / debtor.credit_limit) * 100)
                : 0
            return (
              <div
                key={debtor.id}
                className={`bg-gray-900 border rounded-2xl overflow-hidden ${overdue ? 'border-red-500/40' : 'border-gray-800'}`}
              >
                <div
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : debtor.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-white font-semibold">{debtor.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-lg ${cfg.bg} ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        {overdue && (
                          <span className="text-xs px-2 py-0.5 rounded-lg bg-red-500/20 text-red-400 flex items-center gap-1">
                            <AlertTriangle size={10} /> Overdue
                          </span>
                        )}
                        {debtor.debt_type && (
                          <span className="text-xs px-2 py-0.5 rounded-lg bg-gray-800 text-gray-400">
                            {debtTypeLabels[debtor.debt_type] || debtor.debt_type}
                          </span>
                        )}
                      </div>
                      {debtor.phone && (
                        <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                          <Phone size={10} /> {debtor.phone}
                        </p>
                      )}
                      {debtor.due_date && (
                        <p
                          className={`text-xs mt-1 flex items-center gap-1 ${overdue ? 'text-red-400' : 'text-gray-500'}`}
                        >
                          <Calendar size={10} /> Due:{' '}
                          {new Date(debtor.due_date).toLocaleDateString('en-NG', {
                            timeZone: 'Africa/Lagos',
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-red-400 font-bold">
                        ₦{(debtor.current_balance || 0).toLocaleString()}
                      </p>
                      <p className="text-gray-500 text-xs">
                        of ₦{(debtor.credit_limit || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {debtor.credit_limit > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Paid: ₦{(debtor.amount_paid || 0).toLocaleString()}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: pct + '%' }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-gray-600 text-xs">
                      Recorded by {debtor.recorded_by_name || 'system'} ·{' '}
                      {debtor.created_at
                        ? new Date(debtor.created_at).toLocaleDateString('en-NG', {
                            timeZone: 'Africa/Lagos',
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </p>
                    {isExpanded ? (
                      <ChevronUp size={14} className="text-gray-500" />
                    ) : (
                      <ChevronDown size={14} className="text-gray-500" />
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-800">
                    {debtor.status !== 'paid' && canPay && (
                      <div className="px-4 py-3 flex gap-2 border-b border-gray-800 flex-wrap">
                        <button
                          onClick={() => {
                            setShowPaymentModal(debtor)
                            setPayForm(blankPay)
                          }}
                          className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-2 min-w-[120px]"
                        >
                          <Banknote size={15} /> Record Payment
                        </button>
                        <button
                          onClick={() => sendStatement(debtor.id, 'manual')}
                          disabled={sendingStatement === debtor.id}
                          className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-2 min-w-[120px] transition-colors"
                        >
                          {sendingStatement === debtor.id ? (
                            <>
                              <Loader2 size={15} className="animate-spin" /> Sending…
                            </>
                          ) : (
                            <>
                              <Send size={15} /> Send Statement
                            </>
                          )}
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => markPaid(debtor)}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-2 min-w-[120px]"
                          >
                            <CheckCircle size={15} /> Mark Fully Paid
                          </button>
                        )}
                      </div>
                    )}
                    {(debtor.notes || (debtor as any).order_id) && (
                      <div className="px-4 py-3 border-b border-gray-800">
                        {debtor.notes && (
                          <p className="text-gray-500 text-xs flex items-start gap-2">
                            <FileText size={12} className="mt-0.5 shrink-0" />
                            {debtor.notes}
                          </p>
                        )}
                        {(debtor as any).order_id && debtorItems[(debtor as any).order_id] && (
                          <p className="text-amber-400 text-xs mt-1">
                            Items: {debtorItems[(debtor as any).order_id].join(', ')}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="px-4 py-3">
                      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">
                        Payment History ({debtorPayments.length})
                      </p>
                      {debtorPayments.length === 0 ? (
                        <p className="text-gray-600 text-xs">No payments yet</p>
                      ) : (
                        <div className="space-y-2">
                          {debtorPayments.map((pmt) => (
                            <div
                              key={pmt.id}
                              className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                            >
                              <div>
                                <p className="text-white text-sm font-medium">
                                  ₦{pmt.amount.toLocaleString()}
                                </p>
                                <p className="text-gray-500 text-xs capitalize">
                                  {pmt.payment_method?.replace('_', ' ')} · {pmt.recorded_by_name}
                                </p>
                              </div>
                              <p className="text-gray-500 text-xs">
                                {new Date(pmt.created_at).toLocaleDateString('en-NG', {
                                  timeZone: 'Africa/Lagos',
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800 max-h-screen overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Add Debtor</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Customer Name *
                </label>
                <input
                  value={form.name}
                  onChange={(e) => f({ name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Phone
                </label>
                <input
                  value={form.phone}
                  onChange={(e) => f({ phone: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="08xxxxxxxxx"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Debt Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(debtTypeLabels).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => f({ debt_type: val })}
                      className={`py-2.5 rounded-xl text-xs font-medium border-2 transition-all ${form.debt_type === val ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-400'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Amount Owed (₦) *
                </label>
                <input
                  type="number"
                  value={form.credit_limit}
                  onChange={(e) => f({ credit_limit: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => f({ due_date: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => f({ notes: e.target.value })}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 resize-none text-sm"
                  placeholder="Any additional notes..."
                />
              </div>
              <button
                onClick={saveDebtor}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2"
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Debtor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <div>
                <h3 className="text-white font-bold">Record Payment</h3>
                <p className="text-gray-400 text-xs mt-0.5">
                  {showPaymentModal.name} · Balance: ₦{' '}
                  {(showPaymentModal.current_balance || 0).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setShowPaymentModal(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Amount (₦) *
                </label>
                <input
                  type="number"
                  value={payForm.amount}
                  onChange={(e) => pf({ amount: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['cash', 'Cash'],
                      ['bank_pos', 'Bank POS'],
                      ['bank_transfer', 'Transfer'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => pf({ payment_method: val })}
                      className={`py-2.5 rounded-xl text-xs font-medium border-2 transition-all ${payForm.payment_method === val ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-400'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {payForm.payment_method !== 'cash' && (
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                    Reference
                  </label>
                  <input
                    value={payForm.payment_reference}
                    onChange={(e) => pf({ payment_reference: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                    placeholder="Transaction reference"
                  />
                </div>
              )}
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Notes
                </label>
                <input
                  value={payForm.notes}
                  onChange={(e) => pf({ notes: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="Optional"
                />
              </div>
              <button
                onClick={() => recordPayment(showPaymentModal)}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2"
              >
                <CreditCard size={16} />
                {saving ? 'Saving...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
