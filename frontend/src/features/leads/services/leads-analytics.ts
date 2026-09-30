import { apiFetch } from '@/lib/api'
import {
  resolveLeadStatusFlags,
  type LeadStatusCatalogItem,
} from '@/shared/lib/lead-status-flags'
import {
  type AnalyticsPeriod,
  daysInInclusiveRange,
  displayRangeForPeriod,
  formatDayAxisLabel,
  isoWeekBucketsInRange,
  monthRangeIso,
  periodQueryString,
} from '@/shared/lib/date-range'

export { monthRangeIso }
export type { AnalyticsPeriod }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type LeadRow = Record<string, unknown> & {
  email?: string | null
  ingresos_rango?: string | null
  es_cuota_plazo?: boolean | null
}

let _statusCatalog: LeadStatusCatalogItem[] | null = null

/** Inyectá el catálogo de estados (GET /lead-statuses) antes de calcular embudos. */
export function setLeadStatusCatalog(catalog: LeadStatusCatalogItem[] | null | undefined) {
  _statusCatalog = catalog && catalog.length > 0 ? catalog : null
}

export function getLeadStatusCatalog(): LeadStatusCatalogItem[] | null {
  return _statusCatalog
}

export type LeadsFunnel = {
  chats: number
  conversaciones: number
  agendas: number
  shows: number
  noShows: number
  cierres: number
  ingresos: number       // cash collected (payment)
  facturacion: number    // total revenue billed
  closeRate: number
  showUpRate: number
  tasaAgendamiento: number
  cashPorAgenda: number
  cashPorShow: number
  aov: number            // cash collected ÷ cantidad de ventas
}

export type WeekMetrics = {
  agendas: number[]
  conversaciones: number[]
  shows: number[]
  cierres: number[]
  /** Cash por bucket: suma en vivo de `Lead.pago`. El embudo mensual `ingresos` sigue siendo Pagó + seguimiento. */
  ingresos: number[]
  /** Facturación en euros (mismo criterio que `funnel.facturacion` / `leadFacturacionUsd`) por bucket semanal. */
  facturacion: number[]
  noShows: number[]
}

export type CashCollectedComposition = {
  /** Suma columna Pagó en leads del mes. */
  pago: number
  /** Formularios de seguimiento del mes. */
  seguimiento: number
}

export type LeadsAnalytics = LeadsFunnel & {
  chatsStories: number
  chatsReels: number
  conversacionesStories: number
  conversacionesReels: number
  agendasStories: number
  agendasReels: number
  agendasAds: number
  showsOrganico: number
  showsAds: number
  cierresOrganico: number
  cierresAds: number
  programas: { nombre: string; ventas: number; ingresos: number }[]
  weekLabels: string[]
  dayLabels: string[]
  byWeek: WeekMetrics
  byDay: WeekMetrics
  cashCollectedComposition: CashCollectedComposition
}

