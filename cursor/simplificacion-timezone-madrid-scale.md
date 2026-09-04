# Simplificación — Europe/Madrid fijo (Scale)

Fecha: 2026-09-04. Alcance: solo Scale. No es una vuelta a Argentina: se mantiene el criterio de “hoy” vía funciones centrales, ahora con una sola constante.

---

## 1. Diff de la simplificación

### Sacado

- Entidad `CompanyConfig`, schemas `CompanyConfigOut` / `CompanyConfigPatch`, `GET/PATCH /api/company-config`.
- Pantalla Ajustes → Empresa + ítems de sidebar/topbar.
- `apply_cron_schedules()` (reschedule en caliente de 23:00 / 23:59).
- Fetch de TZ en `AppProviders`.
- Tabla `company_config`: migración ahora hace `DROP TABLE IF EXISTS` (idempotente). Si el deploy anterior la creó, se borra al arrancar.

### Constante única

| Capa | Dónde | Valor |
|---|---|---|
| Backend | `COMPANY_TIMEZONE` en `backend/src/services/company_config_service.py` | `"Europe/Madrid"` |
| Frontend | `COMPANY_TIMEZONE` en `frontend/src/shared/lib/company-timezone.ts` | `'Europe/Madrid'` |

`company_today()`, `company_now()`, `get_company_tz()`, `datetime_month_tuple()` leen esa constante. No consultan BD.

En frontend, `todayIsoInCompanyTz` / `monthKeyInCompanyTz` / `useCompanyTimezone()` / `useMonth` usan la misma constante. Los call sites no se reescribieron.

### Crons

En `main.py` lifespan, 23:00 (closer) y 23:59 (reels) se registran con `get_company_tz()` → Madrid. `apply_sync_schedules()` sigue existiendo solo para intervalos de Tasa de refresco (historias / reels métricas / Calendly), no para cambiar la TZ de los crons.

---

## 2. Grep `America/Argentina/Buenos_Aires`

Corrido sobre `*.py`, `*.ts`, `*.tsx`: **cero ocurrencias**.

La única mención restante está en el `.md` histórico `cursor/implementacion-moneda-timezone-scale.md` (marcado como superseded). No hay default residual en código.

`Europe/Madrid` aparece solo en las dos constantes centrales (más este doc y comentarios de `bio_service` legado).

---

## 3. `_day_bounds` — decisión

**No se corrigió.** Sigue comparando `lead.call` naive contra `00:00`–`23:59` de `fecha`.

Por qué no ahora:

- Calendly guarda `start_time` UTC (Pony lo persiste naive con reloj UTC).
- El alta manual del panel guarda `datetime.combine(fecha, HH:MM)` en hora civil que tipeó el closer (Madrid).
- Interpretar todo naive como UTC (como el corte de mes de Leads) alinearía Calendly con `/leads`, pero **correría las llamadas manuales de 22:00–23:59 al día siguiente**.
- Corregir solo el auto-reporte y no `list_llamadas_dia` (panel diario) partiría panel vs reporte.

Un arreglo limpio implica un solo criterio de persistencia (p. ej. guardar siempre UTC y convertir la hora del form desde Madrid). Eso es otro cambio, no esta simplificación.

El desfasaje cerca de medianoche entre mes de Leads y auto-reporte closer **sigue latente**. `list_llamadas_dia` en `agent_closer_service.py` usa el mismo bound naive (coherente con el reporte, no con el mes).

---

## 4. Cómo probar

Tras deploy (sin pasar por Ajustes):

1. Arrancar backend + frontend. En logs: `Reporte closer … 23:00 (Europe/Madrid)` y `Reels … 23:59 (Europe/Madrid)`.
2. **Carga de Reportes** (`/team/reportes`): el date picker es el hoy civil de España, no UTC ni el del navegador.
3. **Panel diario**: «Hoy» y el reloj en Madrid.
4. **Dashboard de equipo** y selector de mes: mes calendario España.
5. No existe Ajustes → Empresa. Tasa de refresco y Mi cuenta siguen.
6. Montos siguen en `€` (no se tocó moneda).
7. Si la instancia tenía `company_config` de la pasada anterior, al boot desaparece la tabla. No hay efecto en runtime.
