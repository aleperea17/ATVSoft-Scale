# Implementación — Estados de Lead personalizables + roles de embudo (Scale)

**Fecha:** 2026-09-07. Alcance: Scale.

---

## 1. Qué se hizo

CRUD de estados (patrón Avatares) con flags de embudo; seed de los 8 estados del cliente; literales de negocio migrados a flags; columna `fecha_seguimiento_pago`; defaults y Calendly/GHL/webhook escriben desde el catálogo (`Pendiente de pago` / `Reserva`).

### Seed (flags)

| Estado | cierre | no_show | followup fecha | default |
|--------|--------|---------|----------------|---------|
| Pendiente de pago | | | | ✓ |
| Seguimiento post llamada | | | | |
| Reserva | | | | |
| Cerrado PIF | ✓ | | | |
| Cerrado PLAZOS | ✓ | | ✓ | |
| No show | | ✓ | | |
| Re-agendada | | | | |
| No compra | | | | |

Remapeo one-shot de labels legacy en leads (`Pendiente`→`Pendiente de pago`, `Agendado`→`Reserva`, `Cerrado`→`Cerrado PIF`, etc.) al primer `GET /lead-statuses`.

---

## 2. Diff (archivos)

### Backend
- `backend/src/models.py` — `LeadStatusType`; `Lead.fecha_seguimiento_pago`
- `backend/src/db.py` — migraciones `lead_status_type` + columna fecha
- `backend/src/schemas.py` — CRUD schemas; `LeadOut`/`Patch` fecha; default status
- `backend/src/services/lead_statuses_services.py` — **nuevo** CRUD + `default_lead_status_name` / `booking_lead_status_name` / `resolve_status_flags`
- `backend/src/controllers/lead_statuses_controller.py` — **nuevo** `GET/POST/PATCH/DELETE /api/lead-statuses`
- `backend/main.py` — router
- `leads_controller.py` — default dinámico; PATCH fecha; lectura fecha
- `admin_panel_controller.py` — default dinámico
- `calendly_controller.py` / `ghl_controller.py` / `webhook_controller.py` — `Reserva` vía `booking_lead_status_name`
- `closer_report_auto_service.py` — shows/cierres por flags
- `bio_controller.py` — `_is_cerrado` por flag
- `agent_closer_service.py` — fallback default

### Frontend
- `frontend/src/app/(main)/estados/page.tsx` — **nuevo** Ajustes → Estados
- `sidebar.tsx` / `topbar.tsx` — nav
- `shared/constants/lead-status-defaults.ts` / `shared/lib/lead-status-flags.ts` — **nuevos**
- `leads/types/index.ts` — catálogo dinámico + columna Seg. pago
- `leads-analytics.ts` — `setLeadStatusCatalog` + flags en `leadHasShow` / `leadIsCierre` / `calcFunnel`; fetch en `getLeadsAnalytics`
- `leads-page.tsx` — fetch catálogo, tabs, Cerrados por flag, acento Seg. pago
- `dashboard-view.tsx`, `content-page.tsx`, `youtube/page.tsx` — sin literales `Cerrado`
- `daily-calls-table.tsx` — options/colors del seed
- `hot-leads/types` + `hot-leads-page` — opciones nuevas + Cerrados por flag (tabla HotLead aparte)
- `fathom-transcript-analyzer.ts` — lista de 8 estados

---

## 3. Migración de literales → flags

| Lugar | Antes | Ahora |
|-------|-------|--------|
| `leads-analytics.ts` | `'cerrado'` / `'no show'` | `counts_as_cierre` / `counts_as_no_show` |
| `dashboard-view.tsx` | `status === 'Cerrado'` | `leadIsCierre` |
| `closer_report_auto_service.py` | `== "cerrado"` / `!= "no show"` | `status_counts_as_*` |
| `bio_controller.py` | `== "cerrado"` | `status_counts_as_cierre` |
| `leads-page.tsx` | Cerrado\|\|Seña | `counts_as_cierre` |
| `hot-leads-page.tsx` | Cerrado\|\|Seña | `counts_as_cierre` |
| `content-page.tsx` | `=== 'Cerrado'` / Seguimiento color | flag cierre |
| `youtube/page.tsx` | `=== 'Cerrado'` | flag cierre |

Fallback legacy en BE/FE si un lead aún tiene label viejo sin remapear.

---

## 4. Cómo probar

1. Abrir **Ajustes → Estados** → deben aparecer los 8 seed; editar flags y colores.
2. **Leads → nuevo lead** → status default **Pendiente de pago**.
3. Cambiar a **Cerrado PLAZOS** → columna **Seg. pago** se resalta; editar fecha y guardar.
4. **Cerrado PIF** y otro lead **No show**:
   - Dashboard marketing / embudo: ambos PIF+PLAZOS cuentan como cierres; No show no entra en Shows.
5. Sync/webhook Calendly o GHL → status **Reserva** (no `Agendado`).
6. Fathom analyze: el prompt lista los 8 estados.

---

## 5. Hot Leads

Entidad **separada** (`HotLead.status`), no comparte `Lead.status`. Se actualizaron opciones/tabs al mismo vocabulario + `Prospectar`, y el tab Cerrados usa flags del seed (sin CRUD propio). No se rediseñó la pantalla; no queda atada a strings viejos `Cerrado`/`Seña`.
