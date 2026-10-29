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

function quedan(c: MensualidadCuenta): { texto: string; tono: string } {
  if (c.diasRestantes == null) return { texto: 'Sin aviso', tono: 'neo-mens__dias--off' }
  if (c.diasRestantes < 0) return { texto: `Vencida hace ${Math.abs(c.diasRestantes)} d`, tono: 'neo-mens__dias--vencida' }
  if (c.diasRestantes <= 7) return { texto: `${c.diasRestantes} d`, tono: 'neo-mens__dias--pocos' }
  return { texto: `${c.diasRestantes} d`, tono: '' }
}

function CuentaRow({
  cuenta,
  run,
}: {
  cuenta: MensualidadCuenta
  run: (action: () => Promise<MensualidadCuenta>) => Promise<void>
}) {
  const [fecha, setFecha] = useState(cuenta.vence || '')
  useEffect(() => setFecha(cuenta.vence || ''), [cuenta.vence])
  const dias = quedan(cuenta)

  return (
    <div className="neo-mens__row">
      <div className="neo-mens__cuenta" title={cuenta.username}>
        {cuenta.username}
      </div>
      <div>{cuenta.vence ? formatVence(cuenta.vence) : '—'}</div>
      <div className={`neo-mens__dias ${dias.tono}`}>{dias.texto}</div>
      <div className="neo-mens__acciones">
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="neo-panel__date-input"
        />
        <button
          type="button"
          className="neo-panel__btn neo-panel__btn--ghost"
          disabled={!fecha || fecha === cuenta.vence}
          onClick={() => void run(() => setMensualidad(readMensualidadKey(), cuenta.userId, fecha))}
        >
          Guardar
        </button>
        <button
          type="button"
          className="neo-panel__btn"
          onClick={() => void run(() => extenderMensualidad(readMensualidadKey(), cuenta.userId, 30))}
        >
          +30 días
        </button>
        {cuenta.vence ? (
          <button
            type="button"
            className="neo-panel__btn neo-panel__btn--ghost"
            onClick={() => void run(() => setMensualidad(readMensualidadKey(), cuenta.userId, null))}
          >
            Quitar
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function AdminMensualidadesModule() {
  const [cuentas, setCuentas] = useState<MensualidadCuenta[] | null>(null)
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async (key: string) => {
    setError('')
    setLoading(true)
    try {
      const res = await listMensualidades(key)
      writeMensualidadKey(key)
      setCuentas(res)
    } catch (e) {
      setCuentas(null)
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const stored = readMensualidadKey()
    if (stored) void cargar(stored)
    else setLoading(false)
  }, [cargar])

  const run = useCallback(async (action: () => Promise<MensualidadCuenta>) => {
    setError('')
    try {
      const res = await action()
      setCuentas((prev) => prev?.map((c) => (c.userId === res.userId ? res : c)) ?? prev)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error'
      setError(msg)
      if (msg === 'Clave incorrecta.') setCuentas(null)
    }
  }, [])

  return (
    <section className="neo-panel__module neo-panel__module--spaced">
      <div className="neo-panel__module-head">
        <h2 className="neo-panel__module-title">Mensualidades</h2>
        <p className="neo-panel__module-hint">90 USD por mes · cada cuenta ve los días que le quedan</p>
      </div>

      {loading ? (
        <div className="neo-panel__loading">Cargando mensualidades</div>
      ) : cuentas == null ? (
        <form
          className="neo-mens__clave"
          onSubmit={(e) => {
            e.preventDefault()
            if (clave.trim()) void cargar(clave.trim())
          }}
        >
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Clave de mensualidades"
            className="neo-panel__date-input neo-mens__clave-input"
          />
          <button type="submit" className="neo-panel__btn">
            Desbloquear
          </button>
        </form>
      ) : (
        <div className="neo-mens">
          <div className="neo-mens__head">
            <div>Cuenta</div>
            <div>Vence</div>
            <div>Quedan</div>
            <div />
          </div>
          {cuentas.map((c) => (
            <CuentaRow key={c.userId} cuenta={c} run={run} />
          ))}
        </div>
      )}
      {error ? <p className="neo-mens__error">{error}</p> : null}
    </section>
  )
}
