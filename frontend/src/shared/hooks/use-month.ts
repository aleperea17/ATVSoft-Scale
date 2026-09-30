'use client'

import { useState, useCallback, useEffect } from 'react'
import { monthKeyInCompanyTz } from '@/shared/lib/company-timezone'
import { monthRangeIso } from '@/shared/lib/date-range'

function getMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const date = new Date(year, m - 1, 1)
  return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

function getMonthOptions(timeZone: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const nowKey = monthKeyInCompanyTz(timeZone)
  const [year, month] = nowKey.split('-').map(Number)
  for (let i = 0; i < 12; i++) {
    const d = new Date(year, month - 1 - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    options.push({ value, label: getMonthLabel(value) })
  }
  return options
}

function rangeForMonth(ym: string): { desde: string; hasta: string } {
  return monthRangeIso(ym) ?? { desde: `${ym}-01`, hasta: `${ym}-01` }
}

export function useMonth(timeZone: string) {
  const [month, setMonthState] = useState(() => monthKeyInCompanyTz(timeZone))
  const [desde, setDesde] = useState(() => rangeForMonth(monthKeyInCompanyTz(timeZone)).desde)
  const [hasta, setHasta] = useState(() => rangeForMonth(monthKeyInCompanyTz(timeZone)).hasta)

  const setMonth = useCallback((ym: string) => {
    setMonthState(ym)
    const r = rangeForMonth(ym)
    setDesde(r.desde)
    setHasta(r.hasta)
  }, [])

  useEffect(() => {
    const ym = monthKeyInCompanyTz(timeZone)
    setMonthState(ym)
    const r = rangeForMonth(ym)
    setDesde(r.desde)
    setHasta(r.hasta)
  }, [timeZone])

  const options = getMonthOptions(timeZone)
  const label = getMonthLabel(month)

  const setDateRange = useCallback((next: { desde: string; hasta: string }) => {
    setDesde(next.desde)
    setHasta(next.hasta)
  }, [])

  const applyThisMonth = useCallback(() => {
    const r = rangeForMonth(month)
    setDesde(r.desde)
    setHasta(r.hasta)
  }, [month])

  const prev = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [month, setMonth])

  const next = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [month, setMonth])

  return {
    month,
    setMonth,
    label,
    options,
    prev,
    next,
    desde,
    hasta,
    setDateRange,
    applyThisMonth,
  }
}
