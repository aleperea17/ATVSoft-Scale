'use client'


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

const KEY_STORAGE = 'atvscale_mensualidad_key'

export type MensualidadCuenta = Mensualidad & { userId: number; username: string }

type ApiCuenta = {
  user_id: number
  username: string
  vence?: string | null
  dias_restantes?: number | null
}

export function readMensualidadKey(): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem(KEY_STORAGE) || ''
}

export function writeMensualidadKey(key: string): void {
  if (key) sessionStorage.setItem(KEY_STORAGE, key)
  else sessionStorage.removeItem(KEY_STORAGE)
}

function toCuenta(raw: ApiCuenta): MensualidadCuenta {
  return {
    userId: raw.user_id,
    username: raw.username,
    vence: raw.vence ?? null,
    diasRestantes: raw.dias_restantes ?? null,
  }
}

async function adminFetch(key: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BACKEND_BASE}/api/admin/mensualidad${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Mensualidad-Key': key },
  })
  const raw = (await res.json().catch(() => ({}))) as { detail?: string }
  if (res.status === 403) {
    writeMensualidadKey('')
    throw new Error('Clave incorrecta.')
  }
  if (!res.ok) throw new Error(raw.detail || 'No se pudo actualizar la mensualidad.')
  return raw
}

export async function listMensualidades(key: string): Promise<MensualidadCuenta[]> {
  return ((await adminFetch(key, '')) as ApiCuenta[]).map(toCuenta)
}

export async function setMensualidad(key: string, userId: number, vence: string | null): Promise<MensualidadCuenta> {
  return toCuenta(
    (await adminFetch(key, `/${userId}`, { method: 'PUT', body: JSON.stringify({ vence }) })) as ApiCuenta,
  )
}

export async function extenderMensualidad(key: string, userId: number, dias = 30): Promise<MensualidadCuenta> {
  return toCuenta(
    (await adminFetch(key, `/${userId}/extender`, {
      method: 'POST',
      body: JSON.stringify({ dias }),
    })) as ApiCuenta,
  )
}

export function formatVence(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
