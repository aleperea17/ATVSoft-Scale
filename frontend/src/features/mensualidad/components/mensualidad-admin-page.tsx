'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  extenderMensualidad,
  formatVence,
  listMensualidades,
  readMensualidadKey,
  setMensualidad,
  writeMensualidadKey,
  type MensualidadCuenta,
} from '../services/mensualidad-service'

function diasTexto(c: MensualidadCuenta): { texto: string; clase: string } {
  if (c.diasRestantes == null) return { texto: 'Sin aviso', clase: 'text-[var(--text3)]' }
  if (c.diasRestantes < 0) return { texto: `Vencida hace ${Math.abs(c.diasRestantes)} d`, clase: 'text-[var(--red-light)]' }
  if (c.diasRestantes <= 7) return { texto: `${c.diasRestantes} d`, clase: 'text-[var(--amber)]' }
  return { texto: `${c.diasRestantes} d`, clase: 'text-[var(--text2)]' }
}

function CuentaRow({
  cuenta,
  onChange,
  run,
}: {
  cuenta: MensualidadCuenta
  onChange: (c: MensualidadCuenta) => void
  run: (action: () => Promise<MensualidadCuenta>) => Promise<MensualidadCuenta | null>
}) {
  const [fecha, setFecha] = useState(cuenta.vence || '')
  useEffect(() => setFecha(cuenta.vence || ''), [cuenta.vence])
  const dias = diasTexto(cuenta)

  async function act(action: () => Promise<MensualidadCuenta>) {
    const res = await run(action)
    if (res) onChange(res)
  }

  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-2 pr-3 font-medium text-[var(--text)]">{cuenta.username}</td>
      <td className="py-2 pr-3 text-[var(--text2)]">{cuenta.vence ? formatVence(cuenta.vence) : '—'}</td>
      <td className={`py-2 pr-3 ${dias.clase}`}>{dias.texto}</td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
          />
          <button
            type="button"
            disabled={!fecha || fecha === cuenta.vence}
            onClick={() => void act(() => setMensualidad(readMensualidadKey(), cuenta.userId, fecha))}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => void act(() => extenderMensualidad(readMensualidadKey(), cuenta.userId, 30))}
            className="rounded-md bg-[var(--accent)] px-3 py-1 font-medium text-white hover:opacity-90"
          >
            +30 días
          </button>
          {cuenta.vence ? (
            <button
              type="button"
              onClick={() => void act(() => setMensualidad(readMensualidadKey(), cuenta.userId, null))}
              className="px-1 text-[var(--text3)] hover:text-[var(--text)]"
            >
              Quitar
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

export function MensualidadAdminPage() {
  const [cuentas, setCuentas] = useState<MensualidadCuenta[] | null>(null)
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)

  const cargar = useCallback(async (key: string) => {
    setError('')
    try {
      const res = await listMensualidades(key)
      writeMensualidadKey(key)
      setCuentas(res)
    } catch (e) {
      setCuentas(null)
      setError(e instanceof Error ? e.message : 'Error')
    }
  }, [])

  useEffect(() => {
    const stored = readMensualidadKey()
    if (stored) void cargar(stored).finally(() => setChecking(false))
    else setChecking(false)
  }, [cargar])

  const run = useCallback(async (action: () => Promise<MensualidadCuenta>) => {
    setError('')
    try {
      return await action()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error'
      setError(msg)
      if (msg === 'Clave incorrecta.') setCuentas(null)
      return null
    }
  }, [])

  const actualizar = useCallback((c: MensualidadCuenta) => {
    setCuentas((prev) => prev?.map((x) => (x.userId === c.userId ? c : x)) ?? prev)
  }, [])

  if (checking) {
    return <div className="p-8 text-[13px] text-[var(--text3)]">Verificando…</div>
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-10 text-[13px] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-[20px] font-semibold text-[var(--text)]">Mensualidades</h1>
        <p className="mb-6 text-[var(--text3)]">90 USD por mes. Cada cuenta ve los días que le quedan.</p>

        {cuentas == null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (clave.trim()) void cargar(clave.trim())
            }}
            className="flex max-w-sm gap-2"
          >
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="Clave"
              autoFocus
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-2 text-[var(--text)]"
            />
            <button
              type="submit"
              className="rounded-md bg-[var(--accent)] px-4 py-2 font-medium text-white hover:opacity-90"
            >
              Entrar
            </button>
          </form>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)] px-4 py-2">
            <table className="w-full text-left">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--text3)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Cuenta</th>
                  <th className="py-2 pr-3 font-medium">Vence</th>
                  <th className="py-2 pr-3 font-medium">Quedan</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {cuentas.map((c) => (
                  <CuentaRow key={c.userId} cuenta={c} onChange={actualizar} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error ? <div className="mt-3 text-[var(--red-light)]">{error}</div> : null}
      </div>
    </div>
  )
}
