import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { WaitronStat } from './types'

interface Props {
  waitronStats: WaitronStat[]
}

export default function StaffTab({ waitronStats }: Props) {
  return (
    <div className="space-y-4">
      {waitronStats.length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-2 py-2">Staff</th>
                <th className="text-right px-2 py-2">Orders</th>
                <th className="text-right px-2 py-2">Revenue</th>
                <th className="text-right px-2 py-2">Avg</th>
                <th className="text-right px-3 py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {waitronStats.map((w, i) => {
                const totalRev = waitronStats.reduce((s, ws) => s + ws.revenue, 0)
                return (
                  <tr key={w.name} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="px-3 py-2 text-gray-600">{i + 1}</td>
                    <td className="px-2 py-2 text-white font-medium">{w.name}</td>
                    <td className="px-2 py-2 text-gray-300 text-right">{w.orders}</td>
                    <td className="px-2 py-2 text-amber-400 text-right font-bold">
                      ₦{w.revenue.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-gray-400 text-right">
                      ₦{Math.round(w.revenue / w.orders).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-right">
                      {totalRev ? Math.round((w.revenue / totalRev) * 100) : 0}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                <td className="px-3 py-2" colSpan={2}>
                  TOTAL
                </td>
                <td className="px-2 py-2 text-right text-white">
                  {waitronStats.reduce((s, w) => s + w.orders, 0)}
                </td>
                <td className="px-2 py-2 text-right text-amber-400">
                  ₦{waitronStats.reduce((s, w) => s + w.revenue, 0).toLocaleString()}
                </td>
                <td className="px-2 py-2" colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          No staff sales data for this period
        </div>
      )}

      {waitronStats.length > 1 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={waitronStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 9 }}
                tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                formatter={(v: number) => [`₦${v.toLocaleString()}`, 'Revenue']}
              />
              <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
