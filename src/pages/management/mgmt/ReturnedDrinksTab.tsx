import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, RefreshCw, Printer, CheckCircle, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { sendPushToStaff } from '../../../hooks/usePushNotifications'
import { useAuth } from '../../../context/AuthContext'
import { audit } from '../../../lib/audit'
import { useToast } from '../../../context/ToastContext'
import type { Profile } from '../../../types'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface ReturnEntry {
  id: string
  order_id: string
  order_item_id: string
  item_name: string
  quantity: number
  item_total: number
  table_name: string | null
  waitron_id: string | null
  waitron_name: string | null
  barman_name: string | null
  return_reason: string | null
  status: string
  requested_at: string
  resolved_at: string | null
}

export default function ReturnedDrinksTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayStr())
  const [returns, setReturns] = useState<ReturnEntry[]>([])
  const [loading, setLoading] = useState(true)

  const errMsg = (e: unknown) => {
    if (!e) return 'Unknown error'
    if (typeof e === 'string') return e
    if (e instanceof Error) return e.message
    if (typeof e === 'object' && 'message' in (e as any)) return String((e as any).message)
    if (typeof e === 'object' && 'error' in (e as any)) return String((e as any).error)
    return JSON.stringify(e)
  }

  const fetchReturns = useCallback(async (d: string) => {
    setLoading(true)
    const dayStart = new Date(d)
    dayStart.setHours(8, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    // Check for bar_accepted items older than 24 hours unresolved by manager.
    // The bar acceptance permanently removes the item from the waitron's accountability,
    // so expiry just marks the log entry without reverting order items.
    const expiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: expired } = await supabase
      .from('returns_log')
      .select('id')
      .eq('status', 'bar_accepted')
      .lt('resolved_at', expiry)
    if (expired && expired.length > 0) {
      const expiredIds = (expired as Array<{ id: string }>).map((e) => e.id)
      await supabase.from('returns_log').update({ status: 'expired' }).in('id', expiredIds)
    }

    // Pull wider range (last 3 days) then filter locally to catch items approved today but requested earlier
    const wideStart = new Date(dayStart)
    wideStart.setDate(wideStart.getDate() - 2)
    const { data } = await supabase
      .from('returns_log')
      .select(
        'id, order_id, order_item_id, item_name, quantity, item_total, table_name, waitron_id, waitron_name, barman_name, return_reason, status, requested_at, resolved_at'
      )
      .gte('requested_at', wideStart.toISOString())
      .order('requested_at', { ascending: false })

    const filtered = ((data || []) as ReturnEntry[]).filter((r) => {
      const req = new Date(r.requested_at).getTime()
      const res = r.resolved_at ? new Date(r.resolved_at).getTime() : null
      const inWindow =
        (req >= dayStart.getTime() && req < dayEnd.getTime()) ||
        (res !== null && res >= dayStart.getTime() && res < dayEnd.getTime())
      return inWindow
    })
    setReturns(filtered)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchReturns(date)
  }, [date, fetchReturns])

  const syncCreditDebtorForOrder = async (orderId: string, orderTotal: number) => {
    const { data: debtors, error } = await supabase
      .from('debtors')
      .select('id, amount_paid')
      .eq('order_id', orderId)
      .eq('debt_type', 'credit_order')
      .eq('is_active', true)
    if (error) throw error

    for (const debtor of debtors || []) {
      const amountPaid = (debtor.amount_paid || 0) as number
      const currentBalance = Math.max(0, orderTotal - amountPaid)
      const status = currentBalance <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'outstanding'
      const { error: updErr } = await supabase
        .from('debtors')
        .update({
          credit_limit: orderTotal,
          current_balance: currentBalance,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', debtor.id)
      if (updErr) throw updErr
    }
  }

  const managerApprove = async (r: ReturnEntry) => {
    try {
      const { error: oiErr } = await supabase
        .from('order_items')
        .update({ return_accepted: true, return_accepted_at: new Date().toISOString() })
        .eq('id', r.order_item_id)
      if (oiErr) throw oiErr

      const { data: remaining, error: remErr } = await supabase
        .from('order_items')
        .select('total_price, return_accepted')
        .eq('order_id', r.order_id)
      if (remErr) throw remErr
      const newTotal = (remaining || [])
        .filter((ri: { return_accepted?: boolean }) => !ri.return_accepted)
        .reduce((s: number, ri: { total_price: number }) => s + (ri.total_price || 0), 0)
      const { error: orderErr } = await supabase
        .from('orders')
        .update({ total_amount: newTotal })
        .eq('id', r.order_id)
      if (orderErr) throw orderErr

      await syncCreditDebtorForOrder(r.order_id, newTotal)

      if (r.item_name) {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
        const { data: stockRow, error: stockErr } = await supabase
          .from('bar_chiller_stock')
          .select('id, sold_qty')
          .eq('date', today)
          .eq('item_name', r.item_name)
          .single()
        if (stockErr && stockErr.code !== 'PGRST116') throw stockErr
        if (stockRow?.id) {
          const newSold = Math.max(0, (stockRow.sold_qty || 0) - (r.quantity || 1))
          const { error: updStockErr } = await supabase
            .from('bar_chiller_stock')
            .update({ sold_qty: newSold, updated_at: new Date().toISOString() })
            .eq('id', stockRow.id)
          if (updStockErr) throw updStockErr
        }
      }

      const { error: retErr } = await supabase
        .from('returns_log')
        .update({
          status: 'accepted',
          reviewed: true,
          reviewed_by_name: profile?.full_name ?? null,
          reviewed_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      if (retErr) throw retErr

      await audit({
        action: 'RETURN_MANAGER_APPROVED',
        entity: 'returns_log',
        entityId: r.id,
        entityName: r.item_name,
        newValue: {
          quantity: r.quantity,
          total: r.item_total,
          table: r.table_name,
          approved_by: profile?.full_name,
        },
        performer: profile as Profile,
      })
      if (r.waitron_id)
        sendPushToStaff(
          r.waitron_id,
          '✅ Return Approved',
          `${r.quantity}x ${r.item_name} approved by management`
        ).catch(() => {})
      toast.success('Return Approved', `${r.quantity}x ${r.item_name} permanently removed`)
      fetchReturns(date)
    } catch (e) {
      toast.error('Approve failed', errMsg(e))
    }
  }

  const managerReject = async (r: ReturnEntry) => {
    try {
      // Stations that have already accepted the return (bar, kitchen, griller) permanently
      // remove the item from the waitron's accountability. Manager rejection only logs
      // the rejection — it does NOT restore the item to the waitron's bill.
      const stationAccepted = ['bar_accepted', 'kitchen_accepted', 'griller_accepted']
      const isStationAccepted = stationAccepted.includes(r.status)

      if (!isStationAccepted) {
        // Pending (bar hasn't accepted yet) — revert the return request on the order item
        const { error: oiErr } = await supabase
          .from('order_items')
          .update({ return_accepted: false, return_requested: false, return_reason: null })
          .eq('id', r.order_item_id)
        if (oiErr) throw oiErr

        const { data: remaining, error: remErr } = await supabase
          .from('order_items')
          .select('total_price, return_accepted')
          .eq('order_id', r.order_id)
        if (remErr) throw remErr
        const newTotal = (remaining || [])
          .filter((ri: { return_accepted?: boolean }) => !ri.return_accepted)
          .reduce((s: number, ri: { total_price: number }) => s + (ri.total_price || 0), 0)
        const { error: orderErr } = await supabase
          .from('orders')
          .update({ total_amount: newTotal })
          .eq('id', r.order_id)
        if (orderErr) throw orderErr

        await syncCreditDebtorForOrder(r.order_id, newTotal)
      }

      const { error: retErr } = await supabase
        .from('returns_log')
        .update({
          status: 'manager_rejected',
          reviewed: true,
          reviewed_by_name: profile?.full_name ?? null,
          reviewed_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      if (retErr) throw retErr

      const restoredMsg = isStationAccepted
        ? `${r.quantity}x ${r.item_name} rejection noted — item stays off your bill`
        : `${r.quantity}x ${r.item_name} restored to your order`

      await audit({
        action: 'RETURN_MANAGER_REJECTED',
        entity: 'returns_log',
        entityId: r.id,
        entityName: r.item_name,
        newValue: {
          quantity: r.quantity,
          total: r.item_total,
          table: r.table_name,
          rejected_by: profile?.full_name,
          station_already_accepted: isStationAccepted,
        },
        performer: profile as Profile,
      })
      if (r.waitron_id)
        sendPushToStaff(r.waitron_id, '❌ Return Rejected', restoredMsg).catch(() => {})
      toast.success('Return Rejected', restoredMsg)
      fetchReturns(date)
    } catch (e) {
      toast.error('Reject failed', errMsg(e))
    }
  }

  const barAccepted = returns.filter((r) => r.status === 'bar_accepted')
  const accepted = returns.filter((r) => r.status === 'accepted')
  const rejected = returns.filter((r) => r.status === 'rejected' || r.status === 'manager_rejected')
  const expired = returns.filter((r) => r.status === 'expired')
  const _pending = returns.filter((r) => r.status === 'pending')
  const acceptedTotal = [...barAccepted, ...accepted].reduce((s, r) => s + (r.item_total || 0), 0)

  const statusLabel = (s: string) => {
    if (s === 'bar_accepted')
      return {
        text: 'Bar Accepted',
        color: 'bg-amber-500/20 text-amber-400',
        desc: 'Awaiting manager approval',
      }
    if (s === 'kitchen_accepted')
      return {
        text: 'Kitchen Accepted',
        color: 'bg-blue-500/20 text-blue-300',
        desc: 'Kitchen approved — manager final decision needed',
      }
    if (s === 'griller_accepted')
      return {
        text: 'Grill Accepted',
        color: 'bg-orange-500/20 text-orange-300',
        desc: 'Grill approved — manager final decision needed',
      }
    if (s === 'accepted')
      return { text: 'Approved', color: 'bg-green-500/20 text-green-400', desc: 'Manager approved' }
    if (s === 'rejected')
      return { text: 'Bar Rejected', color: 'bg-red-500/20 text-red-400', desc: '' }
    if (s === 'manager_rejected')
      return {
        text: 'Manager Rejected',
        color: 'bg-red-500/20 text-red-400',
        desc: 'Return rejected — item stays permanently removed',
      }
    if (s === 'expired')
      return {
        text: 'Expired',
        color: 'bg-gray-500/20 text-gray-400',
        desc: 'Unresolved — item stays permanently removed',
      }
    if (s === 'pending')
      return {
        text: 'Pending',
        color: 'bg-amber-500/20 text-amber-400',
        desc: 'Waiting for barman',
      }
    return { text: s, color: 'bg-gray-500/20 text-gray-400', desc: '' }
  }

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(date).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const fmtTime = (d: string) =>
      new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('RETURNED DRINKS REPORT'),
      div,
      row('Date:', fmtDate),
      row('Total Returns:', String(returns.length)),
      row('Bar Accepted:', String(barAccepted.length)),
      row('Manager Approved:', String(accepted.length)),
      row('Rejected:', String(rejected.length)),
      row('Expired:', String(expired.length)),
      div,
      ...returns.map((r, idx) =>
        [
          row(`${idx + 1}. ${r.quantity}x ${r.item_name}`, `N${r.item_total.toLocaleString()}`),
          row(`   Status: ${statusLabel(r.status).text}`, fmtTime(r.requested_at)),
          `   Waitron: ${r.waitron_name || '?'}`,
          `   Barman: ${r.barman_name || 'Pending'}`,
          `   Table: ${r.table_name || '?'}`,
          r.return_reason ? `   Reason: ${r.return_reason}` : '',
          '',
        ]
          .filter(Boolean)
          .join('\n')
      ),
      sol,
      row('TOTAL VALUE:', `N${acceptedTotal.toLocaleString()}`),
      sol,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Returns — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    w.onafterprint = () => w.close()
    w.onload = () =>
      setTimeout(() => {
        try {
          w.print()
        } catch {
          /* */
        }
      }, 200)
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setDate(todayStr())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === todayStr() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
        <button onClick={() => fetchReturns(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        {returns.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {/* Pending manager approval banner */}
      {barAccepted.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-amber-400 text-sm font-bold">
              {barAccepted.length} return{barAccepted.length > 1 ? 's' : ''} awaiting your approval
            </span>
          </div>
          <p className="text-amber-400/70 text-xs">
            Bar accepted these returns — items are already permanently removed from the waitron's
            bill. Approve to confirm or reject to log the decision.
          </p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[
          { label: 'Total', value: returns.length, color: 'text-white', border: 'border-gray-800' },
          {
            label: 'Bar Accepted',
            value: barAccepted.length,
            color: 'text-amber-400',
            border: 'border-amber-500/20',
          },
          {
            label: 'Approved',
            value: accepted.length,
            color: 'text-green-400',
            border: 'border-green-500/20',
          },
          {
            label: 'Rejected',
            value: rejected.length,
            color: 'text-red-400',
            border: 'border-red-500/20',
          },
          {
            label: 'Value',
            value: `N${acceptedTotal.toLocaleString()}`,
            color: 'text-amber-400',
            border: 'border-amber-500/20',
          },
        ].map(({ label, value, color, border }) => (
          <div key={label} className={`bg-gray-900 border ${border} rounded-xl p-2.5 text-center`}>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : returns.length === 0 ? (
        <div className="text-center py-12">
          <RotateCcw size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No returns for {date === todayStr() ? 'today' : date}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {returns.map((r) => {
            const st = statusLabel(r.status)
            return (
              <div
                key={r.id}
                className={`bg-gray-900 border rounded-xl p-3 ${r.status === 'bar_accepted' ? 'border-amber-500/40' : r.status === 'accepted' ? 'border-green-500/20' : r.status === 'rejected' || r.status === 'manager_rejected' ? 'border-red-500/20' : 'border-gray-800'}`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div>
                    <p className="text-white text-sm font-semibold">
                      {r.quantity}x {r.item_name}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {r.table_name || '?'} — by {r.waitron_name || '?'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.color}`}
                    >
                      {st.text}
                    </span>
                    <p className="text-gray-400 text-xs mt-1">N{r.item_total.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                  <span>
                    Barman:{' '}
                    {r.barman_name
                      ? r.barman_name
                      : r.status === 'pending'
                        ? 'Pending'
                        : r.status === 'bar_accepted'
                          ? 'Accepted'
                          : 'Direct approval'}
                  </span>
                  <span>·</span>
                  <span>
                    {new Date(r.requested_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </span>
                  {r.return_reason && (
                    <>
                      <span>·</span>
                      <span className="italic">{r.return_reason}</span>
                    </>
                  )}
                </div>
                {/* Manager approval buttons for pending and bar_accepted items */}
                {(r.status === 'bar_accepted' || r.status === 'pending') && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => managerApprove(r)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-xs py-2 rounded-xl transition-colors"
                    >
                      <CheckCircle size={13} /> Approve Return
                    </button>
                    <button
                      onClick={() => managerReject(r)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-xs py-2 rounded-xl transition-colors"
                    >
                      <X size={13} /> Reject Return
                    </button>
                  </div>
                )}
                {st.desc && <p className="text-gray-600 text-[10px] mt-1">{st.desc}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
