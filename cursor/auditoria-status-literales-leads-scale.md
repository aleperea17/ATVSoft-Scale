# Auditoría — Dependencias de valores literales de `status` (Leads) — Scale

**Alcance:** solo lectura. Sin cambios de código.  
**Fecha:** 2026-09-04  
**Pregunta clave:** ¿Se puede calcar el patrón Avatares (CRUD libre) sin romper Shows/Cierres y otros cálculos?

## Veredicto

**No.** Scale **sí depende** de strings literales de status de Lead — sobre todo `"Cerrado"` / `"cerrado"` y `"No show"` / `"no show"`. Si el cliente renombra esos estados libremente, el embudo de marketing (`calcFunnel`), el reporte automático de closer, métricas BIO, YouTube, content-tracking y filtros de tabs dejan de contar bien.

No es tan amplio como “todo el dashboard de ventas” (ese embudo principal toma Shows/Cierres de **reportes diarios** closer/setter), pero esos reportes **automáticos** también se arman comparando literales. Renombrar sin mapeo rompe el circuito.

---

## 1. Origen actual de la lista de status (Leads)

**Hardcodeada en frontend**, mismo patrón que tenían los avatares antes del CRUD.

| Qué | Dónde | Valores |
|-----|--------|---------|
| Opciones del select | `frontend/src/features/leads/types/index.ts` L113 `STATUS_OPTIONS` | `Pendiente`, `Seguimiento`, `Seña`, `Cerrado`, `No show`, `Re-agenda`, `Descalificado` |
| Colores badge | mismo archivo L95–103 `STATUS_COLORS` | keyed por esos labels |
| Tabs de filtro | mismo archivo L131 `STATUS_TABS` | `Todos`, `Cerrados`, `Seguimiento`, `No show`, `Pendiente`, `Descalificado` |
| Normalización | `canonicalLeadStatus` L147–179 | sinónimos → labels canónicos de arriba |
| Columnas tabla | `buildColumns` L209 | `options: STATUS_OPTIONS` |
| Panel diario | `daily-calls-table.tsx` importa `STATUS_OPTIONS` / `canonicalLeadStatus` | misma lista |
| Hot Leads (entidad aparte) | `frontend/src/features/hot-leads/types/index.ts` L41–49 | lista propia + `Prospectar` |

**Backend:** `Lead.status` / `Lead.estado` son `str` libre. Default al crear: `"Pendiente"`. No hay tabla/API de catálogo de status. Calendly/GHL escriben `"Agendado"` (fuera de `STATUS_OPTIONS`), lo que confirma que la BD ya acepta texto libre; solo la UI y la lógica de negocio asumen el set fijo.

---

## 2. Dependencias de literales (lógica de negocio / métricas)

### Críticas — embudo y automatizaciones

| Archivo | Línea(s) | String exacto | Uso |
|---------|----------|---------------|-----|
| `frontend/src/features/leads/services/leads-analytics.ts` | 81–83 | `'no show'` (lower) | `leadHasShow`: agenda **y** status ≠ no show → **Shows** |
| `frontend/src/features/leads/services/leads-analytics.ts` | 86–87 | `'cerrado'` (lower) | `leadIsCierre` → **Cierres** |
| `frontend/src/features/leads/services/leads-analytics.ts` | 136–139, 164–168 | vía helpers | `filterLeadsForFunnelStep` / `calcFunnel` (shows, noShows, cierres, rates) |
| `frontend/src/app/(main)/dashboard/dashboard-view.tsx` | 635–636 | vía `calcFunnel` | Dashboard marketing: Shows/Cierres desde leads |
| `frontend/src/app/(main)/dashboard/dashboard-view.tsx` | 719 | `'Cerrado'` | Breakdown programas solo si `status === 'Cerrado'` |
| `backend/src/services/closer_report_auto_service.py` | 52 | `"no show"` | Shows del día = leads del closer con call ese día y status ≠ no show |
| `backend/src/services/closer_report_auto_service.py` | 53 | `"cerrado"` | Cierres del reporte auto |
| `backend/src/controllers/bio_controller.py` | 89–91, 209 | `"cerrado"` | Métricas BIO: conteo `cerrados` y cash por lead cerrado |

**Nota sales-dashboard:** `getLeadsAnalytics` arma Shows/Cierres del embudo mensual desde **CloserReport** (números del formulario/auto), no relee status de cada lead. Pero el **auto** (`closer_report_auto_service`) sí depende de `"cerrado"` / `"no show"`. Si el auto deja de contar, el dashboard de ventas hereda el error.

### UI filtros / badges / atribución

| Archivo | Línea(s) | String exacto | Uso |
|---------|----------|---------------|-----|
| `frontend/src/features/leads/components/leads-page.tsx` | 693–701 | `'Cerrado'`, `'Seña'` (+ tabs = status) | Tab **Cerrados** = Cerrado ∨ Seña; resto match canónico |
| `frontend/src/features/hot-leads/components/hot-leads-page.tsx` | 51 | `'Cerrado'`, `'Seña'` | Misma regla tab Cerrados |
| `frontend/src/features/content-tracking/components/content-page.tsx` | 161, 235 | `'Cerrado'` | Conteos / ventas atribuidas a contenido |
| `frontend/src/features/content-tracking/components/content-page.tsx` | 272–273 | `'Cerrado'`, `'Seguimiento'` | Colores de badge en lista |
| `frontend/src/app/(main)/youtube/page.tsx` | 667, 784 | `'Cerrado'` | Filtro “cerrados” (+ payment) y estilo verde |
| `frontend/src/features/leads/types/index.ts` | 95–179 | todo el set | Colores, opciones, sinónimos, tabs |
| `frontend/src/features/hot-leads/types/index.ts` | 41–63 | set Hot Leads + `Prospectar` | Idem |

