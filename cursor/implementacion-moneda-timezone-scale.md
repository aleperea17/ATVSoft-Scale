# Implementación — Moneda euros + zona horaria configurable (Scale)

> **Superseded (TZ):** la configurabilidad de zona horaria se revirtió a `Europe/Madrid` fijo. Ver `cursor/simplificacion-timezone-madrid-scale.md`. La moneda en euros sigue vigente.

Fecha: 2026-09-04. Alcance: solo Scale. No se portaron módulos activables ni el resto de `CompanyConfig` de Erik/Lorena (nombre, logo, etc.): solo `timezone`.

---

## 1. Diff de ambos cambios

`git diff --stat` al cierre (archivos nuevos aparte): **~53 archivos tocados, +445 / −358**. Archivos nuevos:

| Archivo | Rol |
|---|---|
| `backend/src/models.py` → entidad `CompanyConfig` | Singleton `id=1`, campo `timezone` |
| `backend/src/services/company_config_service.py` | Lectura/validación + `company_today()` / `company_now()` / `get_company_tz()` |
| `backend/src/controllers/company_config_controller.py` | `GET/PATCH /api/company-config` |
| `frontend/src/shared/lib/company-timezone.ts` | TZ resuelta desde API + `todayIsoInCompanyTz` / `monthKeyInCompanyTz` |
| `frontend/src/app/(main)/ajustes/empresa/page.tsx` | Pantalla Ajustes → Empresa |

### Cambio 1 — Moneda (€, sin FX)

Los montos en BD **no se convierten**. Solo cambia el símbolo mostrado.

- `formatCash` / `formatCashAxisShort` en `frontend/src/shared/lib/format-utils.ts`: `'$'` → `'€'`.
- Labels/placeholders que no pasaban por `formatCash`:
  - KPI / channel breakdown del dashboard marketing (`kpi-grid`, `channel-breakdown`)
  - `reels/page.tsx` (tenía un `formatCash` local con `$`)
  - BIO `formatCashPorChat`, celdas `$0` de leads / panel diario / AOV closer / historias
  - Programas: copy «Precio USD» → «Precio (€)»; display con `formatCash` (columna BD sigue `price_usd`)
  - Columna CRM `Ingresos lead (€)`
  - Discord closer + texto de weekly report en backend (`€`)
  - Prompt Fathom: «mensual en euros»
- **A propósito no tocado:** `calendly-mapper.ts` sigue buscando la pregunta cuyo texto contiene `USD` (es matching del form Calendly, no display). Columna `price_usd` no se renombró.

### Cambio 2 — Zona horaria configurable

- Tabla `company_config` creada de forma idempotente en `db.py` (`CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING`). Default `America/Argentina/Buenos_Aires` para no romper la instancia si nadie configura.
- API: `GET/PATCH /api/company-config`. Al cambiar TZ, si `DISABLE_AUTO_SYNC` no está activo, se reprograman crons 23:00 (closer) y 23:59 (reels) vía `apply_cron_schedules()`.
- Frontend: `AppProviders` carga la TZ, la guarda en módulo + contexto (`useCompanyTimezone`). `useMonth(timezone)` deriva el mes actual y las 12 opciones de esa TZ, no del navegador.
- Ajustes → Empresa: select (AR, Madrid, CDMX, Bogotá, Santiago, Lima, US East, UTC). Sidebar/topbar ya apuntan a `/ajustes/empresa`.

Hardcodes operativos de `America/Argentina/Buenos_Aires` / `AR_TZ` / `toISOString().split('T')[0]` (UTC) reemplazados en backend y frontend. El date picker de Carga de Reportes y el dashboard de equipo leen la TZ de instancia.

---

## 2. Grep de `America/Argentina/Buenos_Aires` — lista final

Corrido sobre todo el repo al cerrar. Cada fila confirma reemplazo o default intencional.

| Ubicación | ¿Reemplazada? | Notas |
|---|---|---|
| `backend/src/models.py` (`CompanyConfig.timezone` default) | **No — default** | Fallback de Pony si no hay fila |
| `backend/src/db.py` (`DEFAULT` de columna + `INSERT` id=1) | **No — default** | Instancia existente no cambia de TZ hasta Ajustes |
| `backend/src/services/company_config_service.py` (`DEFAULT_TIMEZONE` + opción del select) | **No — catálogo** | Una de las 8 opciones; no se usa como “hoy” operativo |
| `frontend/src/shared/lib/company-timezone.ts` (`DEFAULT_COMPANY_TIMEZONE`) | **No — default UI** | Solo hasta que `GET /company-config` hidrata |
| `cursor/orientacion-sistema-scale.md` | Doc actualizado | Menciona el IANA como default, no como hardcode operativo |

**Todas las demás ocurrencias del grep previo se reemplazaron** (ya no aparecen en el repo):

Backend (leían `ZoneInfo("America/Argentina/Buenos_Aires")` o `AR_TZ`):

