'use client'

import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

const AR_TZ = 'America/Argentina/Buenos_Aires'
const PAGE_SIZE = 20

type ReelSummary = {
  reel_id: string
  label: string
  keyword: string | null
  thumbnail_url: string | null
  permalink: string | null
  published_at: string | null
  leads: number
}

type KeywordClientRow = {
  lead_id: string
  nombre: string
  instagram: string
  reel_id?: string | null
  reel_permalink: string | null
  reel_published_at: string | null
  keyword: string
}

type ReelsSummaryResponse = {
  reels?: ReelSummary[]
  total_leads?: number
}

type KeywordsResponse = {
  rows?: KeywordClientRow[]
  total?: number
}

function formatPublishedDate(isoDate: string | null): string {
  if (!isoDate?.trim()) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (m) {
    const [, , mo, d] = m
    return `${d}/${mo}`
  }
  const t = Date.parse(isoDate)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleDateString('es-AR', { timeZone: AR_TZ, day: '2-digit', month: '2-digit' })
}

function ReelLeadCard({
  reel,
  selected,
  onSelect,
}: {
  reel: ReelSummary
  selected: boolean
  onSelect: () => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const rawThumb = reel.thumbnail_url?.trim() || ''
  const thumb = rawThumb && !imgErr ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : ''
  const dateLabel = formatPublishedDate(reel.published_at)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`glass-card group w-full overflow-hidden text-left transition-all hover:ring-1 hover:ring-[var(--border2)] ${
        selected ? 'ring-2 ring-[var(--accent)]' : ''
      }`}
    >
      <div className="relative">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-44 w-full object-cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="flex h-44 w-full flex-col items-center justify-center bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)]">
            <div className="mb-1 text-3xl">🎥</div>
            <div className="max-w-full truncate px-3 text-center text-[10px] text-[var(--text3)]">
              {reel.keyword || reel.label}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 pt-10">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              {dateLabel ? (
                <div className="text-[10px] font-medium uppercase tracking-wide text-white/70">{dateLabel}</div>
              ) : null}
              {reel.keyword ? (
                <div className="truncate text-[11px] font-medium text-white/90">{reel.keyword}</div>
              ) : null}
            </div>
            <div className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-center shadow-lg">
              <div className="font-mono-num text-lg font-bold leading-none tabular-nums text-white">{reel.leads}</div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-white/80">
                {reel.leads === 1 ? 'lead' : 'leads'}
              </div>
            </div>
          </div>
        </div>
        {reel.permalink ? (
          <a
            href={reel.permalink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white/70 backdrop-blur-sm transition-colors hover:text-white"
            aria-label="Abrir reel en Instagram"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        ) : null}
      </div>
    </button>
  )
}

export default function KeywordsPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [reels, setReels] = useState<ReelSummary[]>([])
  const [totalLeads, setTotalLeads] = useState(0)
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null)
  const [leadRows, setLeadRows] = useState<KeywordClientRow[]>([])
  const [leadTotal, setLeadTotal] = useState(0)
  const [leadPage, setLeadPage] = useState(1)
  const [leadsLoading, setLeadsLoading] = useState(false)

  const fetchSummary = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const res = await apiFetch('/keywords/reels-summary')
      const data = (await res.json().catch(() => ({}))) as ReelsSummaryResponse
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar leads por reel: ${detail}`)
        setReels([])
        setTotalLeads(0)
        return
      }
      setReels(Array.isArray(data.reels) ? data.reels : [])
      setTotalLeads(Number(data.total_leads ?? 0))
    } catch (e) {
      toast(`Error al cargar leads por reel: ${(e as Error).message}`)
      setReels([])
      setTotalLeads(0)
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  const fetchLeadsForReel = useCallback(
    async (reelId: string, page: number) => {
      if (!ready) return
      setLeadsLoading(true)
      try {
        const q = new URLSearchParams()
        q.set('page', String(page))
        q.set('page_size', String(PAGE_SIZE))
        q.set('reel_id', reelId)
        const res = await apiFetch(`/keywords?${q.toString()}`)
        const data = (await res.json().catch(() => ({}))) as KeywordsResponse
        if (!res.ok) {
          setLeadRows([])
          setLeadTotal(0)
          return
        }
        setLeadRows(Array.isArray(data.rows) ? data.rows : [])
        setLeadTotal(Number(data.total ?? 0))
      } catch {
        setLeadRows([])
        setLeadTotal(0)
      } finally {
        setLeadsLoading(false)
      }
    },
    [ready],
  )

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    if (!selectedReelId) {
      setLeadRows([])
      setLeadTotal(0)
      setLeadPage(1)
      return
    }
    fetchLeadsForReel(selectedReelId, leadPage)
  }, [selectedReelId, leadPage, fetchLeadsForReel])

  const selectedReel = reels.find((r) => r.reel_id === selectedReelId) ?? null
  const leadTotalPages = Math.max(1, Math.ceil(leadTotal / PAGE_SIZE))

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Lead por reel</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">
            Leads atribuidos por keyword ManyChat. Tocá un reel para ver el detalle.
          </p>
        </div>
        <span className="rounded-full bg-[var(--bg4)] px-3 py-1.5 text-[11px] text-[var(--text3)]">
          Total leads:{' '}
          <span className="font-mono-num font-semibold tabular-nums text-[var(--text)]">{totalLeads}</span>
        </span>
      </div>

      {reels.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">
          No hay reels con keyword configurada. Cargá la keyword en{' '}
          <span className="text-[var(--text2)]">Reels</span> para empezar a trackear leads.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {reels.map((reel) => (
            <ReelLeadCard
              key={reel.reel_id}
              reel={reel}
              selected={selectedReelId === reel.reel_id}
              onSelect={() => {
                setSelectedReelId((prev) => (prev === reel.reel_id ? null : reel.reel_id))
                setLeadPage(1)
              }}
            />
          ))}
        </div>
      )}

      {selectedReel ? (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-[var(--text)]">
              Leads de {selectedReel.label}
            </h3>
            <span className="text-[11px] text-[var(--text3)]">
              {leadTotal} {leadTotal === 1 ? 'lead' : 'leads'}
            </span>
          </div>

          {leadsLoading ? (
            <div className="py-8 text-center text-[12px] text-[var(--text3)]">Cargando leads…</div>
          ) : leadRows.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[var(--text3)]">
              Este reel todavía no tiene leads con su keyword.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,120px)] gap-4 px-4 py-2 sm:grid">
                {['Nombre', 'Instagram', 'Keyword'].map((h) => (
                  <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                    {h}
                  </div>
                ))}
              </div>
              {leadRows.map((r) => (
                <div key={`${r.lead_id}-${r.keyword}`} className="glass-card overflow-hidden">
                  <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,120px)] sm:items-center sm:gap-4">
                    <div className="min-w-0 truncate text-[13px] text-[var(--text)]">{r.nombre || '—'}</div>
                    <div className="min-w-0 truncate text-[13px] text-[var(--text2)]">{r.instagram || '—'}</div>
                    <div className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">{r.keyword}</div>
                  </div>
                </div>
              ))}
              {leadTotalPages > 1 ? (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={leadPage <= 1}
                    onClick={() => setLeadPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="text-[12px] text-[var(--text3)]">
                    Página {leadPage} de {leadTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={leadPage >= leadTotalPages}
                    onClick={() => setLeadPage((p) => Math.min(leadTotalPages, p + 1))}
                    className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
