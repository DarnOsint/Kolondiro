import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { verifyPinServer, verifyPbkdf2 } from '../../lib/pinHash'
import { cacheCredential, verifyOfflinePassword, verifyOfflinePin } from '../../lib/offlineAuth'
import { Eye, EyeOff, Delete } from 'lucide-react'
import type { Profile, Role } from '../../types'

const EMAIL_MAX = 5
const EMAIL_LOCK_MS = 15 * 60 * 1000
const PIN_MAX = 5
const PIN_LOCK_MS = 5 * 60 * 1000

interface RateState {
  attempts: number
  max: number
  lockedAt?: number
}

const getRateState = (key: string): RateState | null => {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
const setRateState = (key: string, s: RateState) => sessionStorage.setItem(key, JSON.stringify(s))
const isLockedOut = (s: RateState | null, ms: number) =>
  !!(s && s.attempts >= (s.max || 5) && s.lockedAt && Date.now() - s.lockedAt < ms)
const getRemaining = (s: RateState | null, ms: number) =>
  s?.lockedAt ? Math.max(0, Math.ceil((ms - (Date.now() - s.lockedAt)) / 1000)) : 0
const recordAttempt = (key: string, max: number): RateState => {
  const s: RateState = getRateState(key) || { attempts: 0, max }
  s.attempts += 1
  if (s.attempts >= max) s.lockedAt = Date.now()
  setRateState(key, s)
  return s
}
const resetAttempts = (key: string) => sessionStorage.removeItem(key)
const fmtTime = (secs: number) => {
  const m = Math.floor(secs / 60)
  return m > 0 ? `${m}m ${secs % 60}s` : `${secs}s`
}

const setOfflineSession = (
  profile: { id: string; full_name: string; role: string; email?: string; created_at?: string },
  mode: 'pin' | 'password'
) => {
  localStorage.setItem(
    'pin_session',
    JSON.stringify({
      id: profile.id,
      full_name: profile.full_name,
      role: profile.role,
      email: profile.email,
      session_type: mode,
      created_at: profile.created_at,
      logged_in_at: new Date().toISOString(),
    })
  )
  // Let AuthContext hydrate immediately without requiring a full reload
  window.dispatchEvent(new Event('pin_session_updated'))
}

function useLockoutTimer(
  locked: boolean,
  remaining: number,
  setRemaining: React.Dispatch<React.SetStateAction<number>>
) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!locked || remaining <= 0) return
    timer.current = setInterval(
      () =>
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(timer.current!)
            return 0
          }
          return r - 1
        }),
      1000
    )
    return () => clearInterval(timer.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])
}

const PIN_PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
]

function LockedOut({ mode, time }: { mode: 'email' | 'pin'; time: number }) {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">🔒</span>
      </div>
      <p className="text-red-400 font-semibold mb-1">
        {mode === 'email' ? 'Account' : 'PIN Entry'} Locked
      </p>
      <p className="text-gray-500 text-sm">
        Try again in <span className="text-white font-mono">{fmtTime(time)}</span>
      </p>
    </div>
  )
}

