import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TrendPoint } from './types'

interface Props {
  trendData: TrendPoint[]
}

export default function TrendsTab({ trendData }: Props) {
  const empty = <div className="text-center py-12 text-gray-500">No trend data available</div>
  const tooltipStyle = { background: '#111827', border: '1px solid #374151', borderRadius: '8px' }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">Revenue Trend — Last 30 Days</h3>
        {trendData.length === 0 ? (
          empty
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: '#fff' }}
                formatter={(v: number) => [`₦${v.toLocaleString()}`, 'Revenue']}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ fill: '#f59e0b', r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">Orders per Day — Last 30 Days</h3>
        {trendData.length === 0 ? (
          empty
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'Orders']} />
              <Bar dataKey="orders" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
