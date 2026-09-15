import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, HelpCircle, ChevronRight, ChevronLeft } from 'lucide-react'

export interface HelpTip {
  id: string
  title: string
  description: string
  targetId?: string
}

interface Props {
  tips: HelpTip[]
  storageKey?: string
}

export function HelpTooltip({ tips, storageKey }: Props) {
  const seenKey = storageKey ? `help_seen_${storageKey}` : null
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; anchorLeft: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!seenKey) return
    if (!localStorage.getItem(seenKey)) {
      const t = setTimeout(() => setOpen(true), 600)
      return () => clearTimeout(t)
    }
  }, [seenKey])

  const current = tips[step]

  const calcPos = useCallback(() => {
    if (!open || !btnRef.current) return
    const el =
      (current?.targetId ? document.getElementById(current.targetId) : null) ?? btnRef.current
    if (!el) {
      setPos(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const viewW = window.innerWidth
    const viewH = window.innerHeight
    const cardW = Math.min(300, viewW - 32)
    let left = rect.left
    let top = rect.bottom + 10
    if (top + 220 > viewH) top = rect.top - 220 - 10
    if (left + cardW > viewW - 16) left = viewW - cardW - 16
    if (left < 16) left = 16
    setPos({ left, top, anchorLeft: rect.left + rect.width / 2 })
  }, [open, current])

  useEffect(() => {
    calcPos()
  }, [open, step, current, calcPos])
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', calcPos, true)
    window.addEventListener('resize', calcPos)
    return () => {
      window.removeEventListener('scroll', calcPos, true)
      window.removeEventListener('resize', calcPos)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step])

  const close = () => {
    setOpen(false)
    setStep(0)
    if (seenKey) localStorage.setItem(seenKey, '1')
  }
  const next = () => (step < tips.length - 1 ? setStep((s) => s + 1) : close())
  const prev = () => step > 0 && setStep((s) => s - 1)

  const tooltip =
    open &&
    pos &&
    createPortal(
      <div className="fixed inset-0 z-[9999] pointer-events-none">
        <div className="absolute inset-0 bg-black/50 pointer-events-auto" onClick={close} />
        <div
          className="absolute pointer-events-auto"
          style={{ left: pos.left, top: pos.top, width: Math.min(300, window.innerWidth - 32) }}
        >
          <div
            className="absolute -top-2 w-4 h-2 overflow-hidden"
            style={{
              left: Math.max(
                8,
                Math.min(pos.anchorLeft - pos.left - 8, Math.min(300, window.innerWidth - 32) - 24)
              ),
            }}
          >
            <div className="w-4 h-4 bg-amber-500 rotate-45 translate-y-1" />
          </div>
          <div className="bg-gray-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-amber-500 px-4 py-2.5 flex items-center justify-between">
              <span className="text-black font-bold text-sm">{current.title}</span>
              <button onClick={close} className="text-black/60 hover:text-black">
                <X size={15} />
              </button>
            </div>
            <div className="px-4 py-3">
              <p className="text-gray-300 text-sm leading-relaxed">{current.description}</p>
            </div>
            <div className="px-4 pb-3 flex items-center justify-between">
              <span className="text-gray-600 text-xs">
                {step + 1} / {tips.length}
              </span>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    onClick={prev}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg bg-gray-800"
                  >
                    <ChevronLeft size={13} /> Prev
                  </button>
                )}
                <button
                  onClick={next}
                  className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg"
                >
                  {step < tips.length - 1 ? (
                    <>
                      <span>Next</span>
                      <ChevronRight size={13} />
                    </>
                  ) : (
                    'Done'
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center gap-1 pb-3">
              {tips.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? 'bg-amber-500' : 'bg-gray-700'}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>,
      document.body
    )

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          setStep(0)
          setOpen(true)
        }}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border bg-gray-800 text-gray-400 hover:text-white border-gray-700 transition-colors"
      >
        <HelpCircle size={13} />
        <span className="hidden sm:inline">Help</span>
      </button>
      {tooltip}
    </>
  )
}
