import type { LeadsAnalytics } from '@/features/leads/services/leads-analytics'

/** View-model for the sales dashboard: analytics plus week-series aliases used in charts */
export type VDData = LeadsAnalytics & {
  chats: number
  chatsStories: number
  chatsReels: number
  agendasByWeek: number[]
  agendasCrmByWeek: number[]
  conversacionesByWeek: number[]
  showsByWeek: number[]
  cierresByWeek: number[]
  ingresosByWeek: number[]
  ingresosCohorteByWeek: number[]
  ingresosCohorteByDay: number[]
  noShowsByWeek: number[]
}
