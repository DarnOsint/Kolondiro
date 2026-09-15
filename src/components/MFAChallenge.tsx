import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { ShieldCheck, Smartphone, ArrowLeft, Loader } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '../types'

interface Props {
  user?: User | null
  profile: Profile | null
  onVerified: () => void
  onSignOut: () => void
}
type Step = 'pick' | 'enroll_totp' | 'verify'

export default function MFAChallenge({ user: _user, profile, onVerified, onSignOut }: Props) {
  const [step, setStep] = useState<Step>('pick')
  const [code, setCode] = useState('')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const startTOTP = async () => {
    setLoading(true)
    setError('')
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const verified = factors?.totp?.find((f) => f.status === 'verified')
    const unverified = factors?.totp?.filter((f) => f.status !== 'verified') || []
    for (const f of unverified) await supabase.auth.mfa.unenroll({ factorId: f.id })
    if (verified) {
      const { data, error } = await supabase.auth.mfa.challenge({ factorId: verified.id })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setFactorId(verified.id)
      setChallengeId(data.id)
      setStep('verify')
    } else {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'KolondiroOS',
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setFactorId(data.id)
      setQrCode(data.totp.qr_code)
      setStep('enroll_totp')
    }
    setLoading(false)
  }

  const confirmTOTPEnroll = async () => {
    if (code.length !== 6 || !factorId) return
    setLoading(true)
    setError('')
    const { data: cd, error: ce } = await supabase.auth.mfa.challenge({ factorId })
    if (ce) {
      setError(ce.message)
      setLoading(false)
      return
    }
    const { error: ve } = await supabase.auth.mfa.verify({ factorId, challengeId: cd.id, code })
    if (ve) {
      await supabase.auth.mfa.unenroll({ factorId })
      setError('Invalid code. Please try again.')
      setCode('')
      setLoading(false)
      setTimeout(startTOTP, 500)
      return
    }
    setLoading(false)
    onVerified()
  }

  const verifyTOTP = async () => {
    if (code.length !== 6 || !factorId || !challengeId) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code })
    if (error) {
      setError('Invalid code. Try again.')
      setCode('')
      setLoading(false)
      return
    }
    setLoading(false)
    onVerified()
  }

  const codeInput = (
    <input
      type="number"
      value={code}
      onChange={(e) => setCode(e.target.value.slice(0, 6))}
      placeholder="000000"
      maxLength={6}
      className="w-full bg-gray-800 border border-gray-700 text-white text-center text-2xl font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 tracking-widest"
    />
  )

  return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
            <ShieldCheck size={28} className="text-amber-400" />
          </div>
          <h1 className="text-white font-bold text-xl">Two-Factor Authentication</h1>
          <p className="text-gray-500 text-sm mt-1">Extra security required for {profile?.role}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          {step === 'pick' && (
            <>
              <p className="text-gray-400 text-sm text-center mb-2">
                Use your authenticator app to verify
              </p>
              <button
                onClick={startTOTP}
                disabled={loading}
                className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-amber-500/40 rounded-xl p-4 transition-all text-left"
              >
                <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center shrink-0">
                  <Smartphone size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Authenticator App</p>
                  <p className="text-gray-500 text-xs">Google Authenticator, Authy, etc.</p>
                </div>
              </button>
              {loading && (
                <div className="text-center text-amber-500 text-sm flex items-center justify-center gap-2">
                  <Loader size={14} className="animate-spin" /> Please wait...
                </div>
              )}
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            </>
          )}
          {step === 'enroll_totp' && (
            <>
              <button
                onClick={() => {
                  setStep('pick')
                  setCode('')
                  setError('')
                }}
                className="flex items-center gap-1 text-gray-500 hover:text-white text-xs mb-2"
              >
                <ArrowLeft size={12} /> Back
              </button>
              <p className="text-white font-semibold text-sm text-center">
                Scan with your authenticator app
              </p>
              <p className="text-gray-500 text-xs text-center mb-3">
                Open Google Authenticator or Authy, tap + and scan this QR code
              </p>
              {qrCode && (
                <div className="flex justify-center">
                  <img
                    src={qrCode}
                    alt="TOTP QR Code"
                    className="w-48 h-48 rounded-xl border border-gray-700"
                  />
                </div>
              )}
              <div>
                <label className="text-gray-400 text-xs block mb-1">
                  Enter the 6-digit code to confirm
                </label>
                {codeInput}
              </div>
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
              <button
                onClick={confirmTOTPEnroll}
                disabled={code.length !== 6 || loading}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 transition-colors"
              >
                {loading ? 'Verifying...' : 'Confirm & Continue'}
              </button>
            </>
          )}
          {step === 'verify' && (
            <>
              <button
                onClick={() => {
                  setStep('pick')
                  setCode('')
                  setError('')
                }}
                className="flex items-center gap-1 text-gray-500 hover:text-white text-xs mb-2"
              >
                <ArrowLeft size={12} /> Back
              </button>
              <p className="text-white font-semibold text-sm text-center">
                Enter code from your app
              </p>
              <p className="text-gray-500 text-xs text-center mb-3">
                Enter the current 6-digit code from your authenticator app
              </p>
              {codeInput}
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
              <button
                onClick={verifyTOTP}
                disabled={code.length !== 6 || loading}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </>
          )}
        </div>
        <button
          onClick={onSignOut}
          className="w-full mt-4 text-gray-600 hover:text-gray-400 text-xs transition-colors"
        >
          Sign out and use a different account
        </button>
      </div>
    </div>
  )
}
