import type { Profile } from '../types'

let performer: Profile | null = null

export function setAuditPerformer(p: Profile | null) {
  performer = p
}

export function getAuditPerformer(): Profile | null {
  return performer
}
