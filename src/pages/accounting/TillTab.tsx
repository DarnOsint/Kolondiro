import type { TillSession } from './types'

interface Props {
  tillSessions: TillSession[]
}

export default function TillTab({ tillSessions }: Props) {
  return (
    <div className="space-y-3">
      {tillSessions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          No till sessions for this period
        </div>
      ) : (
        tillSessions.map((session) => (
          <div key={session.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-white font-semibold">
                  {session.profiles?.full_name || 'Unknown'}
                </p>
                <p className="text-gray-500 text-xs">
                  {new Date(session.opened_at).toLocaleString('en-NG', {
                    timeZone: 'Africa/Lagos',
                  })}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-1 rounded-lg ${session.status === 'open' ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}
              >
                {session.status}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
              {[
                { label: 'Opening Float', value: session.opening_float },
                { label: 'Closing Float', value: session.closing_float },
                { label: 'Expected Cash', value: session.expected_cash },
              ].map((item) => (
                <div key={item.label} className="bg-gray-800 rounded-lg p-3">
                  <p className="text-gray-500 text-xs">{item.label}</p>
                  <p className="text-white font-bold">₦{(item.value || 0).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
