/**
 * Anclas simples de `punto_agenda` (sin ID de contenido).
 * Tokens estables para UI + BD; en el futuro se pueden mapear a canales
 * del dashboard (p. ej. Perfil) en classifyLeadCashSource / classifyLeadChatSource.
 */
export const AGENDA_SIMPLE_ANCHORS = {
  bio: {
    value: 'bio',
    label: 'Formulario',
    hint: 'Formulario externo / link en perfil',
    badge: '[Formulario]',
  },
  bienvenida_instagram: {
    value: 'bienvenida_instagram',
    label: 'Bienvenida Instagram',
    hint: 'Mensaje / flujo de bienvenida en IG',
    badge: '[Bienvenida IG]',
  },
  post_fijado_instagram: {
    value: 'post_fijado_instagram',
    label: 'Post fijado Instagram',
    hint: 'Publicación anclada del perfil',
    badge: '[Post fijado]',
  },
} as const

export type AgendaSimpleAnchorValue =
  (typeof AGENDA_SIMPLE_ANCHORS)[keyof typeof AGENDA_SIMPLE_ANCHORS]['value']

export function agendaSimpleAnchorBadge(raw: string | null | undefined): string | null {
  const k = String(raw || '').trim().toLowerCase()
  if (!k) return null
  for (const a of Object.values(AGENDA_SIMPLE_ANCHORS)) {
    if (a.value === k) return a.badge
  }
  return null
}
