import { Phone } from 'lucide-react'
import type { StaffMember } from './types'

interface Props {
  staff: StaffMember[]
}

export default function StaffTab({ staff }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
        Staff ({staff.length})
      </p>
      {staff.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">
          No staff records. Add via Back Office.
        </div>
      ) : (
        staff.map((s) => (
          <div
            key={s.id}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center shrink-0">
              <span className="text-amber-400 font-bold">{s.full_name?.charAt(0) || '?'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold">{s.full_name}</p>
              <p className="text-gray-500 text-xs capitalize">{s.role}</p>
              {s.phone && (
                <p className="text-gray-500 text-xs flex items-center gap-1 mt-0.5">
                  <Phone size={9} />
                  {s.phone}
                </p>
              )}
            </div>
            {s.hire_date && (
              <p className="text-gray-600 text-xs shrink-0">
                Since{' '}
                {new Date(s.hire_date).toLocaleDateString('en-GB', {
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  )
}
