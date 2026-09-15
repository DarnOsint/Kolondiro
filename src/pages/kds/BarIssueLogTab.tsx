import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface IssueEntry {
  id: string
  issue_date: string
  order_id: string
  order_item_id: string
  table_name: string | null
  waitron_name: string | null
  item_name: string
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

interface ReturnEntry {
  id: string
  order_id: string
  order_item_id: string
  table_name: string | null
  waitron_name: string | null
  item_name: string
  quantity: number
  item_total: number
  requested_at: string
  resolved_at: string | null
  status: string
}

interface WaitronLogEntry {
  id: string
  kind: 'issued' | 'returned'
  order_id: string
  item_name: string
  quantity: number
  total_price: number
  unit_price: number
  table_name: string | null
  at: string
}

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

const buildIssueFallback = (
  d: string,
  rows: Array<{
    id: string
    order_id: string
    quantity: number
    unit_price: number | null
    total_price: number | null
    created_at: string
    menu_items?: { name?: string | null } | null
    orders?: {
      tables?: { name?: string | null } | null
      profiles?: { full_name?: string | null } | null
    } | null
  }>
): IssueEntry[] =>
  rows.map((row) => ({
    id: `fallback-${row.id}`,
    issue_date: d,
    order_id: row.order_id,
    order_item_id: row.id,
    table_name: row.orders?.tables?.name || null,
    waitron_name: row.orders?.profiles?.full_name || null,
    item_name: row.menu_items?.name || 'Item',
    quantity: row.quantity || 0,
    unit_price: row.unit_price || 0,
    total_price: row.total_price || 0,
    created_at: row.created_at,
  }))

export default function BarIssueLogTab() {
  const [date, setDate] = useState(todayWAT())
  const [loading, setLoading] = useState(true)
  const [issueLog, setIssueLog] = useState<IssueEntry[]>([])
  const [returnLog, setReturnLog] = useState<ReturnEntry[]>([])
  const [issueLogAvailable, setIssueLogAvailable] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const loadIssueLog = useCallback(async (d: string) => {
    setLoading(true)
    const dayStart = new Date(d + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [{ data, error }, { data: returnsData, error: returnsErr }] = await Promise.all([
      supabase
        .from('bar_issue_log')
        .select(
          'id, issue_date, order_id, order_item_id, table_name, waitron_name, item_name, quantity, unit_price, total_price, created_at'
        )
        .eq('issue_date', d)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('returns_log')
        .select(
          'id, order_id, order_item_id, table_name, waitron_name, item_name, quantity, item_total, requested_at, resolved_at, status'
        )
        .eq('status', 'accepted')
        .gte('resolved_at', dayStart.toISOString())
        .lt('resolved_at', dayEnd.toISOString())
        .order('resolved_at', { ascending: false }),
    ])

    if (!returnsErr) {
      setReturnLog((returnsData || []) as ReturnEntry[])
    } else {
      console.warn('returns_log fetch failed:', returnsErr.message)
      setReturnLog([])
    }

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        setIssueLogAvailable(false)
        setIssueLog([])
        setLoading(false)
        return
      }
      console.warn('bar_issue_log fetch failed:', error.message)
      setIssueLog([])
      setLoading(false)
      return
    }

    setIssueLogAvailable(true)
    if (data && data.length > 0) {
      setIssueLog((data || []) as IssueEntry[])
      setLoading(false)
      return
    }

    const { data: fallbackRows, error: fallbackErr } = await supabase
      .from('order_items')
      .select(
        'id, order_id, quantity, unit_price, total_price, created_at, menu_items(name), orders(tables(name), profiles(full_name))'
      )
      .eq('destination', 'bar')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())
      .order('created_at', { ascending: false })

    if (fallbackErr) {
      console.warn('bar issue fallback fetch failed:', fallbackErr.message)
      setIssueLog([])
      setLoading(false)
      return
    }

    setIssueLog(
      buildIssueFallback(
        d,
        (fallbackRows || []) as Array<{
          id: string
          order_id: string
          quantity: number
          unit_price: number | null
          total_price: number | null
          created_at: string
          menu_items?: { name?: string | null } | null
          orders?: {
            tables?: { name?: string | null } | null
            profiles?: { full_name?: string | null } | null
          } | null
        }>
      )
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadIssueLog(date)
  }, [date, loadIssueLog])

  const totalIssuedQty = issueLog.reduce((sum, entry) => sum + (entry.quantity || 0), 0)
  const totalReturnedQty = returnLog.reduce((sum, entry) => sum + (entry.quantity || 0), 0)
  const waitronGroups = useMemo(() => {
    const grouped: Record<string, WaitronLogEntry[]> = {}

    for (const entry of issueLog) {
      const key = entry.waitron_name || 'Unknown Waitron'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push({
        id: entry.id,
        kind: 'issued',
        order_id: entry.order_id,
        item_name: entry.item_name,
        quantity: entry.quantity,
        total_price: entry.total_price,
        unit_price: entry.unit_price,
        table_name: entry.table_name,
        at: entry.created_at,
      })
    }

    for (const entry of returnLog) {
      const key = entry.waitron_name || 'Unknown Waitron'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push({
        id: `returned-${entry.id}`,
        kind: 'returned',
        order_id: entry.order_id,
        item_name: entry.item_name,
        quantity: entry.quantity,
        total_price: entry.item_total,
        unit_price: entry.quantity > 0 ? (entry.item_total || 0) / entry.quantity : 0,
        table_name: entry.table_name,
        at: entry.resolved_at || entry.requested_at,
      })
    }

    return Object.entries(grouped)
      .map(([waitronName, entries]) => ({
        waitronName,
        entries: entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
      }))
      .sort((a, b) => a.waitronName.localeCompare(b.waitronName))
  }, [issueLog, returnLog])

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev }
      for (const group of waitronGroups) {
        if (!(group.waitronName in next)) next[group.waitronName] = false
      }
      return next
    })
  }, [waitronGroups])

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <input
            type="date"
            value={date}
            max={todayWAT()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2">
            <p className="text-amber-400 text-lg font-bold">{totalIssuedQty}</p>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">qty issued</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2">
            <p className="text-red-400 text-lg font-bold">{totalReturnedQty}</p>
            <p className="text-gray-500 text-[10px] uppercase tracking-wider">qty returned</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="mb-4">
            <p className="text-white text-sm font-semibold">Waitron Issue Log</p>
            <p className="text-gray-500 text-xs">
              Drinks issued from chiller to waitrons for {date}
            </p>
          </div>

          {!issueLogAvailable ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <p className="text-amber-400 text-xs font-medium">
                `bar_issue_log` is not in the database yet.
              </p>
            </div>
          ) : loading ? (
            <p className="text-gray-500 text-sm">Loading issue log...</p>
          ) : waitronGroups.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No bar issues or accepted returns logged for this date.
            </p>
          ) : (
            <div className="space-y-3">
              {waitronGroups.map(({ waitronName, entries }) => {
                const isOpen = expanded[waitronName] || false
                const issuedQty = entries
                  .filter((entry) => entry.kind === 'issued')
                  .reduce((sum, entry) => sum + (entry.quantity || 0), 0)
                const returnedQty = entries
                  .filter((entry) => entry.kind === 'returned')
                  .reduce((sum, entry) => sum + (entry.quantity || 0), 0)
                return (
                  <div
                    key={waitronName}
                    className="bg-gray-800/60 border border-gray-800 rounded-xl"
                  >
                    <button
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [waitronName]: !prev[waitronName] }))
                      }
                      className="w-full flex items-center justify-between px-3 py-3 text-left"
                    >
                      <div>
                        <p className="text-white text-sm font-semibold">{waitronName}</p>
                        <p className="text-gray-500 text-xs">
                          {entries.length} log row(s) · Issued {issuedQty} · Returned {returnedQty}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-blue-400 text-sm font-bold">{issuedQty}</p>
                          {returnedQty > 0 && (
                            <p className="text-red-400 text-xs font-medium">
                              Returned {returnedQty}
                            </p>
                          )}
                        </div>
                        {isOpen ? (
                          <ChevronUp size={16} className="text-gray-500" />
                        ) : (
                          <ChevronDown size={16} className="text-gray-500" />
                        )}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-gray-800 border-t border-gray-800">
                        {entries.map((entry) => (
                          <div key={entry.id} className="px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p
                                  className={`text-sm font-medium ${
                                    entry.kind === 'returned' ? 'text-red-300' : 'text-white'
                                  }`}
                                >
                                  {entry.kind === 'returned' ? 'Returned ' : ''}
                                  {entry.quantity}x {entry.item_name}
                                </p>
                                <p className="text-gray-500 text-xs">
                                  {entry.table_name || 'No table'} · Order #
                                  {entry.order_id.slice(0, 8).toUpperCase()} ·{' '}
                                  {new Date(entry.at).toLocaleTimeString('en-NG', {
                                    timeZone: 'Africa/Lagos',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true,
                                  })}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p
                                  className={`text-sm font-bold ${
                                    entry.kind === 'returned' ? 'text-red-400' : 'text-amber-400'
                                  }`}
                                >
                                  ₦{(entry.total_price || 0).toLocaleString()}
                                </p>
                                <p className="text-gray-500 text-[11px]">
                                  ₦{(entry.unit_price || 0).toLocaleString()} each
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
