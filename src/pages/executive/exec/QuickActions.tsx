import { useNavigate } from 'react-router-dom'
import { BookOpen, BarChart2, Settings, Users, BedDouble } from 'lucide-react'

const ACTIONS = [
  { label: 'Accounting', icon: BookOpen, color: 'bg-green-600', path: '/accounting' },
  { label: 'Reports', icon: BarChart2, color: 'bg-indigo-500', path: '/reports' },
  { label: 'Back Office', icon: Settings, color: 'bg-amber-500', path: '/backoffice' },
  { label: 'Management', icon: Users, color: 'bg-blue-500', path: '/management' },
  { label: 'View Rooms', icon: BedDouble, color: 'bg-purple-500', path: '/rooms' },
]

export default function QuickActions() {
  const navigate = useNavigate()
  return (
    <div className="mb-8">
      <h3 className="text-white font-semibold text-sm md:text-base mb-4">Quick Actions</h3>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.path)}
            className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 flex flex-col items-center gap-2 hover:border-gray-600 transition-colors"
          >
            <div
              className={`w-9 h-9 md:w-10 md:h-10 ${a.color} rounded-lg flex items-center justify-center`}
            >
              <a.icon size={16} className="text-white" />
            </div>
            <span className="text-gray-300 text-xs md:text-sm text-center">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
