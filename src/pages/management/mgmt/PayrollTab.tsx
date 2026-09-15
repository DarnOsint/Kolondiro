import { useState, useEffect, useCallback } from 'react'
import { DollarSign, RefreshCw, Save, Printer, Download, X, UserPlus } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { audit } from '../../../lib/audit'
import type { Profile } from '../../../types'

interface PayrollRow {
  id?: string
  staff_id: string
  staff_name: string
  role: string
  is_active: boolean
  bank_name: string
  account_number: string
  base_salary: number
  daily_rate: number
  // Manual outstanding saved in payroll table
  outstanding: number
  // Auto outstanding from daily reconciliation + pay-later (computed, not persisted)
  auto_outstanding?: number
  // Split breakdown of auto outstanding: cash shortages vs credit debts owed
  shortages_outstanding?: number
  debts_outstanding?: number
  docking: number
  days_worked: number
  total_days: number
}

const normalizeStaffNameKey = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const getMonthStr = (offset = 0) => {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-NG', {
    month: 'long',
    year: 'numeric',
  })
}

const daysInMonth = (m: string) => {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo), 0).getDate()
}

const formatErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const maybeMessage = 'message' in err ? err.message : null
    const maybeDetails = 'details' in err ? err.details : null
    const maybeHint = 'hint' in err ? err.hint : null
    return (
      [maybeMessage, maybeDetails, maybeHint].filter(Boolean).join(' | ') || JSON.stringify(err)
    )
  }
  return String(err)
}

