'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { resolveMediaUrl } from '@/shared/lib/backend-public-url'

const AR_TZ = 'America/Argentina/Buenos_Aires'

type SequenceSummary = {
  sequence_id: string
  label: string
  sequence_date: string
  thumbnail_url: string | null
  chats: number
  agendas: number
  has_cta: boolean
  dolor: string | null
  slides_count: number
}

type SequencesSummaryResponse = {
  sequences?: SequenceSummary[]
  total_chats?: number
}

function currentMonthYm(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `${y}-${m}`
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: AR_TZ })
}

function formatSequenceDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!m) return isoDate
  const [, y, mo, d] = m
  return `${d}/${mo}/${y}`
}

function SequenceChatCard({ sequence }: { sequence: SequenceSummary }) {
  const [imgErr, setImgErr] = useState(false)
  const rawThumb = sequence.thumbnail_url?.trim() || ''
  const resolved = rawThumb ? resolveMediaUrl(rawThumb) : ''
  const thumb =
    resolved && !imgErr
      ? resolved.startsWith('http')
        ? `/api/proxy-image?url=${encodeURIComponent(resolved)}`
        : resolved
      : ''

  return (
    <div className="glass-card overflow-hidden">
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
            <div className="mb-1 text-3xl">📱</div>
            <div className="max-w-full truncate px-3 text-center text-[10px] text-[var(--text3)]">
              {sequence.label}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 pt-10">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-white/90">{sequence.label}</div>
              <div className="text-[10px] text-white/70">{formatSequenceDate(sequence.sequence_date)}</div>
              {sequence.dolor ? (
                <div className="mt-1 truncate text-[10px] text-red-300/90">{sequence.dolor}</div>
              ) : null}
            </div>
            <div className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-center shadow-lg">
              <div className="font-mono-num text-lg font-bold leading-none tabular-nums text-white">
                {sequence.chats}
              </div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-white/80">
                {sequence.chats === 1 ? 'chat' : 'chats'}
              </div>
            </div>
          </div>
        </div>
        {sequence.has_cta ? (
          <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300 backdrop-blur-sm">
            CTA
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-[10px] text-[var(--text3)]">
        <span>{sequence.slides_count} {sequence.slides_count === 1 ? 'historia' : 'historias'}</span>
        {sequence.agendas > 0 ? (
          <span>
            {sequence.agendas} {sequence.agendas === 1 ? 'agenda' : 'agendas'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export default function MetricasHistoriasPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonthYm)
  const [sequences, setSequences] = useState<SequenceSummary[]>([])
  const [totalChats, setTotalChats] = useState(0)

  const monthLabel = useMemo(() => formatMonthLabel(month), [month])

  const fetchSummary = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const res = await apiFetch(`/stories/sequences-summary?month=${encodeURIComponent(month)}`)
      const data = (await res.json().catch(() => ({}))) as SequencesSummaryResponse
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar métricas de historias: ${detail}`)
        setSequences([])
        setTotalChats(0)
        return
      }
      setSequences(Array.isArray(data.sequences) ? data.sequences : [])
      setTotalChats(Number(data.total_chats ?? 0))
    } catch (e) {
      toast(`Error al cargar métricas de historias: ${(e as Error).message}`)
      setSequences([])
      setTotalChats(0)
    } finally {
      setLoading(false)
    }
  }, [ready, toast, month])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Métricas historias</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">
            Chats (replies de Instagram) por secuencia — {monthLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonthYm())}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
          />
          <span className="rounded-full bg-[var(--bg4)] px-3 py-1.5 text-[11px] text-[var(--text3)]">
            Total chats:{' '}
            <span className="font-mono-num font-semibold tabular-nums text-[var(--text)]">{totalChats}</span>
          </span>
        </div>
      </div>

      {sequences.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">
          No hay secuencias en este mes. Creá o sincronizá historias en{' '}
          <span className="text-[var(--text2)]">Historias</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sequences.map((seq) => (
            <SequenceChatCard key={seq.sequence_id} sequence={seq} />
          ))}
        </div>
      )}
    </div>
  )
}
