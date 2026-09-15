import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from 'react'
import { supabase } from '../lib/supabase'
import { audit } from '../lib/audit'
import { setAuditPerformer } from '../lib/auditContext'
import { getCachedProfileById } from '../lib/offlineAuth'
import type { Profile } from '../types'
import type { User } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes
const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'scroll',
  'click',
] as const

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({} as AuthContextValue)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Session timeout ────────────────────────────────────────────────────────

  const doSignOut = useCallback(async (reason: 'timeout' | 'manual' = 'timeout') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setAuditPerformer(null)

    const pinSession = localStorage.getItem('pin_session')
    if (pinSession) {
      localStorage.removeItem('pin_session')
      setUser(null)
      setProfile(null)
      window.location.href = '/login?reason=' + reason
      return
    }

    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    if (reason === 'timeout') window.location.href = '/login?reason=timeout'
  }, [])

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (localStorage.getItem('pin_session') || sessionStorage.getItem('auth_active')) {
      timeoutRef.current = setTimeout(() => doSignOut('timeout'), TIMEOUT_MS)
    }
  }, [doSignOut])

  useEffect(() => {
    if (!user) return
    sessionStorage.setItem('auth_active', '1')
    resetTimer()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer))
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      sessionStorage.removeItem('auth_active')
    }
  }, [user, resetTimer])

  // ── Auth init ──────────────────────────────────────────────────────────────

  const fetchProfile = useCallback(async (userId: string) => {
    // Retry up to 3 times — handles transient RLS or network errors
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (!error && data) {
        setProfile(data as Profile)
        setAuditPerformer(data as Profile)
        setLoading(false)
        return
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500))
    }
    // All retries failed — sign out cleanly rather than leaving broken state
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const hydratePinSession = async (): Promise<boolean> => {
        // PIN session — SECURITY: only ID is trusted from localStorage.
        // Role/name/active status are always re-fetched from the DB to prevent forgery.
        const pinSession = localStorage.getItem('pin_session')
        if (!pinSession) return false
        try {
          const parsed = JSON.parse(pinSession) as { id: string; logged_in_at: string }
          const hoursSince = (Date.now() - new Date(parsed.logged_in_at).getTime()) / 3_600_000
          if (!(hoursSince < 12 && parsed.id)) {
            localStorage.removeItem('pin_session')
            return false
          }

          // Offline mode: hydrate profile from cached credentials (device-trust),
          // so POS/KDS can operate without internet.
          if (!navigator.onLine) {
            const cached = await getCachedProfileById(parsed.id)
            if (cancelled) return true
            if (!cached) {
              localStorage.removeItem('pin_session')
              return false
            }
            setProfile(cached)
            setAuditPerformer(cached)
            setUser({ id: cached.id, pin_session: true } as unknown as User)
            setLoading(false)
            return true
          }

          const { data: freshProfile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', parsed.id)
            .eq('is_active', true)
            .single()
          if (cancelled) return true
          if (error || !freshProfile) {
            localStorage.removeItem('pin_session')
            return false
          }
          setProfile(freshProfile as Profile)
          setAuditPerformer(freshProfile as Profile)
          setUser({ id: freshProfile.id, pin_session: true } as unknown as User)
          setLoading(false)
          return true
        } catch {
          localStorage.removeItem('pin_session')
          return false
        }
      }

      // Prefer Supabase (email/password) session if present.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.user) {
        // If an email session exists, it takes precedence over any lingering PIN session.
        if (localStorage.getItem('pin_session')) {
          localStorage.removeItem('pin_session')
          window.dispatchEvent(new Event('pin_session_updated'))
        }
        setUser(session.user)
        fetchProfile(session.user.id)
        return
      }

      // Otherwise attempt PIN session.
      if (await hydratePinSession()) return

      setUser(null)
      setLoading(false)
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const pinSession = localStorage.getItem('pin_session')

      // If Supabase session becomes available (SIGNED_IN / TOKEN_REFRESHED),
      // it should override any PIN session.
      if (session?.user) {
        if (pinSession) {
          localStorage.removeItem('pin_session')
          window.dispatchEvent(new Event('pin_session_updated'))
        }
        setUser(session.user)
        fetchProfile(session.user.id)
        return
      }

      // If Supabase session is cleared but a PIN session exists, keep the PIN session.
      if (pinSession) return

      setUser(null)
      setProfile(null)
      setLoading(false)
    })

    const onPinSessionUpdated = () => {
      // If a PIN login just happened without a page reload, hydrate immediately.
      if (!cancelled) {
        void (async () => {
          await new Promise((r) => setTimeout(r, 0))
          // Avoid overriding an email session.
          if (localStorage.getItem('pin_session')) {
            // Re-run init PIN hydration path.
            const pinSession = localStorage.getItem('pin_session')
            if (!pinSession) return
            try {
              const parsed = JSON.parse(pinSession) as { id: string; logged_in_at: string }
              if (!parsed?.id) return
              if (!navigator.onLine) {
                const cached = await getCachedProfileById(parsed.id)
                if (cached) {
                  setProfile(cached)
                  setAuditPerformer(cached)
                  setUser({ id: cached.id, pin_session: true } as unknown as User)
                  setLoading(false)
                }
                return
              }
              const { data: freshProfile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', parsed.id)
                .eq('is_active', true)
                .single()
              if (freshProfile) {
                setProfile(freshProfile as Profile)
                setAuditPerformer(freshProfile as Profile)
                setUser({ id: freshProfile.id, pin_session: true } as unknown as User)
                setLoading(false)
              }
            } catch {
              /* ignore */
            }
          }
        })()
      }
    }
    window.addEventListener('pin_session_updated', onPinSessionUpdated)
    window.addEventListener('storage', onPinSessionUpdated)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      window.removeEventListener('pin_session_updated', onPinSessionUpdated)
      window.removeEventListener('storage', onPinSessionUpdated)
    }
  }, [fetchProfile])

  const signOut = async () => {
    void audit({
      action: 'LOGOUT',
      entity: 'auth',
      entityName: profile?.full_name ?? undefined,
      newValue: { reason: 'manual' },
      performer: profile as import('../types').Profile,
    })
    doSignOut('manual')
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
