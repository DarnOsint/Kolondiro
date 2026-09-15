import { createClient } from '@supabase/supabase-js'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Primary client used by the app
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
// Secondary client used only for audit writes (used by audit helper)
export const auditClient = createClient(supabaseUrl, supabaseAnonKey)
