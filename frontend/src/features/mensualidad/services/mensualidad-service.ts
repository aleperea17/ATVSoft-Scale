'use client'

import { apiFetch } from '@/lib/api'
import { clearAdminPanelToken } from '@/features/admin-panel/services/admin-panel-service'

const BACKEND_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

/** WhatsApp de Franco para extender la mensualidad (Argentina: 54 + 9 + número). */
export const MENSUALIDAD_WHATSAPP = '5493804219551'

export type Mensualidad = {
  vence: string | null
  diasRestantes: number | null
  plazoDias: number
  bloqueada: boolean
}

export type MensualidadCuenta = Mensualidad & { userId: number; username: string }

function readToken(): string | null {
  if (typeof window === 'undefined') return null
  return (
    sessionStorage.getItem('evoluciona_token') ||
    sessionStorage.getItem('access_token') ||
    sessionStorage.getItem('token') ||
    sessionStorage.getItem('auth_token')
  )
}

export function mensualidadWhatsappUrl(username: string): string {
  const texto = `Hola Franco! Quiero extender mi mensualidad de ATV Scale${username ? ` (usuario: ${username})` : ''}.`
  return `https://wa.me/${MENSUALIDAD_WHATSAPP}?text=${encodeURIComponent(texto)}`
}

/** Días de plazo que le quedan a una cuenta vencida (0 = hoy es el último). */
export function plazoRestante(m: Mensualidad): number | null {
  if (m.diasRestantes == null || m.diasRestantes >= 0 || m.bloqueada) return null
  return m.plazoDias + m.diasRestantes
}

export async function getMiMensualidad(): Promise<(Mensualidad & { username: string }) | null> {
  const token = readToken()
  if (!token) return null
  const res = await fetch(`${BACKEND_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const raw = (await res.json().catch(() => ({}))) as {
    username?: string
    mensualidad_vence?: string | null
    mensualidad_dias_restantes?: number | null
    mensualidad_plazo_dias?: number
    mensualidad_bloqueada?: boolean
  }
  return {
    username: raw.username || '',
    vence: raw.mensualidad_vence ?? null,
    diasRestantes: raw.mensualidad_dias_restantes ?? null,
    plazoDias: raw.mensualidad_plazo_dias ?? 0,
    bloqueada: Boolean(raw.mensualidad_bloqueada),
  }
}

type ApiCuenta = {
  user_id: number
  username: string
  vence?: string | null
  dias_restantes?: number | null
  plazo_dias?: number
  bloqueada?: boolean
}

function toCuenta(raw: ApiCuenta): MensualidadCuenta {
  return {
    userId: raw.user_id,
    username: raw.username,
    vence: raw.vence ?? null,
    diasRestantes: raw.dias_restantes ?? null,
    plazoDias: raw.plazo_dias ?? 0,
    bloqueada: Boolean(raw.bloqueada),
  }
}

async function adminFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await apiFetch(`/admin/panel/mensualidades${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Panel-Token': token },
  })
  const raw = (await res.json().catch(() => ({}))) as { detail?: string }
  if (res.status === 403) {
    clearAdminPanelToken()
    throw new Error('Sesión admin expirada. Volvé a ingresar la contraseña.')
  }
  if (!res.ok) throw new Error(raw.detail || 'No se pudo actualizar la mensualidad.')
  return raw
}

export async function listMensualidades(token: string): Promise<MensualidadCuenta[]> {
  return ((await adminFetch(token, '')) as ApiCuenta[]).map(toCuenta)
}

export async function activarMensualidad(
  token: string,
  userId: number,
  dias: number,
  plazoDias: number,
): Promise<MensualidadCuenta> {
  return toCuenta(
    (await adminFetch(token, `/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ dias, plazo_dias: plazoDias }),
    })) as ApiCuenta,
  )
}

export async function quitarMensualidad(token: string, userId: number): Promise<MensualidadCuenta> {
  return toCuenta((await adminFetch(token, `/${userId}`, { method: 'DELETE' })) as ApiCuenta)
}

export function formatVence(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
