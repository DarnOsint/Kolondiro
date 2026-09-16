// ⚠️  DO NOT DEPLOY — DUPLICATE
// The daily report is already handled by api/cron/daily-report.js (Vercel cron)
// which runs automatically via vercel.json schedule: "30 3 * * *"
// Deploying this Edge Function would cause the report to be sent twice every morning.
// This file is kept for reference only.
//
// Kolondiro — Daily Report Edge Function (v3 — verified schema)
// 03:30 UTC = 4:30am WAT | supabase functions deploy daily-report
// supabase functions schedule daily-report --cron "30 3 * * *"
// Secrets: RESEND_API_KEY (required), OWNER_EMAIL (optional fallback)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const fmt = (n: number) => `SSP${Number(n||0).toLocaleString('en-SS',{minimumFractionDigits:2})}`
const pct = (p: number, w: number) => w === 0 ? '—' : `${Math.round(p/w*100)}%`

function sessionWindow8to8() {
  // Always report the last complete 8am–8am window (WAT, UTC+1)
  const now = new Date(Date.now() + 3_600_000) // WAT
  const endWAT = new Date(now)
  endWAT.setHours(8, 0, 0, 0) // today 08:00 WAT
  // If we're before 08:00 WAT, keep end as today 08:00; if after, we still report the window ending today 08:00
  const startWAT = new Date(endWAT)
  startWAT.setDate(startWAT.getDate() - 1)
  const start = new Date(startWAT.getTime() - 3_600_000) // back to UTC
  const end = new Date(endWAT.getTime() - 3_600_000)
  return { start, end, labelStart: startWAT, labelEnd: endWAT }
}

function toWAT(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SS',{hour:'2-digit',minute:'2-digit',timeZone:'Africa/Lagos'})
}

function dateLabel(startWAT: Date, endWAT: Date) {
  const s = startWAT.toLocaleDateString('en-SS',{day:'2-digit',month:'short',year:'numeric',timeZone:'Africa/Lagos'})
  const e = endWAT.toLocaleDateString('en-SS',{day:'2-digit',month:'short',year:'numeric',timeZone:'Africa/Lagos'})
  return `${s} → ${e} (8am–8am)`
}

async function fetchAll(start: Date, end: Date) {
  const s = start.toISOString(), e = end.toISOString()
  const dateStr = start.toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'})

  const [ordRes,itmRes,voidRes,payRes,tillRes,attRes,debtRes,invRes] = await Promise.all([

    // orders — profiles + tables join confirmed in codebase
    sb.from('orders')
      .select('id,total_amount,payment_method,order_type,closed_at,profiles(full_name),tables(name,table_categories(name))')
      .eq('status','paid').gte('closed_at',s).lte('closed_at',e),

    // order_items — for top sellers
    sb.from('order_items')
      .select('quantity,total_price,unit_price,menu_items(name,menu_categories(name))')
      .gte('created_at',s).lte('created_at',e),

    // void_log — columns confirmed from schema + codebase
    sb.from('void_log')
      .select('menu_item_name,quantity,total_value,void_type,approved_by_name,created_at')
      .gte('created_at',s).lte('created_at',e),

    // payouts — profiles join confirmed in codebase
    sb.from('payouts')
      .select('amount,reason,category,created_at,profiles(full_name)')
      .gte('created_at',s).lte('created_at',e),

    // till_sessions — profiles join confirmed in codebase
    sb.from('till_sessions')
      .select('opened_at,closed_at,opening_float,closing_float,expected_cash,status,profiles(full_name)')
      .gte('opened_at',s).lte('opened_at',e),

    // attendance — fk alias confirmed in codebase
    sb.from('attendance')
      .select('clock_in,clock_out,date,profiles!attendance_staff_id_fkey(full_name,role)')
      .eq('date',dateStr),

    // debt_payments — no debtors join (FK only, not a select join in codebase)
    sb.from('debt_payments')
      .select('amount,payment_method,recorded_by_name,created_at')
      .gte('created_at',s).lte('created_at',e),

    // inventory — item_name column confirmed
    sb.from('inventory').select('item_name,current_stock,minimum_stock').eq('is_active',true),
  ])

  const inv = invRes.data || []
  return {
    orders:       ordRes.data  || [],
    items:        itmRes.data  || [],
    voids:        voidRes.data || [],
    payouts:      payRes.data  || [],
    till:         tillRes.data || [],
    attendance:   attRes.data  || [],
    debtPayments: debtRes.data || [],
    lowStock:     inv.filter(i => (i.current_stock||0) <= (i.minimum_stock||0)),
  }
}

