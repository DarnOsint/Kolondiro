/**
 * api/cron/accountant-summary.js
 * Vercel cron job — runs daily at 07:00 UTC (08:00 WAT).
 * Sends the Accountant Summary (reconciliation data) to the owner.
 *
 * Required env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                    RESEND_API_KEY, REPORT_EMAIL, CRON_SECRET
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

function fmt(n) {
  return `SSP${Number(n || 0).toLocaleString('en-SS', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function pct(num, den) { return den ? `${Math.round((num / den) * 100)}%` : '0%' }

function getSessionWAT() {
  const now = new Date()
  const watNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const end = new Date(watNow)
  end.setHours(8, 0, 0, 0)
  if (watNow.getHours() < 8) end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 1)
  const label = start.toLocaleDateString('en-SS', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lagos',
  })
  const y = start.getFullYear()
  const m = String(start.getMonth() + 1).padStart(2, '0')
  const d = String(start.getDate()).padStart(2, '0')
  return { start: start.toISOString(), end: end.toISOString(), label, short: `${d}/${m}/${y}`, dateKey: `${y}-${m}-${d}` }
}

function section(title, icon, content, borderColor = '#e5e7eb') {
  return `<div style="background:white;border-radius:12px;padding:20px 24px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-top:3px solid ${borderColor};"><h3 style="margin:0 0 14px;color:#111827;font-size:14px;font-weight:700;">${icon} ${title}</h3>${content}</div>`
}
function kpiRow(items) {
  return `<div style="display:grid;grid-template-columns:${Array(items.length).fill('1fr').join(' ')};gap:10px;">${items.join('')}</div>`
}
function kpiBox(label, value, color = '#111827', note = '') {
  return `<div style="background:#f9fafb;border-radius:10px;padding:14px 16px;"><div style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">${label}</div><div style="color:${color};font-size:20px;font-weight:800;margin-top:4px;">${value}</div>${note ? `<div style="color:#9ca3af;font-size:11px;margin-top:2px;">${note}</div>` : ''}</div>`
}
function buildTable(headers, rows, emptyMsg = 'No data') {
  if (!rows.length) return `<p style="color:#9ca3af;font-size:12px;margin:4px 0;">${emptyMsg}</p>`
  const ths = headers.map(h => `<th style="text-align:${h.right?'right':'left'};color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;padding:6px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">${h.label}</th>`).join('')
  const trs = rows.map(row => `<tr>${row.map((cell, i) => `<td style="text-align:${headers[i]?.right?'right':'left'};padding:7px 0;border-bottom:1px solid #f3f4f6;color:#374151;font-size:12px;">${cell}</td>`).join('')}</tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default async function handler(req, res) {
  const isCron     = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = req.headers['x-internal-secret'] === process.env.INTERNAL_API_SECRET
  if (!isCron && !isInternal) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { start, end, label, short, dateKey } = getSessionWAT()

    // Derive attendance date
    const sessionDate = new Date(start)
    const watDate = new Date(sessionDate.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    const dateStr = `${watDate.getFullYear()}-${String(watDate.getMonth() + 1).padStart(2, '0')}-${String(watDate.getDate()).padStart(2, '0')}`

    const [
      { data: orders },
      { data: orderItems },
      { data: returnsLog },
      { data: payouts },
      { data: attendance },
      { data: reconData },
      { data: manifestData },
      { data: debtors },
    ] = await Promise.all([
      supabase.from('orders').select('*, profiles(full_name), tables(name), order_items(*, menu_items(name))').gte('created_at', start).lte('created_at', end),
      supabase.from('order_items').select('*, menu_items(name, menu_categories(name))').gte('created_at', start).lte('created_at', end).neq('status', 'cancelled'),
      supabase.from('returns_log').select('*').gte('requested_at', start).lte('requested_at', end),
      supabase.from('payouts').select('*, profiles(full_name)').gte('created_at', start).lte('created_at', end),
      supabase.from('attendance').select('*').eq('date', dateStr),
      supabase.from('settings').select('value').eq('id', `recon_${dateKey}`).single(),
      supabase.from('settings').select('value').eq('id', `manifest_${dateKey}`).single(),
      supabase.from('debtors').select('*').gt('balance', 0),
    ])

    // Parse reconciliation if saved
    let recon = { cashCollected: {}, outstanding: {}, bankEntries: {}, posEntries: {}, debts: [] }
    if (reconData?.value) {
      try { recon = JSON.parse(reconData.value) } catch { /* */ }
    }

    const manifestNotes = (manifestData?.value || '').toString().trim()

    // Revenue
    const paid = (orders || []).filter(o => o.status === 'paid')
    const netOrderAmount = (o) => (o.order_items || [])
      .filter(i => !i.return_requested && !i.return_accepted && (i.status || '').toLowerCase() !== 'cancelled')
      .reduce((s, i) => s + (i.total_price || 0), 0)

    const totalRevenue = paid.reduce((s, o) => s + netOrderAmount(o), 0)
    const avgOrder = paid.length ? totalRevenue / paid.length : 0

    // Payment methods
    function classifyMethod(pm) {
      if (!pm) return 'transfer'
      if (pm === 'cash') return 'cash'
      if (pm === 'card' || pm === 'bank_pos') return 'pos'
      if (pm.startsWith('transfer')) return 'transfer'
      if (pm === 'credit') return 'credit'
      if (pm === 'split') return 'split'
      if (pm.startsWith('cash+transfer')) return 'cash+transfer'
      if (pm.startsWith('cash+card')) return 'cash+pos'
      if (pm === 'complimentary') return 'complimentary'
      return pm
    }
    const methodLabels = {
      cash: 'Cash', pos: 'POS / Card', transfer: 'Transfer', credit: 'Credit',
      split: 'Split', 'cash+transfer': 'Cash + Transfer', 'cash+pos': 'Cash + POS',
      complimentary: 'Complimentary',
    }
    const methodGroups = {}
    for (const o of paid) {
      const key = classifyMethod(o.payment_method)
      if (!methodGroups[key]) methodGroups[key] = { count: 0, revenue: 0 }
      methodGroups[key].count++
      methodGroups[key].revenue += netOrderAmount(o)
    }

    // Staff performance
    const waitronMap = {}
    for (const o of paid) {
      const name = o.profiles?.full_name || 'Unknown'
      if (!waitronMap[name]) waitronMap[name] = { orders: 0, revenue: 0 }
      waitronMap[name].orders++
      waitronMap[name].revenue += netOrderAmount(o)
    }
    const topWaitrons = Object.entries(waitronMap).sort((a, b) => b[1].revenue - a[1].revenue)

    // Returns
    const acceptedReturns = (returnsLog || []).filter(r => ['accepted', 'bar_accepted', 'kitchen_accepted', 'griller_accepted'].includes(r.status))
    const totalReturnValue = acceptedReturns.reduce((s, r) => s + (r.item_total || 0), 0)

    // Payouts
    const totalPayouts = (payouts || []).reduce((s, p) => s + (p.amount || 0), 0)
    const netRevenue = totalRevenue - totalPayouts

    // Attendance
    const clockedIn = (attendance || []).length

    // Reconciliation calculations
    const totalCashCollected = Object.values(recon.cashCollected || {}).reduce((s, v) => s + (v || 0), 0)
    const totalBankReceived = Object.values(recon.bankEntries || {}).reduce((s, v) => s + (v || 0), 0)
    const totalPOSReceived = Object.values(recon.posEntries || {}).reduce((s, v) => s + (v || 0), 0)
    const totalDebts = (recon.debts || []).reduce((s, d) => s + (d.amount || 0), 0)
    const totalOutstanding = Object.values(recon.outstanding || {}).reduce((s, v) => s + (v || 0), 0)
    const totalReceived = totalCashCollected + totalBankReceived + totalPOSReceived
    const shortfall = totalRevenue - totalReceived - totalDebts - totalOutstanding - totalPayouts

    // Debtors
    const totalDebtorBalance = (debtors || []).reduce((s, d) => s + (d.balance || 0), 0)

    const reconSaved = !!reconData?.value

    // ── Build email ──
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:20px;">
<div style="max-width:640px;margin:0 auto;">

  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#0f172a 100%);border-radius:14px;padding:28px;margin-bottom:16px;">
    <div style="color:#60a5fa;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">📊 Kolondiro</div>
    <div style="color:white;font-size:22px;font-weight:800;">Accountant Summary</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${label}</div>
    <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
      <div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:14px 18px;">
        <div style="color:#6ee7b7;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Gross Revenue</div>
        <div style="color:white;font-size:26px;font-weight:900;margin-top:4px;">${fmt(totalRevenue)}</div>
      </div>
      <div style="background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.3);border-radius:10px;padding:14px 18px;">
        <div style="color:#93c5fd;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Net Revenue</div>
        <div style="color:white;font-size:26px;font-weight:900;margin-top:4px;">${fmt(netRevenue)}</div>
      </div>
    </div>
  </div>

  ${section('Revenue & Orders', '💰', `
    ${kpiRow([kpiBox('Paid Orders', paid.length), kpiBox('Avg Order', fmt(avgOrder)), kpiBox('Returns', acceptedReturns.length, acceptedReturns.length > 0 ? '#dc2626' : '#6b7280', acceptedReturns.length > 0 ? fmt(totalReturnValue) : '')])}
  `, '#059669')}

  ${section('Payment Methods', '💳', buildTable(
    [{ label: 'Method' }, { label: 'Orders' }, { label: 'Amount', right: true }, { label: '%', right: true }],
    Object.entries(methodGroups)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([key, d]) => [methodLabels[key] || key, d.count, fmt(d.revenue), pct(d.revenue, totalRevenue)]),
    'No paid orders.'
  ), '#2563eb')}

  ${section('Staff Sales', '👥', buildTable(
    [{ label: 'Waitron' }, { label: 'Orders' }, { label: 'Revenue', right: true }, { label: '%', right: true }],
    topWaitrons.map(([name, s]) => [name, s.orders, fmt(s.revenue), pct(s.revenue, totalRevenue)]),
    'No waitron data.'
  ), '#8b5cf6')}

  ${section('Expenses & Payouts', '💸', `
    ${kpiRow([kpiBox('Total Payouts', fmt(totalPayouts), '#dc2626'), kpiBox('Net After Expenses', fmt(netRevenue), '#059669')])}
    ${(payouts || []).length > 0 ? `<div style="margin-top:12px;">${buildTable(
      [{ label: 'Time' }, { label: 'Staff' }, { label: 'Reason' }, { label: 'Amount', right: true }],
      (payouts || []).slice(0,10).map(p => [
        new Date(p.created_at).toLocaleTimeString('en-SS', { hour:'2-digit', minute:'2-digit', timeZone:'Africa/Lagos' }),
        p.profiles?.full_name || '—', p.reason || '—', fmt(p.amount)
      ])
    )}</div>` : ''}
  `, '#ef4444')}

  ${section('Daily Reconciliation', reconSaved ? '🏦' : '⚠️', `
    <div style="background:${manifestNotes ? '#f8fafc' : '#fff7ed'};border:1px solid ${manifestNotes ? '#e5e7eb' : '#fed7aa'};border-radius:10px;padding:14px 16px;margin-bottom:14px;">
      <div style="font-weight:800;color:#111827;font-size:12px;margin-bottom:6px;">📝 Accountant Notes / Manifest</div>
      ${manifestNotes
        ? `<div style="white-space:pre-wrap;color:#374151;font-size:12px;line-height:1.6;">${escapeHtml(manifestNotes)}</div>`
        : `<div style="color:#ea580c;font-size:12px;">No notes added for this trading day.</div>`
      }
    </div>

    ${reconSaved ? `
    ${kpiRow([kpiBox('Cash Collected', fmt(totalCashCollected), '#059669'), kpiBox('Bank Transfers', fmt(totalBankReceived), '#7c3aed'), kpiBox('POS Receipts', fmt(totalPOSReceived), '#2563eb')])}
    <div style="height:12px;"></div>

    ${Object.keys(recon.cashCollected || {}).length > 0 ? `<div style="margin-bottom:12px;">${buildTable(
      [{ label: 'Waitron' }, { label: 'Cash Collected', right: true }],
      Object.entries(recon.cashCollected).filter(([,v]) => v > 0).map(([name, amt]) => [name, fmt(amt)])
    )}</div>` : ''}

    ${Object.keys(recon.outstanding || {}).length > 0 && Object.values(recon.outstanding).some(v => v > 0) ? `
      <div style="margin-bottom:12px;">
        <div style="color:#dc2626;font-weight:700;font-size:12px;margin-bottom:6px;">⚠️ Outstanding per Waitron</div>
        ${buildTable(
          [{ label: 'Waitron' }, { label: 'Outstanding', right: true }],
          Object.entries(recon.outstanding).filter(([,v]) => v > 0).map(([name, amt]) => [name, fmt(amt)])
        )}
        <div style="text-align:right;color:#dc2626;font-weight:700;font-size:13px;margin-top:6px;">Total Outstanding: ${fmt(totalOutstanding)}</div>
      </div>
    ` : ''}

    ${Object.keys(recon.bankEntries || {}).length > 0 ? `<div style="margin-bottom:12px;">${buildTable(
      [{ label: 'Bank Account' }, { label: 'Amount Received', right: true }],
      Object.entries(recon.bankEntries).filter(([,v]) => v > 0).map(([name, amt]) => [name, fmt(amt)])
    )}</div>` : ''}

    ${Object.keys(recon.posEntries || {}).length > 0 ? `<div style="margin-bottom:12px;">${buildTable(
      [{ label: 'POS Machine' }, { label: 'Amount Received', right: true }],
      Object.entries(recon.posEntries).filter(([,v]) => v > 0).map(([name, amt]) => [name, fmt(amt)])
    )}</div>` : ''}

    ${(recon.debts || []).length > 0 ? `<div style="margin-bottom:12px;">
      <div style="color:#dc2626;font-weight:700;font-size:12px;margin-bottom:6px;">Outstanding Debts / IOUs</div>
      ${buildTable(
        [{ label: 'Name' }, { label: 'Note' }, { label: 'Amount', right: true }],
        recon.debts.filter(d => d.amount > 0).map(d => [d.name || '—', d.note || '—', fmt(d.amount)])
      )}
    </div>` : ''}

    <div style="background:#f0f4f8;border-radius:10px;padding:16px;margin-top:12px;">
      <div style="font-weight:700;color:#111827;font-size:13px;margin-bottom:10px;">End of Day Reconciliation</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#6b7280;font-size:12px;">Total Sales (POS)</td><td style="padding:4px 0;text-align:right;color:#111827;font-weight:700;font-size:12px;">${fmt(totalRevenue)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:12px;">Cash Collected</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:12px;">${fmt(totalCashCollected)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:12px;">Bank Transfers</td><td style="padding:4px 0;text-align:right;color:#7c3aed;font-size:12px;">${fmt(totalBankReceived)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:12px;">POS Receipts</td><td style="padding:4px 0;text-align:right;color:#2563eb;font-size:12px;">${fmt(totalPOSReceived)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:12px;">Expenses/Payouts</td><td style="padding:4px 0;text-align:right;color:#dc2626;font-size:12px;">${fmt(totalPayouts)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:12px;">Outstanding Debts</td><td style="padding:4px 0;text-align:right;color:#dc2626;font-size:12px;">${fmt(totalDebts)}</td></tr>
        <tr style="border-top:2px solid #d1d5db;"><td style="padding:6px 0;color:#111827;font-weight:700;font-size:12px;">Total Accounted For</td><td style="padding:6px 0;text-align:right;color:#111827;font-weight:700;font-size:12px;">${fmt(totalReceived + totalDebts + totalPayouts)}</td></tr>
      </table>
      <div style="margin-top:12px;padding:12px 16px;border-radius:8px;${shortfall > 0 ? 'background:#fef2f2;border:1px solid #fecaca;' : shortfall < 0 ? 'background:#f0fdf4;border:1px solid #bbf7d0;' : 'background:#f0fdf4;border:1px solid #bbf7d0;'}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;font-size:14px;color:${shortfall > 0 ? '#dc2626' : '#059669'};">${shortfall > 0 ? '⚠️ SHORTFALL' : shortfall < 0 ? '✅ SURPLUS' : '✅ BALANCED'}</span>
          <span style="font-weight:900;font-size:22px;color:${shortfall > 0 ? '#dc2626' : '#059669'};">${fmt(Math.abs(shortfall))}</span>
        </div>
      </div>
    </div>
  ` : `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px;">
      <div style="color:#ea580c;font-weight:700;font-size:13px;">Reconciliation not yet saved for ${short}</div>
      <div style="color:#9ca3af;font-size:12px;margin-top:4px;">The accountant has not entered the daily reconciliation data. Please complete this in the Accounting → Overview tab.</div>
    </div>
  `}
  `, reconSaved ? '#f59e0b' : '#ea580c')}

  ${section('Attendance', '📋', `
    ${kpiRow([kpiBox('Staff Clocked In', clockedIn)])}
  `, '#6366f1')}

  ${section('Debtors Summary', '📋', `
    ${kpiRow([kpiBox('Total Outstanding Balance', fmt(totalDebtorBalance), totalDebtorBalance > 0 ? '#dc2626' : '#059669'), kpiBox('Active Debtor Accounts', (debtors || []).length)])}
  `, '#ef4444')}

  <div style="text-align:center;padding:20px 0 10px;color:#94a3b8;font-size:11px;line-height:1.7;">
    <div style="font-weight:700;color:#64748b;margin-bottom:4px;">RestaurantOS · Kolondiro</div>
    <div>Trading period: 8:00 AM – 8:00 AM WAT · ${short}</div>
    <div>Generated at ${new Date().toLocaleString('en-SS', { timeZone: 'Africa/Lagos', hour:'2-digit', minute:'2-digit' })} WAT · <a href="https://kolondiro.vercel.app" style="color:#60a5fa;text-decoration:none;">kolondiro.vercel.app</a></div>
  </div>

</div>
</body>
</html>`

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'RestaurantOS <reports@kolondiro.vercel.app>',
      to: [process.env.REPORT_EMAIL || 'seventeenkay@proton.me'],
      subject: `Accountant Summary ${short} · ${fmt(totalRevenue)} · ${shortfall > 0 ? 'SHORTFALL ' + fmt(shortfall) : shortfall < 0 ? 'SURPLUS ' + fmt(Math.abs(shortfall)) : 'BALANCED'} — Kolondiro`,
      html,
    })

    if (emailError) {
      console.error('[accountant-summary] Email failed:', emailError)
      return res.status(500).json({ error: emailError.message })
    }

    console.log(`[accountant-summary] OK — ${fmt(totalRevenue)}, shortfall: ${fmt(shortfall)}, id: ${emailData?.id}`)
    return res.status(200).json({
      sent: true, emailId: emailData?.id, date: short,
      totalRevenue, netRevenue, shortfall, reconSaved,
    })

  } catch (err) {
    console.error('[accountant-summary] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
