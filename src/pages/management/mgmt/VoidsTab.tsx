import { useState, useEffect, useCallback } from 'react'
import { Trash2, RefreshCw, Printer, CheckCircle, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { audit } from '../../../lib/audit'
import { useToast } from '../../../context/ToastContext'
import { useVisibilityInterval } from '../../../hooks/useVisibilityInterval'
import type { Profile } from '../../../types'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface VoidRequest {
  id: string
  item_name: string
  quantity: number
  reason: string
  station: string
  requested_by: string
  requested_by_name: string
  status: string
  requested_at: string
  resolved_at: string | null
  resolved_by_name: string | null
}

export default function VoidsTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayStr())
  const [voids, setVoids] = useState<VoidRequest[]>([])
  const [loading, setLoading] = useState(true)

  const fetchVoids = useCallback(async (d: string) => {
    setLoading(true)
    const dayStart = new Date(d)
    dayStart.setHours(8, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const { data } = await supabase
      .from('void_requests')
      .select(
        'id, item_name, quantity, reason, station, requested_by, requested_by_name, status, requested_at, resolved_at, resolved_by_name'
      )
      .gte('requested_at', dayStart.toISOString())
      .lte('requested_at', dayEnd.toISOString())
      .order('requested_at', { ascending: false })
    setVoids((data || []) as VoidRequest[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchVoids(date)
  }, [date, fetchVoids])

  useVisibilityInterval(() => fetchVoids(date), 60_000, [date, fetchVoids])

  const pending = voids.filter((v) => v.status === 'pending')
  const approved = voids.filter((v) => v.status === 'approved')
  const rejected = voids.filter((v) => v.status === 'rejected')

  const approveVoid = async (v: VoidRequest) => {
    const targetDate = new Date(v.requested_at).toLocaleDateString('en-CA', {
      timeZone: 'Africa/Lagos',
    })
    await supabase
      .from('void_requests')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString(),
        resolved_by_name: profile?.full_name,
      })
      .eq('id', v.id)
    const tableName = v.station === 'kitchen' ? 'kitchen_stock' : 'bar_chiller_stock'
    const { data: stockRow } = await supabase
      .from(tableName)
      .select('id, void_qty, opening_qty, received_qty, sold_qty')
      .eq('item_name', v.item_name)
      .eq('date', targetDate)
      .single()
    if (stockRow?.id) {
      const nextVoidQty = (stockRow.void_qty || 0) + v.quantity
      const closingQty = Math.max(
        0,
        (stockRow.opening_qty || 0) +
          (stockRow.received_qty || 0) -
          (stockRow.sold_qty || 0) -
          nextVoidQty
      )
      await supabase
        .from(tableName)
        .update({
          void_qty: nextVoidQty,
          closing_qty: closingQty,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stockRow.id)
    }
    await audit({
      action: 'VOID_APPROVED',
      entity: 'void_requests',
      entityId: v.id,
      entityName: v.item_name,
      newValue: {
        quantity: v.quantity,
        reason: v.reason,
        station: v.station,
        approved_by: profile?.full_name,
      },
      performer: profile as Profile,
    })
    toast.success('Void Approved', `${v.quantity}x ${v.item_name} — ${v.reason}`)
    fetchVoids(date)
  }

  const rejectVoid = async (v: VoidRequest) => {
    await supabase
      .from('void_requests')
      .update({
        status: 'rejected',
        resolved_at: new Date().toISOString(),
        resolved_by_name: profile?.full_name,
      })
      .eq('id', v.id)
    await audit({
      action: 'VOID_REJECTED',
      entity: 'void_requests',
      entityId: v.id,
      entityName: v.item_name,
      newValue: {
        quantity: v.quantity,
        reason: v.reason,
        station: v.station,
        rejected_by: profile?.full_name,
      },
      performer: profile as Profile,
    })
    toast.success('Void Rejected', `${v.quantity}x ${v.item_name} left unchanged in stock`)
    fetchVoids(date)
  }

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('VOID REPORT'),
      div,
      row('Date:', date),
      row('Pending:', String(pending.length)),
      row('Approved:', String(approved.length)),
      row('Rejected:', String(rejected.length)),
      div,
      ...voids.map((v, i) =>
        [
          row(`${i + 1}. ${v.quantity}x ${v.item_name}`, v.status),
          `   Reason: ${v.reason}`,
          `   By: ${v.requested_by_name}`,
          '',
        ].join('\n')
      ),
      div,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Voids</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
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
        <button onClick={() => fetchVoids(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        {voids.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {pending.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-amber-400 text-sm font-bold">
              {pending.length} void{pending.length > 1 ? 's' : ''} awaiting approval
            </span>
          </div>
          <p className="text-amber-400/70 text-xs">
            Bar/kitchen staff reported these items as broken, expired, or damaged. Approve to
            confirm the loss or reject to restore the stock.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Pending', value: pending.length, color: 'text-amber-400' },
          { label: 'Approved', value: approved.length, color: 'text-green-400' },
          { label: 'Rejected', value: rejected.length, color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center"
          >
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : voids.length === 0 ? (
        <div className="text-center py-12">
          <Trash2 size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            No void requests for {date === todayStr() ? 'today' : date}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {voids.map((v) => (
            <div
              key={v.id}
              className={`bg-gray-900 border rounded-xl p-3 ${v.status === 'pending' ? 'border-amber-500/40' : v.status === 'approved' ? 'border-green-500/20' : 'border-red-500/20'}`}
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div>
                  <p className="text-white text-sm font-semibold">
                    {v.quantity}x {v.item_name}
                  </p>
                  <p className="text-gray-400 text-xs">
                    {v.station} — by {v.requested_by_name}
                  </p>
                  <p className="text-gray-500 text-xs italic mt-0.5">{v.reason}</p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${v.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : v.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                  >
                    {v.status}
                  </span>
                  <p className="text-gray-500 text-xs mt-1">
                    {new Date(v.requested_at).toLocaleTimeString('en-SS', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </p>
                </div>
              </div>
              {v.status === 'pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => approveVoid(v)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-xs py-2 rounded-xl transition-colors"
                  >
                    <CheckCircle size={13} /> Approve Void
                  </button>
                  <button
                    onClick={() => rejectVoid(v)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-xs py-2 rounded-xl transition-colors"
                  >
                    <X size={13} /> Reject & Restore
                  </button>
                </div>
              )}
              {v.resolved_by_name && (
                <p className="text-gray-600 text-[10px] mt-1">
                  {v.status === 'approved' ? 'Approved' : 'Rejected'} by {v.resolved_by_name}
                  {v.resolved_at &&
                    ` at ${new Date(v.resolved_at).toLocaleTimeString('en-SS', { hour: '2-digit', minute: '2-digit', hour12: true })}`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