export type MemberMetrics = LeadsFunnel & {
  name: string
  leads: LeadRow[]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE CALCULATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function leadIsCuotaPlazo(l: LeadRow): boolean {
  const v = l.es_cuota_plazo
  return v === true || v === 1 || v === 'true' || v === '1'
}

export function leadHasAgenda(l: LeadRow): boolean {
  if (leadIsCuotaPlazo(l)) return false
  const ag = l.agendo
  const hasAgendo = ag != null && String(ag).trim() !== ''
  return !!(l.scheduled_at || l.call_at || l.call || hasAgendo)
}

export function leadHasShow(l: LeadRow): boolean {
  const flags = resolveLeadStatusFlags(String(l.status ?? ''), _statusCatalog)
  return leadHasAgenda(l) && !flags.counts_as_no_show
}

export function leadIsCierre(l: LeadRow): boolean {
  if (leadIsCuotaPlazo(l)) return false
  return resolveLeadStatusFlags(String(l.status ?? ''), _statusCatalog).counts_as_cierre
}

function textLooksLikeBioTraffic(s: string): boolean {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return false
  if (t === 'bio') return true
  if (t.includes('información') || t.includes('informacion')) return true
  if (/\binfo\b/.test(t)) return true
  if ((t.includes('link') || t.includes('enlace')) && (t.includes('bio') || t.includes('biografía') || t.includes('perfil'))) return true
  if (t.includes('link en bio') || t.includes('link del perfil') || t.includes('desde perfil')) return true
  return false
}

export type LeadChatSource = 'Historias' | 'Reels' | 'Perfil' | 'YouTube' | 'Posts' | 'Otros'

export function classifyLeadChatSource(l: LeadRow): LeadChatSource {
  const url = String(l.content_url || '').toLowerCase()
  if (url.includes('/reel/') || url.includes('instagram.com/reel')) return 'Reels'
  const candidates = [
    l.agenda_point,
    l.entry_channel,
    l.entry_funnel,
    l.keyword,
    l.origin,
  ].map(v => String(v || '').trim().toLowerCase())
  for (const s of candidates) {
    if (!s) continue
    if (s.startsWith('post:') || s === 'post_fijado_instagram') return 'Posts'
    if (s.startsWith('story:') || s.includes('historia') || /\bstor(y|ies)\b/.test(s)) return 'Historias'
    if (s.includes('reel') || /^\d+$/.test(s)) return 'Reels'
    if (textLooksLikeBioTraffic(s) || s === 'perfil') return 'Perfil'
    if (s === 'youtube' || s.startsWith('youtube:')) return 'YouTube'
  }
  const origin = String(l.origin || '').trim().toLowerCase()
  if (origin === 'youtube') return 'YouTube'
  const entryChannel = String(l.entry_channel || '').trim().toLowerCase()
  if (entryChannel === 'youtube') return 'YouTube'
  return 'Otros'
}

export type FunnelLeadStep = 'CHATS' | 'CONVERSACIONES' | 'AGENDAS' | 'SHOWS' | 'CIERRES'

export function filterLeadsForFunnelStep(leads: LeadRow[], step: FunnelLeadStep): LeadRow[] {
  switch (step) {
    case 'CHATS':
    case 'CONVERSACIONES':
      return leads
    case 'AGENDAS':
      return leads.filter(leadHasAgenda)
    case 'SHOWS':
      return leads.filter(leadHasShow)
    case 'CIERRES':
      return leads.filter(leadIsCierre)
    default:
      return leads
  }
}

export function sortLeadsForFunnelStep(leads: LeadRow[], step: FunnelLeadStep): LeadRow[] {
  const ts = (l: LeadRow, keys: string[]) => {
    for (const k of keys) {
      const n = Date.parse(String(l[k] ?? ''))
      if (!Number.isNaN(n)) return n
    }
    return 0
  }
  const keysByStep: Record<FunnelLeadStep, string[]> = {
    CHATS: ['fecha_bot', 'date', 'first_contact_at'],
    CONVERSACIONES: ['fecha_bot', 'date', 'first_contact_at'],
    AGENDAS: ['agendo', 'scheduled_at', 'call_at', 'call'],
    SHOWS: ['call', 'scheduled_at', 'call_at', 'agendo'],
    CIERRES: ['agendo', 'call', 'scheduled_at', 'date'],
  }
  const keys = keysByStep[step]
  return [...leads].sort((a, b) => ts(b, keys) - ts(a, keys))
}

export function calcFunnel(leads: LeadRow[], conversaciones?: number): LeadsFunnel {
  const agendas = leads.filter(leadHasAgenda).length
  const noShows = leads.filter(
    (l) => resolveLeadStatusFlags(String(l.status ?? ''), _statusCatalog).counts_as_no_show,
  ).length
  const shows = leads.filter(leadHasShow).length
  const cierres = leads.filter(leadIsCierre).length
  const ingresos = leads.reduce((s, l) => s + (Number(l.payment) || 0), 0)
  const facturacion = leads.reduce((s, l) => s + (Number(l.revenue) || 0), 0)
  const conv = conversaciones ?? leads.length

  return {
    chats: 0,
    conversaciones: conv,
    agendas, shows, noShows, cierres, ingresos, facturacion,
    closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
    showUpRate: agendas > 0 ? ((agendas - noShows) / agendas) * 100 : 0,
    tasaAgendamiento: conv > 0 ? (agendas / conv) * 100 : 0,
    cashPorAgenda: agendas > 0 ? ingresos / agendas : 0,
    cashPorShow: shows > 0 ? ingresos / shows : 0,
    aov: cierres > 0 ? ingresos / cierres : 0,
  }
}

export function distribute(total: number, n: number): number[] {
  const arr: number[] = []
  const base = Math.floor(total / n)
  const rem = total - base * n
  for (let i = 0; i < n; i++) arr.push(base + (i < rem ? 1 : 0))
  return arr
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FULL ANALYTICS (for sales-dashboard)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Igual que status: ignorar mayúsculas y acentos al cruzar programa del lead con el catálogo. */
function normProgramLookupKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

function resolveProgramPrice(programPrices: Record<string, number>, progRaw: unknown): number | null {
  const raw = String(progRaw ?? '').trim()
  if (!raw) return null
  if (Object.prototype.hasOwnProperty.call(programPrices, raw)) {
    const v = programPrices[raw]
    return v !== undefined ? v : null
  }
  const nk = normProgramLookupKey(raw)
  for (const [k, v] of Object.entries(programPrices)) {
    if (normProgramLookupKey(k) === nk) return v
  }
  return null
}

/** ISO `YYYY-MM-DD` para bucket semanal/diario de facturación en leads. */
function leadMetricDateIso(l: LeadRow): string | null {
  // Mismo orden que GET /leads ?month= (call > agendo > fecha_bot > created_at/`date`).
  const candidates = [l.call, l.scheduled_at, l.call_at, l.agendo, l.fecha_bot, l.date]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (!s) continue
    const head = s.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  }
  return null
}

function emptyMetrics(n: number): WeekMetrics {
  const z = () => Array.from({ length: n }, () => 0)
  return {
    agendas: z(),
    conversaciones: z(),
    shows: z(),
    cierres: z(),
    ingresos: z(),
    facturacion: z(),
    noShows: z(),
  }
}

function resolveAnalyticsPeriod(input: string | AnalyticsPeriod): AnalyticsPeriod {
  if (typeof input === 'string') return { kind: 'month', month: input }
  return input
}

export async function getLeadsAnalytics(
  monthOrPeriod: string | AnalyticsPeriod,
): Promise<{ leads: LeadRow[]; analytics: LeadsAnalytics; conversaciones: number }> {
  try {
    const stRes = await apiFetch('/lead-statuses')
    if (stRes.ok) {
      const stj = (await stRes.json().catch(() => ({}))) as { statuses?: LeadStatusCatalogItem[] }
      if (Array.isArray(stj.statuses)) setLeadStatusCatalog(stj.statuses)
    }
  } catch {
    /* catálogo default vía resolveLeadStatusFlags */
  }

  const leads: LeadRow[] = []
  const setterReports: Record<string, unknown>[] = []
  const closerReports: Record<string, unknown>[] = []
  let programPrices: Record<string, number> = {}

  const period = resolveAnalyticsPeriod(monthOrPeriod)
  const bucketRange = displayRangeForPeriod(period)
  const q = periodQueryString(period)
  let seguimientoTotal = 0
  let chatsReels = 0
  let chatsStories = 0
  try {
    const leadsReq = apiFetch(`/leads?${q}`)
    const programsReq = apiFetch('/programs')
    const reelsMetricsReq = apiFetch(`/reels/metrics?${q}`)
    const storiesMetricsReq = apiFetch(`/stories/metrics?${q}`)
    const segReq = apiFetch(`/team/seguimiento-reports/month?${q}`)
    const reportsReq = apiFetch(
      `/team/reports?desde=${encodeURIComponent(bucketRange.desde)}&hasta=${encodeURIComponent(bucketRange.hasta)}`,
    )
    const [leadsRes, repRes, progRes, segRes, reelsMetricsRes, storiesMetricsRes] = await Promise.all([
      leadsReq,
      reportsReq,
      programsReq,
      segReq,
      reelsMetricsReq,
      storiesMetricsReq,
    ])
    if (leadsRes.ok) {
      const j = (await leadsRes.json().catch(() => ({}))) as { leads?: LeadRow[] }
      if (Array.isArray(j.leads)) leads.push(...j.leads)
    }
    if (progRes.ok) {
      const pj = (await progRes.json().catch(() => ({}))) as {
        programs?: { name?: string; price_usd?: number }[]
      }
      const next: Record<string, number> = {}
      for (const p of pj.programs || []) {
        const n = String(p?.name ?? '').trim()
        if (n) next[n] = Number(p?.price_usd) || 0
      }
      programPrices = next
    }

    if (segRes.ok) {
      const sj = (await segRes.json().catch(() => ({}))) as {
        total?: unknown
      }
      seguimientoTotal = Number(sj.total) || 0
    }

    if (repRes.ok) {
      const j = (await repRes.json().catch(() => ({}))) as { reports?: unknown[] }
      if (Array.isArray(j.reports)) {
        for (const raw of j.reports) {
          const r = raw as Record<string, unknown>
          const fecha = String(r.fecha ?? '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue
          if (r.kind === 'setter') {
            setterReports.push({
              date: fecha,
              conversaciones: Number(r.conversaciones) || 0,
              agendas: Number(r.agendas) || 0,
              conversaciones_stories: Number(r.conversaciones_stories) || 0,
              conversaciones_reels: Number(r.conversaciones_reels) || 0,
              agendas_stories: Number(r.agendas_stories) || 0,
              agendas_reels: Number(r.agendas_reels) || 0,
              agendas_ads: Number(r.agendas_ads) || 0,
              shows: 0,
              cierres: 0,
              ingreso: 0,
            })
          } else if (r.kind === 'closer') {
            closerReports.push({
              date: fecha,
              conversaciones: 0,
              agendas: 0,
              shows: Number(r.shows) || 0,
              cierres: Number(r.cierres) || 0,
              shows_organico: Number(r.shows_organico) || 0,
              shows_ads: Number(r.shows_ads) || 0,
              cierres_organico: Number(r.cierres_organico) || 0,
              cierres_ads: Number(r.cierres_ads) || 0,
              reservas: Number(r.reservas) || 0,
              ingreso: Number(r.ingreso) || 0,
            })
          }
        }
      }
    }

    if (reelsMetricsRes.ok) {
      const reelsMetricsData = (await reelsMetricsRes.json().catch(() => ({}))) as {
        chats_del_mes?: number
      }
      chatsReels = reelsMetricsData?.chats_del_mes ?? 0
    }
    if (storiesMetricsRes.ok) {
      const storiesMetricsData = (await storiesMetricsRes.json().catch(() => ({}))) as {
        chats_del_mes?: number
      }
      chatsStories = storiesMetricsData?.chats_del_mes ?? 0
    }
  } catch {
    /* red / sin sesión: seguimos con arrays vacíos */
  }

  const chats = chatsReels + chatsStories

  // Embudo: setter reports (conversaciones/agendas) + leads en vivo (shows/cierres/cash).
  // Mes de cada lead = mismo filtro que GET /leads?month= (call > agendo > fecha_bot > created_at).
  const sumField = (reports: Record<string, unknown>[], field: string) =>
    reports.reduce((s, r) => s + (Number(r[field]) || 0), 0)

  const conversaciones = sumField(setterReports, 'conversaciones')
  const agendas = sumField(setterReports, 'agendas')
  /** Shows / cierres en vivo: flag del catálogo LeadStatusType (no CloserReport congelado). */
  const shows = leads.filter(leadHasShow).length
  const cierres = leads.filter(leadIsCierre).length
  const noShows = leads.filter(
    (l) => resolveLeadStatusFlags(String(l.status ?? ''), _statusCatalog).counts_as_no_show,
  ).length
  const conversacionesStories = sumField(setterReports, 'conversaciones_stories')
  const conversacionesReels = sumField(setterReports, 'conversaciones_reels')
  const agendasStories = sumField(setterReports, 'agendas_stories')
  const agendasReels = sumField(setterReports, 'agendas_reels')
  const agendasAds = sumField(setterReports, 'agendas_ads')
  /** Desglose orgánico/ads sigue en reportes (campos legacy; suele ser 0). */
  const showsOrganico = sumField(closerReports, 'shows_organico')
  const showsAds = sumField(closerReports, 'shows_ads')
  const cierresOrganico = sumField(closerReports, 'cierres_organico')
  const cierresAds = sumField(closerReports, 'cierres_ads')
  /** Ingreso declarado en reportes closer (solo fallback facturación si no hay programa en leads). */
  const ingresosReports = sumField(closerReports, 'ingreso')
  const cashFromLeadsPayments = leads.reduce((s, l) => s + (Number(l.payment) || 0), 0)
  /** Cash collected = suma columna Pagó (`payment`) en leads del mes + montos de formularios de seguimiento. */
  const cashCollected = cashFromLeadsPayments + seguimientoTotal

  const catalogDefined = Object.keys(programPrices).length > 0
  const leadsWithProgramOfferedCount = leads.filter(
    (l) => String(l.program_offered ?? '').trim() !== '',
  ).length

  /**
   * Facturación por programa: solo «Prog. comprado» (`program_offered` / `programa_ofrecido` en BD).
   * `programada_ofrecido_llamada` no interviene aquí.
   */
  const leadFacturacionUsd = (l: LeadRow): number => {
    const prog = String(l.program_offered ?? '').trim()
    const apiPriceRaw = l.program_price_usd
    const hasApiPrice = apiPriceRaw != null && Number.isFinite(Number(apiPriceRaw))

    if (!prog) {
      if (!catalogDefined && !hasApiPrice) {
        return Number(l.revenue) || Number(l.payment) || 0
      }
      return 0
    }

    if (hasApiPrice) return Number(apiPriceRaw)
    const priced = resolveProgramPrice(programPrices, l.program_offered)
    if (priced != null) return priced
    return Number(l.revenue) || 0
  }

  const revenueLeads = leads.reduce((s, l) => s + leadFacturacionUsd(l), 0)
  const facturacion = revenueLeads > 0 ? revenueLeads : ingresosReports

  /** Cantidad de ventas: leads con Prog. comprado; si no hay, cierres en vivo. */
  const ventas =
    leadsWithProgramOfferedCount > 0 ? leadsWithProgramOfferedCount : cierres

  const funnel: LeadsFunnel = {
    chats,
    conversaciones,
    agendas,
    shows,
    noShows,
    cierres,
    ingresos: cashCollected,
    facturacion,
    closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
    showUpRate: agendas > 0 ? (shows / agendas) * 100 : 0,
    tasaAgendamiento: conversaciones > 0 ? (agendas / conversaciones) * 100 : 0,
    cashPorAgenda: agendas > 0 ? cashCollected / agendas : 0,
    cashPorShow: shows > 0 ? cashCollected / shows : 0,
    // AOV = cash collected ÷ cantidad de ventas
    aov: ventas > 0 ? cashCollected / ventas : 0,
  }

  // Programs breakdown (solo programa comprado / facturación; no `programada_ofrecido_llamada`)
  const progMap: Record<string, { ventas: number; ingresos: number }> = {}
  leads.forEach(l => {
    const p = String(l.program_offered ?? '').trim()
    if (!p) return
    progMap[p] = progMap[p] || { ventas: 0, ingresos: 0 }
    progMap[p].ventas++
    if (catalogDefined) {
      progMap[p].ingresos += leadFacturacionUsd(l)
    } else {
      progMap[p].ingresos += Number(l.payment) || 0
    }
  })
  const programas = Object.entries(progMap)
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => b.ingresos - a.ingresos)

  const allReports = [...setterReports, ...closerReports]
  const weekBuckets = isoWeekBucketsInRange(bucketRange.desde, bucketRange.hasta)
  const dayList = daysInInclusiveRange(bucketRange.desde, bucketRange.hasta)
  const byWeek = emptyMetrics(weekBuckets.length)
  const byDay = emptyMetrics(dayList.length)
  const weekLabels = weekBuckets.map((b) => b.label)
  const dayLabels = dayList.map((d) => formatDayAxisLabel(d))

  const weekIndexFor = (iso: string) => weekBuckets.findIndex((b) => iso >= b.desde && iso <= b.hasta)
  const dayIndexFor = (iso: string) => dayList.indexOf(iso)

  allReports.forEach((r: Record<string, unknown>) => {
    const iso = String(r.date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return
    const w = weekIndexFor(iso)
    const di = dayIndexFor(iso)
    const conv = Number(r.conversaciones) || 0
    const ag = Number(r.agendas) || 0
    if (w >= 0) {
      byWeek.conversaciones[w] += conv
      byWeek.agendas[w] += ag
    }
    if (di >= 0) {
      byDay.conversaciones[di] += conv
      byDay.agendas[di] += ag
    }
  })

  leads.forEach((l) => {
    const iso = leadMetricDateIso(l)
    if (!iso) return
    const w = weekIndexFor(iso)
    const di = dayIndexFor(iso)
    const bump = (target: WeekMetrics, idx: number) => {
      if (idx < 0) return
      if (leadHasShow(l)) target.shows[idx] += 1
      if (leadIsCierre(l)) target.cierres[idx] += 1
      if (resolveLeadStatusFlags(String(l.status ?? ''), _statusCatalog).counts_as_no_show) {
        target.noShows[idx] += 1
      }
      const pago = Number(l.payment) || 0
      if (pago !== 0) target.ingresos[idx] += pago
    }
    bump(byWeek, w)
    bump(byDay, di)
  })

  leads.forEach((l) => {
    const bill = leadFacturacionUsd(l)
    if (bill <= 0) return
    const iso = leadMetricDateIso(l)
    if (!iso) return
    const w = weekIndexFor(iso)
    const di = dayIndexFor(iso)
    if (w >= 0) byWeek.facturacion[w] += bill
    if (di >= 0) byDay.facturacion[di] += bill
  })

  return {
    leads,
    conversaciones,
    analytics: {
      ...funnel,
      chatsStories,
      chatsReels,
      conversacionesStories,
      conversacionesReels,
      agendasStories,
      agendasReels,
      agendasAds,
      showsOrganico,
      showsAds,
      cierresOrganico,
      cierresAds,
      programas,
      weekLabels,
      dayLabels,
      byWeek,
      byDay,
      cashCollectedComposition: {
        pago: cashFromLeadsPayments,
        seguimiento: seguimientoTotal,
      },
    },
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEMBER METRICS (for setter/closer dashboards)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getMemberMetrics(
  allLeads: LeadRow[],
  memberName: string,
  field: 'setter' | 'closer'
): MemberMetrics {
  const memberLeads = allLeads.filter(l => l[field] === memberName)
  const funnel = calcFunnel(memberLeads)
  return { ...funnel, name: memberName, leads: memberLeads }
}
