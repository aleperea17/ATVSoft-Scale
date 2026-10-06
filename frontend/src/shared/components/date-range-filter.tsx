'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isCommittedIsoDate } from '@/shared/lib/date-range'

type DateRangeFilterProps = {
  desde: string
  hasta: string
  onChange: (next: { desde: string; hasta: string }) => void
  onThisMonth: () => void
}

type Field = 'desde' | 'hasta'

function clampPair(desde: string, hasta: string, changed: Field): { desde: string; hasta: string } {
  if (desde <= hasta) return { desde, hasta }
  if (changed === 'desde') return { desde, hasta: desde }
  return { desde: hasta, hasta }
}

export function DateRangeFilter({ desde, hasta, onChange, onThisMonth }: DateRangeFilterProps) {
  const [draftDesde, setDraftDesde] = useState(desde)
  const [draftHasta, setDraftHasta] = useState(hasta)
  const editing = useRef({ desde: false, hasta: false })

  useEffect(() => {
    if (!editing.current.desde) setDraftDesde(desde)
  }, [desde])

  useEffect(() => {
    if (!editing.current.hasta) setDraftHasta(hasta)
  }, [hasta])

  const commit = (changed: Field, nextDesde: string, nextHasta: string) => {
    if (!isCommittedIsoDate(nextDesde) || !isCommittedIsoDate(nextHasta)) return
    const clamped = clampPair(nextDesde, nextHasta, changed)
    setDraftDesde(clamped.desde)
    setDraftHasta(clamped.hasta)
    if (clamped.desde === desde && clamped.hasta === hasta) return
    onChange(clamped)
  }

  const onDraftChange = (field: Field, raw: string) => {
    if (field === 'desde') setDraftDesde(raw)
    else setDraftHasta(raw)
    if (!isCommittedIsoDate(raw)) return
    commit(field, field === 'desde' ? raw : draftDesde, field === 'hasta' ? raw : draftHasta)
  }

  const onFieldBlur = (field: Field) => {
    editing.current[field] = false
    if (!isCommittedIsoDate(draftDesde) || !isCommittedIsoDate(draftHasta)) {
      setDraftDesde(desde)
      setDraftHasta(hasta)
      return
    }
    commit(field, draftDesde, draftHasta)
  }

  const onFieldKeyDown = (field: Field, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.currentTarget.blur()
    commit(field, draftDesde, draftHasta)
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</label>
        <input
          type="date"
          value={draftDesde}
          onFocus={() => {
            editing.current.desde = true
          }}
          onChange={(e) => onDraftChange('desde', e.target.value)}
          onBlur={() => onFieldBlur('desde')}
          onKeyDown={(e) => onFieldKeyDown('desde', e)}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</label>
        <input
          type="date"
          value={draftHasta}
          onFocus={() => {
            editing.current.hasta = true
          }}
          onChange={(e) => onDraftChange('hasta', e.target.value)}
          onBlur={() => onFieldBlur('hasta')}
          onKeyDown={(e) => onFieldKeyDown('hasta', e)}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          editing.current.desde = false
          editing.current.hasta = false
          onThisMonth()
        }}
        className="rounded-lg border border-[var(--border2)] px-3 py-2.5 text-[11px] font-semibold uppercase text-[var(--text)] hover:border-[var(--text3)]"
      >
        Este mes
      </button>
    </div>
  )
}