function buildEmail(dateStr: string, d: Awaited<ReturnType<typeof fetchAll>>) {
  const total   = d.orders.reduce((s,o)=>s+(o.total_amount||0),0)
  const voided  = d.voids.reduce((s,v)=>s+(v.total_value||0),0)
  const payouts = d.payouts.reduce((s,p)=>s+(p.amount||0),0)
  const debt    = d.debtPayments.reduce((s,p)=>s+(p.amount||0),0)
  const net     = total - payouts
  const n       = d.orders.length
  const avg     = n ? total/n : 0

  const payMap: Record<string, number> = {}
  d.orders.forEach(o => {
    const k = (o.payment_method || 'unspecified').toLowerCase()
    payMap[k] = (payMap[k] || 0) + (o.total_amount || 0)
  })
  const paymentRows = Object.entries(payMap).sort((a,b)=>b[1]-a[1])
  const cash     = payMap['cash'] || 0
  const transfer = payMap['transfer'] || 0
  const card     = payMap['card'] || payMap['pos'] || 0
  const credit   = payMap['credit'] || payMap['tab'] || 0

  // Peak hour WAT
  const hMap: Record<number,number> = {}
  d.orders.forEach(o => { if(!o.closed_at)return; const h=(new Date(o.closed_at).getUTCHours()+1)%24; hMap[h]=(hMap[h]||0)+(o.total_amount||0) })
  const peak = Object.entries(hMap).sort((a,b)=>Number(b[1])-Number(a[1]))[0]
  const peakStr = peak ? (() => { const h=parseInt(peak[0]); return `${h===0?12:h>12?h-12:h}${h<12||h===0?'am':'pm'}` })() : 'N/A'

  // Aggregations
  const wMap: Record<string,{rev:number,ord:number}> = {}
  d.orders.forEach(o => { const n=(o.profiles as any)?.full_name||'Unknown'; if(!wMap[n])wMap[n]={rev:0,ord:0}; wMap[n].rev+=o.total_amount||0; wMap[n].ord++ })

  const zMap: Record<string,number> = {}
  d.orders.forEach(o => { const z=(o.tables as any)?.table_categories?.name||(o.order_type==='takeaway'?'Takeaway':o.order_type==='cash_sale'?'Counter':'Unknown'); zMap[z]=(zMap[z]||0)+(o.total_amount||0) })

  const iMap: Record<string,{qty:number,rev:number,cat:string}> = {}
  d.items.forEach(i => {
    const n=(i.menu_items as any)?.name||'Unknown',c=(i.menu_items as any)?.menu_categories?.name||''
    const unit = (i as any).unit_price ?? 0
    const total = (i as any).total_price ?? unit*(i.quantity||0) ?? 0
    if(!iMap[n]) iMap[n]={qty:0,rev:0,cat:c}
    iMap[n].qty+=i.quantity||0
    iMap[n].rev+= total
  })

  // HTML helpers
  const td = (v: string) => `<td style="padding:7px 12px;font-size:13px;color:#1e293b">${v}</td>`
  const tr = (cells: string[], bg='white') => `<tr style="background:${bg}">${cells.map(td).join('')}</tr>`
  const thead = (hs: string[]) => `<thead><tr style="background:#0f172a">${hs.map(h=>`<th style="padding:8px 12px;color:white;font-size:11px;text-transform:uppercase;letter-spacing:.5px;text-align:left">${h}</th>`).join('')}</tr></thead>`
  const tbl = (hs: string[], body: string) => `<table style="width:100%;border-collapse:collapse;margin-top:8px">${thead(hs)}<tbody>${body||tr(['<span style="color:#94a3b8">No data</span>'])}</tbody></table>`
  const kpi = (lbl: string, val: string, sub='', col='#0f172a') => `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;min-width:110px;flex:1"><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${lbl}</div><div style="font-size:17px;font-weight:800;color:${col};margin-top:3px">${val}</div>${sub?`<div style="font-size:10px;color:#94a3b8;margin-top:1px">${sub}</div>`:''}</div>`
  const sec = (title: string, col: string, body: string) => `<div style="margin-bottom:24px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${col};border-bottom:2px solid ${col};padding-bottom:5px;margin-bottom:10px">${title}</div>${body}</div>`
  const box = (count: number, lbl: string, rev: number, col: string, bg: string, bd: string) => `<div style="background:${bg};border:1px solid ${bd};border-radius:8px;padding:10px 14px;text-align:center;min-width:100px"><div style="font-size:20px;font-weight:800;color:${col}">${count}</div><div style="font-size:11px;color:${col}">${lbl}</div><div style="font-size:10px;color:#94a3b8">${fmt(rev)}</div></div>`

  // Rows
  const wRows = Object.entries(wMap).sort((a,b)=>b[1].rev-a[1].rev)
    .map(([n,w],i)=>tr([n,String(w.ord),fmt(w.rev),fmt(w.ord?w.rev/w.ord:0)],i%2===0?'#f8fafc':'white')).join('')

  const zRows = Object.entries(zMap).sort((a,b)=>b[1]-a[1])
    .map(([z,r],i)=>tr([z,fmt(r),pct(r,total)],i%2===0?'#f8fafc':'white')).join('')

  const topRows = Object.entries(iMap).sort((a,b)=>b[1].rev-a[1].rev).slice(0,10)
    .map(([n,v],i)=>tr([n,v.cat,String(v.qty),fmt(v.rev)],i%2===0?'#f8fafc':'white')).join('')

  const voidRows = d.voids.slice(0,15)
    .map((v,i)=>tr([v.menu_item_name||'—',String(v.quantity||1),`<span style="color:#dc2626">-${fmt(v.total_value||0)}</span>`,v.approved_by_name||'—'],i%2===0?'#fff5f5':'white')).join('')

  const payRows = d.payouts
    .map((p,i)=>tr([p.reason||'—',p.category||'—',`<span style="color:#dc2626">-${fmt(p.amount||0)}</span>`,(p.profiles as any)?.full_name||'—'],i%2===0?'#f8fafc':'white')).join('')

  const tillRows = d.till.map((t,i) => {
    const diff = t.closing_float!=null&&t.expected_cash!=null ? t.closing_float-t.expected_cash : null
    return tr([
      t.opened_at?toWAT(t.opened_at):'—',
      t.closed_at?toWAT(t.closed_at):'<span style="color:#e5d4a6">Open</span>',
      fmt(t.opening_float||0), fmt(t.closing_float||0),
      diff===null?'—':diff>=0?`<span style="color:#16a34a">+${fmt(diff)}</span>`:`<span style="color:#dc2626">${fmt(diff)}</span>`,
      (t.profiles as any)?.full_name||'—'],
    i%2===0?'#f8fafc':'white')
  }).join('')

  const attRows = d.attendance.filter(a=>(a.profiles as any)?.role!=='owner').map((a,i)=>{
    const p = a.profiles as any
    const mins = a.clock_in&&a.clock_out ? Math.round((new Date(a.clock_out).getTime()-new Date(a.clock_in).getTime())/60000) : null
    return tr([
      p?.full_name||'—',
      `<span style="text-transform:capitalize;color:#64748b">${p?.role||'—'}</span>`,
      a.clock_in?toWAT(a.clock_in):'—',
      a.clock_out?toWAT(a.clock_out):'<span style="color:#ef4444">On shift</span>',
      mins!==null?(mins>=60?`${Math.floor(mins/60)}h ${mins%60}m`:`${mins}m`):'—'],
    i%2===0?'#f8fafc':'white')
  }).join('')

  const debtRows = d.debtPayments.map((p,i)=>tr([p.recorded_by_name||'—',fmt(p.amount||0),p.payment_method||'—',toWAT(p.created_at)],i%2===0?'#f8fafc':'white')).join('')
  const lowRows  = d.lowStock.map((it,i)=>tr([it.item_name||'—',`<span style="color:#dc2626;font-weight:700">${it.current_stock}</span>`,String(it.minimum_stock)],i%2===0?'#fff7ed':'#fef3c7')).join('')

  const tableOrds = d.orders.filter(o=>o.order_type==='table')
  const cashOrds  = d.orders.filter(o=>o.order_type==='cash_sale')
  const takeOrds  = d.orders.filter(o=>o.order_type==='takeaway')

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:16px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:680px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="background:#0f172a;padding:26px 30px">
    <div style="font-size:21px;font-weight:900;color:#e5d4a6">Kolondiro</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px">Daily Trading Summary · ${dateStr}</div>
  </div>
  <div style="padding:26px 30px">

    ${sec('At a Glance','#e5d4a6',`
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        ${kpi('Total Revenue',fmt(total),n+' orders','#e5d4a6')}
        ${kpi('Net Revenue',fmt(net),'after payouts','#16a34a')}
        ${kpi('Avg Order',fmt(avg))}
        ${kpi('Peak Hour',peakStr,'','#6366f1')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${paymentRows.map(([m,v])=>kpi(m.replace(/_/g,' ').toUpperCase(),fmt(v),pct(v,total))).join('')}
        ${voided>0?kpi('Voided',fmt(voided),d.voids.length+' void(s)','#dc2626'):''}
      </div>`)}

    ${sec('Order Types','#3b82f6',`<div style="display:flex;gap:10px;flex-wrap:wrap">
      ${box(tableOrds.length,'Table Orders',tableOrds.reduce((s,o)=>s+(o.total_amount||0),0),'#2563eb','#eff6ff','#bfdbfe')}
      ${box(cashOrds.length,'Cash Sales',cashOrds.reduce((s,o)=>s+(o.total_amount||0),0),'#16a34a','#f0fdf4','#bbf7d0')}
      ${box(takeOrds.length,'Takeaways',takeOrds.reduce((s,o)=>s+(o.total_amount||0),0),'#9333ea','#fdf4ff','#e9d5ff')}
      ${debt>0?box(d.debtPayments.length,'Debts Recovered',debt,'#16a34a','#f0fdf4','#bbf7d0'):''}
    </div>`)}

    ${wRows?sec('Waitron Performance','#6366f1',tbl(['Staff','Orders','Revenue','Avg Order'],wRows)):''}
    ${zRows?sec('Revenue by Zone','#0891b2',tbl(['Zone','Revenue','Share'],zRows)):''}
    ${topRows?sec('Top 10 Items','#10b981',tbl(['Item','Category','Qty','Revenue'],topRows)):''}
    ${debtRows?sec('Debt Payments Received','#16a34a',tbl(['Recorded By','Amount','Method','Time'],debtRows)):''}
    ${tillRows?sec('Till Sessions','#0369a1',tbl(['Opened','Closed','Float','Closing','Variance','Staff'],tillRows)):''}
    ${payRows?sec('Cash Payouts','#dc2626',tbl(['Reason','Category','Amount','By'],payRows)):''}
    ${voidRows?sec('Voids','#ef4444',tbl(['Item','Qty','Value Lost','Approved By'],voidRows)):''}
    ${attRows?sec('Staff Attendance','#0284c7',tbl(['Name','Role','Clock In','Clock Out','Hours'],attRows)):''}

    ${sec('Stock Status','#e5d4a6',d.lowStock.length===0
      ?`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:11px 14px;font-size:13px;color:#15803d">✅ All inventory above minimum thresholds.</div>`
      :`<p style="font-size:13px;color:#92400e;background:#fef3c7;padding:8px 12px;border-radius:6px;margin:0 0 8px">⚠️ ${d.lowStock.length} item(s) below minimum — restock before opening.</p>${tbl(['Item','Current','Minimum'],lowRows)}`
    )}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
      Auto-generated at 4:30am WAT by RestaurantOS.
      Full detail at <a href="https://kolondiro.vercel.app" style="color:#e5d4a6;text-decoration:none">kolondiro.vercel.app</a>.
    </div>
  </div>
</div>
</body></html>`
}

Deno.serve(async () => {
  try {
    const { start, end, labelStart, labelEnd } = sessionWindow8to8()
    const label = dateLabel(labelStart, labelEnd)
    const data  = await fetchAll(start, end)

    const ownerEmail = Deno.env.get('OWNER_EMAIL')
    const { data: ownerProfiles } = await sb.from('profiles').select('email').eq('role','owner').eq('is_active',true).not('email','is',null)
    const recipients = [...new Set([ownerEmail,...((ownerProfiles||[]).map((p:any)=>p.email as string))].filter(Boolean))] as string[]

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ok:true,skipped:true,reason:'no recipients'}),{status:200})
    }

    const html  = buildEmail(label, data)
    const total = data.orders.reduce((s,o)=>s+(o.total_amount||0),0)
    const subject = `📊 Daily Report — ${label} — SSP${Math.round(total).toLocaleString('en-SS')}`

    const key = Deno.env.get('RESEND_API_KEY')
    if (!key) return new Response(JSON.stringify({ok:false,error:'RESEND_API_KEY not set'}),{status:500})

    const res = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:"Kolondiro <reports@kolondiro.com>",to:recipients,subject,html}),
    })

    if (!res.ok) { const err=await res.text(); return new Response(JSON.stringify({ok:false,error:err}),{status:500}) }

    return new Response(JSON.stringify({ok:true,date:label,recipients,orders:data.orders.length,revenue:total}),
      {status:200,headers:{'Content-Type':'application/json'}})

  } catch(e) {
    console.error('Daily report failed:',e)
    return new Response(JSON.stringify({ok:false,error:String(e)}),{status:500})
  }
})
