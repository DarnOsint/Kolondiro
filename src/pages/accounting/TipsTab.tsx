import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Printer, CheckCircle, Clock, Users, TrendingUp } from 'lucide-react'

interface Tip {
  id: string
  order_id: string
  waitron_id: string
  waitron_name: string
  table_name: string
  order_total: number
  amount_received: number
  tip_amount: number
  payment_method: string
  shift_date: string
  status: 'pending' | 'disbursed' | 'pooled'
  disbursed_at: string | null
  disbursed_by_name: string | null
  notes: string | null
  created_at: string
}

interface WaitronSummary {
  waitron_id: string
  waitron_name: string
  total_tips: number
  tip_count: number
  pending: number
  disbursed: number
}

interface Props {
  dateRange: { from: string; to: string }
}

export default function TipsTab({ dateRange }: Props) {
  const { profile } = useAuth()
  const [tips, setTips] = useState<Tip[]>([])
  const [summaries, setSummaries] = useState<WaitronSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [disbursing, setDisbursing] = useState<string | null>(null)
  const [view, setView] = useState<'summary' | 'detail'>('summary')

  const fetchTips = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tips')
      .select(
        'id, order_id, waitron_id, waitron_name, table_name, order_total, amount_received, tip_amount, payment_method, shift_date, status, disbursed_at, disbursed_by_name, notes, created_at'
      )
      .gte('shift_date', dateRange.from)
      .lte('shift_date', dateRange.to)
      .order('created_at', { ascending: false })

    if (data) {
      // Cast numeric fields — Supabase returns numerics as strings
      const tipData = (data as Tip[]).map((t) => ({
        ...t,
        tip_amount: Number(t.tip_amount),
        order_total: Number(t.order_total),
        amount_received: Number(t.amount_received),
      }))
      setTips(tipData)

      // Aggregate by waitron
      const map = new Map<string, WaitronSummary>()
      for (const tip of tipData) {
        const tipAmt = Number(tip.tip_amount)
        const existing = map.get(tip.waitron_id)
        if (existing) {
          existing.total_tips += tipAmt
          existing.tip_count++
          if (tip.status === 'pending') existing.pending += tipAmt
          else if (tip.status === 'disbursed') existing.disbursed += tipAmt
        } else {
          map.set(tip.waitron_id, {
            waitron_id: tip.waitron_id,
            waitron_name: tip.waitron_name,
            total_tips: tipAmt,
            tip_count: 1,
            pending: tip.status === 'pending' ? tipAmt : 0,
            disbursed: tip.status === 'disbursed' ? tipAmt : 0,
          })
        }
      }
      setSummaries(Array.from(map.values()).sort((a, b) => b.total_tips - a.total_tips))
    }
    setLoading(false)
  }, [dateRange])

  useEffect(() => {
    fetchTips()
  }, [fetchTips])

  const disburse = async (waitronId: string) => {
    setDisbursing(waitronId)
    const now = new Date().toISOString()
    await supabase
      .from('tips')
      .update({
        status: 'disbursed',
        disbursed_at: now,
        disbursed_by: profile?.id,
        disbursed_by_name: profile?.full_name,
      })
      .eq('waitron_id', waitronId)
      .eq('status', 'pending')
      .gte('shift_date', dateRange.from)
      .lte('shift_date', dateRange.to)
    await fetchTips()
    setDisbursing(null)
  }

  const totalTips = summaries.reduce((s, w) => s + w.total_tips, 0)
  const totalPending = summaries.reduce((s, w) => s + w.pending, 0)
  const totalDisbursed = summaries.reduce((s, w) => s + w.disbursed, 0)

  const handlePrint = () => {
    const date = new Date().toLocaleDateString('en-SS', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const time = new Date().toLocaleTimeString('en-SS', { hour: '2-digit', minute: '2-digit' })

    const summaryRows = summaries
      .map(
        (w, i) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${i + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600;">${w.waitron_name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${w.tip_count}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">SSP${w.pending.toLocaleString()}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">SSP${w.disbursed.toLocaleString()}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">SSP${w.total_tips.toLocaleString()}</td>
      </tr>
    `
      )
      .join('')

    const detailRows = tips
      .map(
        (t) => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;">${new Date(t.created_at).toLocaleString('en-SS')}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;">${t.waitron_name}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;">${t.table_name || '—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;">SSP${t.order_total.toLocaleString()}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;">SSP${t.amount_received.toLocaleString()}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:green;">SSP${t.tip_amount.toLocaleString()}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center;">
          <span style="background:${t.status === 'disbursed' ? '#d1fae5' : '#fef3c7'};color:${t.status === 'disbursed' ? '#065f46' : '#92400e'};padding:2px 8px;border-radius:99px;font-size:11px;">
            ${t.status}
          </span>
        </td>
      </tr>
    `
      )
      .join('')

    const html = `
      <!DOCTYPE html><html>
      <head><title>Tips Report — ${dateRange.from} to ${dateRange.to}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#000}
        h1{font-size:16px;margin:0 0 4px}
        h2{font-size:13px;margin:16px 0 6px;color:#333}
        p{margin:0 0 12px;color:#555}
        table{width:100%;border-collapse:collapse;margin-bottom:20px}
        th{background:#f5f5f5;padding:8px;text-align:left;border-bottom:2px solid #ddd}
        .totals{font-weight:bold;font-size:13px;margin-bottom:20px;border:1px solid #ddd;padding:10px;border-radius:4px}
        .footer{margin-top:20px;font-size:10px;color:#999;text-align:center}
      </style></head>
      <body>
        <h1>Kolondiro — Tips Report</h1>
        <p>${dateRange.from} to ${dateRange.to} &nbsp;|&nbsp; Printed at ${time} on ${date}</p>
        <div class="totals">
          Total Tips: SSP${totalTips.toLocaleString()} &nbsp;|&nbsp;
          Pending Disbursement: SSP${totalPending.toLocaleString()} &nbsp;|&nbsp;
          Disbursed: SSP${totalDisbursed.toLocaleString()}
        </div>
        <h2>Summary by Waitron</h2>
        <table><thead><tr>
          <th>#</th><th>Waitron</th><th>Tips</th><th>Pending</th><th>Disbursed</th><th>Total</th>
        </tr></thead><tbody>${summaryRows}</tbody></table>
        <h2>Detailed Tip Log</h2>
        <table><thead><tr>
          <th>Date/Time</th><th>Waitron</th><th>Table</th><th>Order Total</th><th>Received</th><th>Tip</th><th>Status</th>
        </tr></thead><tbody>${detailRows}</tbody></table>
        <div class="footer">RestaurantOS — Kolondiro</div>
      </body></html>
    `
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => {
      win.print()
      win.close()
    }, 300)
  }

  const fmt = (n: number) => `SSP${n.toLocaleString()}`

  return (
    <div className="p-4 space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-green-400" />
            <p className="text-gray-400 text-xs">Total Tips</p>
          </div>
          <p className="text-white font-bold text-xl">{fmt(totalTips)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-amber-400" />
            <p className="text-gray-400 text-xs">Pending</p>
          </div>
          <p className="text-amber-400 font-bold text-xl">{fmt(totalPending)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={14} className="text-green-400" />
            <p className="text-gray-400 text-xs">Disbursed</p>
          </div>
          <p className="text-green-400 font-bold text-xl">{fmt(totalDisbursed)}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-800 rounded-xl p-0.5">
          <button
            onClick={() => setView('summary')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'summary' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
          >
            <Users size={12} className="inline mr-1" />
            By Waitron
          </button>
          <button
            onClick={() => setView('detail')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'detail' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
          >
            Full Log
          </button>
        </div>
        <button
          onClick={handlePrint}
          disabled={tips.length === 0}
          className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-xl"
        >
          <Printer size={13} /> Print Report
        </button>
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : tips.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No tips recorded in this period</div>
      ) : view === 'summary' ? (
        <div className="space-y-3">
          {summaries.map((w) => (
            <div
              key={w.waitron_id}
              className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="text-white font-semibold">{w.waitron_name}</p>
                  <p className="text-gray-500 text-xs">
                    {w.tip_count} tip{w.tip_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-green-400 font-bold text-lg">{fmt(w.total_tips)}</p>
                  <p className="text-gray-500 text-xs">total earned</p>
                </div>
              </div>
              <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between">
                <div className="flex gap-4">
                  <div>
                    <p className="text-amber-400 text-sm font-semibold">{fmt(w.pending)}</p>
                    <p className="text-gray-500 text-xs">pending</p>
                  </div>
                  <div>
                    <p className="text-green-400 text-sm font-semibold">{fmt(w.disbursed)}</p>
                    <p className="text-gray-500 text-xs">disbursed</p>
                  </div>
                </div>
                {w.pending > 0 && (
                  <button
                    onClick={() => disburse(w.waitron_id)}
                    disabled={disbursing === w.waitron_id}
                    className="bg-green-500 hover:bg-green-400 disabled:bg-gray-700 text-black text-xs font-bold px-3 py-2 rounded-xl transition-colors"
                  >
                    {disbursing === w.waitron_id ? 'Processing...' : `Disburse ${fmt(w.pending)}`}
                  </button>
                )}
                {w.pending === 0 && (
                  <span className="flex items-center gap-1 text-green-400 text-xs">
                    <CheckCircle size={12} /> All disbursed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {tips.map((tip) => (
            <div key={tip.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white font-semibold text-sm">{tip.waitron_name}</p>
                    <span className="text-gray-500 text-xs">·</span>
                    <p className="text-gray-400 text-xs">{tip.table_name || 'Unknown table'}</p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${tip.status === 'disbursed' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}
                    >
                      {tip.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-gray-500 text-xs">Order: {fmt(tip.order_total)}</p>
                    <p className="text-gray-500 text-xs">Received: {fmt(tip.amount_received)}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(tip.created_at).toLocaleString('en-SS', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <p className="text-green-400 font-bold text-lg whitespace-nowrap">
                  +{fmt(tip.tip_amount)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
