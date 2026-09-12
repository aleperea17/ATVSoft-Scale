'use client'

import { useCallback, useEffect, useState } from 'react'

import { apiFetch, backendAuthHeaders, formatApiDetail } from '@/lib/api'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatCash } from '@/shared/lib/format-utils'

type FeedPost = {
  id: string
  title: string | null
  media_type: string | null
  url: string | null
  external_id: string
  keyword: string | null
  published_at: string | null
  agenda_token: string
  chats: number
  agendas: number
  cash_total: number
  cpc: number
  metrics: {
    views?: number
    reach?: number
    likes?: number
    comentarios?: number
    shares?: number
    guardados?: number
    thumbnail?: string
  }
}

export default function PostsFijadosPage() {
  const { ready } = useAuthUser()
  const { toast } = useToast()
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [permalink, setPermalink] = useState('')
  const [kwDraft, setKwDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/feed-posts', { headers: backendAuthHeaders() })
      const data = (await res.json().catch(() => ({}))) as { posts?: FeedPost[]; detail?: unknown }
      if (!res.ok) {
        toast(formatApiDetail(data.detail) || 'No se pudieron cargar los posts.')
        setPosts([])
        return
      }
      const list = Array.isArray(data.posts) ? data.posts : []
      setPosts(list)
      const drafts: Record<string, string> = {}
      for (const p of list) drafts[p.id] = p.keyword || ''
      setKwDraft(drafts)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!ready) return
    void load()
  }, [ready, load])

  const addPost = async () => {
    const raw = permalink.trim()
    if (!raw) {
      toast('Pegá el permalink o el media_id del post.')
      return
    }
    setAdding(true)
    try {
      const res = await apiFetch('/feed-posts/add', {
        method: 'POST',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ permalink_or_media_id: raw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(formatApiDetail((data as { detail?: unknown }).detail) || 'No se pudo agregar el post.')
        return
      }
      setPermalink('')
      toast('Post agregado y métricas sincronizadas.')
      await load()
    } finally {
      setAdding(false)
    }
  }

  const refreshAll = async () => {
    setRefreshing(true)
    try {
      const res = await apiFetch('/feed-posts/refresh-metrics', {
        method: 'POST',
        headers: backendAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(formatApiDetail((data as { detail?: unknown }).detail) || 'Error al refrescar.')
        return
      }
      toast('Métricas actualizadas.')
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  const saveKeyword = async (id: string) => {
    const keyword = (kwDraft[id] || '').trim() || null
    const res = await apiFetch(`/feed-posts/${id}/keyword`, {
      method: 'PATCH',
      headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keyword }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast(formatApiDetail((data as { detail?: unknown }).detail) || 'No se pudo guardar keyword.')
      return
    }
    toast('Keyword guardada.')
    await load()
  }

  const removePost = async (id: string) => {
    if (!confirm('¿Quitar este post del trackeo? (no borra el post en Instagram)')) return
    const res = await apiFetch(`/feed-posts/${id}`, {
      method: 'DELETE',
      headers: backendAuthHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast(formatApiDetail((data as { detail?: unknown }).detail) || 'No se pudo eliminar.')
      return
    }
    await load()
  }

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando…</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">Post fijados</h2>
          <p className="mt-1 max-w-xl text-[12px] text-[var(--text3)]">
            Trackeá carruseles/posts de feed (p. ej. los fijados del perfil). Cada uno tiene su propio token{' '}
            <span className="font-mono-num text-[var(--text2)]">post:&lt;id&gt;</span> para atribuir leads.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing || posts.length === 0}
          onClick={() => void refreshAll()}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] hover:border-[var(--accent)] disabled:opacity-50"
        >
          {refreshing ? 'Refrescando…' : 'Refrescar métricas'}
        </button>
      </div>

      <div className="mb-8 rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Agregar post (permalink o media_id)
        </h3>
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={permalink}
            onChange={(e) => setPermalink(e.target.value)}
            placeholder="https://www.instagram.com/p/XXXX/ o 1789…"
            className="min-w-[280px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            disabled={adding}
            onClick={() => void addPost()}
            className="rounded-lg bg-[var(--accent)] px-5 py-2 text-[12px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            {adding ? 'Validando insights…' : 'Agregar'}
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border2)] py-16 text-center text-[13px] text-[var(--text3)]">
          Todavía no hay posts. Agregá los 3 fijados con su permalink.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => {
            const thumb = String(p.metrics?.thumbnail || '').trim()
            const thumbUrl = thumb ? `/api/proxy-image?url=${encodeURIComponent(thumb)}` : ''
            return (
              <article
                key={p.id}
                className="overflow-hidden rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
              >
                <div className="aspect-square max-h-[220px] w-full bg-[var(--bg3)]">
                  {thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[var(--text3)]">Sin preview</div>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <div className="line-clamp-2 text-[14px] font-semibold text-[var(--text)]">
                      {p.title || `Post ${p.id}`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--text3)]">
                      <span className="rounded bg-[var(--bg4)] px-1.5 py-0.5 font-mono-num">{p.agenda_token}</span>
                      {p.media_type ? <span>{p.media_type}</span> : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {(
                      [
                        ['Views', p.metrics.views],
                        ['Reach', p.metrics.reach],
                        ['Likes', p.metrics.likes],
                        ['Coment.', p.metrics.comentarios],
                        ['Shares', p.metrics.shares],
                        ['Saved', p.metrics.guardados],
                      ] as const
                    ).map(([label, val]) => (
                      <div key={label} className="rounded-lg bg-[var(--bg4)] px-1 py-2">
                        <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">{label}</div>
                        <div className="font-mono-num text-[13px] font-semibold text-[var(--text)]">
                          {Number(val || 0).toLocaleString('es-AR')}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text2)]">
                    <span>
                      Chats <strong className="font-mono-num">{p.chats}</strong>
                    </span>
                    <span>
                      Agendas <strong className="font-mono-num">{p.agendas}</strong>
                    </span>
                    <span className="text-[var(--green)]">
                      Cash <strong className="font-mono-num">{formatCash(p.cash_total)}</strong>
                    </span>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                      Keyword ManyChat
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={kwDraft[p.id] ?? ''}
                        onChange={(e) => setKwDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
                        placeholder="keyword"
                      />
                      <button
                        type="button"
                        onClick={() => void saveKeyword(p.id)}
                        className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[11px] font-medium text-[var(--text2)] hover:border-[var(--accent)]"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[var(--accent)] hover:underline"
                      >
                        Abrir en Instagram
                      </a>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => void removePost(p.id)}
                      className="text-[11px] text-[var(--text3)] hover:text-[var(--red)]"
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
