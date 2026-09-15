import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { createPDF, addTable, savePDF } from '../../lib/pdfExport'
import type { AuditEntry } from './types'

interface Props {
  auditLog: AuditEntry[]
  dateRange: string
}

const ACTION_COLORS: Record<string, string> = {
  ORDER_CREATED: 'text-green-400 bg-green-500/10 border-green-500/20',
  ORDER_PAID: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  ORDER_CANCELLED: 'text-red-400 bg-red-500/10 border-red-500/20',
  STAFF_CREATED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  STAFF_UPDATED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  ITEM_VOIDED: 'text-red-400 bg-red-500/10 border-red-500/20',
}

export default function AuditTab({ auditLog, dateRange }: Props) {
  const [selected, setSelected] = useState<AuditEntry | null>(null)

  const exportPDF = () => {
    const doc = createPDF('Audit Log', dateRange)
    const body = auditLog.map((e) => [
      new Date(e.created_at).toLocaleDateString('en-NG'),
      new Date(e.created_at).toLocaleTimeString('en-NG', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
      (e.action || '').replace(/_/g, ' '),
      e.entity_name || e.entity || '',
      e.performed_by_name || 'System',
      e.performed_by_role || '',
    ])
    addTable(doc, ['Date', 'Time', 'Action', 'Entity', 'Performed By', 'Role'], body)
    savePDF(doc, `audit-log-${dateRange}-${new Date().toISOString().split('T')[0]}.pdf`)
  }

  return (
    <div className="space-y-3">
      <button
        onClick={exportPDF}
        className="w-full flex items-center justify-center gap-2 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2.5 rounded-xl transition-colors"
      >
        <Download size={12} /> Export Audit PDF
      </button>

      {auditLog.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          No audit records for this period
        </div>
      ) : (
        auditLog.map((entry) => {
          const colorClass =
            ACTION_COLORS[entry.action] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/20'
          return (
            <button
              key={entry.id}
              onClick={() => setSelected(entry)}
              className="w-full bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start justify-between gap-4 hover:border-gray-600 transition-colors text-left"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span
                  className={`text-xs px-2 py-1 rounded-lg border font-medium whitespace-nowrap ${colorClass}`}
                >
                  {entry.action.replace(/_/g, ' ')}
                </span>
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {entry.entity_name || entry.entity}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    by {entry.performed_by_name || 'System'}
                    {entry.performed_by_role && (
                      <span className="capitalize"> · {entry.performed_by_role}</span>
                    )}
                  </p>
                  {entry.new_value && (
                    <p className="text-gray-600 text-xs mt-1 truncate">
                      {Object.entries(entry.new_value)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-gray-400 text-xs">
                  {new Date(entry.created_at).toLocaleDateString('en-NG')}
                </p>
                <p className="text-gray-500 text-xs">
                  {new Date(entry.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </button>
          )
        })
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h3 className="text-white font-bold">Audit Entry</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {(
                [
                  { label: 'Action', value: selected.action.replace(/_/g, ' ') },
                  { label: 'Entity', value: selected.entity_name || selected.entity },
                  { label: 'Performed by', value: selected.performed_by_name || 'System' },
                  { label: 'Role', value: selected.performed_by_role || '—' },
                  {
                    label: 'Date',
                    value: new Date(selected.created_at).toLocaleDateString('en-NG'),
                  },
                  {
                    label: 'Time',
                    value: new Date(selected.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                ] as { label: string; value: string }[]
              ).map((row) => (
                <div key={row.label} className="flex justify-between items-start gap-4">
                  <span className="text-gray-500 text-xs">{row.label}</span>
                  <span className="text-white text-sm font-medium text-right capitalize">
                    {row.value}
                  </span>
                </div>
              ))}
              {selected.new_value &&
                Object.entries(selected.new_value).map(([k, v]) => (
                  <div key={k} className="flex justify-between items-start gap-4">
                    <span className="text-gray-500 text-xs capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-white text-sm font-medium text-right">{String(v)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
