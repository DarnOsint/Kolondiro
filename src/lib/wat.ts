// West African Time (WAT) = UTC+1
// All display formatting should use this timezone

export const WAT = 'Africa/Lagos'

export function watDate(date?: string | Date): Date {
  return date ? new Date(date) : new Date()
}

export function fmtWATTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('en-NG', {
    timeZone: WAT,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function fmtWATDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-NG', {
    timeZone: WAT,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtWATDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-NG', {
    timeZone: WAT,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function fmtWATDateFull(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-NG', {
    timeZone: WAT,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// For date-only strings used in DB queries — get today in WAT
export function todayWAT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: WAT }) // YYYY-MM-DD
}

// WAT start/end of day for DB range queries — 8am-to-8am trading day
export function watDayRange(dateStr?: string): { start: Date; end: Date } {
  const base = dateStr
    ? new Date(dateStr + 'T08:00:00+01:00')
    : (() => {
        const watNow = new Date(new Date().toLocaleString('en-US', { timeZone: WAT }))
        const d = new Date(
          new Date().toLocaleDateString('en-CA', { timeZone: WAT }) + 'T08:00:00+01:00'
        )
        if (watNow.getHours() < 8) d.setDate(d.getDate() - 1)
        return d
      })()
  const start = new Date(base)
  const end = new Date(base)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

// Shared 8am session window helper — used across the app
export function sessionWindowWAT(): { start: Date; end: Date; startISO: string; endISO: string } {
  const watNow = new Date(new Date().toLocaleString('en-US', { timeZone: WAT }))
  const start = new Date(watNow)
  start.setHours(8, 0, 0, 0)
  if (watNow.getHours() < 8) start.setDate(start.getDate() - 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end, startISO: start.toISOString(), endISO: end.toISOString() }
}