### Defaults / escritura / IA (no calculan embudo, pero fijan el vocabulario)

| Archivo | Línea(s) | String | Uso |
|---------|----------|--------|-----|
| `backend/src/controllers/leads_controller.py` | 216, 362, 427–428, 606 | `"Pendiente"` | Default lectura/creación/patch |
| `backend/src/controllers/admin_panel_controller.py` | 112–113 | `"Pendiente"` | Alta desde admin |
| `backend/src/schemas.py` | 458, 625 | `"Pendiente"` | Defaults schema Lead |
| `backend/src/services/agent_closer_service.py` | 50 | `"Pendiente"` | Default al serializar panel |
| `backend/src/controllers/calendly_controller.py` | 396, 415 | `"Agendado"` | Status al agendar (no está en `STATUS_OPTIONS`) |
| `backend/src/controllers/ghl_controller.py` | 252, 273 | `"Agendado"` | Idem |
| `frontend/src/features/leads/services/fathom-transcript-analyzer.ts` | 16–17, 31, 64, 72 | lista fija + `"Pendiente"` | Prompt Claude: status debe ser exactamente uno de esos |

### Hot Leads (defaults, no embudo de Leads)

| Archivo | Línea(s) | String | Uso |
|---------|----------|--------|-----|
| `backend/src/controllers/hot_leads_controller.py` | 110, 179, 239 | `"Prospectar"` | Default |
| `backend/src/db.py` / models | default columna | `'Prospectar'` | Schema HotLead |

### Fuera de alcance (no son status de Lead)

No cuentan como dependencia de status de Lead, aunque el nombre confunda:

- **`calificacion_llamada`:** `"calificado"` / `"descalificado"` (campo aparte; closer auto L54–55).
- **Reportes `SeguimientoReport` / filtro `kind === 'seguimiento'`:** cobranza, no status de lead.
- **`CallReport.estado` / weekly report `estado`:** ciclo de vida del job (`pendiente`, `procesando`, …).
- Código **comentado** en `bio_service.py` (~L427+) con literales — no activo.

---

## 3. Resumen de strings que “alimentan” cálculos

| Literal | Rol semántico hoy |
|---------|-------------------|
| `Cerrado` / `cerrado` | **Cierre** (embudo, auto-reporte closer, BIO, YouTube, content, tab Cerrados) |
| `No show` / `no show` | **Excluye de Shows** (y suma noShows en `calcFunnel`) |
| `Seña` | Tab **Cerrados** (junto con Cerrado); no cuenta como cierre en `leadIsCierre` |
| `Seguimiento` | Solo UI (tab, color content-tracking); **no** entra en Shows/Cierres del calc |
| `Pendiente`, `Re-agenda`, `Descalificado` | UI / defaults / Fathom; sin rol en Shows/Cierres |
| `Agendado` | Escrito por integraciones; no en select ni en calc de cierre |

---

## 4. Recomendación: **A** (con roles semánticos), no Avatares puro ni B solo

### Por qué no calcar Avatares tal cual

Avatares son labels cosméticos. Status de Lead **particiona el embudo**. Sin un enlace estable label → rol, renombrar `"Cerrado"` a p.ej. `"Ganado"` deja `leadIsCierre` y el auto-reporte en cero.

### Por qué no **B** solo (status de sistema intocables)

El cliente quiere **reemplazar** la lista por 6 estados propios. Si Cerrado/No show/Seguimiento quedan fijos e inborrables, no cumple el pedido (solo “agregar extras”).

### **A recomendada** (híbrido práctico)

1. CRUD en Ajustes (nombre, color, orden, activo) — UX tipo Avatares.
2. Cada status tiene **uno o más flags de rol** (o un `funnel_role` excluyente), p.ej.:
   - `counts_as_cierre` (hoy: Cerrado)
   - `counts_as_no_show` (hoy: No show)
   - `counts_as_cerrados_tab` opcional (hoy: Cerrado + Seña)
3. Toda comparación de negocio usa esos flags (o IDs/slugs internos), **nunca** el label visible.
4. Seed inicial: mapear los 7 actuales a esos roles para no romper datos existentes.
5. Validación: como máximo un status con `counts_as_no_show` (o N, si se documenta); al menos uno con `counts_as_cierre` si quieren embudo.
6. Actualizar en el mismo PR: `leads-analytics`, `closer_report_auto_service`, `bio_controller`, tabs, content/YouTube, Fathom prompt (inyectar lista + roles), defaults (`Pendiente` → el status marcado “inicial” o el primero activo).

**Alternativa B+:** status sistema con **label editable** pero slug fijo (`closed`, `no_show`). Funciona, pero es menos flexible si quieren 2 tipos de “cierre” o no usar “No show” con ese nombre — A con flags cubre eso mejor.

---

## 5. Conclusión explícita

- **Hay dependencias literales fuertes.** Scale no es “más simple” que otros clientes ATV en este punto para Shows/Cierres derivados de leads y del reporte auto.
- **No implementar status 100% libres sin mapeo a roles.**
- Camino seguro: **CRUD custom + roles de embudo (opción A)**.
