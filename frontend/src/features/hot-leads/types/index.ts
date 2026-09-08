import { AVATAR_COLORS, AVATAR_OPTIONS } from '@/shared/constants/avatar-defaults'
import {
  STATUS_COLORS as DEFAULT_STATUS_COLORS,
  STATUS_OPTIONS as DEFAULT_STATUS_OPTIONS,
} from '@/shared/constants/lead-status-defaults'
import { buildStatusTabs } from '@/shared/lib/lead-status-flags'

export type HotLead = {
  id: string
  nombre: string
  ig: string
  avatar: string
  seguidores: string
  calidad: string
  fecha: string | null
  status: string
  notas: string
  created_at: string
  month: string | null
}

export type HotLeadColumnDef = {
  key: keyof HotLead
  label: string
  width: number
  type: 'text' | 'select' | 'badge' | 'date'
  editable: boolean
  sticky?: boolean
  options?: string[]
  colors?: Record<string, string>
}

export { AVATAR_COLORS, AVATAR_OPTIONS }

export const SEGUIDORES_OPTIONS = ['', '0-2k', '3-5k', '6-10k', '10-20k', '20-50k', '50-100k', '+100k']

export const CALIDAD_OPTIONS = ['', 'Medio', 'Bueno', 'Genial', 'Perfecto']

export const CALIDAD_COLORS: Record<string, string> = {
  Medio: '#94A3B8',
  Bueno: '#60A5FA',
  Genial: '#22C55E',
  Perfecto: '#F59E0B',
}

export const STATUS_OPTIONS = ['Prospectar', ...DEFAULT_STATUS_OPTIONS]

export const STATUS_COLORS: Record<string, string> = {
  Prospectar: '#6B7280',
  ...DEFAULT_STATUS_COLORS,
}

/** Tabs: Todos + Prospectar + Cerrados + estados no-cierre del catálogo default. */
export const STATUS_TABS = ['Todos', 'Prospectar', ...buildStatusTabs().slice(1)]

export const HOT_LEAD_COLUMNS: HotLeadColumnDef[] = [
  { key: 'nombre', label: 'Nombre', width: 180, type: 'text', editable: true, sticky: true },
  { key: 'ig', label: 'IG', width: 140, type: 'text', editable: true },
  {
    key: 'avatar',
    label: 'Avatar',
    width: 170,
    type: 'badge',
    editable: true,
    options: AVATAR_OPTIONS,
    colors: AVATAR_COLORS,
  },
  {
    key: 'seguidores',
    label: 'Seguidores',
    width: 120,
    type: 'select',
    editable: true,
    options: SEGUIDORES_OPTIONS,
  },
  {
    key: 'calidad',
    label: 'Calidad',
    width: 110,
    type: 'badge',
    editable: true,
    options: CALIDAD_OPTIONS,
    colors: CALIDAD_COLORS,
  },
  { key: 'fecha', label: 'Fecha', width: 120, type: 'date', editable: true },
  {
    key: 'status',
    label: 'Status',
    width: 130,
    type: 'select',
    editable: true,
    options: STATUS_OPTIONS,
    colors: STATUS_COLORS,
  },
  { key: 'notas', label: 'Notas', width: 220, type: 'text', editable: true },
]
