'use client'

import { useEffect, useState } from 'react'
import {
  extenderAdminMensualidad,
  formatVence,
  getAdminMensualidad,
  setAdminMensualidad,
  type Mensualidad,
} from '../services/mensualidad-service'

export function AdminMensualidadCard({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<Mensualidad | null>(null)
  const [fecha, setFecha] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void getAdminMensualidad(adminToken)
      .then((res) => {
        setData(res)
        setFecha(res.vence || '')
      })
      .catch((e: Error) => setError(e.message))
  }, [adminToken])

  async function run(action: () => Promise<Mensualidad>) {
    setBusy(true)
    setError('')
    try {
      const res = await action()
      setData(res)
      setFecha(res.vence || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  const estado =
    data?.vence && data.diasRestantes != null
      ? `Vence el ${formatVence(data.vence)} · ${
          data.diasRestantes < 0 ? `vencida hace ${Math.abs(data.diasRestantes)} d` : `${data.diasRestantes} d restantes`
        }`
      : 'Sin vencimiento cargado (no se muestra aviso)'

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg2)] px-4 py-3 text-[13px]">
      <div className="min-w-[200px] flex-1">
        <div className="font-medium text-[var(--text)]">Mensualidad (90 USD)</div>
        <div className="text-[var(--text3)]">{estado}</div>
      </div>
      <input
        type="date"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
        className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
      />
      <button
        type="button"
        disabled={busy || !fecha}
        onClick={() => void run(() => setAdminMensualidad(adminToken, fecha))}
        className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-50"
      >
        Guardar fecha
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => extenderAdminMensualidad(adminToken, 30))}
        className="rounded-md bg-[var(--accent)] px-3 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        +30 días
      </button>
      {data?.vence ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => setAdminMensualidad(adminToken, null))}
          className="text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-50"
        >
          Quitar
        </button>
      ) : null}
      {error ? <div className="w-full text-[var(--red-light)]">{error}</div> : null}
    </div>
  )
}
