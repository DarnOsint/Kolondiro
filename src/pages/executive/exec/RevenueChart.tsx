import { useNavigate } from 'react-router-dom'
import type { TrendDay } from './types'

interface Props {
  trendData: TrendDay[]
}

export default function RevenueChart({ trendData }: Props) {
  const navigate = useNavigate()
  const maxRevenue = Math.max(...trendData.map((d) => d.revenue), 1)
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 md:p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm md:text-base">Revenue — Last 7 Days</h3>
        <button
          onClick={() => navigate('/reports')}
          className="text-amber-400 hover:text-amber-300 text-xs transition-colors"
        >
          Full report →
        </button>
      </div>
      {trendData.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm">No revenue data yet</div>
      ) : (
        <div className="flex items-end gap-2 md:gap-3 h-32">
          {trendData.map((d, i) => {
            const height = Math.max((d.revenue / maxRevenue) * 100, 2)
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <p className="text-gray-500 text-[10px]">₦{(d.revenue / 1000).toFixed(0)}k</p>
                <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                  <div
                    className="w-full bg-amber-500 rounded-t-md transition-all"
                    style={{ height: `${height}%` }}
                  />
                </div>
                <p className="text-gray-600 text-[10px] whitespace-nowrap">{d.day}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
