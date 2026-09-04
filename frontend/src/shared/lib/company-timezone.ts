/** Zona horaria operativa de Scale: fija, no configurable. */
export const COMPANY_TIMEZONE = 'Europe/Madrid'

export function getResolvedCompanyTimezone(): string {
  return COMPANY_TIMEZONE
}

export function calendarPartsInTimeZone(
  date: Date,
  timeZone: string = COMPANY_TIMEZONE,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  const parts = dtf.formatToParts(date)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { year: n('year'), month: n('month'), day: n('day') }
}

/** YYYY-MM-DD en el calendario de Madrid (no UTC ni el del navegador). */
export function todayIsoInCompanyTz(timeZone: string = COMPANY_TIMEZONE): string {
  const p = calendarPartsInTimeZone(new Date(), timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function monthKeyInCompanyTz(
  timeZone: string = COMPANY_TIMEZONE,
  date: Date = new Date(),
): string {
  const p = calendarPartsInTimeZone(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

/** Suma días de calendario a un `YYYY-MM-DD` (aritmética UTC sobre fecha civil, no hora local). */
export function addCalendarDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)
  const d = new Date(utc)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function dateKeyInCompanyTz(
  isoOrDate: string | Date,
  timeZone: string = COMPANY_TIMEZONE,
): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) {
    const s = String(isoOrDate)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
  }
  const p = calendarPartsInTimeZone(d, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
