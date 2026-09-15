import { useState } from 'react'
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Props {
  onBack: () => void
}

function passwordStrength(pw: string): number {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'] as const
const STRENGTH_COLOR = [
  '',
  'bg-red-500',
  'bg-orange-400',
  'bg-yellow-400',
  'bg-green-400',
  'bg-green-500',
] as const

export default function ChangePassword({ onBack }: Props) {
  const [current, setCurrent] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const s = passwordStrength(newPw)

  const handleSubmit = async () => {
    setError(null)
    if (!current || !newPw || !confirm) {
      setError('Please fill in all fields.')
      return
    }
    if (newPw !== confirm) {
      setError('New passwords do not match.')
      return
    }
    if (newPw.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (newPw === current) {
      setError('New password must be different from your current password.')
      return
    }

    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) {
      setError('Could not retrieve your account details. Please log in again.')
      setLoading(false)
      return
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    })
    if (signInErr) {
      setError('Current password is incorrect.')
      setLoading(false)
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
    setCurrent('')
    setNewPw('')
    setConfirm('')
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-800 transition-colors">
          <ArrowLeft size={20} className="text-gray-400" />
        </button>
        <div>
          <h1 className="text-white font-bold text-base leading-tight">Change Password</h1>
          <p className="text-gray-500 text-xs">Update your account login password</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-6 space-y-4">
        {success ? (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6 text-center">
            <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
            <p className="text-white font-semibold text-base">Password updated successfully</p>
            <p className="text-gray-400 text-sm mt-1">Your new password is active immediately.</p>
            <button
              onClick={onBack}
              className="mt-5 w-full bg-gray-800 text-white rounded-2xl py-3 text-sm font-medium"
            >
              Back to Back Office
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
                <XCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Current password */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <label className="text-gray-400 text-xs font-medium block mb-2">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm pr-10 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs font-medium block mb-2">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm pr-10 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                  >
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {newPw.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${i <= s ? STRENGTH_COLOR[s] : 'bg-gray-700'}`}
                        />
                      ))}
                    </div>
                    <p
                      className={`text-xs ${s >= 4 ? 'text-green-400' : s >= 3 ? 'text-yellow-400' : 'text-orange-400'}`}
                    >
                      {STRENGTH_LABEL[s]} —{' '}
                      {s < 3
                        ? 'Add uppercase, numbers, or symbols to strengthen it.'
                        : 'Good to go.'}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="text-gray-400 text-xs font-medium block mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                    className={`w-full bg-gray-800 border rounded-xl px-4 py-3 text-white text-sm pr-10 focus:outline-none focus:border-amber-500 ${
                      confirm.length > 0
                        ? confirm === newPw
                          ? 'border-green-500/50'
                          : 'border-red-500/50'
                        : 'border-gray-700'
                    }`}
                  />
                  <button
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {confirm.length > 0 && confirm !== newPw && (
                  <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
                )}
              </div>
            </div>

            {/* Requirements */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
              <p className="text-gray-500 text-xs font-medium mb-2">Requirements</p>
              {(
                [
                  ['At least 8 characters', newPw.length >= 8],
                  ['Different from current password', newPw.length > 0 && newPw !== current],
                  ['Passwords match', confirm.length > 0 && newPw === confirm],
                ] as [string, boolean][]
              ).map(([label, met]) => (
                <div key={label} className="flex items-center gap-2 py-1">
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center ${met ? 'bg-green-500/20' : 'bg-gray-800'}`}
                  >
                    {met ? (
                      <CheckCircle size={10} className="text-green-400" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                    )}
                  </div>
                  <p className={`text-xs ${met ? 'text-green-400' : 'text-gray-500'}`}>{label}</p>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !current || !newPw || !confirm || newPw !== confirm}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold rounded-2xl py-4 text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Lock size={16} />
              {loading ? 'Updating Password…' : 'Update Password'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
