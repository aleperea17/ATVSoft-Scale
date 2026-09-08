'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, backendAuthHeaders, resolveBackendUserId } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

type StatusRow = {
  id: number
  nombre: string
  color: string
  activo: boolean
  sort_order: number
  counts_as_cierre: boolean
  counts_as_no_show: boolean
  requires_followup_date: boolean
  is_default: boolean
}

function isValidHexColor(s: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(s.trim())
}

export default function EstadosPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6B7280')
  const [newCierre, setNewCierre] = useState(false)
  const [newNoShow, setNewNoShow] = useState(false)
  const [newFollowup, setNewFollowup] = useState(false)
  const [newDefault, setNewDefault] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#6B7280')
  const [editCierre, setEditCierre] = useState(false)
  const [editNoShow, setEditNoShow] = useState(false)
  const [editFollowup, setEditFollowup] = useState(false)
  const [editDefault, setEditDefault] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const fetchStatuses = useCallback(async () => {
    if (!ready) return
    if (!resolveBackendUserId()) {
      setStatuses([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/lead-statuses', { headers: backendAuthHeaders() })
      const data = (await res.json().catch(() => ({}))) as { statuses?: StatusRow[] }
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar estados: ${detail}`)
        setStatuses([])
        return
      }
      setStatuses(Array.isArray(data.statuses) ? data.statuses : [])
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  useEffect(() => {
    void fetchStatuses()
  }, [fetchStatuses])

  const notifyChanged = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('lead-status-types-updated'))
    }
  }

  const addStatus = async () => {
    const nombre = newName.trim()
    const color = newColor.trim()
    if (!nombre) {
      toast('Ingresá el nombre del estado')
      return
    }
    if (!isValidHexColor(color)) {
      toast('Color inválido (usá formato #RRGGBB)')
      return
    }
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar')
      return
    }
    setAdding(true)
    try {
      const res = await apiFetch('/lead-statuses', {
        method: 'POST',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          nombre,
          color,
          activo: true,
          counts_as_cierre: newCierre,
          counts_as_no_show: newNoShow,
          requires_followup_date: newFollowup,
          is_default: newDefault,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo crear: ${detail}`)
        return
      }
      setNewName('')
      setNewColor('#6B7280')
      setNewCierre(false)
      setNewNoShow(false)
      setNewFollowup(false)
      setNewDefault(false)
      await fetchStatuses()
      notifyChanged()
      toast('Estado creado')
    } finally {
      setAdding(false)
    }
  }

  const startEdit = (a: StatusRow) => {
    setEditingId(a.id)
    setEditName(a.nombre)
    setEditColor(a.color || '#6B7280')
    setEditCierre(!!a.counts_as_cierre)
    setEditNoShow(!!a.counts_as_no_show)
    setEditFollowup(!!a.requires_followup_date)
    setEditDefault(!!a.is_default)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async () => {
    if (editingId == null) return
    const nombre = editName.trim()
    const color = editColor.trim()
    if (!nombre) {
      toast('El nombre no puede estar vacío')
      return
    }
    if (!isValidHexColor(color)) {
      toast('Color inválido (usá formato #RRGGBB)')
      return
    }
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para guardar')
      return
    }
    setBusyId(editingId)
    try {
      const res = await apiFetch(`/lead-statuses/${editingId}`, {
        method: 'PATCH',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          nombre,
          color,
          counts_as_cierre: editCierre,
          counts_as_no_show: editNoShow,
          requires_followup_date: editFollowup,
          is_default: editDefault,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo guardar: ${detail}`)
        return
      }
      cancelEdit()
      await fetchStatuses()
      notifyChanged()
      toast('Cambios guardados')
    } finally {
      setBusyId(null)
    }
  }

  const toggleActivo = async (a: StatusRow) => {
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para editar')
      return
    }
    setBusyId(a.id)
    try {
      const res = await apiFetch(`/lead-statuses/${a.id}`, {
        method: 'PATCH',
        headers: backendAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ activo: !a.activo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo actualizar: ${detail}`)
        return
      }
      await fetchStatuses()
      notifyChanged()
    } finally {
      setBusyId(null)
    }
  }

  const removeStatus = async (id: number) => {
    if (!resolveBackendUserId()) {
      toast('Iniciá sesión para editar')
      return
    }
    setBusyId(id)
    try {
      const res = await apiFetch(`/lead-statuses/${id}`, {
        method: 'DELETE',
        headers: backendAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo eliminar: ${detail}`)
        return
      }
      if (editingId === id) cancelEdit()
      await fetchStatuses()
      notifyChanged()
      toast('Estado eliminado')
    } finally {
      setBusyId(null)
    }
  }

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  const flagChecks = (
    cierre: boolean,
    setCierre: (v: boolean) => void,
    noshow: boolean,
    setNoshow: (v: boolean) => void,
    follow: boolean,
    setFollow: (v: boolean) => void,
    isDef: boolean,
    setDef: (v: boolean) => void,
    disabled?: boolean,
  ) => (
    <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text2)]">
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={cierre} disabled={disabled} onChange={(e) => setCierre(e.target.checked)} />
        Cierre
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={noshow} disabled={disabled} onChange={(e) => setNoshow(e.target.checked)} />
        No show
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={follow} disabled={disabled} onChange={(e) => setFollow(e.target.checked)} />
        Seg. pago
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={isDef} disabled={disabled} onChange={(e) => setDef(e.target.checked)} />
        Default
      </label>
    </div>
  )

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">Estados de Lead</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Catálogo editable de status. Los roles (Cierre / No show / Seg. pago) alimentan el embudo y el
          reporte automático del closer — no hace falta que el nombre coincida con un string fijo.
          «Default» es el estado al crear un lead nuevo. Calendly/GHL escriben el estado «Reserva» al agendar.
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]">
        <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
          Nuevo estado
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Nombre</span>
            <input
              type="text"
              value={newName}
              disabled={adding}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Cerrado PIF"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="flex w-[160px] flex-col gap-1">
            <span className="text-[11px] text-[var(--text3)]">Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                disabled={adding}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-9 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
              />
              <input
                type="text"
                value={newColor}
                disabled={adding}
                onChange={(e) => setNewColor(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-2 py-2 font-mono-num text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </label>
          <button
            type="button"
            disabled={adding}
            onClick={() => void addStatus()}
            className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2 text-[12px] font-semibold text-[var(--auth-cta-text)] hover:opacity-95 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
        <div className="mt-3">
          {flagChecks(newCierre, setNewCierre, newNoShow, setNewNoShow, newFollowup, setNewFollowup, newDefault, setNewDefault, adding)}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border2)] bg-[var(--bg2)]">
        <table className="w-full min-w-[780px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg3)]">
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Estado</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Roles</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Activo</th>
              <th className="w-[220px] px-4 py-3 font-semibold text-[var(--text2)]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {statuses.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--text3)]">
                  Todavía no hay estados. Se seedarán al entrar o agregá uno arriba.
                </td>
              </tr>
            ) : (
              statuses.map((a) => {
                const isEdit = editingId === a.id
                const busy = busyId === a.id
                return (
                  <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--text)]">
                      {isEdit ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            disabled={busy}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full max-w-[220px] rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[13px] outline-none"
                          />
                          <input
                            type="color"
                            value={editColor}
                            disabled={busy}
                            onChange={(e) => setEditColor(e.target.value)}
                            className="h-8 w-9 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
                          />
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                            style={{
                              backgroundColor: `${a.color}18`,
                              color: a.color,
                              border: `1px solid ${a.color}30`,
                            }}
                          >
                            {a.nombre}
                          </span>
                          {a.is_default && (
                            <span className="text-[10px] uppercase tracking-wide text-[var(--text3)]">default</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEdit
                        ? flagChecks(
                            editCierre,
                            setEditCierre,
                            editNoShow,
                            setEditNoShow,
                            editFollowup,
                            setEditFollowup,
                            editDefault,
                            setEditDefault,
                            busy,
                          )
                        : (
                          <span className="text-[11px] text-[var(--text3)]">
                            {[
                              a.counts_as_cierre ? 'Cierre' : null,
                              a.counts_as_no_show ? 'No show' : null,
                              a.requires_followup_date ? 'Seg. pago' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </span>
                          )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={busy || isEdit}
                        onClick={() => void toggleActivo(a)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                          a.activo ? 'bg-[var(--green)]' : 'bg-[var(--border2)]'
                        }`}
                        aria-pressed={a.activo}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            a.activo ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {isEdit ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveEdit()}
                            className="rounded-md bg-[var(--auth-cta-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--auth-cta-text)] disabled:opacity-50"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={cancelEdit}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:bg-[var(--bg3)]"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startEdit(a)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:bg-[var(--bg3)]"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeStatus(a.id)}
                            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--text2)] hover:underline"
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
