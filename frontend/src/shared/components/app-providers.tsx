'use client'

import { createContext, useContext } from 'react'
import { useMonth } from '@/shared/hooks/use-month'
import { COMPANY_TIMEZONE } from '@/shared/lib/company-timezone'
import { ToastProvider } from './toast'

type MonthContextType = ReturnType<typeof useMonth>

const MonthContext = createContext<MonthContextType | null>(null)

export function useMonthContext() {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonthContext must be inside AppProviders')
  return ctx
}

type CompanyTimezoneContextType = {
  timezone: string
}

const CompanyTimezoneContext = createContext<CompanyTimezoneContextType>({
  timezone: COMPANY_TIMEZONE,
})

export function useCompanyTimezone(): CompanyTimezoneContextType {
  return useContext(CompanyTimezoneContext)
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const monthState = useMonth(COMPANY_TIMEZONE)

  return (
    <CompanyTimezoneContext.Provider value={{ timezone: COMPANY_TIMEZONE }}>
      <MonthContext.Provider value={monthState}>
        <ToastProvider>{children}</ToastProvider>
      </MonthContext.Provider>
    </CompanyTimezoneContext.Provider>
  )
}
