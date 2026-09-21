'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionCard } from '@/features/conexiones/connection-card'
import { platformsForApp } from '@/features/conexiones/connection-platforms'
import { backendAuthHeaders } from '@/lib/api'
import { API_BASE } from '@/shared/lib/backend-public-url'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type Connection = {
  id?: string
  platform: string
  account_key: string
  credentials: Record<string, string>
  last_sync_at: string | null
}

const PLATFORMS = platformsForApp()

const CALENDLY_LABELS: Record<string, string> = {
  clienta: 'Clienta',
  closer: 'Closer',
}

function calendlyDisplayLabel(accountKey: string, credentials?: Record<string, string>): string {
  const custom = String(credentials?.account_label || '').trim()
  if (custom) return `Calendly (${custom})`
  const known = CALENDLY_LABELS[accountKey] || accountKey.replace(/_/g, ' ')
  return `Calendly (${known.charAt(0).toUpperCase()}${known.slice(1)})`
}

function nextCalendlyAccountKey(existing: string[]): string {
  const set = new Set(existing.map((k) => k.toLowerCase()))
  if (!set.has('clienta') && !set.has('')) return 'clienta'
  if (!set.has('closer')) return 'closer'
  let i = 2
  while (set.has(`cuenta${i}`)) i += 1
  return `cuenta${i}`
}

export default function ConexionesPage() {
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [draftCalendlyKeys, setDraftCalendlyKeys] = useState<string[]>([])

  const fetchConnections = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setConnections([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/conexiones`, { headers: backendAuthHeaders() })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar conexiones: ${detail}`)
        setConnections([])
        return
      }
      if (!Array.isArray(raw)) {
        toast('Error al cargar conexiones: respuesta inválida del servidor.')
        setConnections([])
        return
      }
      const rows = raw as Array<{
        id: string
        platform: string
        account_key?: string
        credentials: Record<string, unknown>
        last_sync_at: string | null
      }>
      const list: Connection[] = rows.map((row) => {
        const creds: Record<string, string> = {}
        Object.entries(row.credentials || {}).forEach(([k, v]) => {
          creds[k] = v == null ? '' : String(v)
        })
        const ak = String(row.account_key || '').trim()
        return {
          id: row.id,
          platform: row.platform,
          account_key: row.platform === 'calendly' ? ak || 'clienta' : ak,
          credentials: creds,
          last_sync_at: row.last_sync_at,
        }
      })
      setConnections(list)
      setDraftCalendlyKeys((prev) =>
        prev.filter((k) => !list.some((c) => c.platform === 'calendly' && c.account_key === k)),
      )
    } finally {
      setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    void fetchConnections()
  }, [fetchConnections])

  const saveConnection = useCallback(
    async (platform: string, credentials: Record<string, string>, accountKey?: string) => {
      if (!userId) {
        toast('Iniciá sesión para guardar conexiones.')
        return
      }
      const body: { credentials: Record<string, string>; account_key?: string } = { credentials }
      if (platform === 'calendly' && accountKey) {
        body.account_key = accountKey
      }
      const res = await fetch(`${API_BASE}/conexiones/${encodeURIComponent(platform)}`, {
        method: 'PUT',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        throw new Error(detail)
      }
      const label =
        platform === 'calendly' && accountKey
          ? calendlyDisplayLabel(accountKey, credentials)
          : platform
      toast(`${label} guardado ✓`)
      await fetchConnections()
    },
    [userId, toast, fetchConnections],
  )

  const deleteConnection = useCallback(
    async (platform: string, accountKey?: string) => {
      if (!userId) {
        toast('Iniciá sesión para desconectar.')
        return
      }
      const qs =
        platform === 'calendly' && accountKey
          ? `?account_key=${encodeURIComponent(accountKey)}`
          : ''
      const res = await fetch(`${API_BASE}/conexiones/${encodeURIComponent(platform)}${qs}`, {
        method: 'DELETE',
        headers: backendAuthHeaders(),
      })
      if (!res.ok && res.status !== 204) {
        const raw = await res.json().catch(() => ({}))
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        throw new Error(detail)
      }
      toast(
        platform === 'calendly' && accountKey
          ? `${calendlyDisplayLabel(accountKey)} desconectado`
          : `${platform} desconectado`,
      )
      await fetchConnections()
    },
    [userId, toast, fetchConnections],
  )

  const calendlySlots = useMemo(() => {
    const saved = connections.filter((c) => c.platform === 'calendly')
    const keys = new Set(saved.map((c) => c.account_key))
    const drafts = draftCalendlyKeys
      .filter((k) => !keys.has(k))
      .map(
        (k): Connection => ({
          platform: 'calendly',
          account_key: k,
          credentials: {},
          last_sync_at: null,
        }),
      )
    const all = [...saved, ...drafts]
    if (all.length === 0) {
      return [
        {
          platform: 'calendly',
          account_key: 'clienta',
          credentials: {},
          last_sync_at: null,
        } satisfies Connection,
      ]
    }
    return all.sort((a, b) => a.account_key.localeCompare(b.account_key))
  }, [connections, draftCalendlyKeys])

  const addCalendlyAccount = useCallback(() => {
    const existing = [
      ...connections.filter((c) => c.platform === 'calendly').map((c) => c.account_key),
      ...draftCalendlyKeys,
    ]
    const next = nextCalendlyAccountKey(existing)
    setDraftCalendlyKeys((prev) => [...prev, next])
  }, [connections, draftCalendlyKeys])

  if (loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando…</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Conexiones API</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Conectá tus cuentas para importar contenido. Las credenciales se guardan en tu instancia.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {PLATFORMS.map((p) => {
          if (p.key === 'calendly') {
            return (
              <div key="calendly-group" className="flex flex-col gap-4">
                {calendlySlots.map((row) => {
                  const isDraft = !row.id
                  const label = calendlyDisplayLabel(row.account_key, row.credentials)
                  return (
                    <ConnectionCard
                      key={`calendly-${row.account_key}`}
                      platform={{ ...p, label, subtitle: `Cuenta ${row.account_key}` }}
                      connection={row}
                      accountKey={row.account_key}
                      apiBase={API_BASE}
                      onSave={(creds) => saveConnection('calendly', creds, row.account_key)}
                      onDisconnect={
                        isDraft
                          ? async () => {
                              setDraftCalendlyKeys((prev) =>
                                prev.filter((k) => k !== row.account_key),
                              )
                            }
                          : () => deleteConnection('calendly', row.account_key)
                      }
                      onSyncComplete={fetchConnections}
                    />
                  )
                })}
                <button
                  type="button"
                  onClick={addCalendlyAccount}
                  className="rounded-lg border border-dashed border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-left text-[12px] font-medium text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  + Agregar otra cuenta Calendly
                </button>
              </div>
            )
          }

          const row = connections.find((c) => c.platform === p.key)
          return (
            <ConnectionCard
              key={p.key}
              platform={p}
              connection={row}
              apiBase={API_BASE}
              onSave={(creds) => saveConnection(p.key, creds)}
              onDisconnect={row?.id ? () => deleteConnection(p.key) : undefined}
              onSyncComplete={fetchConnections}
            />
          )
        })}
      </div>
    </div>
  )
}
