import { addCalendarDaysIso } from '@/shared/lib/company-timezone'

export type AnalyticsPeriod =
  | { kind: 'month'; month: string }
  | { kind: 'range'; desde: string; hasta: string }

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim())
}

/** Fecha lista para aplicar al contexto (nativo incompleto emite `''`). */
export function isCommittedIsoDate(s: string): boolean {
  if (!isIsoDate(s)) return false
  const y = Number(s.slice(0, 4))
  return y >= 2000 && y <= 2100
}

export function monthRangeIso(month: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null
  const desde = `${y}-${String(mo).padStart(2, '0')}-01`
  const last = new Date(y, mo, 0).getDate()
  const hasta = `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { desde, hasta }
}

export function lastDayOfMonthIso(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null
  const last = new Date(y, mo, 0).getDate()
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function isFullCalendarMonth(desde: string, hasta: string): boolean {
  if (!isIsoDate(desde) || !isIsoDate(hasta)) return false
  if (!desde.endsWith('-01')) return false
  const last = lastDayOfMonthIso(desde.slice(0, 7))
  return last != null && hasta === last
}

/** Mes calendario anterior `YYYY-MM`. */
export function previousYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function inclusiveDayCount(desde: string, hasta: string): number {
  if (!isIsoDate(desde) || !isIsoDate(hasta) || desde > hasta) return 0
  let n = 0
  let cur = desde
  while (cur <= hasta) {
    n += 1
    cur = addCalendarDaysIso(cur, 1)
  }
  return n
}

export function daysInInclusiveRange(desde: string, hasta: string): string[] {
  if (!isIsoDate(desde) || !isIsoDate(hasta) || desde > hasta) return []
  const out: string[] = []
  let cur = desde
  while (cur <= hasta) {
    out.push(cur)
    cur = addCalendarDaysIso(cur, 1)
  }
  return out
}

export function periodFromUiRange(desde: string, hasta: string): AnalyticsPeriod {
  if (isFullCalendarMonth(desde, hasta)) {
    return { kind: 'month', month: desde.slice(0, 7) }
  }
  return { kind: 'range', desde, hasta }
}

/**
 * Mes calendario completo → mes anterior completo (misma regla que MonthSelector).
 * Rango arbitrario → misma cantidad de días, inmediatamente antes.
 */
export function previousComparisonPeriod(desde: string, hasta: string): AnalyticsPeriod {
  if (isFullCalendarMonth(desde, hasta)) {
    return { kind: 'month', month: previousYearMonth(desde.slice(0, 7)) }
  }
  const n = inclusiveDayCount(desde, hasta)
  const prevHasta = addCalendarDaysIso(desde, -1)
  const prevDesde = addCalendarDaysIso(desde, -n)
  return { kind: 'range', desde: prevDesde, hasta: prevHasta }
}

export function periodQueryString(period: AnalyticsPeriod): string {
  if (period.kind === 'month') {
    return `month=${encodeURIComponent(period.month)}`
  }
  return `desde=${encodeURIComponent(period.desde)}&hasta=${encodeURIComponent(period.hasta)}`
}

export function displayRangeForPeriod(period: AnalyticsPeriod): { desde: string; hasta: string } {
  if (period.kind === 'range') return { desde: period.desde, hasta: period.hasta }
  return monthRangeIso(period.month) ?? { desde: `${period.month}-01`, hasta: `${period.month}-01` }
}

function parseYmd(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/** Lunes ISO (lunes=inicio) de la semana que contiene `iso`. */
export function isoMondayOf(iso: string): string {
  const p = parseYmd(iso)
  if (!p) return iso
  const utc = Date.UTC(p.y, p.m - 1, p.d)
  const dow = new Date(utc).getUTCDay() // 0=dom
  const delta = dow === 0 ? -6 : 1 - dow
  return addCalendarDaysIso(iso, delta)
}

export function isoSundayOf(iso: string): string {
  return addCalendarDaysIso(isoMondayOf(iso), 6)
}

export type IsoWeekBucket = { desde: string; hasta: string; label: string }

function formatDayMonth(iso: string): string {
  const p = parseYmd(iso)
  if (!p) return iso
  return `${p.d} ${MONTHS_SHORT[p.m - 1] ?? ''}`
}

export function formatIsoWeekLabel(desde: string, hasta: string): string {
  const a = parseYmd(desde)
  const b = parseYmd(hasta)
  if (!a || !b) return `${desde}–${hasta}`
  if (a.m === b.m && a.y === b.y) {
    return `${a.d}–${b.d} ${MONTHS_SHORT[a.m - 1]}`
  }
  return `${formatDayMonth(desde)} – ${formatDayMonth(hasta)}`
}

export function formatDayAxisLabel(iso: string): string {
  const p = parseYmd(iso)
  if (!p) return iso
  return `${p.d}/${String(p.m).padStart(2, '0')}`
}

/** Semanas ISO lunes–domingo recortadas a [desde, hasta]. */
export function isoWeekBucketsInRange(desde: string, hasta: string): IsoWeekBucket[] {
  if (!isIsoDate(desde) || !isIsoDate(hasta) || desde > hasta) return []
  const buckets: IsoWeekBucket[] = []
  let cursor = isoMondayOf(desde)
  const lastMonday = isoMondayOf(hasta)
  while (cursor <= lastMonday) {
    const weekEnd = addCalendarDaysIso(cursor, 6)
    const clipStart = cursor < desde ? desde : cursor
    const clipEnd = weekEnd > hasta ? hasta : weekEnd
    if (clipStart <= clipEnd) {
      buckets.push({
        desde: clipStart,
        hasta: clipEnd,
        label: formatIsoWeekLabel(clipStart, clipEnd),
      })
    }
    cursor = addCalendarDaysIso(cursor, 7)
  }
  return buckets
}

export function applyThisMonthRange(month: string): { desde: string; hasta: string } | null {
  return monthRangeIso(month)
}
