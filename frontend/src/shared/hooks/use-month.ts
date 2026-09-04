'use client'

import { useState, useCallback, useEffect } from 'react'
import { monthKeyInCompanyTz } from '@/shared/lib/company-timezone'

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

export function useMonth(timeZone: string) {
  const [month, setMonth] = useState(() => monthKeyInCompanyTz(timeZone))

  useEffect(() => {
    setMonth(monthKeyInCompanyTz(timeZone))
  }, [timeZone])

  const options = getMonthOptions(timeZone)
  const label = getMonthLabel(month)

  const prev = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [month])

  const next = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [month])

  return { month, setMonth, label, options, prev, next }
}
