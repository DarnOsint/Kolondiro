import { getCredentials, saveCredential, type CredentialRecord } from './db'
import { hashPin, verifyPbkdf2 } from './pinHash'
import type { Profile } from '../types'

export type OfflineLoginMode = 'pin' | 'password'

export interface OfflineAuthResult {
  profile: Profile
  mode: OfflineLoginMode
}

const LS_KEY = 'offline_credentials_v1'

function normalizeEmail(email?: string): string | undefined {
  return email?.trim().toLowerCase()
}

function readLocalCredentials(): CredentialRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CredentialRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalCredentials(creds: CredentialRecord[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(creds.slice(0, 50)))
  } catch {
    /* ignore (storage full / blocked) */
  }
}

function upsertLocalCredential(record: CredentialRecord): void {
  const all = readLocalCredentials()
  const next = [record, ...all.filter((c) => c.id !== record.id)]
  writeLocalCredentials(next)
}

export async function cacheCredential(
  profile: Profile,
  mode: OfflineLoginMode,
  secret: string
): Promise<void> {
  const verifier = await hashPin(secret) // PBKDF2 string; works for PIN or password
  const record: CredentialRecord = {
    id: profile.id,
    email: normalizeEmail(profile.email),
    full_name: profile.full_name,
    role: profile.role,
    mode,
    verifier,
    created_at: profile.created_at,
    stored_at: new Date().toISOString(),
  }
  // Prefer IndexedDB, but also write a localStorage fallback for browsers/devices
  // where IDB is blocked/cleared aggressively.
  try {
    await saveCredential(record)
  } catch (e) {
    console.warn('[offlineAuth] saveCredential failed; using localStorage fallback', e)
  }
  upsertLocalCredential(record)
}

async function matchVerifier(secret: string, verifier: string): Promise<boolean> {
  // All cached secrets are stored as pbkdf2:...
  return verifyPbkdf2(secret, verifier)
}

export async function verifyOfflinePin(pin: string): Promise<OfflineAuthResult | null> {
  let creds: CredentialRecord[] = []
  try {
    creds = await getCredentials()
  } catch {
    creds = []
  }
  if (creds.length === 0) creds = readLocalCredentials()
  for (const cred of creds) {
    if (cred.mode !== 'pin') continue
    if (await matchVerifier(pin, cred.verifier)) {
      return {
        mode: 'pin',
        profile: {
          id: cred.id,
          full_name: cred.full_name,
          role: cred.role as Profile['role'],
          email: cred.email,
          is_active: true,
          created_at: cred.created_at ?? new Date(0).toISOString(),
        },
      }
    }
  }
  return null
}

export async function verifyOfflinePassword(
  email: string,
  password: string
): Promise<OfflineAuthResult | null> {
  const target = normalizeEmail(email)
  if (!target) return null
  let creds: CredentialRecord[] = []
  try {
    creds = await getCredentials()
  } catch {
    creds = []
  }
  if (creds.length === 0) creds = readLocalCredentials()
  for (const cred of creds) {
    if (cred.mode !== 'password') continue
    if (normalizeEmail(cred.email) !== target) continue
    if (await matchVerifier(password, cred.verifier)) {
      return {
        mode: 'password',
        profile: {
          id: cred.id,
          full_name: cred.full_name,
          role: cred.role as Profile['role'],
          email: cred.email,
          is_active: true,
          created_at: cred.created_at ?? new Date(0).toISOString(),
        },
      }
    }
  }
  return null
}

export async function getCachedProfileById(id: string): Promise<Profile | null> {
  let creds: CredentialRecord[] = []
  try {
    creds = await getCredentials()
  } catch {
    creds = []
  }
  if (creds.length === 0) creds = readLocalCredentials()
  const cred = creds.find((c) => c.id === id)
  if (!cred) return null
  return {
    id: cred.id,
    full_name: cred.full_name,
    role: cred.role as Profile['role'],
    email: cred.email,
    is_active: true,
    created_at: cred.created_at ?? new Date(0).toISOString(),
  }
}