- `backend/main.py` — crons 23:00 / 23:59 y `next_run_time` de historias
- `backend/src/services/sync_scheduler_service.py` — `apply_cron_schedules` / `apply_sync_schedules`
- `backend/src/services/closer_report_auto_service.py` — `company_today()` para el día del auto-reporte
- `backend/src/controllers/team_controller.py` — generate-day / preview
- `backend/src/controllers/leads_controller.py` — mes, llamadas-hoy, alta manual
- `backend/src/controllers/bio_controller.py`, `youtube_controller.py`, `hot_leads_controller.py`, `stories_controller.py`, `admin_panel_controller.py`
- `backend/src/services/agent_closer_service.py`, `agent_analytics_service.py`, `reels_services.py`, `stories_service.py`
- `backend/src/services/instagram_token_utils.py` — se eliminó `AR_TZ` (no se usaba)
- `backend/src/services/bio_service.py` — código activo no usa IANA; comentarios actualizados

Frontend (constante `AR_TZ` o `timeZone: 'America/Argentina/Buenos_Aires'`):

- `daily-panel-page.tsx` + `daily-panel-service.ts`
- `dashboard-view.tsx` (corte MTD y fechas de publicación)
- `reels/page.tsx`, `reels-metrics-panel.tsx`, `metrica-historias/page.tsx`, `keywords/page.tsx`, `bio/page.tsx`, `youtube/page.tsx`
- `connection-card.tsx` + `useMonth`
- Date pickers que usaban UTC: `daily-report-form.tsx`, `seguimiento-report-form.tsx`, historial de reportes, weekly reports, admin panel, historias, content-tracking, simple-entries

No quedó ningún `AR_TZ` ni `America/Argentina/Buenos_Aires` operativo fuera de default/catálogo/doc.

---

## 3. Cómo probar

1. Arrancar backend (la migración crea `company_config` id=1 con Argentina). Frontend con sesión.
2. Ir a **Ajustes → Empresa**. Elegir **España (Madrid)** (`Europe/Madrid`). Guardar.
3. **Carga de Reportes** (`/team/reportes`): el date picker «Fecha» debe ser el **hoy civil de Madrid**, no UTC ni el del navegador. Si son las 22:00 en Argentina y ya es 03:00 del día siguiente en Madrid, el picker muestra esa fecha de Madrid.
4. **Panel diario**: la fecha «Hoy» y el reloj usan la misma TZ. El label dice «zona empresa».
5. **Dashboard de equipo** (`/team`) y selector de mes global: el mes «actual» es el de Madrid. Misma regla en dashboard marketing, Reels (filtro mes actual), YouTube, BIO, métricas de historias.
6. Tras Guardar, si el auto-sync está encendido, los jobs 23:00 (reporte closer) y 23:59 (reels nuevos) quedan reprogramados en Madrid **sin reiniciar**. En Tasa de refresco el copy ya no dice «Argentina». Si `DISABLE_AUTO_SYNC=true`, no hay scheduler (comportamiento previo).
7. Montos: `€1.234` en reportes, leads, dashboards, Discord. Los números en BD no cambian.

Para volver atrás: Ajustes → Empresa → Argentina (Buenos Aires) → Guardar.

---

## 4. Riesgos no descartados (scheduler / auto-reporte)

Punto de mayor riesgo, no cerrado del todo:

### 4.1 `_day_bounds` sigue naive

`closer_report_auto_service._day_bounds` compara `lead.call` (datetime naive) contra `00:00`–`23:59` de `fecha`. **No** convierte `lead.call` a la TZ de empresa.

El mes de `/leads` sí trata naive como UTC y lo pasa a TZ empresa (`datetime_month_tuple`). Históricamente el reporte closer no hacía esa conversión; no se cambió para no mover qué calls caen en qué día vs el histórico.

Consecuencia al pasar a Madrid: una call cerca de medianoche puede caer en un día distinto en el auto-reporte que en el corte de mes de Leads. Revisar un día de frontera (23:00–02:00) después del cambio.

### 4.2 Cambio de TZ a mitad del día

- **Saltear:** si a las 22:00 AR (ya 03:00 del día siguiente en Madrid) se pasa a Madrid, el cron 23:00 AR de esa noche no corre y el de Madrid 23:00 es el día civil siguiente. El auto-reporte de “hoy AR” no se genera.
- **Discord doble:** `upsert_closer_report` no duplica filas (actualiza), pero si el cron corre dos veces el mismo `company_today()` (reschedule + hora ya pasada / misfire), Discord puede avisar de nuevo.
- `DISABLE_AUTO_SYNC=true`: PATCH guarda TZ pero **no** reprograma jobs (no hay scheduler).

### 4.3 Recomendación pre-prod

Probar en local con TZ Argentina, generar/forzar un closer report, cambiar a Madrid, verificar: (a) date picker, (b) `company_today()` en logs, (c) `next_run_time` de los dos crons, (d) que un segundo «Generar» el mismo día hace upsert y no una fila extra. No deployar el cambio de TZ a producción a las 22–23 h de ninguna de las dos zonas.
