import { useState } from 'react'
import { Users, X } from 'lucide-react'

interface Props {
  tableName: string
  onConfirm: (covers: number) => void
  onCancel: () => void
}

export default function CoversModal({ tableName, onConfirm, onCancel }: Props) {
  const [covers, setCovers] = useState<number | null>(null)

  const select = (n: number) => setCovers(n)

  const confirm = () => {
    if (!covers) return
    onConfirm(covers)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-amber-400" />
            <div>
              <p className="text-white font-bold text-sm">{tableName}</p>
              <p className="text-gray-400 text-xs">How many covers?</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Quick-select grid — 1 to 12 */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
            <button
              key={n}
              onClick={() => select(n)}
              className={`h-12 rounded-xl text-sm font-bold transition-colors
                ${
                  covers === n
                    ? 'bg-amber-500 text-black'
                    : 'bg-gray-800 text-white hover:bg-gray-700'
                }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Large party input */}
        <div className="flex items-center gap-2 mb-5">
          <input
            type="number"
            min={1}
            max={99}
            placeholder="13+"
            value={covers && covers > 12 ? covers : ''}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              if (!isNaN(v) && v > 0) setCovers(v)
            }}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm text-center focus:outline-none focus:border-amber-500"
          />
          <span className="text-gray-500 text-xs">for large parties</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-400 text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!covers}
            className="flex-2 flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold text-sm transition-colors"
          >
            Open table
          </button>
        </div>
      </div>
    </div>
  )
}
