import { auditClient } from './supabase'
import { getAuditPerformer } from './auditContext'
import type { AuditParams } from '../types'

export async function audit({
  action,
  entity,
  entityId,
  entityName,
  oldValue,
  newValue,
  performer,
}: AuditParams): Promise<void> {
  try {
    const actor = performer ?? getAuditPerformer() ?? undefined
    await auditClient.from('audit_log').insert({
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      entity_name: entityName ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
      performed_by: actor?.id ?? null,
      performed_by_name: actor?.full_name ?? null,
      performed_by_role: actor?.role ?? null,
    })
  } catch (e) {
    // Never crash the app over an audit log failure
    console.warn('Audit log failed:', e)
  }
}
