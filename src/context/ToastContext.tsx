import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface AppToast {
  id: string
  variant: ToastVariant
  title: string
  message?: string
}

interface ToastContextValue {
  toast: {
    success: (title: string, message?: string) => void
    error: (title: string, message?: string) => void
    warning: (title: string, message?: string) => void
    info: (title: string, message?: string) => void
  }
}

const ToastContext = createContext<ToastContextValue | null>(null)

const STYLES: Record<ToastVariant, { border: string; bg: string; icon: string }> = {
  success: { border: 'border-green-500/50', bg: 'bg-green-500/10', icon: 'text-green-400' },
  error: { border: 'border-red-500/50', bg: 'bg-red-500/10', icon: 'text-red-400' },
  warning: { border: 'border-amber-500/50', bg: 'bg-amber-500/10', icon: 'text-amber-400' },
  info: { border: 'border-blue-500/50', bg: 'bg-blue-500/10', icon: 'text-blue-400' },
}

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 3_500,
  error: 6_000,
  warning: 5_000,
  info: 4_000,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<AppToast[]>([])

  const add = useCallback((variant: ToastVariant, title: string, message?: string) => {
    const id = String(Date.now() + Math.random())
    setToasts((prev) => [...prev, { id, variant, title, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, AUTO_DISMISS_MS[variant])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = {
    success: (title: string, message?: string) => add('success', title, message),
    error: (title: string, message?: string) => add('error', title, message),
    warning: (title: string, message?: string) => add('warning', title, message),
    info: (title: string, message?: string) => add('info', title, message),
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {toasts.map((t) => {
            const Icon = ICONS[t.variant]
            const s = STYLES[t.variant]
            return (
              <div
                key={t.id}
                className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border ${s.border} ${s.bg} backdrop-blur-sm shadow-lg`}
                style={{ animation: 'slideIn 0.2s ease-out' }}
              >
                <Icon size={18} className={`mt-0.5 flex-shrink-0 ${s.icon}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm">{t.title}</p>
                  {t.message && <p className="text-gray-300 text-xs mt-0.5">{t.message}</p>}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="flex-shrink-0 text-gray-500 hover:text-white transition-colors mt-0.5"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(1rem) } to { opacity:1; transform:translateX(0) } }`}</style>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue['toast'] {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}
