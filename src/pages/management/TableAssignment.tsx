import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { X, Users, UserPlus, UserMinus } from 'lucide-react'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { audit } from '../../lib/audit'

interface CategoryColors {
  card: string
  text: string
  badge: string
}

const categoryColors: Record<string, CategoryColors> = {
  Outdoor: {
    card: 'bg-green-500/10 border-green-500/20',
    text: 'text-green-400',
    badge: 'bg-green-500/20 text-green-300',
  },
  Indoor: {
    card: 'bg-blue-500/10 border-blue-500/20',
    text: 'text-blue-400',
    badge: 'bg-blue-500/20 text-blue-300',
  },
  'VIP Lounge': {
    card: 'bg-amber-500/10 border-amber-500/20',
    text: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-300',
  },
  'The Nook': {
    card: 'bg-purple-500/10 border-purple-500/20',
    text: 'text-purple-400',
    badge: 'bg-purple-500/20 text-purple-300',
  },
}

interface TableRow {
  id: string
  status: string
}
interface Category {
  id: string
  name: string
  tables?: TableRow[]
}
interface StaffMember {
  id: string
  full_name: string
  role: string
}
interface Assignment {
  id: string
  staff_id: string
  category_id: string
  profiles?: { id: string; full_name: string }
}

interface Props {
  onClose?: () => void
}

export default function TableAssignment({ onClose }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [assignments, setAssignments] = useState<Record<string, Assignment[]>>({})
  const [selectedStaff, setSelectedStaff] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const { profile } = useAuth()
  const [staffSearch, setStaffSearch] = useState('')

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('table_categories')
      .select('*, tables(id, status)')
      .order('name')
    if (data) setCategories(data)
  }

  const fetchActiveStaff = async () => {
    // Use open attendance regardless of date (overnight)
    const { data: attendance } = await supabase
      .from('attendance')
      .select('staff_id')
      .or('clock_out.is.null')
    if (!attendance || attendance.length === 0) {
      setStaff([])
      return
    }
    const staffIds = attendance.map((a: { staff_id: string }) => a.staff_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('id', staffIds)
      .eq('role', 'waitron')
      .eq('is_active', true)
    setStaff(profiles || [])
  }

  const fetchAssignments = useCallback(async () => {
    const { data } = await supabase
      .from('zone_assignments')
      .select('*, profiles(id, full_name)')
      .eq('is_active', true)
    if (data) {
      const map: Record<string, Assignment[]> = {}
      data.forEach((a: Assignment) => {
        if (!map[a.category_id]) map[a.category_id] = []
        map[a.category_id].push(a)
      })
      setAssignments(map)
    }
  }, [])

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchCategories(), fetchActiveStaff(), fetchAssignments()])
    setLoading(false)
  }, [fetchAssignments])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const addStaffToZone = async (categoryId: string) => {
    const staffId = selectedStaff[categoryId]
    if (!staffId) return
    const existing = assignments[categoryId] || []
    if (existing.find((a) => a.staff_id === staffId)) {
      toast.warning('Already Assigned', 'This staff member is already assigned to this zone')
      return
    }
    const { error } = await supabase
      .from('zone_assignments')
      .insert({ category_id: categoryId, staff_id: staffId, is_active: true })
    if (!error) {
      void audit({
        action: 'ASSIGN_ZONE',
        entity: 'zone_assignments',
        entityName: categoryId,
        newValue: { staff_id: staffId, category_id: categoryId },
        performer: profile as import('../../types').Profile,
      })
      setSelectedStaff((prev) => ({ ...prev, [categoryId]: '' }))
      fetchAssignments()
    }
  }

  const removeStaffFromZone = async (assignmentId: string) => {
    const { error } = await supabase.from('zone_assignments').delete().eq('id', assignmentId)
    if (error) {
      toast.error('Error', 'Failed to remove assignment: ' + error.message)
      return
    }
    void audit({
      action: 'UNASSIGN_ZONE',
      entity: 'zone_assignments',
      entityId: assignmentId,
      performer: profile as import('../../types').Profile,
    })
    fetchAssignments()
  }

  const getAvailableStaff = (categoryId: string) => {
    const assigned = (assignments[categoryId] || []).map((a) => a.staff_id)
    return staff.filter((s) => !assigned.includes(s.id))
  }

  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-white font-bold text-lg">Zone Assignment</h3>
          <p className="text-gray-400 text-xs mt-0.5">Assign waitrons to zones</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        )}
      </div>

      {staff.length === 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
          <p className="text-amber-400 text-sm">
            No waitrons on shift. Clock in staff first under Shifts tab.
          </p>
        </div>
      )}

      <input
        value={staffSearch}
        onChange={(e) => setStaffSearch(e.target.value)}
        placeholder="Search staff or zone…"
        className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-xl px-4 py-2.5 mb-4 focus:outline-none focus:border-amber-500"
      />
      <div className="space-y-4">
        {categories
          .filter(
            (cat) =>
              !staffSearch ||
              cat.name.toLowerCase().includes(staffSearch.toLowerCase()) ||
              (assignments[cat.id] || []).some((a) =>
                (a.profiles as { full_name: string } | null)?.full_name
                  ?.toLowerCase()
                  .includes(staffSearch.toLowerCase())
              )
          )
          .map((category) => {
            const colors = categoryColors[category.name] || {
              card: 'bg-gray-800 border-gray-700',
              text: 'text-gray-400',
              badge: 'bg-gray-700 text-gray-300',
            }
            const totalTables = category.tables?.length || 0
            const occupiedTables =
              category.tables?.filter((t) => t.status === 'occupied').length || 0
            const zoneAssignments = assignments[category.id] || []
            const available = getAvailableStaff(category.id)

            return (
              <div key={category.id} className={`rounded-xl border p-4 ${colors.card}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className={`font-semibold ${colors.text}`}>{category.name}</h4>
                    <p className="text-gray-500 text-xs">
                      {occupiedTables}/{totalTables} tables occupied
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Users size={14} className={colors.text} />
                    <span className={`text-xs font-medium ${colors.text}`}>
                      {zoneAssignments.length} assigned
                    </span>
                  </div>
                </div>

                {zoneAssignments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {zoneAssignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${colors.badge}`}
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        {assignment.profiles?.full_name}
                        <button
                          onClick={() => removeStaffFromZone(assignment.id)}
                          className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
                        >
                          <UserMinus size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {staff.length > 0 && available.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      value={selectedStaff[category.id] || ''}
                      onChange={(e) =>
                        setSelectedStaff((prev) => ({ ...prev, [category.id]: e.target.value }))
                      }
                      className="flex-1 bg-black/20 text-white text-sm rounded-lg px-3 py-1.5 border border-white/10 focus:outline-none focus:border-white/30"
                    >
                      <option value="">-- Add waitron --</option>
                      {available.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => addStaffToZone(category.id)}
                      disabled={!selectedStaff[category.id]}
                      className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-lg px-3 py-1.5 text-sm transition-colors"
                    >
                      <UserPlus size={14} /> Add
                    </button>
                  </div>
                )}

                {staff.length > 0 && available.length === 0 && zoneAssignments.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    All on-shift waitrons assigned to this zone
                  </p>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