export default function PayrollTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [month, setMonth] = useState(getMonthStr())
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [edited, setEdited] = useState<Record<string, Partial<PayrollRow>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newStaff, setNewStaff] = useState({
    name: '',
    role: 'waitron',
    bank: '',
    account: '',
    salary: '',
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setEdited({})

    const totalDays = daysInMonth(month)
    const monthStart = month + '-01'
    const monthEnd = month + '-' + String(totalDays).padStart(2, '0')

    // Get all staff
    const { data: staff } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active')
      .order('full_name')

    // Get attendance for the month with duration
    const { data: attendance } = await supabase
      .from('attendance')
      .select('staff_id, date, duration_minutes')
      .gte('date', monthStart)
      .lte('date', monthEnd)

    // Count qualified days: clocked in > 6 hours (360 minutes)
    // People get one day off per week, naturally reflected in attendance
    const daysMap: Record<string, Set<string>> = {}
    for (const a of (attendance || []) as Array<{
      staff_id: string
      date: string
      duration_minutes: number | null
    }>) {
      if (!daysMap[a.staff_id]) daysMap[a.staff_id] = new Set()
      // Only count completed shifts with more than 6 hours
      if (a.duration_minutes !== null && a.duration_minutes > 360) {
        daysMap[a.staff_id].add(a.date)
      }
    }

    // Get saved payroll for this month
    const { data: payroll } = await supabase
      .from('payroll')
      .select(
        'id, staff_id, staff_name, role, is_active, bank_name, account_number, base_salary, daily_rate, outstanding, docking'
      )
      .eq('month', month)

    const payMap: Record<string, any> = {}
    for (const p of (payroll || []) as any[]) {
      payMap[p.staff_id] = p
    }

    // Sum outstanding from daily reconciliation for the month
    const { data: reconEntries } = await supabase
      .from('settings')
      .select('id, value')
      .ilike('id', `recon_${month}-%`)
    const reconOutstanding: Record<string, number> = {}
    for (const entry of (reconEntries || []) as Array<{ id: string; value: string }>) {
      try {
        const recon = JSON.parse(entry.value)
        if (recon.outstanding) {
          for (const [name, amt] of Object.entries(recon.outstanding as Record<string, number>)) {
            const key = normalizeStaffNameKey(name)
            if (amt > 0) reconOutstanding[key] = (reconOutstanding[key] || 0) + amt
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Sum UNPAID credit debts per waitron for the month (from debtors table)
    // This respects paid/partial status — paid debts are excluded
    // All unpaid debts a waitron is responsible for are included regardless of month.
    const { data: unpaidDebts } = await supabase
      .from('debtors')
      .select('name, current_balance, recorded_by_name')
      .in('status', ['outstanding', 'partial'])
      .in('debt_type', ['credit_order', 'table_order', 'fridge', 'bar_tab', 'room_stay'])
    const creditByStaff: Record<string, number> = {}
    for (const d of (unpaidDebts || []) as any[]) {
      // "recorded_by_name" is the waitron/staff who recorded the pay-later debt.
      const key = normalizeStaffNameKey(d.recorded_by_name || 'Unknown')
      creditByStaff[key] = (creditByStaff[key] || 0) + (d.current_balance || 0)
    }

    // Build rows — auto-populate outstanding from reconciliation + credit orders
    const display: PayrollRow[] = (
      (staff || []) as Array<{ id: string; full_name: string; role: string; is_active: boolean }>
    ).map((s) => {
      const saved = payMap[s.id]
      const effectiveRole = saved?.role || s.role || ''
      const key = normalizeStaffNameKey(s.full_name)
      const shortages = effectiveRole === 'waitron' ? reconOutstanding[key] || 0 : 0
      const debts = effectiveRole === 'waitron' ? creditByStaff[key] || 0 : 0
      const autoOutstanding = shortages + debts
      return {
        id: saved?.id,
        staff_id: s.id,
        staff_name: s.full_name,
        role: effectiveRole,
        is_active: s.is_active ?? true,
        bank_name: saved?.bank_name || '',
        account_number: saved?.account_number || '',
        daily_rate: saved?.daily_rate ?? saved?.base_salary ?? 0,
        base_salary: saved?.daily_rate ?? saved?.base_salary ?? 0,
        outstanding: saved?.outstanding || 0,
        auto_outstanding: autoOutstanding,
        shortages_outstanding: shortages,
        debts_outstanding: debts,
        docking: saved?.docking || 0,
        days_worked: daysMap[s.id]?.size || 0,
        total_days: totalDays,
      }
    })

    // Include payroll entries for staff who may no longer be active
    for (const p of (payroll || []) as any[]) {
      if (!display.find((r) => r.staff_id === p.staff_id)) {
        display.push({
          id: p.id,
          staff_id: p.staff_id,
          staff_name: p.staff_name,
          role: p.role || '',
          is_active: false,
          bank_name: p.bank_name || '',
          account_number: p.account_number || '',
          daily_rate: p.daily_rate ?? p.base_salary ?? 0,
          base_salary: p.daily_rate ?? p.base_salary ?? 0,
          outstanding: p.outstanding || 0,
          auto_outstanding: 0,
          shortages_outstanding: 0,
          debts_outstanding: 0,
          docking: p.docking || 0,
          days_worked: daysMap[p.staff_id]?.size || 0,
          total_days: totalDays,
        })
      }
    }

    display.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      return a.staff_name.localeCompare(b.staff_name)
    })
    setRows(display)
    setLoading(false)
  }, [month])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getRow = (staffId: string): PayrollRow => {
    const base = rows.find((r) => r.staff_id === staffId)!
    const edits = edited[staffId]
    return { ...base, ...edits }
  }

  const totalOutstandingFor = (r: PayrollRow) => (r.outstanding || 0) + (r.auto_outstanding || 0)
  const grossPay = (r: PayrollRow) => (r.base_salary || 0) * (r.days_worked || 0)
  const netPay = (r: PayrollRow) => Math.max(0, grossPay(r) - totalOutstandingFor(r) - r.docking)

  const updateField = (staffId: string, field: string, value: string | number) => {
    setEdited((prev) => ({ ...prev, [staffId]: { ...(prev[staffId] || {}), [field]: value } }))
  }

  const copyAccountNumber = async (accountNumber: string) => {
    const trimmed = accountNumber.trim()
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      toast.success('Copied', `${trimmed} copied to clipboard`)
    } catch (err) {
      toast.error('Copy failed', formatErrorMessage(err))
    }
  }

  const hasEdits = Object.keys(edited).length > 0

  const saveAll = async () => {
    setSaving(true)
    try {
      let count = 0
      for (const staffId of Object.keys(edited)) {
        const row = getRow(staffId)
        const payload = {
          staff_id: staffId,
          staff_name: row.staff_name,
          role: row.role,
          bank_name: row.bank_name,
          account_number: row.account_number,
          base_salary: row.base_salary,
          daily_rate: row.daily_rate,
          outstanding: row.outstanding,
          docking: row.docking,
          month,
          updated_by: profile?.full_name,
          updated_at: new Date().toISOString(),
        }
        const { error } = await supabase
          .from('payroll')
          .upsert(payload, { onConflict: 'staff_id,month' })
        if (error) throw error
        count++
      }

      await audit({
        action: 'PAYROLL_UPDATED',
        entity: 'payroll',
        entityName: `${count} staff for ${monthLabel(month)}`,
        newValue: edited,
        performer: profile as Profile,
      })
      setEdited({})
      toast.success('Saved', `${count} payroll record${count !== 1 ? 's' : ''} updated`)
      await fetchData()
    } catch (err) {
      toast.error('Save failed', formatErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const addStaff = async () => {
    if (!newStaff.name.trim()) {
      toast.warning('Required', 'Enter staff name')
      return
    }
    setSaving(true)
    try {
      // Create profile
      const { data: existing, error: existingError } = await supabase
        .from('profiles')
        .select('id')
        .eq('full_name', newStaff.name.trim())
        .limit(1)
      if (existingError) throw existingError

      let staffId = existing?.[0]?.id
      if (!staffId) {
        const { data: created, error: createError } = await supabase
          .from('profiles')
          .insert({
            id: crypto.randomUUID(),
            full_name: newStaff.name.trim(),
            role: newStaff.role,
            is_active: true,
          })
          .select('id')
          .single()
        if (createError) throw createError
        staffId = created?.id
      }

      if (!staffId) throw new Error('Unable to create or find staff profile')

      const { error: payrollError } = await supabase.from('payroll').upsert(
        {
          staff_id: staffId,
          staff_name: newStaff.name.trim(),
          role: newStaff.role,
          bank_name: newStaff.bank,
          account_number: newStaff.account,
          base_salary: parseFloat(newStaff.salary) || 0,
          daily_rate: parseFloat(newStaff.salary) || 0,
          outstanding: 0,
          docking: 0,
          month,
          updated_by: profile?.full_name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'staff_id,month' }
      )
      if (payrollError) throw payrollError

      await audit({
        action: 'PAYROLL_STAFF_ADDED',
        entity: 'payroll',
        entityName: newStaff.name.trim(),
        newValue: { role: newStaff.role, salary: newStaff.salary },
        performer: profile as Profile,
      })

      setShowAdd(false)
      setNewStaff({ name: '', role: 'waitron', bank: '', account: '', salary: '' })
      toast.success('Added', `${newStaff.name.trim()} added to payroll`)
      await fetchData()
    } catch (err) {
      toast.error('Add failed', formatErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const totalGross = rows.reduce((s, r) => s + grossPay(getRow(r.staff_id)), 0)
  const totalOutstanding = rows.reduce((s, r) => s + totalOutstandingFor(getRow(r.staff_id)), 0)
  const totalDocking = rows.reduce((s, r) => s + getRow(r.staff_id).docking, 0)
  const totalNet = rows.reduce((s, r) => s + netPay(getRow(r.staff_id)), 0)

  const exportCsv = () => {
    const lines = [
      [
        'Name',
        'Role',
        'Qualified Days (>6h)',
        'Bank',
        'Account No',
        'Daily Rate',
        'Gross Pay',
        'Owing (Total)',
        'Owing (Manual)',
        'Owing (Shortage)',
        'Owing (Debts)',
        'Docking',
        'Net Pay',
      ],
      ...rows.map((r) => {
        const m = getRow(r.staff_id)
        return [
          m.staff_name,
          m.role,
          `${m.days_worked}/${m.total_days}`,
          m.bank_name,
          m.account_number,
          String(m.base_salary),
          String(grossPay(m)),
          String(totalOutstandingFor(m)),
          String(m.outstanding || 0),
          String(m.shortages_outstanding || 0),
          String(m.debts_outstanding || 0),
          String(m.docking),
          String(netPay(m)),
        ]
      }),
    ]
    const csv = lines.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payroll_${month}.csv`
    a.click()
  }

  const printReport = () => {
    const W = 50
    const div = '-'.repeat(W)
    const r = (l: string, rv: string) => {
      const left = l.substring(0, W - rv.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - rv.length)) + rv
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmt = (n: number) => 'N' + n.toLocaleString()
    const lines = [
      '',
      ctr("KOLONDIRO"),
      ctr('MONTHLY PAYROLL'),
      div,
      r('Month:', monthLabel(month)),
      r('Staff Count:', String(rows.length)),
      div,
      r('Total Gross Pay:', fmt(totalGross)),
      r('Total Outstanding:', fmt(totalOutstanding)),
      r('Total Docking:', fmt(totalDocking)),
      r('Total Net Pay:', fmt(totalNet)),
      div,
      '',
      ...rows.map((row) => {
        const m = getRow(row.staff_id)
        const outTotal = totalOutstandingFor(m)
        return [
          r(m.staff_name, `(${m.role})`),
          r(`  Days: ${m.days_worked}/${m.total_days}`, `Bank: ${m.bank_name || '—'}`),
          r(`  Acct: ${m.account_number || '—'}`, ''),
          r(`  Rate: ${fmt(m.base_salary)}/day`, `Gross: ${fmt(grossPay(m))}`),
          r(`  Outst: ${fmt(outTotal)}`, `Dock: ${fmt(m.docking)}`),
          (m.shortages_outstanding || 0) > 0
            ? r(`  Shortage: ${fmt(m.shortages_outstanding || 0)}`, '')
            : '',
          (m.debts_outstanding || 0) > 0 ? r(`  Debts: ${fmt(m.debts_outstanding || 0)}`, '') : '',
          r(`  NET PAY:`, `${fmt(netPay(m))}`),
          '',
        ].join('\n')
      }),
      div,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payroll — ${monthLabel(month)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
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

  const roles = [
    'waitron',
    'kitchen',
    'bar',
    'griller',
    'mixologist',
    'manager',
    'supervisor',
    'accountant',
    'auditor',
    'floor_staff',
    'dj',
    'hypeman',
    'games_master',
    'shisha_attendant',
    'apartment_manager',
    'social_media_manager',
  ]

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-white font-bold text-lg flex items-center gap-2">
          <DollarSign size={18} className="text-amber-400" /> Payroll
        </h3>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setMonth(getMonthStr(-1))}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white"
        >
          Prev Month
        </button>
        <button
          onClick={() => setMonth(getMonthStr())}
          className={`px-3 py-2 rounded-xl text-xs font-medium ${month === getMonthStr() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400'}`}
        >
          This Month
        </button>
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white font-bold text-xs px-3 py-2 rounded-xl"
        >
          <UserPlus size={13} /> Add Staff
        </button>
        {hasEdits && (
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-4 py-2 rounded-xl"
          >
            <Save size={13} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
        {rows.length > 0 && (
          <>
            <button
              onClick={printReport}
              className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs ml-auto"
            >
              <Printer size={12} /> Print
            </button>
            <button
              onClick={exportCsv}
              className="p-2 text-gray-400 hover:text-white bg-gray-800 border border-gray-800 rounded-xl"
            >
              <Download size={14} />
            </button>
          </>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Gross Pay', value: `₦${totalGross.toLocaleString()}`, color: 'text-white' },
          {
            label: 'Outstanding',
            value: `₦${totalOutstanding.toLocaleString()}`,
            color: totalOutstanding > 0 ? 'text-red-400' : 'text-gray-400',
          },
          {
            label: 'Docking',
            value: `₦${totalDocking.toLocaleString()}`,
            color: totalDocking > 0 ? 'text-amber-400' : 'text-gray-400',
          },
          { label: 'Net Payable', value: `₦${totalNet.toLocaleString()}`, color: 'text-green-400' },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
          >
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
            <p className="text-gray-500 text-[9px] uppercase tracking-wider">{k.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No staff for {monthLabel(month)}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-2 py-2">Role</th>
                <th className="text-center px-2 py-2">Days</th>
                <th className="text-left px-2 py-2">Bank</th>
                <th className="text-left px-2 py-2">Account No</th>
                <th className="text-right px-2 py-2">Daily Rate</th>
                <th className="text-right px-2 py-2">Total Owing (Manual + Shortage + Debts)</th>
                <th className="text-right px-2 py-2">Docking</th>
                <th className="text-right px-3 py-2">Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const m = getRow(row.staff_id)
                const isEdited = !!edited[row.staff_id]
                const net = netPay(m)
                return (
                  <tr
                    key={row.staff_id}
                    className={`border-t border-gray-800 ${
                      !m.is_active
                        ? 'bg-gray-900/60 text-gray-500'
                        : isEdited
                          ? 'bg-amber-500/5'
                          : 'hover:bg-gray-800/50'
                    }`}
                  >
                    <td
                      className={`px-3 py-2 font-medium ${m.is_active ? 'text-white' : 'text-gray-500'}`}
                    >
                      {m.staff_name}
                      {!m.is_active && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={m.role}
                        onChange={(e) => updateField(row.staff_id, 'role', e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-300 rounded px-1 py-1 text-xs w-24 focus:outline-none focus:border-amber-500"
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center px-2 py-2">
                      <span
                        className={
                          m.days_worked < m.total_days * 0.7 ? 'text-red-400' : 'text-green-400'
                        }
                      >
                        {m.days_worked}
                      </span>
                      <span className="text-gray-600">/{m.total_days}</span>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={m.bank_name}
                        placeholder="Bank"
                        onChange={(e) => updateField(row.staff_id, 'bank_name', e.target.value)}
                        className="w-20 bg-gray-800 border border-gray-700 text-white rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={m.account_number}
                        placeholder="Acct No"
                        onClick={() => void copyAccountNumber(m.account_number)}
                        onChange={(e) =>
                          updateField(row.staff_id, 'account_number', e.target.value)
                        }
                        title={
                          m.account_number ? 'Click to copy account number' : 'Enter account number'
                        }
                        className="w-24 cursor-copy bg-gray-800 border border-gray-700 text-white rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={m.base_salary || ''}
                        placeholder="0"
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0
                          updateField(row.staff_id, 'base_salary', val)
                          updateField(row.staff_id, 'daily_rate', val)
                        }}
                        className="w-20 bg-gray-800 border border-gray-700 text-white text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-0.5 items-end">
                        <input
                          type="number"
                          value={m.outstanding || ''}
                          placeholder="0"
                          onChange={(e) =>
                            updateField(row.staff_id, 'outstanding', Number(e.target.value) || 0)
                          }
                          title="Manual outstanding"
                          className="w-24 bg-gray-800 border border-gray-700 text-red-400 text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-red-500"
                        />
                        {(m.shortages_outstanding || 0) > 0 && (
                          <span
                            className="text-[10px] text-gray-500 text-right"
                            title="Cash shortage from daily reconciliation"
                          >
                            shortage ₦{(m.shortages_outstanding || 0).toLocaleString()}
                          </span>
                        )}
                        {(m.debts_outstanding || 0) > 0 && (
                          <span
                            className="text-[10px] text-amber-400 text-right"
                            title="Unpaid credit debts owed"
                          >
                            debts ₦{(m.debts_outstanding || 0).toLocaleString()}
                          </span>
                        )}
                        {totalOutstandingFor(m) > 0 && (
                          <span className="text-[10px] text-red-400 font-semibold text-right">
                            total ₦{totalOutstandingFor(m).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={m.docking || ''}
                        placeholder="0"
                        onChange={(e) =>
                          updateField(row.staff_id, 'docking', Number(e.target.value) || 0)
                        }
                        className="w-20 bg-gray-800 border border-gray-700 text-amber-400 text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td
                      className={`text-right px-3 py-2 font-bold ${net > 0 ? 'text-green-400' : 'text-gray-500'}`}
                    >
                      ₦{net.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                <td className="text-white px-3 py-2" colSpan={5}>
                  TOTAL ({rows.length} staff)
                </td>
                <td className="text-white text-right px-2 py-2">₦{totalGross.toLocaleString()}</td>
                <td className="text-red-400 text-right px-2 py-2">
                  ₦{totalOutstanding.toLocaleString()}
                </td>
                <td className="text-amber-400 text-right px-2 py-2">
                  ₦{totalDocking.toLocaleString()}
                </td>
                <td className="text-green-400 text-right px-3 py-2">
                  ₦{totalNet.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Add Staff to Payroll</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Full Name"
                value={newStaff.name}
                onChange={(e) => setNewStaff((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <select
                value={newStaff.role}
                onChange={(e) => setNewStaff((p) => ({ ...p, role: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Bank Name"
                value={newStaff.bank}
                onChange={(e) => setNewStaff((p) => ({ ...p, bank: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <input
                type="text"
                placeholder="Account Number"
                value={newStaff.account}
                onChange={(e) => setNewStaff((p) => ({ ...p, account: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <input
                type="number"
                placeholder="Daily Rate (₦)"
                value={newStaff.salary}
                onChange={(e) => setNewStaff((p) => ({ ...p, salary: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={addStaff}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-amber-500 text-black font-bold rounded-xl text-sm hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add to Payroll'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