export default function Login() {
  const [mode, setMode] = useState<'email' | 'pin'>('pin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)
  const [emailRem, setEmailRem] = useState(() => {
    const s = getRateState('rl_email')
    return isLockedOut(s, EMAIL_LOCK_MS) ? getRemaining(s, EMAIL_LOCK_MS) : 0
  })
  const [pinRem, setPinRem] = useState(() => {
    const s = getRateState('rl_pin')
    return isLockedOut(s, PIN_LOCK_MS) ? getRemaining(s, PIN_LOCK_MS) : 0
  })
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('reason') === 'timeout'
  const emailLocked = emailRem > 0
  const pinLocked = pinRem > 0

  useLockoutTimer(emailLocked, emailRem, setEmailRem)
  useLockoutTimer(pinLocked, pinRem, setPinRem)

  const getDevice = () => {
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
    if (/Android/.test(ua)) return 'Android'
    if (/Windows/.test(ua)) return 'Windows'
    if (/Mac/.test(ua)) return 'Mac'
    return 'Browser'
  }
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (emailLocked) return
    // Ensure a lingering PIN session doesn't block Supabase auth hydration.
    if (localStorage.getItem('pin_session')) {
      localStorage.removeItem('pin_session')
      window.dispatchEvent(new Event('pin_session_updated'))
    }
    const s = getRateState('rl_email')
    if (isLockedOut(s, EMAIL_LOCK_MS)) {
      setEmailRem(getRemaining(s, EMAIL_LOCK_MS))
      setError(`Too many attempts. Try again in ${fmtTime(getRemaining(s, EMAIL_LOCK_MS))}.`)
      return
    }
    setLoading(true)
    setError(null)
    const tryOffline = async () => {
      const offline = await verifyOfflinePassword(email, password)
      if (!offline) return false
      setOfflineSession(offline.profile, 'password')
      resetAttempts('rl_email')
      setLoading(false)
      window.location.replace('/dashboard')
      return true
    }

    if (!navigator.onLine) {
      const ok = await tryOffline()
      if (!ok) setError('No offline password cached for this account.')
      setLoading(false)
      return
    }

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err || !data?.session) {
      // Network or credential failure — if network-related, attempt offline cache
      if (err?.message?.toLowerCase().includes('network') || !navigator.onLine) {
        const ok = await tryOffline()
        if (ok) return
      }
      const ns = recordAttempt('rl_email', EMAIL_MAX)
      if (ns.attempts >= EMAIL_MAX) {
        const rem = getRemaining(ns, EMAIL_LOCK_MS)
        setEmailRem(rem)
        setError(`Too many failed attempts. Locked out for ${fmtTime(rem)}.`)
      } else {
        const left = EMAIL_MAX - ns.attempts
        setError(
          `${err?.message ?? 'Login failed'} — ${left} attempt${left !== 1 ? 's' : ''} remaining.`
        )
      }
      setLoading(false)
      return
    }

    // Online success — cache credential for offline reuse
    resetAttempts('rl_email')
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (userId) {
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (prof) {
        try {
          await cacheCredential(prof as unknown as Profile, 'password', password)
        } catch (e) {
          console.warn('cacheCredential(password) failed', e)
        }
      }
    }

    void fetch('https://api.ipify.org?format=json')
      .then((r) => r.json())
      .catch(() => ({ ip: 'unknown' }))
      .then(({ ip }) =>
        supabase
          .from('audit_log')
          .insert({
            action: 'LOGIN_EMAIL',
            entity: 'auth',
            entity_name: email,
            ip_address: ip,
            new_value: { device: getDevice(), browser: navigator.userAgent.slice(0, 120) },
          })
          .select()
      )
    setLoading(false)
    window.location.replace('/dashboard')
  }

  const handlePinLogin = async (entered: string) => {
    if (entered.length !== 4 || pinLocked) return
    const s = getRateState('rl_pin')
    if (isLockedOut(s, PIN_LOCK_MS)) {
      setPinRem(getRemaining(s, PIN_LOCK_MS))
      setPin('')
      setError(`Try again in ${fmtTime(getRemaining(s, PIN_LOCK_MS))}.`)
      return
    }
    setLoading(true)
    setError(null)

    const offlineFallback = async () => {
      const offline = await verifyOfflinePin(entered)
      if (!offline) return null
      setOfflineSession(offline.profile, 'pin')
      resetAttempts('rl_pin')
      setLoading(false)
      window.location.replace('/dashboard')
      return offline.profile
    }

    // Offline-first: if no network, try cached credentials immediately
    if (!navigator.onLine) {
      const offlineProfile = await offlineFallback()
      if (!offlineProfile) {
        setError('Offline login needs a prior online login on this POS (PIN not cached yet).')
        setLoading(false)
      }
      return
    }

    // Step 1: Server-side verify — handles plain-text and bcrypt instantly
    let data: Record<string, unknown> | null = await verifyPinServer(entered)

    // Step 2: PBKDF2 legacy fallback (slow — only until all PINs are migrated)
    // This loop shrinks to zero as each staff member logs in and gets re-hashed
    if (!data) {
      const { data: pbkdf2Rows } = await supabase
        .from('profiles')
        .select('id, pin')
        .eq('is_active', true)
        .like('pin', 'pbkdf2:%')

      if (pbkdf2Rows) {
        for (const row of pbkdf2Rows) {
          if (row.pin && (await verifyPbkdf2(entered, row.pin))) {
            const { data: fullProfile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', row.id)
              .eq('is_active', true)
              .single()
            data = fullProfile as Record<string, unknown>
            break
          }
        }
      }
    }

    // Cast to typed profile after verification
    const profile = data as
      | (Partial<Profile> & {
          id: string
          full_name: string
          role: Role
          email?: string
          pin?: string
        })
      | null

    if (!profile) {
      // If server failed due to network, attempt offline cached login
      if (!navigator.onLine) {
        const offlineProfile = await offlineFallback()
        if (offlineProfile) return
      }
      const ns = recordAttempt('rl_pin', PIN_MAX)
      if (ns.attempts >= PIN_MAX) {
        const rem = getRemaining(ns, PIN_LOCK_MS)
        setPinRem(rem)
        setError(`Too many failed attempts. Locked out for ${fmtTime(rem)}.`)
      } else {
        const left = PIN_MAX - ns.attempts
        setError(`Invalid PIN. ${left} attempt${left !== 1 ? 's' : ''} remaining.`)
      }
      setPin('')
      setLoading(false)
      return
    }
    resetAttempts('rl_pin')

    // Operational roles must be clocked in before they can log in
    const clockInRequired = [
      'waitron',
      'kitchen',
      'bar',
      'griller',
      'mixologist',
      'games_master',
      'shisha_attendant',
    ]
    if (clockInRequired.includes(profile.role)) {
      const { data: activeShift } = await supabase
        .from('attendance')
        .select('id')
        .eq('staff_id', profile.id)
        .or('clock_out.is.null')
        .limit(1)
      if (!activeShift || activeShift.length === 0) {
        setError('You must be clocked in by a manager before logging in.')
        setPin('')
        setLoading(false)
        return
      }
    }

    // Normalize PIN storage: if stored as PBKDF2 hash, replace with plaintext
    // so the server-side RPC can verify it directly next time (faster, no fallback loop)
    if (profile.pin && profile.pin.startsWith('pbkdf2:')) {
      void supabase.from('profiles').update({ pin: entered }).eq('id', profile.id)
    }

    void fetch('https://api.ipify.org?format=json')
      .then((r) => r.json())
      .catch(() => ({ ip: 'unknown' }))
      .then(({ ip }) =>
        supabase
          .from('audit_log')
          .insert({
            action: 'LOGIN_PIN',
            entity: 'auth',
            entity_name: profile.full_name,
            performed_by: profile.id,
            performed_by_name: profile.full_name,
            performed_by_role: profile.role,
            ip_address: ip,
            new_value: { device: getDevice(), browser: navigator.userAgent.slice(0, 120) },
          })
          .select()
      )
    try {
      const cacheProfile: Profile = {
        id: profile.id,
        full_name: profile.full_name,
        role: profile.role as Role,
        email: profile.email,
        pin: profile.pin,
        is_active: true,
        created_at: profile.created_at || new Date().toISOString(),
      }
      await cacheCredential(cacheProfile, 'pin', entered)
    } catch (e) {
      console.warn('cacheCredential(pin) failed', e)
    }
    setOfflineSession(
      {
        id: profile.id,
        full_name: profile.full_name,
        role: profile.role as Role,
        email: profile.email,
        created_at: new Date().toISOString(),
      },
      'pin'
    )
    setLoading(false)
    window.location.replace('/dashboard')
  }

  const handlePinPress = (digit: string) => {
    if (pin.length >= 4 || loading || pinLocked) return
    const np = pin + digit
    setPin(np)
    setError(null)
    if (np.length === 4) handlePinLogin(np)
  }

  const _Locked = ({ time }: { time: number }) => (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">🔒</span>
      </div>
      <p className="text-red-400 font-semibold mb-1">
        {mode === 'email' ? 'Account' : 'PIN Entry'} Locked
      </p>
      <p className="text-gray-500 text-sm">
        Try again in <span className="text-white font-mono">{fmtTime(time)}</span>
      </p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-900 via-gray-900 to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-500 mb-4">
            <span className="text-3xl">🍺</span>
          </div>
          <h1 className="text-3xl font-bold text-amber-400">Kolondiro</h1>
          <p className="text-gray-300 mt-1">Restaurant Operating System</p>
        </div>

        {sessionExpired && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 mb-6 flex items-center gap-3">
            <span className="text-amber-400 text-lg">⏱</span>
            <div>
              <p className="text-amber-400 text-sm font-medium">Session expired</p>
              <p className="text-amber-400/70 text-xs">
                You were signed out after 60 minutes of inactivity.
              </p>
            </div>
          </div>
        )}

        {mode === 'pin' ? (
          <p className="text-center text-xs text-gray-600 mb-4">
            Manager or Owner?{' '}
            <button
              onClick={() => {
                setMode('email')
                setError(null)
                setPin('')
              }}
              className="text-amber-500 hover:text-amber-400 underline"
            >
              Sign in with email
            </button>
          </p>
        ) : (
          <p className="text-center text-xs text-gray-600 mb-4">
            <button
              onClick={() => {
                setMode('pin')
                setError(null)
              }}
              className="text-amber-500 hover:text-amber-400 underline"
            >
              ← Use PIN instead
            </button>
          </p>
        )}

        <div className="bg-gray-800/90 backdrop-blur rounded-2xl p-8 shadow-2xl border border-amber-500/20">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 mb-6 text-sm">
              {error}
            </div>
          )}

          {mode === 'email' && (
            <>
              <h2 className="text-xl font-semibold text-white mb-2">Sign in</h2>
              <p className="text-gray-500 text-sm mb-6">For managers, owners and accountants</p>
              {emailLocked ? (
                <LockedOut mode="email" time={emailRem} />
              ) : (
                <form onSubmit={handleEmailLogin} className="space-y-5">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@kolondiro.com"
                      required
                      className="w-full bg-gray-700 border border-gray-500 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full bg-gray-700 border border-gray-500 text-white rounded-xl px-4 py-3 pr-11 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                      >
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-black font-semibold rounded-xl px-4 py-3 transition-colors"
                  >
                    {loading ? 'Signing in…' : 'Sign In'}
                  </button>
                </form>
              )}
            </>
          )}

          {mode === 'pin' && (
            <>
              <h2 className="text-xl font-semibold text-white mb-2">Enter PIN</h2>
              <p className="text-gray-500 text-sm mb-6">
                For waitrons, kitchen, bar and grill staff
              </p>
              {pinLocked ? (
                <LockedOut mode="pin" time={pinRem} />
              ) : (
                <>
                  <div className="flex justify-center gap-4 mb-8">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${pin.length > i ? 'border-amber-500 bg-amber-500/10' : 'border-gray-500 bg-gray-700'}`}
                      >
                        {pin.length > i && <div className="w-4 h-4 rounded-full bg-amber-500" />}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {PIN_PAD.map((row, ri) => (
                      <div key={ri} className="grid grid-cols-3 gap-3">
                        {row.map((digit, di) => (
                          <button
                            key={di}
                            onClick={() =>
                              digit === 'del'
                                ? setPin((p) => p.slice(0, -1))
                                : digit !== ''
                                  ? handlePinPress(digit)
                                  : undefined
                            }
                            disabled={loading || digit === ''}
                            className={`h-16 rounded-2xl text-xl font-bold transition-all ${
                              digit === ''
                                ? 'opacity-0 pointer-events-none'
                                : digit === 'del'
                                  ? 'bg-gray-700 border border-gray-500 text-gray-300 hover:bg-gray-600 hover:text-white active:scale-95'
                                  : 'bg-gray-700 border border-gray-500 text-white font-bold hover:bg-amber-500/20 hover:border-amber-500 active:scale-95'
                            }`}
                          >
                            {digit === 'del' ? <Delete size={20} className="mx-auto" /> : digit}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  {loading && (
                    <div className="text-center mt-6 text-amber-500 text-sm">Verifying PIN...</div>
                  )}
                  <button
                    onClick={() => {
                      setPin('')
                      setError(null)
                    }}
                    className="w-full mt-4 text-gray-500 hover:text-gray-300 text-sm transition-colors"
                  >
                    Clear
                  </button>
                </>
              )}
            </>
          )}
        </div>
        <p className="text-center text-gray-600 text-sm mt-6">
          RestaurantOS v1.0 — Kolondiro
        </p>
      </div>
    </div>
  )
}
