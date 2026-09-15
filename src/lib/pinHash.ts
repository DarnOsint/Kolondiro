import { supabase } from './supabase'

// ── PIN hashing strategy ──────────────────────────────────────────────────────
// Storage format: bcrypt via pgcrypto (server-side, instant verification)
// Legacy: PBKDF2 (client-side, slow — auto-migrated to bcrypt on login)
// Legacy: plain text (pre-hash era — verified then immediately re-hashed)

// ── bcrypt via Supabase RPC ───────────────────────────────────────────────────

/** Hash a PIN for storage using PBKDF2 (client-side Web Crypto). */
export async function hashPin(pin: string): Promise<string> {
  // Use PBKDF2 — verified client-side for hashed PINs,
  // or DB RPC for plain-text PINs (instant)
  const salt = randomSaltHex()
  const hash = await pbkdf2Derive(pin, salt)
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** Verify a PIN server-side. Returns the matching profile or null. */
export async function verifyPinServer(pin: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('verify_pin_and_get_profile', {
    entered_pin: pin,
  })
  if (error) {
    console.warn('verifyPin RPC error:', error.message)
    return null
  }
  return data as Record<string, unknown> | null
}

// ── PBKDF2 (legacy client-side — only used during migration) ─────────────────

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32

async function pbkdf2Derive(pin: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const salt = hexToBytes(saltHex)
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  return bytesToHex(new Uint8Array(bits))
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Verify a PBKDF2 hash — legacy path only */
export async function verifyPbkdf2(pin: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2:')) return false
  const parts = stored.split(':')
  if (parts.length !== 4) return false
  const [, , salt, expectedHash] = parts
  const actualHash = await pbkdf2Derive(pin, salt)
  return actualHash === expectedHash
}

/** Legacy compatibility — kept for any code still calling verifyPin directly */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!stored) return false
  if (stored.startsWith('pbkdf2:')) return verifyPbkdf2(pin, stored)
  if (stored.startsWith('$2')) {
    // bcrypt — can't verify client-side, this path shouldn't be reached
    return false
  }
  return pin === stored
}

export function isPinHashed(stored: string): boolean {
  return stored.startsWith('pbkdf2:') || stored.startsWith('$2')
}

export function isPbkdf2Hash(stored: string): boolean {
  return stored.startsWith('pbkdf2:')
}
