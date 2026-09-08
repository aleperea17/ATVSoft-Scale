/** Seed / fallback de estados de Lead (alineado con backend lead_statuses_services). */

export type LeadStatusDefault = {
  nombre: string
  color: string
  counts_as_cierre: boolean
  counts_as_no_show: boolean
  requires_followup_date: boolean
  is_default: boolean
}

export const DEFAULT_LEAD_STATUSES: LeadStatusDefault[] = [
  {
    nombre: 'Pendiente de pago',
    color: '#94A3B8',
    counts_as_cierre: false,
    counts_as_no_show: false,
    requires_followup_date: false,
    is_default: true,
  },
  {
    nombre: 'Seguimiento post llamada',
    color: '#60A5FA',
    counts_as_cierre: false,
    counts_as_no_show: false,
    requires_followup_date: false,
    is_default: false,
  },
  {
    nombre: 'Reserva',
    color: '#FB923C',
    counts_as_cierre: false,
    counts_as_no_show: false,
    requires_followup_date: false,
    is_default: false,
  },
  {
    nombre: 'Cerrado PIF',
    color: '#4ADE80',
    counts_as_cierre: true,
    counts_as_no_show: false,
    requires_followup_date: false,
    is_default: false,
  },
  {
    nombre: 'Cerrado PLAZOS',
    color: '#22C55E',
    counts_as_cierre: true,
    counts_as_no_show: false,
    requires_followup_date: true,
    is_default: false,
  },
  {
    nombre: 'No show',
    color: '#F87171',
    counts_as_cierre: false,
    counts_as_no_show: true,
    requires_followup_date: false,
    is_default: false,
  },
  {
    nombre: 'Re-agendada',
    color: '#FBBF24',
    counts_as_cierre: false,
    counts_as_no_show: false,
    requires_followup_date: false,
    is_default: false,
  },
  {
    nombre: 'No compra',
    color: '#A855F7',
    counts_as_cierre: false,
    counts_as_no_show: false,
    requires_followup_date: false,
    is_default: false,
  },
]

export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  DEFAULT_LEAD_STATUSES.map((s) => [s.nombre, s.color]),
)

export const STATUS_OPTIONS: string[] = DEFAULT_LEAD_STATUSES.map((s) => s.nombre)

export const FALLBACK_DEFAULT_STATUS =
  DEFAULT_LEAD_STATUSES.find((s) => s.is_default)?.nombre ?? 'Pendiente de pago'
