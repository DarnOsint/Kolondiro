import { useState, useEffect, useCallback } from 'react'
import { Package, RefreshCw, Search, Download, Filter, Check, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { audit } from '../../../lib/audit'
import { sendPushToStaff } from '../../../hooks/usePushNotifications'
import type { Profile } from '../../../types'

interface InventoryItem {
  id: string
  item_name: string
  category: string | null
  unit: string
  current_stock: number
  minimum_stock: number
  cost_price: number | null
}

interface StoreRequest {
  id: string
  item_name: string
  inventory_id: string | null
  quantity: number
  unit: string
  requested_by: string | null
  requested_by_name: string | null
  status: string
  approved_by_name: string | null
  reject_reason: string | null
  reason: string | null
  created_at: string
  resolved_at: string | null
}

interface Props {
  filterLow?: boolean
  onClearFilterLow?: () => void
}

const todayWAT = () => {
  const now = new Date()
  const wat = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

export default function MainStoreSummaryTab({ filterLow = false, onClearFilterLow }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [view, setView] = useState<'inventory' | 'requests'>(filterLow ? 'inventory' : 'inventory')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [requests, setRequests] = useState<StoreRequest[]>([])
  const [search, setSearch] = useState('')
  const [date, setDate] = useState(todayWAT())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const fetchData = useCallback(async () => {
    setLoading(true)
    const dayStart = new Date(date + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [{ data: inv }, { data: reqs }] = await Promise.all([
      supabase
        .from('inventory')
        .select('id, item_name, category, unit, current_stock, minimum_stock, cost_price')
        .eq('is_active', true)
        .order('current_stock', { ascending: false }),
      supabase
        .from('store_requests')
        .select(
          'id, item_name, inventory_id, quantity, unit, requested_by, requested_by_name, status, approved_by_name, reject_reason, reason, created_at, resolved_at'
        )
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false }),
    ])
    setItems((inv || []) as InventoryItem[])
    setRequests((reqs || []) as StoreRequest[])
    setLoading(false)
  }, [date])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('mgmt-store')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_requests' }, fetchData)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const filtered = items.filter((i) => {
    const matchSearch =
      i.item_name.toLowerCase().includes(search.toLowerCase()) ||
      (i.category || '').toLowerCase().includes(search.toLowerCase())
    const matchLow = !filterLow || i.current_stock <= i.minimum_stock
    return matchSearch && matchLow
  })

  const outOfStock = items.filter((i) => i.current_stock <= 0).length
  const lowStock = items.filter(
    (i) => i.current_stock > 0 && i.current_stock <= i.minimum_stock
  ).length
  const totalValue = items.reduce((s, i) => s + (i.current_stock || 0) * (i.cost_price || 0), 0)

  const approvedReqs = requests.filter((r) => r.status === 'approved')
  const rejectedReqs = requests.filter((r) => r.status === 'rejected')
  const pendingReqs = requests.filter((r) => r.status === 'pending')
  const totalMoved = approvedReqs.reduce((s, r) => s + r.quantity, 0)

  const byRequester: Record<string, { count: number; qty: number }> = {}
  approvedReqs.forEach((r) => {
    const name = r.requested_by_name || 'Unknown'
    if (!byRequester[name]) byRequester[name] = { count: 0, qty: 0 }
    byRequester[name].count++
    byRequester[name].qty += r.quantity
  })

  const approveRequest = async (req: StoreRequest) => {
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('approve_store_request', {
        req_id: req.id,
        approver_name: profile?.full_name ?? null,
      })
      if (error) throw error
      if (!data || (data as any)?.status !== 'approved') {
        toast.info('Already handled')
        setSaving(false)
        return
      }

      await audit({
        action: 'STORE_REQUEST_APPROVED',
        entity: 'store_requests',
        entityId: req.id,
        entityName: req.item_name,
        newValue: {
          quantity: req.quantity,
          unit: req.unit,
          requested_by: req.requested_by_name,
          approved_by: profile?.full_name,
        },
        performer: profile as Profile,
      })

      if (req.requested_by)
        sendPushToStaff(
          req.requested_by,
          '✅ Request Approved',
          `${req.quantity}x ${req.item_name} released to chiller`
        ).catch(() => {})
      toast.success('Approved', `${req.quantity} ${req.unit} of ${req.item_name} sent to chiller`)
      fetchData()
    } catch (e: any) {
      toast.error('Error', e?.message || 'Failed to approve')
    }
    setSaving(false)
  }

  const rejectRequest = async (req: StoreRequest, reason: string) => {
    setSaving(true)
    try {
      await supabase
        .from('store_requests')
        .update({
          status: 'rejected',
          approved_by: profile?.id ?? null,
          approved_by_name: profile?.full_name ?? null,
          reject_reason: reason || 'Rejected by manager',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', req.id)

      await audit({
        action: 'STORE_REQUEST_REJECTED',
        entity: 'store_requests',
        entityId: req.id,
        entityName: req.item_name,
        newValue: { quantity: req.quantity, rejected_by: profile?.full_name, reason },
        performer: profile as Profile,
      })

      if (req.requested_by)
        sendPushToStaff(
          req.requested_by,
          '❌ Request Rejected',
          `${req.item_name} — ${reason || 'No reason'}`
        ).catch(() => {})
      toast.success('Rejected', `Request for ${req.item_name} rejected`)
      setRejectingId(null)
      setRejectReason('')
      fetchData()
    } catch (e: any) {
      toast.error('Error', e?.message || 'Failed to reject')
    }
    setSaving(false)
  }

  const exportCsv = () => {
    const lines = [
      ['Time', 'Item', 'Qty', 'Unit', 'Requested By', 'Status', 'Approved By', 'Reject Reason'],
      ...requests.map((r) => [
        new Date(r.created_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }),
        r.item_name,
        String(r.quantity),
        r.unit,
        r.requested_by_name || '',
        r.status,
        r.approved_by_name || '',
        r.reject_reason || '',
      ]),
    ]
    const csv = lines
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `store_requests_${date}.csv`
    a.click()
  }

  const elapsed = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.floor(hrs / 24)}d`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setView('inventory')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${view === 'inventory' ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Inventory
        </button>
        <button
          onClick={() => setView('requests')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${view === 'requests' ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Store Requests
          {pendingReqs.length > 0 && isManager && (
            <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pendingReqs.length}
            </span>
          )}
        </button>
        {filterLow && (
          <button
            onClick={() => onClearFilterLow?.()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            <Filter size={14} /> Low Stock Active
          </button>
        )}
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : view === 'inventory' ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              {
                label: 'Total Items',
                value: filterLow ? filtered.length : items.length,
                color: 'text-white',
              },
              {
                label: 'Out of Stock',
                value: filterLow ? filtered.filter((i) => i.current_stock <= 0).length : outOfStock,
                color: outOfStock > 0 ? 'text-red-400' : 'text-green-400',
              },
              {
                label: 'Low Stock',
                value: lowStock,
                color: lowStock > 0 ? 'text-amber-400' : 'text-green-400',
              },
              {
                label: 'Stock Value',
                value: `₦${totalValue.toLocaleString()}`,
                color: 'text-purple-400',
              },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
              >
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-gray-500 text-[10px] uppercase tracking-wider">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder={filterLow ? 'Search low stock items...' : 'Search items...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Inventory table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-left px-2 py-2">Category</th>
                  <th className="text-right px-2 py-2">Stock</th>
                  <th className="text-right px-2 py-2">Min</th>
                  <th className="text-left px-2 py-2">Unit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="text-white px-3 py-2 font-medium">{item.item_name}</td>
                    <td className="text-gray-400 px-2 py-2">{item.category || '—'}</td>
                    <td
                      className={`text-right px-2 py-2 font-bold ${item.current_stock <= 0 ? 'text-red-400' : item.current_stock <= item.minimum_stock ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      {item.current_stock}
                    </td>
                    <td className="text-gray-500 text-right px-2 py-2">{item.minimum_stock}</td>
                    <td className="text-gray-500 px-2 py-2">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* Date picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={date}
              max={todayWAT()}
              onChange={(e) => setDate(e.target.value)}
              className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1.5"
            />
            <button
              onClick={() => setDate(todayWAT())}
              className={`px-2 py-1.5 text-xs rounded-lg ${date === todayWAT() ? 'bg-amber-500 text-black font-bold' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
            >
              Today
            </button>
            <button
              onClick={() => {
                const d = new Date(date)
                d.setDate(d.getDate() - 1)
                setDate(d.toLocaleDateString('en-CA'))
              }}
              className="px-2 py-1.5 text-xs bg-gray-900 text-gray-400 border border-gray-800 rounded-lg"
            >
              Prev Day
            </button>
            {requests.length > 0 && (
              <button
                onClick={exportCsv}
                className="ml-auto p-1.5 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg"
              >
                <Download size={14} />
              </button>
            )}
          </div>

          {/* Request summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Total Requests', value: requests.length, color: 'text-white' },
              {
                label: 'Approved',
                value: approvedReqs.length,
                color: 'text-green-400',
              },
              {
                label: 'Rejected',
                value: rejectedReqs.length,
                color: rejectedReqs.length > 0 ? 'text-red-400' : 'text-gray-400',
              },
              { label: 'Items Moved', value: totalMoved, color: 'text-blue-400' },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
              >
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-gray-500 text-[10px] uppercase tracking-wider">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Pending approvals (manager only) */}
          {isManager && pendingReqs.length > 0 && (
            <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-4">
              <h4 className="text-amber-400 text-sm font-bold mb-3 flex items-center gap-2">
                <Package size={14} /> Pending Approval ({pendingReqs.length})
              </h4>
              <div className="space-y-2">
                {pendingReqs.map((req) => (
                  <div
                    key={req.id}
                    className="bg-gray-800/50 border border-gray-700 rounded-xl p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-white text-sm font-bold">
                          {req.quantity} {req.unit} of {req.item_name}
                        </p>
                        <p className="text-gray-400 text-xs">
                          by {req.requested_by_name || 'Unknown'} · {elapsed(req.created_at)} ago
                        </p>
                        {req.reason && (
                          <p className="text-gray-500 text-xs italic mt-1">{req.reason}</p>
                        )}
                      </div>
                    </div>
                    {rejectingId === req.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Reason for rejection"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs"
                          autoFocus
                        />
                        <button
                          onClick={() => rejectRequest(req, rejectReason)}
                          disabled={saving}
                          className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => {
                            setRejectingId(null)
                            setRejectReason('')
                          }}
                          className="px-2 py-1.5 bg-gray-800 text-gray-400 rounded-lg text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => approveRequest(req)}
                          disabled={saving}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-xs py-2 rounded-xl"
                        >
                          <Check size={13} /> Approve
                        </button>
                        <button
                          onClick={() => setRejectingId(req.id)}
                          disabled={saving}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-xs py-2 rounded-xl"
                        >
                          <X size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Who took what */}
          {Object.keys(byRequester).length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h4 className="text-white text-sm font-bold mb-2">Who took what (approved)</h4>
              <div className="space-y-1.5">
                {Object.entries(byRequester)
                  .sort((a, b) => b[1].qty - a[1].qty)
                  .map(([name, v]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between py-1 border-b border-gray-800 last:border-0"
                    >
                      <span className="text-gray-300 text-sm">{name}</span>
                      <span className="text-amber-400 text-sm font-bold">
                        {v.qty} items ({v.count} request{v.count > 1 ? 's' : ''})
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Requests list */}
          {requests.length === 0 ? (
            <div className="text-center py-8">
              <Package size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No store requests for this date</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-2 py-2">Item</th>
                    <th className="text-right px-2 py-2">Qty</th>
                    <th className="text-left px-2 py-2">By</th>
                    <th className="text-left px-2 py-2">Status</th>
                    <th className="text-left px-2 py-2">Approved By</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="text-gray-400 px-3 py-2">
                        {new Date(r.created_at).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Africa/Lagos',
                        })}
                      </td>
                      <td className="text-white px-2 py-2 font-medium">{r.item_name}</td>
                      <td className="text-blue-400 text-right px-2 py-2 font-bold">{r.quantity}</td>
                      <td className="text-gray-300 px-2 py-2">{r.requested_by_name || '—'}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${r.status === 'approved' ? 'bg-green-500/20 text-green-400' : r.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="text-gray-400 px-2 py-2">{r.approved_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
