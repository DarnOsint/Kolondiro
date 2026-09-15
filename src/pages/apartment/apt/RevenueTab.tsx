import { fmtShort, fmtDate } from './types'
import type { RoomStay, ServiceOrder } from './types'

interface Props {
  stays: RoomStay[]
  serviceOrders: ServiceOrder[]
  rooms: { id: string }[]
}

export default function RevenueTab({ stays, serviceOrders, rooms }: Props) {
  const now = new Date()
  const thisMonthStays = stays.filter((s) => {
    const d = new Date(s.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const monthRevenue = thisMonthStays.reduce((s, st) => s + (st.amount_paid || 0), 0)
  const allRevenue = stays.reduce((s, st) => s + (st.amount_paid || 0), 0)
  const checkedOut = stays.filter((s) => s.status === 'checked_out')
  const activeStays = stays.filter((s) => s.status === 'active')
  const totalOutstanding = activeStays.reduce(
    (s, st) => s + Math.max(0, (st.total_amount || 0) - (st.amount_paid || 0)),
    0
  )
  const adr = checkedOut.length
    ? Math.round(
        checkedOut.reduce((s, st) => {
          const n =
            Math.ceil(
              (new Date(st.check_out_date).getTime() - new Date(st.check_in_date).getTime()) /
                86400000
            ) || 1
          return s + (st.amount_paid || 0) / n
        }, 0) / checkedOut.length
      )
    : 0
  const revpar = rooms.length ? Math.round(monthRevenue / rooms.length) : 0

  const monthlyRevenue = Array.from({ length: 6 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (5 - i))
    const label = d.toLocaleDateString('en-NG', { month: 'short' })
    const rev = stays
      .filter((s) => {
        const sd = new Date(s.created_at)
        return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear()
      })
      .reduce((s, st) => s + (st.amount_paid || 0), 0)
    return { label, rev }
  })
  const maxMonthRev = Math.max(...monthlyRevenue.map((m) => m.rev), 1)

  const cards = [
    {
      label: 'This Month',
      value: fmtShort(monthRevenue),
      sub: `${thisMonthStays.length} bookings`,
      color: 'text-amber-400',
    },
    {
      label: 'All Time',
      value: fmtShort(allRevenue),
      sub: `${stays.length} stays`,
      color: 'text-white',
    },
    { label: 'ADR', value: fmtShort(adr), sub: 'Avg daily rate', color: 'text-blue-400' },
    {
      label: 'RevPAR',
      value: fmtShort(revpar),
      sub: 'Rev/available room',
      color: 'text-purple-400',
    },
    {
      label: 'Outstanding',
      value: fmtShort(totalOutstanding),
      sub: 'Unpaid balances',
      color: totalOutstanding > 0 ? 'text-red-400' : 'text-green-400',
    },
    {
      label: 'Room Service',
      value: fmtShort(serviceOrders.reduce((s, o) => s + (o.total_amount || 0), 0)),
      sub: 'Total',
      color: 'text-white',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">{c.label}</p>
            <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
            <p className="text-gray-600 text-xs mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">
          Monthly Revenue (6 months)
        </p>
        <div className="flex items-end gap-2 h-28">
          {monthlyRevenue.map(({ label, rev }) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <p className="text-amber-400 text-[9px] font-bold">
                {rev > 0 ? fmtShort(rev).replace('₦', '') : ''}
              </p>
              <div className="w-full bg-gray-800 rounded-t-lg relative" style={{ height: 72 }}>
                <div
                  className="absolute bottom-0 w-full bg-amber-500 rounded-t-lg transition-all duration-500"
                  style={{ height: `${Math.round((rev / maxMonthRev) * 100)}%` }}
                />
              </div>
              <p className="text-gray-500 text-[10px]">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent stays */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <p className="text-white font-semibold text-sm px-4 py-3 border-b border-gray-800">
          Recent Stays
        </p>
        {stays.slice(0, 15).map((stay, i) => (
          <div
            key={stay.id}
            className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-gray-800/60' : ''}`}
          >
            <div>
              <p className="text-white text-sm font-medium">{stay.guest_name}</p>
              <p className="text-gray-500 text-xs">
                Room {stay.rooms?.room_number} · {fmtDate(stay.check_in_date)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-amber-400 font-bold text-sm">{fmtShort(stay.amount_paid)}</p>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${stay.status === 'active' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}
              >
                {stay.status === 'active' ? 'Active' : 'Checked Out'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
