/**
 * api/cron/stock-check.js
 * Vercel cron wrapper — runs daily at 06:00 UTC (07:00 WAT).
 * Checks all inventory for low/out-of-stock items and fires push alerts.
 */

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const response = await fetch(`${baseUrl}/api/stock-alerts`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  })

  const result = await response.json()
  console.log('[stock-check cron]', result)
  return res.status(200).json(result)
}
