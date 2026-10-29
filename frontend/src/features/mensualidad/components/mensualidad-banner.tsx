'use client'

import { useEffect, useState } from 'react'
import {
  formatVence,
  getMiMensualidad,
  mensualidadWhatsappUrl,
  type Mensualidad,
} from '../services/mensualidad-service'

export function MensualidadBanner() {
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

  const dias = data.diasRestantes
  const vencida = dias < 0
  const urgente = dias <= 7

  let texto: string
  if (vencida) {
    const hace = Math.abs(dias)
    texto = `Tu mensualidad venció hace ${hace} ${hace === 1 ? 'día' : 'días'} (${formatVence(data.vence)}).`
  } else if (dias === 0) {
    texto = 'Tu mensualidad vence hoy.'
  } else {
    texto = `Te ${dias === 1 ? 'queda' : 'quedan'} ${dias} ${dias === 1 ? 'día' : 'días'} de mensualidad (vence el ${formatVence(data.vence)}).`
  }

  const tono = vencida
    ? 'border-[var(--border-red)] bg-[var(--red-faint)] text-[var(--red-light)]'
    : urgente
      ? 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] text-[var(--amber)]'
      : 'border-[var(--border)] bg-[var(--bg2)] text-[var(--text2)]'

  return (
    <div
      className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] sm:mx-6 lg:mx-8 ${tono}`}
    >
      <span>{texto}</span>
      <a
        href={mensualidadWhatsappUrl(data.username)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-[var(--green)] px-3 py-1 text-[12px] font-medium text-white hover:opacity-90"
      >
        Extender por WhatsApp
      </a>
    </div>
  )
}
