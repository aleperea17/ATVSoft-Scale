'use client'

type DateRangeFilterProps = {
  desde: string
  hasta: string
  onChange: (next: { desde: string; hasta: string }) => void
  onThisMonth: () => void
}

export function DateRangeFilter({ desde, hasta, onChange, onThisMonth }: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</label>
        <input
          type="date"
          value={desde}
          onChange={(e) => onChange({ desde: e.target.value, hasta })}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</label>
        <input
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => onChange({ desde, hasta: e.target.value })}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
        />
      </div>
      <button
        type="button"
        onClick={onThisMonth}
        className="rounded-lg border border-[var(--border2)] px-3 py-2.5 text-[11px] font-semibold uppercase text-[var(--text)] hover:border-[var(--text3)]"
      >
        Este mes
      </button>
    </div>
  )
}
