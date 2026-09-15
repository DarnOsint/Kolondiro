import { X, CheckCircle, AlertTriangle, Bell } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface Toast {
  id: string
  type: 'ready' | 'stock' | 'call'
  title: string
  message: string
  color: 'green' | 'amber' | 'blue'
}

const ICONS: Record<string, LucideIcon> = { ready: CheckCircle, stock: AlertTriangle, call: Bell }
const COLORS = {
  green: 'border-green-500/50 bg-green-500/10',
  amber: 'border-amber-500/50 bg-amber-500/10',
  blue: 'border-blue-500/50 bg-blue-500/10',
}
const ICON_COLORS = { green: 'text-green-400', amber: 'text-amber-400', blue: 'text-blue-400' }

interface Props {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

export default function NotificationToast({ toasts, onDismiss }: Props) {
  if (!toasts.length) return null
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] ?? Bell
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border ${COLORS[toast.color]} backdrop-blur-sm shadow-lg animate-slide-in`}
          >
            <Icon size={18} className={`mt-0.5 flex-shrink-0 ${ICON_COLORS[toast.color]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm">{toast.title}</p>
              <p className="text-gray-300 text-xs mt-0.5 truncate">{toast.message}</p>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-gray-500 hover:text-white flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
