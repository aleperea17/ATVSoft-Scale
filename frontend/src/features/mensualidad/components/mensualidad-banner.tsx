'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '@/features/auth/services/auth-service'
import { BrandLogo } from '@/shared/components/brand-logo'
import {
  formatVence,
  getMiMensualidad,
  mensualidadWhatsappUrl,
  plazoRestante,
  type Mensualidad,
} from '../services/mensualidad-service'

function WhatsappButton({ username, grande = false }: { username: string; grande?: boolean }) {
  return (
    <a
      href={mensualidadWhatsappUrl(username)}
      target="_blank"
      rel="noopener noreferrer"
      className={`rounded-md bg-[var(--green)] font-medium text-white hover:opacity-90 ${
        grande ? 'px-5 py-2.5 text-[14px]' : 'px-3 py-1 text-[12px]'
      }`}
    >
      {grande ? 'Hablar por WhatsApp' : 'Extender por WhatsApp'}
    </a>
  )
}

function Bloqueo({ username }: { username: string }) {
  const router = useRouter()
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md text-center">
        <BrandLogo className="mx-auto mb-8 h-16 w-auto object-contain opacity-95" />
        <h1 className="mb-2 text-[20px] font-semibold text-[var(--text)]">Tu mensualidad venció</h1>
        <p className="mb-6 text-[14px] leading-relaxed text-[var(--text2)]">
          Para seguir usando la plataforma escribinos por WhatsApp y la reactivamos.
        </p>
        <div className="flex flex-col items-center gap-4">
          <WhatsappButton username={username} grande />
          <button
            type="button"
            onClick={() => {
              void logout()
              router.replace('/login')
            }}
            className="text-[12px] text-[var(--text3)] hover:text-[var(--text)]"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}

export function MensualidadBanner() {
  const pathname = usePathname()
  const [data, setData] = useState<(Mensualidad & { username: string }) | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMiMensualidad()
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!data || data.vence == null || data.diasRestantes == null) return null

  // El panel admin queda libre para poder reactivar la cuenta.
  if (data.bloqueada) {
    return pathname?.startsWith('/admin') ? null : <Bloqueo username={data.username} />
  }

  const dias = data.diasRestantes
  const plazo = plazoRestante(data)

  let texto: string
  if (plazo != null) {
    texto =
      plazo === 0
        ? 'Tu mensualidad venció. Hoy es el último día de plazo: después se bloquea el acceso.'
        : `Tu mensualidad venció. Te ${plazo === 1 ? 'queda' : 'quedan'} ${plazo} ${plazo === 1 ? 'día' : 'días'} de plazo antes de que se bloquee el acceso.`
  } else if (dias === 0) {
    texto = 'Tu mensualidad vence hoy.'
  } else {
    texto = `Te ${dias === 1 ? 'queda' : 'quedan'} ${dias} ${dias === 1 ? 'día' : 'días'} de mensualidad (vence el ${formatVence(data.vence)}).`
  }

  const tono =
    plazo != null
      ? 'border-[var(--border-red)] bg-[var(--red-faint)] text-[var(--red-light)]'
      : dias <= 7
        ? 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] text-[var(--amber)]'
        : 'border-[var(--border)] bg-[var(--bg2)] text-[var(--text2)]'

  return (
    <div
      className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] sm:mx-6 lg:mx-8 ${tono}`}
    >
      <span>{texto}</span>
      <WhatsappButton username={data.username} />
    </div>
  )
}
