'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  activarMensualidad,
  formatVence,
  listMensualidades,
  plazoRestante,
  quitarMensualidad,
  type MensualidadCuenta,
} from '../services/mensualidad-service'

function estado(c: MensualidadCuenta): { texto: string; tono: string } {
  if (c.diasRestantes == null) return { texto: 'Sin mensualidad', tono: 'neo-mens__dias--off' }
  if (c.bloqueada) return { texto: 'Bloqueada', tono: 'neo-mens__dias--vencida' }
  const plazo = plazoRestante(c)
  if (plazo != null) {
    return { texto: plazo === 0 ? 'Plazo: último día' : `Plazo: ${plazo} d`, tono: 'neo-mens__dias--vencida' }
  }
  return { texto: `${c.diasRestantes} d`, tono: c.diasRestantes <= 7 ? 'neo-mens__dias--pocos' : '' }
}

function CuentaRow({
  cuenta,
  adminToken,
  run,
}: {
  cuenta: MensualidadCuenta
  adminToken: string
  run: (action: () => Promise<MensualidadCuenta>) => Promise<void>
}) {
  const [dias, setDias] = useState('30')
  const [plazo, setPlazo] = useState(String(cuenta.plazoDias || 3))
  const st = estado(cuenta)
  const diasNum = Number(dias)
  const plazoNum = Number(plazo)
  const valido = Number.isInteger(diasNum) && diasNum >= 1 && Number.isInteger(plazoNum) && plazoNum >= 0

  return (
    <div className="neo-mens__row">
      <div className="neo-mens__cuenta" title={cuenta.username}>
        {cuenta.username}
      </div>
      <div>{cuenta.vence ? formatVence(cuenta.vence) : '—'}</div>
      <div className={`neo-mens__dias ${st.tono}`}>{st.texto}</div>
      <div className="neo-mens__acciones">
        <label className="neo-mens__campo">
          <span>Días</span>
          <input
            type="number"
            min={1}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className="neo-panel__date-input neo-mens__num"
          />
        </label>
        <label className="neo-mens__campo">
          <span>Plazo</span>
          <input
            type="number"
            min={0}
            value={plazo}
            onChange={(e) => setPlazo(e.target.value)}
            className="neo-panel__date-input neo-mens__num"
          />
        </label>
        <button
          type="button"
          className="neo-panel__btn"
          disabled={!valido}
          onClick={() => void run(() => activarMensualidad(adminToken, cuenta.userId, diasNum, plazoNum))}
        >
          Activar
        </button>
        {cuenta.vence ? (
          <button
            type="button"
            className="neo-panel__btn neo-panel__btn--ghost"
            onClick={() => void run(() => quitarMensualidad(adminToken, cuenta.userId))}
          >
            Quitar
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function AdminMensualidadesModule({ adminToken }: { adminToken: string }) {
  const [cuentas, setCuentas] = useState<MensualidadCuenta[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void listMensualidades(adminToken)
      .then(setCuentas)
      .catch((e: Error) => setError(e.message))
  }, [adminToken])

  const run = useCallback(async (action: () => Promise<MensualidadCuenta>) => {
    setError('')
    try {
      const res = await action()
      setCuentas((prev) => prev?.map((c) => (c.userId === res.userId ? res : c)) ?? prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    }
  }, [])

  return (
    <section className="neo-panel__module neo-panel__module--spaced">
      <div className="neo-panel__module-head">
        <h2 className="neo-panel__module-title">Mensualidades</h2>
        <p className="neo-panel__module-hint">
          Activar arranca hoy · terminado el plazo la cuenta se bloquea y se la manda a WhatsApp
        </p>
      </div>

      {cuentas == null && !error ? (
        <div className="neo-panel__loading">Cargando mensualidades</div>
      ) : cuentas ? (
        <div className="neo-mens">
          <div className="neo-mens__head">
            <div>Cuenta</div>
            <div>Vence</div>
            <div>Estado</div>
            <div />
          </div>
          {cuentas.map((c) => (
            <CuentaRow key={c.userId} cuenta={c} adminToken={adminToken} run={run} />
          ))}
        </div>
      ) : null}
      {error ? <p className="neo-mens__error">{error}</p> : null}
    </section>
  )
}
