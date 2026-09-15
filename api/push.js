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

  // Reject requests that don't carry the internal secret
  const authHeader = req.headers['x-internal-secret']
  if (!INTERNAL_SECRET || authHeader !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { staff_id, title, body, data } = req.body
  if (!staff_id || !title) return res.status(400).json({ error: 'Missing fields' })

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('staff_id', staff_id)

  if (error || !subs?.length) return res.status(200).json({ sent: 0 })

  const payload = JSON.stringify({ title, body, data: data || {} })
  let sent = 0

  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload)
      sent++
    } catch (err) {
      if (err.statusCode === 410) {
        await supabase.from('push_subscriptions')
          .delete()
          .eq('staff_id', staff_id)
          .eq('subscription', row.subscription)
      }
    }
  }

  return res.status(200).json({ sent })
}
