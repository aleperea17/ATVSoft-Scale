import {
  DEFAULT_LEAD_STATUSES,
  FALLBACK_DEFAULT_STATUS,
  type LeadStatusDefault,
} from '@/shared/constants/lead-status-defaults'

export type LeadStatusCatalogItem = {
  id?: number
  nombre: string
  color: string
  activo?: boolean
  counts_as_cierre: boolean
  counts_as_no_show: boolean
  requires_followup_date: boolean
  is_default?: boolean
}

export type LeadStatusFlags = {
  counts_as_cierre: boolean
  counts_as_no_show: boolean
  requires_followup_date: boolean
}

const LEGACY_ROLES: Record<string, LeadStatusFlags> = {
  cerrado: { counts_as_cierre: true, counts_as_no_show: false, requires_followup_date: false },
  cerrados: { counts_as_cierre: true, counts_as_no_show: false, requires_followup_date: false },
  closed: { counts_as_cierre: true, counts_as_no_show: false, requires_followup_date: false },
  won: { counts_as_cierre: true, counts_as_no_show: false, requires_followup_date: false },
  'cerrado pif': { counts_as_cierre: true, counts_as_no_show: false, requires_followup_date: false },
  'cerrado plazos': { counts_as_cierre: true, counts_as_no_show: false, requires_followup_date: true },
  'no show': { counts_as_cierre: false, counts_as_no_show: true, requires_followup_date: false },
  noshow: { counts_as_cierre: false, counts_as_no_show: true, requires_followup_date: false },
}

const LEGACY_NAME_MAP: Record<string, string> = {
  pendiente: 'Pendiente de pago',
  pending: 'Pendiente de pago',
  seguimiento: 'Seguimiento post llamada',
  'en seguimiento': 'Seguimiento post llamada',
  follow: 'Seguimiento post llamada',
  'follow up': 'Seguimiento post llamada',
  agendado: 'Reserva',
  're-agenda': 'Re-agendada',
  're agenda': 'Re-agendada',
  reagenda: 'Re-agendada',
  descalificado: 'No compra',
  disqualified: 'No compra',
  cerrado: 'Cerrado PIF',
  cerrados: 'Cerrado PIF',
  closed: 'Cerrado PIF',
  won: 'Cerrado PIF',
  seña: 'Reserva',
  sena: 'Reserva',
}

export function normStatusKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
}

export function emptyStatusFlags(): LeadStatusFlags {
  return { counts_as_cierre: false, counts_as_no_show: false, requires_followup_date: false }
}

export function resolveLeadStatusFlags(
  status: string | null | undefined,
  catalog?: LeadStatusCatalogItem[] | null,
): LeadStatusFlags {
  const raw = String(status ?? '').trim()
  const key = normStatusKey(raw)
  if (!key) return emptyStatusFlags()

  const list = catalog && catalog.length > 0 ? catalog : DEFAULT_LEAD_STATUSES
  for (const row of list) {
    if (normStatusKey(row.nombre) === key) {
      return {
        counts_as_cierre: !!row.counts_as_cierre,
        counts_as_no_show: !!row.counts_as_no_show,
        requires_followup_date: !!row.requires_followup_date,
      }
    }
  }
  const legacy = LEGACY_ROLES[key]
  if (legacy) return { ...legacy }
  return emptyStatusFlags()
}

/** Unifica variantes / legacy al nombre canónico del catálogo. */
export function canonicalLeadStatus(
  raw: string | null | undefined,
  catalog?: LeadStatusCatalogItem[] | null,
): string {
  const s = (raw ?? '').trim()
  if (!s) {
    const def = (catalog || DEFAULT_LEAD_STATUSES).find((x) => x.is_default)
    return def?.nombre || FALLBACK_DEFAULT_STATUS
  }
  const n = normStatusKey(s)
  const list = catalog && catalog.length > 0 ? catalog : DEFAULT_LEAD_STATUSES
  const fromCat = list.find((o) => normStatusKey(o.nombre) === n)
  if (fromCat) return fromCat.nombre
  const mapped = LEGACY_NAME_MAP[n]
  if (mapped) {
    const hit = list.find((o) => normStatusKey(o.nombre) === normStatusKey(mapped))
    return hit?.nombre || mapped
  }
  return s
}

export function defaultStatusName(catalog?: LeadStatusCatalogItem[] | null): string {
  const list = catalog && catalog.length > 0 ? catalog : DEFAULT_LEAD_STATUSES
  const def = list.find((x) => x.is_default && x.activo !== false)
  if (def) return def.nombre
  const first = list.find((x) => x.activo !== false)
  return first?.nombre || FALLBACK_DEFAULT_STATUS
}

export function activeStatusOptions(catalog?: LeadStatusCatalogItem[] | null): string[] {
  const list = catalog && catalog.length > 0 ? catalog : DEFAULT_LEAD_STATUSES
  return list.filter((x) => x.activo !== false).map((x) => x.nombre)
}

export function statusColorMap(catalog?: LeadStatusCatalogItem[] | null): Record<string, string> {
  const list = catalog && catalog.length > 0 ? catalog : DEFAULT_LEAD_STATUSES
  return Object.fromEntries(list.map((x) => [x.nombre, x.color || '#6B7280']))
}

export function buildStatusTabs(catalog?: LeadStatusCatalogItem[] | null): string[] {
  const opts = activeStatusOptions(catalog)
  const rest = opts.filter((n) => {
    const f = resolveLeadStatusFlags(n, catalog)
    return !f.counts_as_cierre
  })
  return ['Todos', 'Cerrados', ...rest]
}

export function catalogFromDefaults(): LeadStatusCatalogItem[] {
  return DEFAULT_LEAD_STATUSES.map((s: LeadStatusDefault) => ({ ...s, activo: true }))
}
