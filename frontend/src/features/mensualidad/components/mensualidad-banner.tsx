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

function WhatsappButton({ username }: { username: string }) {
  return (
    <a
      href={mensualidadWhatsappUrl(username)}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md bg-[var(--green)] px-5 py-2.5 text-[14px] font-medium text-white hover:opacity-90"
    >
      Hablar por WhatsApp
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
          <WhatsappButton username={username} />
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

const TOP_BAR_HEIGHT = '2rem'

function TopBar({ data }: { data: Mensualidad & { username: string } }) {
  // Sidebar y topbar son sticky: se corren hacia abajo lo que ocupa esta barra.
  useEffect(() => {
    document.documentElement.style.setProperty('--top-bar-h', TOP_BAR_HEIGHT)
    return () => {
      document.documentElement.style.removeProperty('--top-bar-h')
    }
  }, [])

  const dias = data.diasRestantes ?? 0
  const plazo = plazoRestante(data)

  let texto: string
  if (plazo != null) {
    texto =
      plazo === 0
        ? 'Tu mensualidad venció · hoy es el último día de plazo'
        : `Tu mensualidad venció · ${plazo === 1 ? 'queda' : 'quedan'} ${plazo} ${plazo === 1 ? 'día' : 'días'} de plazo`
  } else if (dias === 0) {
    texto = 'Tu mensualidad vence hoy'
  } else {
    texto = `${dias === 1 ? 'Queda' : 'Quedan'} ${dias} ${dias === 1 ? 'día' : 'días'} de mensualidad · vence el ${formatVence(data.vence ?? '')}`
  }

  const tono =
    plazo != null
      ? 'bg-[var(--accent)] text-white'
      : dias <= 7
        ? 'bg-[rgba(245,158,11,0.14)] text-[var(--amber)] border-b border-[rgba(245,158,11,0.25)]'
        : 'bg-[var(--bg2)] text-[var(--text3)] border-b border-[var(--border)]'

  return (
    <div
      className={`sticky top-0 z-30 flex h-8 items-center justify-center gap-3 overflow-hidden whitespace-nowrap px-4 text-[12px] ${tono}`}
    >
      <span className="truncate">{texto}</span>
      <a
        href={mensualidadWhatsappUrl(data.username)}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 font-medium underline underline-offset-2 opacity-90 hover:opacity-100"
      >
        Extender por WhatsApp
      </a>
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

  return <TopBar data={data} />
}
