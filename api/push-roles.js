/**
 * api/push-roles.js
 * Sends a push notification to all staff members matching specified roles.
 * Used by stock alerts to notify owner + manager regardless of who is logged in.
 *
 * POST body: { roles: string[], title: string, body: string, data?: object }
 * Requires header: x-internal-secret
 */

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

webpush.setVapidDetails(
  'mailto:seventeenkay@proton.me',
  process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.VITE_INTERNAL_API_SECRET

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { roles, title, body, data = {} } = req.body || {}
  if (!roles?.length || !title) {
    return res.status(400).json({ error: 'roles and title required' })
  }

  // Get all staff IDs with the given roles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id')
    .in('role', roles)

  if (!profiles?.length) return res.status(200).json({ sent: 0 })

  const staffIds = profiles.map(p => p.id)

  // Get their push subscriptions
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('staff_id, subscription')
    .in('staff_id', staffIds)

  if (!subs?.length) return res.status(200).json({ sent: 0 })

  const payload = JSON.stringify({ title, body, data })
  let sent = 0
  const staleIds = []

  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload)
      sent++
    } catch (err) {
      if (err.statusCode === 410) {
        staleIds.push(row.staff_id)
      }
    }
  }

  // Clean up expired subscriptions
  if (staleIds.length) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .in('staff_id', staleIds)
  }

  return res.status(200).json({ sent, total: subs.length })
}
