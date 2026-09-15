import pg from 'pg'

const projectRef = 'qdibeyhdrcrddckouqmc'
const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWJleWhkcmNyZGRja291cW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg3NTgxOCwiZXhwIjoyMDg4NDUxODE4fQ.F5rL5cGFX5sS2_Dl_rM2ZrQFVC9v3_y1WD4-8qK1aJ0'

const configs = [
  // Direct connection (IPv4 might work with some DNS configs)
  {
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: jwt,
    ssl: { rejectUnauthorized: false },
  },
  // Session pooler
  {
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: jwt,
    ssl: { rejectUnauthorized: false },
  },
  // Transaction pooler
  {
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6599,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: jwt,
    ssl: { rejectUnauthorized: false },
  },
]

for (const config of configs) {
  const client = new pg.Client(config)
  try {
    console.log(`Trying ${config.host}:${config.port} as ${config.user}...`)
    await client.connect()
    console.log('  Connected!')
    const result = await client.query("ALTER TABLE payroll ADD COLUMN IF NOT EXISTS daily_rate numeric(12,2) NOT NULL DEFAULT 0;")
    console.log('  Migration applied:', result.command)
    await client.end()
    console.log('  ✅ Success!')
    process.exit(0)
  } catch (err) {
    console.log(`  ❌ ${err.message}`)
    try { await client.end() } catch {}
  }
}

console.log('\nAll connection methods failed.')
