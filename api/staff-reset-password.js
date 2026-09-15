import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
const supabaseAuth = createClient(supabaseUrl, anonKey)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'Missing authorization token' })

  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token)
  if (authError || !authData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }

  const { data: callerProfile, error: callerError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single()

  if (callerError || !callerProfile) {
    return res.status(403).json({ error: 'Unable to verify caller permissions' })
  }

  if (!['owner', 'manager'].includes(callerProfile.role)) {
    return res.status(403).json({ error: 'Only owners and managers can reset staff passwords' })
  }

  const { staffId, newPassword } = req.body || {}
  if (!staffId || !newPassword) {
    return res.status(400).json({ error: 'staffId and newPassword are required' })
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' })
  }

  const { data: targetProfile, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', staffId)
    .single()

  if (targetError || !targetProfile) {
    return res.status(404).json({ error: 'Staff profile not found' })
  }

  if (!targetProfile.email) {
    return res.status(400).json({ error: 'This staff member does not have an email login account' })
  }

  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffId, {
    password: newPassword,
  })

  if (resetError) {
    return res.status(400).json({ error: resetError.message })
  }

  return res.status(200).json({
    ok: true,
    message: `Password updated for ${targetProfile.full_name || targetProfile.email}`,
  })
}
