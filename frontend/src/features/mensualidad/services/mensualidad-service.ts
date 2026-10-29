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
}

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
  }
  return {
    username: raw.username || '',
    vence: raw.mensualidad_vence ?? null,
    diasRestantes: raw.mensualidad_dias_restantes ?? null,
  }
}

type ApiMensualidad = { vence?: string | null; dias_restantes?: number | null; detail?: string }

async function parseAdmin(res: Response): Promise<Mensualidad> {
  const raw = (await res.json().catch(() => ({}))) as ApiMensualidad
  if (res.status === 403) {
    clearAdminPanelToken()
    throw new Error('Sesión admin expirada. Volvé a ingresar la contraseña.')
  }
  if (!res.ok) throw new Error(raw.detail || 'No se pudo actualizar la mensualidad.')
  return { vence: raw.vence ?? null, diasRestantes: raw.dias_restantes ?? null }
}

export async function getAdminMensualidad(token: string): Promise<Mensualidad> {
  return parseAdmin(
    await apiFetch('/admin/panel/mensualidad', { headers: { 'X-Admin-Panel-Token': token } }),
  )
}

export async function setAdminMensualidad(token: string, vence: string | null): Promise<Mensualidad> {
  return parseAdmin(
    await apiFetch('/admin/panel/mensualidad', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Panel-Token': token },
      body: JSON.stringify({ vence }),
    }),
  )
}

export async function extenderAdminMensualidad(token: string, dias = 30): Promise<Mensualidad> {
  return parseAdmin(
    await apiFetch('/admin/panel/mensualidad/extender', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Panel-Token': token },
      body: JSON.stringify({ dias }),
    }),
  )
}

export function formatVence(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
