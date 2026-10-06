/** Fecha de cobro vs fecha de llamada. Reutilizable (Equipo no cableado en este lote). */

export type IngresosBase = 'llamada' | 'pago'

export function leadCallWallDateIso(l: Record<string, unknown>): string | null {
  const candidates = [l.call, l.scheduled_at, l.call_at, l.agendo, l.fecha_bot, l.date]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (!s) continue
    const head = s.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  }
  return null
}

export function leadFechaCobroIso(l: Record<string, unknown>): string | null {
  const s = String(l.fecha_cobro ?? '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Modo pago: fecha_cobro o fallback de llamada (históricos sin estampar). */
export function leadCobroWallDateIso(l: Record<string, unknown>): string | null {
  return leadFechaCobroIso(l) ?? leadCallWallDateIso(l)
}

export function leadHasPago(l: Record<string, unknown>): boolean {
  return (Number(l.payment) || 0) > 0
}
