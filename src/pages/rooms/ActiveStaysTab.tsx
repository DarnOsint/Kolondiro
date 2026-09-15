import type { StayRow } from './types'

interface Props {
  stays: StayRow[]
}

export default function ActiveStaysTab({ stays }: Props) {
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  return (
    <div className="space-y-3">
      {stays.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No active stays right now</div>
      ) : (
        stays.map((stay) => {
          const hoursLeft = Math.round((new Date(stay.check_out_at).getTime() - now) / 3_600_000)
          const isOverstay = hoursLeft < 0
          return (
            <div
              key={stay.id}
              className={`bg-gray-900 border rounded-xl p-5 ${isOverstay ? 'border-red-500/30' : 'border-gray-800'}`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-white font-bold text-lg">{stay.room_name}</p>
                    {isOverstay && (
                      <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-lg">
                        ⚠️ Overstay
                      </span>
                    )}
                  </div>
                  <p className="text-amber-400 font-semibold">{stay.guest_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-xl">
                    ₦{stay.total_amount?.toLocaleString()}
                  </p>
                  <p className="text-gray-500 text-xs capitalize">{stay.payment_method}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                {[
                  { label: 'Phone', value: stay.guest_phone },
                  {
                    label: 'Guests',
                    value: `${stay.num_guests} person${stay.num_guests > 1 ? 's' : ''}`,
                  },
                  {
                    label: 'Check-in',
                    value: new Date(stay.check_in_at).toLocaleString('en-NG', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                  {
                    label: 'Check-out Due',
                    value: new Date(stay.check_out_at).toLocaleString('en-NG', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                  { label: 'Nights', value: stay.nights },
                  { label: 'Rate/Night', value: `₦${stay.rate_per_night?.toLocaleString()}` },
                  { label: 'ID Type', value: stay.id_type },
                  { label: 'ID Number', value: stay.id_number },
                ].map((f) => (
                  <div key={f.label} className="bg-gray-800 rounded-lg px-3 py-2">
                    <p className="text-gray-500">{f.label}</p>
                    <p className="text-white font-medium">{f.value || '—'}</p>
                  </div>
                ))}
              </div>
              <div
                className={`text-sm font-medium ${isOverstay ? 'text-red-400' : hoursLeft < 6 ? 'text-amber-400' : 'text-green-400'}`}
              >
                {isOverstay
                  ? `⚠️ ${Math.abs(hoursLeft)} hours overdue`
                  : `✅ ${hoursLeft} hours remaining`}
              </div>
              {stay.notes && <p className="text-gray-500 text-xs mt-2">📝 {stay.notes}</p>}
            </div>
          )
        })
      )}
    </div>
  )
}
