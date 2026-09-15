import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL

const anonKey = process.env.VITE_SUPABASE_ANON_KEY

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY

const supabaseAdmin =
  supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null
const supabaseAuth = supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null

function parseDataUrl(input) {
  const value = String(input || '')
  const match = value.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  const mime = match[1]
  const base64 = match[2]
  return { mime, base64 }
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'jpg'
}

export default async function handler(req, res) {
  if (!supabaseAdmin || !supabaseAuth) return res.status(500).json({ error: 'Server not configured' })
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
    return res.status(403).json({ error: 'Only owners and managers can upload menu images' })
  }

  const { menuItemId, dataUrl } = req.body || {}
  if (!menuItemId || !dataUrl) {
    return res.status(400).json({ error: 'menuItemId and dataUrl are required' })
  }

  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return res.status(400).json({ error: 'Invalid dataUrl' })
  const ext = extFromMime(parsed.mime)

  let file
  try {
    file = Buffer.from(parsed.base64, 'base64')
  } catch {
    return res.status(400).json({ error: 'Invalid base64 payload' })
  }

  const bucket = 'menu-items'
  try {
    const { data: existing } = await supabaseAdmin.storage.getBucket(bucket)
    if (!existing) {
      await supabaseAdmin.storage.createBucket(bucket, { public: true })
    }
  } catch {
    // bucket might already exist; ignore
  }

  const path = `${menuItemId}.${ext}`

  const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: parsed.mime,
    cacheControl: '3600',
  })
  if (uploadError) return res.status(400).json({ error: uploadError.message })

  const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path)
  const imageUrl = `${pub.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabaseAdmin
    .from('menu_items')
    .update({ image_url: imageUrl })
    .eq('id', menuItemId)

  if (updateError) return res.status(400).json({ error: updateError.message })

  return res.status(200).json({ ok: true, imageUrl })
}

