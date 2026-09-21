# Fix — Dashboard de Equipo + gráficos Ingresos en vivo (Scale Boost)

Fecha: 2026-09-21 · Alcance: local, sin deploy. No se tocó generación/historial de `CloserReport` ni el Dashboard de Marketing.

## Diagnóstico (de dónde salía cada número)

### Dashboard de Equipo (`Trackeo de equipo → Dashboard equipo`)

UI: `frontend/src/features/team/components/team-page.tsx` → `GET /api/team/dashboard?month=YYYY-MM`.

**Closers (Calls, Cierres, Close %, Ingreso, Shows, Calif., Desc.)** — antes: suma mensual de `CloserReport` por `member_id` en `team_controller.team_dashboard`:

- `llamadas_agendadas`, `shows`, `cierres`, `calificados`, `descalificados`, `ingreso`

Esos campos se congelan al generar el reporte diario. Misma causa que el KPI de Cierres/Shows de Ventas antes del fix en vivo.

**Setters (Conversaciones, Agendas, Links)** — `SetterReport`. No es el mismo bug; no se cambió.

**Cash / facturación del encabezado** — el cash del header ya venía de `getLeadsAnalytics` (`Lead.pago` + seguimiento). Las tarjetas de closer no.

### Gráficos Ventas (semanal y diario)

Origen: `frontend/src/features/leads/services/leads-analytics.ts` → `byWeek.ingresos` / `byWeekDay.ingresos`.

Antes: `CloserReport.ingreso` (por fecha del reporte) **+** montos de formularios de seguimiento por día. El gráfico diario comparte `byWeekDay.ingresos` (mismo bug, confirmado).

El KPI mensual “Cash del mes” ya usaba `sum(Lead.pago) + seguimiento`; los gráficos no.

## Cambio

1. **Equipo / closers:** `_live_closer_month_stats` — mes = `call > agendo > fecha_bot > created_at` (igual que `GET /leads?month=`). Match closer por nombre (`casefold`). `ingreso` = `sum(Lead.pago)` (incluye cuotas de plazo). Calls/Shows/Cierres/Calif. solo leads con agenda (`call` o `agendo`), excluye `es_cuota_plazo`; flags `status_counts_as_cierre` / `status_counts_as_no_show`.
2. **Gráficos:** `byWeek`/`byWeekDay.ingresos` = `Lead.pago` en vivo, bucket con `leadMetricDateIso` (mismo orden de fechas). Sin `CloserReport.ingreso` ni seguimiento en esos buckets. Subtítulos: “Pagó en vivo”. Tabla diaria: “Ingresos (Pagó)”.

## Diff (archivos de este fix)

- `backend/src/controllers/team_controller.py`
- `frontend/src/features/leads/services/leads-analytics.ts`
- `frontend/src/features/sales-dashboard/components/sales-dashboard-page.tsx`

## Cómo probar

1. Dashboard equipo: cierres e ingreso por closer = CRM del mes, sin regenerar reportes.
2. “Ingresos por semana” ≈ suma de `pago` del mes (~€5–6k, no ~€971 congelado).
3. Cambiar `pago` de un lead y ver ambos lugares al recargar, igual que el KPI de Cierres.

*(Pruebas 1–3 con datos reales del cliente: pendientes de sesión autenticada en este entorno; no había app/dev server ni login.)*
