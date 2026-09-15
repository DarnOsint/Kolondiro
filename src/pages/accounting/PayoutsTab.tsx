import { Plus, X, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useState } from 'react'
import type { PayoutRow, PayoutForm } from './types'
import { useToast } from '../../context/ToastContext'

interface Props {
  payouts: PayoutRow[]
  totalPayouts: number
  onRefresh: () => void
}

const CATEGORIES = ['expense', 'payout', 'refund'] as const

const categoryColor: Record<string, string> = {
  expense: 'bg-red-500/20 text-red-400',
  payout: 'bg-orange-500/20 text-orange-400',
  refund: 'bg-blue-500/20 text-blue-400',
}

export default function PayoutsTab({ payouts, totalPayouts, onRefresh }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<PayoutForm>({
    amount: '',
    reason: '',
    category: 'expense',
    paid_to: '',
  })

  const save = async () => {
    if (!form.amount || !form.reason)
      return toast.warning('Required', 'Amount and reason are required')
    setSaving(true)
    const { error } = await supabase.from('payouts').insert({
      amount: parseFloat(form.amount),
      reason: form.reason,
      category: form.category,
      paid_to: form.paid_to || null,
      recorded_by: profile?.id,
    })
    setSaving(false)
    if (error) {
      toast.error('Error', error instanceof Error ? error.message : String(error))
      return
    }
    setForm({ amount: '', reason: '', category: 'expense', paid_to: '' })
    setShowModal(false)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-sm">Total expenses this period</p>
          <p className="text-red-400 font-bold text-xl break-all">
            ₦{totalPayouts.toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> Record Expense
        </button>
      </div>

      <div className="space-y-3">
        {payouts.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
            No expenses recorded for this period
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payouts…"
              className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-4 py-2.5 mb-3 focus:outline-none focus:border-amber-500"
            />
            {payouts
              .filter(
                (p) =>
                  !search ||
                  (p.reason || '').toLowerCase().includes(search.toLowerCase()) ||
                  (p.paid_to || '').toLowerCase().includes(search.toLowerCase()) ||
                  (p.category || '').toLowerCase().includes(search.toLowerCase())
              )
              .map((payout) => (
                <div
                  key={payout.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white font-medium">{payout.reason}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-lg capitalize ${categoryColor[payout.category] ?? 'bg-gray-700 text-gray-400'}`}
                      >
                        {payout.category}
                      </span>
                      {payout.paid_to && (
                        <span className="text-gray-500 text-xs">→ {payout.paid_to}</span>
                      )}
                      <span className="text-gray-600 text-xs">
                        {new Date(payout.created_at).toLocaleString('en-NG')}
                      </span>
                    </div>
                  </div>
                  <p className="text-red-400 font-bold text-lg">
                    ₦{payout.amount?.toLocaleString()}
                  </p>
                </div>
              ))}
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Record Expense / Payout</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Category
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setForm({ ...form, category: cat })}
                      className={`py-2 rounded-xl text-xs font-medium border-2 capitalize transition-all ${
                        form.category === cat
                          ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                          : 'border-gray-700 bg-gray-800 text-gray-400'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Amount (₦) *
                </label>
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-lg font-bold"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Reason *
                </label>
                <input
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="e.g. Generator fuel, Ice supply"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Paid To
                </label>
                <input
                  value={form.paid_to}
                  onChange={(e) => setForm({ ...form, paid_to: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="Person or vendor name"
                />
              </div>
              <button
                onClick={save}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
              >
                <Save size={16} /> {saving ? 'Saving...' : 'Record Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
