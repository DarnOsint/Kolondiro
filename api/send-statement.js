/**
 * api/send-statement.js
 * Sends a professional debtor account statement via Resend.
 * Called from:
 *  1. Debtors.jsx — on payment recorded
 *  2. Debtors.jsx — on new credit sale posted
 *  3. Debtors.jsx — on manual "Send Statement" button click
 *
 * POST body: { debtor_id: string, trigger: 'payment' | 'credit_sale' | 'manual' }
 * Requires header: x-internal-secret
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)
const OWNER_EMAIL = process.env.REPORT_EMAIL || 'seventeenkay@proton.me'
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.VITE_INTERNAL_API_SECRET

function fmt(n) {
  return `SSP${Number(n || 0).toLocaleString('en-SS', { minimumFractionDigits: 2 })}`
}

function ageBucket(dateStr) {
  if (!dateStr) return 'current'
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000)
  if (days <= 30) return 'current'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { debtor_id, trigger = 'manual' } = req.body || {}
  if (!debtor_id) return res.status(400).json({ error: 'debtor_id required' })

  try {
    // ── Fetch debtor ─────────────────────────────────────────────────────────
    const { data: debtor, error: dErr } = await supabase
      .from('debtors')
      .select('*')
      .eq('id', debtor_id)
      .single()

    if (dErr || !debtor) return res.status(404).json({ error: 'Debtor not found' })

    // ── Fetch all transactions (payments) ────────────────────────────────────
    const { data: payments } = await supabase
      .from('debt_payments')
      .select('*')
      .eq('debtor_id', debtor_id)
      .order('created_at', { ascending: false })

    // ── Fetch all credit orders linked to this debtor ────────────────────────
    const { data: creditOrders } = await supabase
      .from('orders')
      .select('id, total_amount, created_at, order_type, table_id, tables(name)')
      .eq('payment_method', 'credit')
      .eq('status', 'paid')
      .order('created_at', { ascending: false })

    // Filter to this debtor's orders if debtor has phone
    // (orders are linked via debtor phone or account credit)
    const debtorOrders = (creditOrders || []).filter(o =>
      // include all if no link yet — future: add debtor_id to orders
      true
    ).slice(0, 50)

    // ── Build unified ledger (charges + payments, chronological) ─────────────
    const charges = debtorOrders.map(o => ({
      date: o.created_at,
      type: 'charge',
      description: `Credit sale${o.tables?.name ? ' — ' + o.tables.name : ''}`,
      debit: o.total_amount || 0,
      credit: 0,
    }))

    const pmts = (payments || []).map(p => ({
      date: p.created_at,
      type: 'payment',
      description: `Payment received${p.payment_method ? ' (' + p.payment_method.replace(/_/g, ' ') + ')' : ''}${p.payment_reference ? ' — Ref: ' + p.payment_reference : ''}`,
      debit: 0,
      credit: p.amount || 0,
    }))

    const ledger = [...charges, ...pmts].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    )

    // Running balance
    let runningBalance = 0
    const ledgerWithBalance = ledger.map(row => {
      runningBalance += row.debit - row.credit
      return { ...row, balance: runningBalance }
    })

    // ── Ageing analysis ──────────────────────────────────────────────────────
    const ageing = { current: 0, '31-60': 0, '61-90': 0, '90+': 0 }
    ;(payments?.length ? [] : debtorOrders).forEach(o => {
      const bucket = ageBucket(o.created_at)
      ageing[bucket] += o.total_amount || 0
    })
    // If we have payments, compute ageing from outstanding balance only
    if (debtor.current_balance > 0) {
      ageing.current = debtor.current_balance
    }

    const availableCredit = Math.max(0, debtor.credit_limit - debtor.current_balance)
    const isOverLimit = debtor.current_balance > debtor.credit_limit
    const isOverdue = debtor.due_date && new Date(debtor.due_date) < new Date() && debtor.current_balance > 0

    const statementDate = new Date().toLocaleDateString('en-SS', {
      day: 'numeric', month: 'long', year: 'numeric'
    })

    const triggerNote = {
      payment: 'This statement was generated automatically after a payment was recorded on your account.',
      credit_sale: 'This statement was generated automatically after a new charge was posted to your account.',
      manual: 'This statement was generated on request.',
    }[trigger]

    // ── HTML email ────────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f4f4f5; color: #111827; }
    .wrapper { max-width: 640px; margin: 24px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    .header { background: #0f172a; padding: 32px 32px 24px; }
    .header h1 { color: #e5d4a6; font-size: 22px; font-weight: 800; letter-spacing: -0.3px; }
    .header p { color: #9ca3af; font-size: 13px; margin-top: 4px; }
    .header .statement-label { color: #ffffff; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .body { padding: 28px 32px; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    .meta-block p.label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta-block p.value { color: #111827; font-size: 14px; font-weight: 600; margin-top: 2px; }
    .balance-box { background: #0f172a; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .balance-box .amount { color: ${debtor.current_balance > 0 ? '#f87171' : '#4ade80'}; font-size: 28px; font-weight: 800; }
    .balance-box .label { color: #9ca3af; font-size: 12px; }
    .overdue-banner { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
    .overdue-banner p { color: #dc2626; font-size: 13px; font-weight: 600; }
    .section-title { font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #f3f4f6; }
    .ageing-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 24px; }
    .ageing-cell { background: #f9fafb; border-radius: 8px; padding: 12px; text-align: center; }
    .ageing-cell .age-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; }
    .ageing-cell .age-amount { font-size: 14px; font-weight: 700; color: #111827; margin-top: 4px; }
    .ageing-cell.has-balance { background: #fef9f0; }
    .ageing-cell.has-balance .age-amount { color: #d97706; }
    .credit-bar-wrap { background: #f3f4f6; border-radius: 99px; height: 8px; margin-bottom: 6px; overflow: hidden; }
    .credit-bar { height: 100%; border-radius: 99px; background: ${isOverLimit ? '#ef4444' : debtor.current_balance / debtor.credit_limit > 0.8 ? '#e5d4a6' : '#10b981'}; width: ${Math.min(100, (debtor.current_balance / debtor.credit_limit) * 100).toFixed(1)}%; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; }
    th { text-align: left; background: #0f172a; color: #ffffff; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 9px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .debit { color: #dc2626; font-weight: 600; }
    .credit { color: #059669; font-weight: 600; }
    .balance-col { font-weight: 700; }
    .payment-row td { background: #f0fdf4 !important; }
    .footer { background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 20px 32px; }
    .footer p { font-size: 11px; color: #9ca3af; line-height: 1.6; }
    .footer a { color: #e5d4a6; text-decoration: none; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; }
    .tag-outstanding { background: #fef3c7; color: #92400e; }
    .tag-paid { background: #d1fae5; color: #065f46; }
    .tag-overdue { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <p class="statement-label">Account Statement</p>
      <h1>Kolondiro</h1>
      <p>Statement Date: ${statementDate}</p>
    </div>

    <div class="body">
      <div class="meta-row">
        <div class="meta-block">
          <p class="label">Account Holder</p>
          <p class="value">${debtor.name}</p>
          ${debtor.phone ? `<p style="color:#6b7280;font-size:12px;margin-top:2px">${debtor.phone}</p>` : ''}
        </div>
        <div class="meta-block">
          <p class="label">Account Status</p>
          <p class="value" style="margin-top:4px">
            <span class="tag ${isOverdue ? 'tag-overdue' : debtor.status === 'paid' ? 'tag-paid' : 'tag-outstanding'}">
              ${isOverdue ? 'OVERDUE' : debtor.status?.toUpperCase() || 'OUTSTANDING'}
            </span>
          </p>
        </div>
        <div class="meta-block">
          <p class="label">Due Date</p>
          <p class="value">${debtor.due_date ? new Date(debtor.due_date).toLocaleDateString('en-SS', { day: 'numeric', month: 'long', year: 'numeric' }) : 'On demand'}</p>
        </div>
      </div>

      ${isOverdue ? `
      <div class="overdue-banner">
        <p>⚠ This account is overdue. Please settle the outstanding balance at your earliest convenience.</p>
      </div>` : ''}

      <div class="balance-box">
        <div>
          <p class="label">Outstanding Balance</p>
          <p class="amount">${fmt(debtor.current_balance)}</p>
        </div>
        <div style="text-align:right">
          <p class="label">Credit Limit</p>
          <p style="color:#ffffff;font-size:16px;font-weight:700;margin-top:2px">${fmt(debtor.credit_limit)}</p>
          <p class="label" style="margin-top:6px">Available Credit</p>
          <p style="color:${availableCredit > 0 ? '#4ade80' : '#f87171'};font-size:14px;font-weight:700">${fmt(availableCredit)}</p>
        </div>
      </div>

      <!-- Credit utilisation bar -->
      <div style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:11px;color:#6b7280">Credit utilisation</span>
          <span style="font-size:11px;font-weight:700;color:${isOverLimit ? '#ef4444' : '#374151'}">${Math.min(100, Math.round((debtor.current_balance / debtor.credit_limit) * 100))}%${isOverLimit ? ' — OVER LIMIT' : ''}</span>
        </div>
        <div class="credit-bar-wrap"><div class="credit-bar"></div></div>
      </div>

      <!-- Ageing analysis -->
      <p class="section-title">Ageing Analysis</p>
      <div class="ageing-grid">
        ${[
          { label: 'Current', key: 'current' },
          { label: '31–60 Days', key: '31-60' },
          { label: '61–90 Days', key: '61-90' },
          { label: '90+ Days', key: '90+' },
        ].map(b => `
        <div class="ageing-cell ${ageing[b.key] > 0 ? 'has-balance' : ''}">
          <p class="age-label">${b.label}</p>
          <p class="age-amount">${fmt(ageing[b.key])}</p>
        </div>`).join('')}
      </div>

      <!-- Account summary -->
      <p class="section-title">Account Summary</p>
      <table>
        <tr>
          <th>Item</th><th style="text-align:right">Amount</th>
        </tr>
        <tr><td>Total credit extended</td><td style="text-align:right">${fmt(debtor.credit_limit)}</td></tr>
        <tr><td>Total paid to date</td><td style="text-align:right;color:#059669;font-weight:600">${fmt(debtor.amount_paid)}</td></tr>
        <tr><td><strong>Balance outstanding</strong></td><td style="text-align:right;color:${debtor.current_balance > 0 ? '#dc2626' : '#059669'};font-weight:700"><strong>${fmt(debtor.current_balance)}</strong></td></tr>
      </table>

      <!-- Transaction ledger -->
      <p class="section-title">Transaction History</p>
      ${ledgerWithBalance.length === 0 ? '<p style="color:#9ca3af;font-size:13px;margin-bottom:24px">No transactions recorded yet.</p>' : `
      <table>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th style="text-align:right">Charges (SSP)</th>
          <th style="text-align:right">Payments (SSP)</th>
          <th style="text-align:right">Balance (SSP)</th>
        </tr>
        ${ledgerWithBalance.map(row => `
        <tr class="${row.type === 'payment' ? 'payment-row' : ''}">
          <td style="white-space:nowrap;color:#6b7280">${new Date(row.date).toLocaleDateString('en-SS', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
          <td>${row.description}</td>
          <td style="text-align:right" class="${row.debit > 0 ? 'debit' : ''}">${row.debit > 0 ? fmt(row.debit) : '—'}</td>
          <td style="text-align:right" class="${row.credit > 0 ? 'credit' : ''}">${row.credit > 0 ? fmt(row.credit) : '—'}</td>
          <td style="text-align:right" class="balance-col" style="color:${row.balance > 0 ? '#dc2626' : '#059669'}">${fmt(row.balance)}</td>
        </tr>`).join('')}
        <tr style="background:#0f172a">
          <td colspan="4" style="color:#ffffff;font-weight:700;padding:10px">Closing Balance</td>
          <td style="text-align:right;color:${debtor.current_balance > 0 ? '#f87171' : '#4ade80'};font-weight:800;font-size:14px">${fmt(debtor.current_balance)}</td>
        </tr>
      </table>`}

      ${debtor.notes ? `
      <div style="background:#f9fafb;border-radius:8px;padding:14px 16px;margin-bottom:16px">
        <p style="font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Account Notes</p>
        <p style="font-size:13px;color:#374151">${debtor.notes}</p>
      </div>` : ''}

      <p style="font-size:12px;color:#9ca3af;font-style:italic">${triggerNote}</p>
    </div>

    <div class="footer">
      <p><strong style="color:#374151">Kolondiro</strong> · Ibadan, Nigeria</p>
      <p style="margin-top:4px">For queries about this statement, please contact us at <a href="mailto:info@kolondiro.vercel.app">info@kolondiro.vercel.app</a> or visit <a href="https://kolondiro.vercel.app">kolondiro.vercel.app</a></p>
      <p style="margin-top:8px">This is an automatically generated statement. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`

    // ── Send to debtor (if they have an email) ───────────────────────────────
    const recipients = []
    if (debtor.email) recipients.push(debtor.email)
    if (OWNER_EMAIL) recipients.push(OWNER_EMAIL)

    if (recipients.length === 0) {
      return res.status(200).json({ sent: false, reason: 'No recipient emails available' })
    }

    const subject = debtor.current_balance > 0
      ? `Account Statement — ${fmt(debtor.current_balance)} Outstanding · ${debtor.name}`
      : `Account Statement — Fully Settled · ${debtor.name}`

    const { data, error } = await resend.emails.send({
      from: "Kolondiro <reports@kolondiro.vercel.app>",
      to: recipients,
      subject,
      html,
    })

    if (error) {
      console.error('Statement email failed:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({
      sent: true,
      emailId: data?.id,
      recipients,
      balance: debtor.current_balance,
    })

  } catch (err) {
    console.error('send-statement error:', err)
    return res.status(500).json({ error: err.message })
  }
}
