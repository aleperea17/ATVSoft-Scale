# Auditoría de cierre — lote del 21-sep-2026 (Scale Boost)

Solo lectura + un arreglo trivial de build (reportado en § Cambio trivial). Sin deploy. Sin suite de tests en el repo.

**Semáforo general: AMARILLO.** Equipo/Ingresos puede ir solo. Calendly dual + plazos juntos no conviene hasta resolver match de leads-cuota y el backfill de `calendly_user_uri`.

| Feature | Semáforo |
|---|---|
| Doble Calendly | **AMARILLO** (lógica de resolve/allowlist correcta en FastAPI; riesgo de regresión webhook si falta URI; Next no reenvía) |
| Plazos de pago | **AMARILLO** (exclusión de agendas bien puesta en los puntos verificados; captura de cash/mes y colisión con Calendly abiertas) |
| Equipo + Ingresos en vivo | **VERDE** (con matices de match por nombre y helper de agenda) |

---

## A) Doble Calendly

### A1. Modelo `account_key` — **OK en Postgres**

Evidencia:

- `ApiConnection.composite_key(user_id, platform, account_key)` en `backend/src/models.py` (L14–25).
- Migración `_migrate_postgres_apiconnection_account_key` (`db.py` L1590–1660):
  1. `ADD COLUMN account_key VARCHAR NOT NULL DEFAULT ''`
  2. `UPDATE … SET account_key = 'clienta' WHERE lower(platform)='calendly' AND (account_key IS NULL OR '')` — **no borra la fila existente**.
  3. Crea índice único `(user_id, platform, account_key)`.

**Caveat:** la migración **solo corre si `DB_PROVIDER=postgres`**. En SQLite local no hay este backfill. Además, el `DROP CONSTRAINT` itera **todos** los unique de la tabla `apiconnection` (no solo el de `(user_id, platform)`). Hoy no hay otro unique en el modelo; si en prod hubiera uno extra, se caería.

Upsert busca `(platform, account_key)` y, para `clienta`, también filas legacy con `account_key` vacío (`conexiones_services.py` L129–144).

### A2. Orden webhook — **CORRECTO en FastAPI** (línea a línea)

`webhook_controller.calendly_webhook` (`L542–569`):

1. Lista **todas** las `ApiConnection` `platform=calendly` (todos los users).
2. `host_uris = extract_calendly_host_uris(inner, flat, scheduled)`.
3. `matched = match_calendly_connection(calendly_conns, host_uris)`.
4. Si `matched is None` → `return {status: ok, skipped: no_matching_calendly_user}` — **no crea lead, HTTP 200**.
5. **Después:** `creds = matched.credentials` y `is_event_type_allowed(creds, event_type_uri)`.

`match_calendly_connection` (`calendly_connection_resolve.py` L46–62): compara `credentials.calendly_user_uri` con hosts; **sin fallback a `conn[0]`**.

Allowlist: `is_event_type_allowed` usa **solo** el dict `creds` de esa fila (`calendly_event_type_filter.py` L43–54). Fail-closed si allowlist vacía.

### A3. Sync multi-cuenta — **OK**

- `_run_calendly_sync` sin `account_key` itera `_list_calendly_connection_targets` (`calendly_controller.py` L664–711).
- `_run_calendly_sync_one` carga PAT de esa fila y al final `_touch_calendly_last_sync(conn_id)` (L648, L785–794) — **`last_sync_at` por conexión**.
- Auto-sync `run_calendly_auto_sync_for_user` hace check+sync **por `account_key`** (L714–754).
- Allowlist del sync: `is_event_type_allowed(creds, …)` con los `creds` de esa cuenta (L601–604).

### A4. Allowlist no se cruza — **OK (mental + código)**

Clienta URI-A, Closer URI-B:

- Webhook: match por user URI → creds de Closer → allowlist B. URI-A nunca se evalúa.
- Sync Closer: PAT Closer + allowlist de esa fila.
- Evento sin match de user: skip limpio, no se prueba contra clienta.

### A5. UI — **OK**

`conexiones/page.tsx`: un `ConnectionCard` por `account_key`; save/delete/sync pasan esa key (`L236–244`, `L114–117`, `L147–151`).  
`connection-card.tsx` POST `/calendly/sync` con `{ month, account_key }` (L238–244). Desconectar una cuenta no llama delete de la otra.

### A6. Regresión cuenta clienta — **condicional**

Comportamiento de allowlist + sync de **una** fila `clienta` es el mismo **si** `calendly_user_uri` está guardado.

**Riesgo real post-deploy:** `calendly_user_uri` solo se escribe en `ensure_calendly_webhook_subscription` al **guardar** la conexión (`calendly_webhook_service.py` L48–71). Filas viejas sin ese campo: `stored` vacío → `match` siempre `None` → **todos los webhooks se ignoran** (antes se procesaban con `conn[0]`). Mitigación operativa: re-guardar el PAT de clienta una vez tras el deploy (el merge conserva allowlist).

`host_uris` vacío (payload sin memberships/`created_by`) también skippea. Antes no.

### A7. Qué falta para probar E2E con el token de la Closer

**Del código, ya está:** card “+ Agregar otra cuenta Calendly” (`account_key=closer`), PUT con PAT + `event_type_allowlist` de **sus** event types, sync manual de esa card.

**Operativo, no hay más feature que programar para “cargar el token”:**

1. Pegar PAT Closer + allowlist (URIs de tipos de esa cuenta, fail-closed).
2. Guardar (registra webhook Calendly + `calendly_user_uri`).
3. Re-guardar clienta si no tiene `calendly_user_uri`.
4. Probar sync de la card Closer (no hace falta un booking real para ver leads).
5. Confirmar que Calendly pega al **FastAPI** `POST /webhooks/calendly`.

**Trampa de infra:** `ensure_calendly_webhook_subscription` apunta a `{PUBLIC_SITE_URL}/api/webhooks/calendly`. La ruta Next `frontend/src/app/api/webhooks/calendly/route.ts` **no reenvía al backend** (devuelve `{ success: true, lead_id: null }`). Si el dominio público es Next sin proxy a FastAPI, el resolve dual **nunca corre**. El sync sí usa FastAPI. Verificar el rewrite de prod antes de fiarse del webhook.

---

## B) Plazos de pago

Prompt `cursor/auditoria-cierre-plazos-pago-scale.md` **no está** en el repo. Se cubren los 7 puntos pedidos.

### B1. Separación del working tree Calendly vs plazos — **OK**

Sin mezcla incorrecta de credenciales/webhook dentro de `plazos_pago_service.py`. Calendly no lee `es_cuota_plazo` (el problema es el inverso: ver D1). Helpers de agenda viven en `lead_agenda_utils.py`.

### B2. Exclusión de agendas — **6+ puntos con evidencia de código** (no se ejecutó contra BD)

| # | Sitio | Evidencia |
|---|---|---|
| 1 | Metrics leads | `leads_controller.py` L630 `lead_counts_as_agenda` |
| 2 | Sin punto agenda | L555 `not lead_is_cuota_plazo(r)` |
| 3 | BIO | `bio_controller.py` L209 `lead_counts_as_agenda` |
| 4 | Reels COUNT | `reels_services.py` L195 `es_cuota_plazo = false` |
| 5 | Stories COUNT | `stories_service.py` L88 mismo SQL |
| 6 | YouTube COUNT | `youtube_controller.py` L142 mismo SQL |
| 7 | Posts | `feed_posts_services.py` L183 |
| 8 | Preview closer report | `closer_report_auto_service.py` L59 `reales = not lead_is_cuota_plazo` |
| 9 | WhatsApp recordatorio | `agent_closer_service.py` L88 |
| 10 | FE Ventas | `leads-analytics.ts` `leadHasAgenda` / `leadIsCierre` con `leadIsCuotaPlazo` |
| 11 | Hijo cuota | `plazos_pago_service.py` L97 `punto_agenda=""` |
| 12 | Equipo (hoy) | `team_controller.py` L885 skip cuota en calls/shows |

**No se recorrieron 16/16 contra runtime.** Cash de contenido (SUM `pago` por `punto_agenda`) **no** filtra cuota; con `punto_agenda=""` en el hijo, no atribuye. Si alguien copia el token al hijo, sí sumaría cash (intencional de “ingreso sí / agenda no”).

### B3. Idempotencia — **código OK; no corrido dos veces en esta auditoría**

`generate_plazos_pago`: candidato = `fecha_seguimiento_pago <= hoy`. Tras crear, pone la fecha del padre a `None` (L111). `_child_exists_for_fecha` (L29–40) + skip. Segunda corrida: lista vacía o `skipped`, `created=0`. **No hay evidencia de ejecución real** (sin job/API en este entorno).

### B4. Seed PLAZO PAGADO — **OK**

`_ensure_default_catalog` solo inserta nombres **faltantes** (`lead_statuses_services.py` L182–207). No resetea flags ni borra estados custom.

### B5. Catch-up / fecha de cash del agente — **sigue como limitación**

Cuota nace con `call=agendo=fecha del plazo` (mediodía), `created_at=now` (`plazos_pago_service.py` L84–109).

- CRM / Equipo / Ventas en vivo: mes = `call > agendo > …` → **mes de la fecha de plazo**, no del día del job.
- **Agente** `agent_analytics_service._lead_effective_dt` = `fecha_bot or created_at` (L57–58) y `_leads_for_month` exige `agendo` (L87–95). Un catch-up masivo mete cuotas en el mes de **creación** del agente, no del plazo. **No se unificó** con el criterio `call > agendo`.

`pago` del hijo arranca en 0; el cash aparece cuando se carga a mano, en el mes que use cada superficie.

### B6. Cron vs `DISABLE_AUTO_SYNC` — **OK**

`main.py` L200–261: jobs de sync solo si `auto_sync_enabled()`; `auto_generate_plazos_pago` se registra **fuera** de ese `if` (L256–264), 00:15 TZ empresa.

### B7. Compilación archivos tocados — **OK**

`compileall` de `backend/` exit 0.

---

## C) Dashboard de Equipo + Ingresos en vivo

### C1. `_live_closer_month_stats` vs resto en vivo — **OK con un desvío de helper**

Archivo: `team_controller.py` L863–901.

- Mes: `_lead_effective_dt_for_month` = `call or agendo or fecha_bot or created_at` (L853–855) = `GET /leads?month=`.
- `ingreso`: `pago` **antes** del `continue` de cuota (L884–886) — cuotas **sí** suman ingreso.
- Calls/shows/cierres: no cuota; requiere `call` o `agendo`; flags de catálogo.

Alineado con Ventas (`leadHasShow` / `leadIsCierre` + `pago`). **No** usa `lead_counts_as_agenda` (ese helper solo mira `agendo`, no `call`). Ver D2.

### C2. Match closer por `casefold` — **edge cases reales**

`_norm_member_name` = `strip().casefold()` — **no** quita tildes (`Ainóa` ≠ `Ainoa`). Nombres duplicados: dos tarjetas muestran **el mismo** agregado. Closers **inactivos** no salen en la UI; su `pago` no entra en `cash_total` del endpoint (sí existiría en el dict interno). Leads sin `closer` se ignoran.

### C3. Gráficos no duplican `pago` + seguimiento — **OK en semanal/diario**

`leads-analytics.ts`: buckets `ingresos` solo suman `l.payment` (L560–564). Ya no se recorren `seguimientoEntries`. El KPI mensual **sigue** `cashCollected = pago + seguimientoTotal` (L433–435). Los gráficos pueden ser **menores** que “Cash del mes” si hay seguimiento; no es doble conteo en el gráfico.

---

## D) Interacción entre las tres

### D1. Cuota vs doble Calendly — **HALLAZGO (P0 si se deployan juntos)**

Calendly **no** mira `es_cuota_plazo`. El hijo copia `nombre`, `ig`, `email` del padre (`plazos_pago_service.py` L88–94).

- Webhook `_find_lead_for_calendly`: mismo IG/nombre, **el más nuevo** (`webhook_controller.py` L464–482). Tras crear una cuota, un `invitee.created` (clienta **o** closer) puede **actualizar la cuota**: `call`/`agendo`/status Reserva, no el padre.
- Sync `_find_lead_by_email`: misma regla (más reciente) (`calendly_controller.py` L111–126, L444).

No es un bug del resolve de cuenta; es matching de Lead. El doble Calendly **aumenta** la superficie (más eventos).

### D2. Helper de exclusión en Equipo — **parcial**

Usa `lead_is_cuota_plazo` (bien). **No** usa `lead_counts_as_agenda`; reimplementa `call is None and agendo is None` para alinearse a Ventas, no a BIO. Riesgo de desvío futuro: BIO/metrics = “hay `agendo`”; Equipo/Ventas = “hay `call` o `agendo`”. Documentado, no bloqueante para Equipo-Ingresos.

---

## E) Salud general

### E1. Build

- `python -m compileall backend` → **OK**.
- `npm run build` (frontend): **falló** por operador `??`/`||` en `historias/page.tsx` L512 (archivo **no** del lote de hoy). Tras paréntesis (cambio trivial, ver abajo) → **OK** (Next 16.2.4, 64 páginas). Typecheck de Next **skipped** (`Skipping validation of types`).
- `node_modules` no estaba; se hizo `npm install` para poder medir el build (no es cambio de producto).

### E2. Tests

No hay `pytest.ini` ni `*test*.py` de producto. **Nada que correr.**

### E3. Ruido en código nuevo de hoy

- `print(f"[calendly webhook] payload: {payload}")` (`webhook_controller.py` L494) — PII en logs. Preexistente al dual, sigue en el path tocado.
- Sin `TODO` crítico en los archivos del lote.
- `agent_analytics_service.py` (no es del lote): `_norm_program_key` **se usa y no está definido** (L116); hay una función rota duplicada `_program_prices_display` (L69–73) que parece un rename a medias. `NameError` si corre facturación del agente. **Preexistente** (`git diff` limpio vs working tree).

---

## Prioridad antes de deploy

1. **P0 — Matching Calendly × cuota:** excluir `es_cuota_plazo` (y/o preferir padre) en `_find_lead_for_calendly` y `_find_lead_by_email`. Obligatorio si plazos y Calendly salen juntos.
2. **P0 — `calendly_user_uri` en clienta:** re-guardar conexión o backfill en `/users/me` (sync/check) para no silenciar webhooks el día 1.
3. **P1 — Ruta pública del webhook:** confirmar que prod no se queda en el stub de Next; si sí, el dual Calendly en vivo no existe (el sync sí).
4. **P2 — Catch-up agente:** o unificar mes del agente con `call>agendo`, o dejarlo escrito como limitación (sigue abierto).
5. **P3 — `_norm_program_key`** en analytics del agente (fuera del lote, rompe un endpoint).
6. **P4 — Quitar print del payload** Calendly.

Equipo/Ingresos: nada bloqueante.

---

## ¿Un solo lote o separar?

| Lote | Recomendación |
|---|---|
| Solo Equipo + gráficos Ingresos | **Sí, puede ir ahora.** |
| Doble Calendly | **Separar** hasta P0 URI + confirmar proxy webhook. Se puede **cargar el token y probar por sync** en staging sin esperar bookings. |
| Plazos | **No juntar con Calendly** hasta P0 matching. Solo plazos: OK si se acepta catch-up del agente y se re-guarda clienta no aplica. |
| Las tres juntas | **No.** Interacción D1 + silencio de webhooks.

---

## Cambio trivial hecho en esta pasada

`frontend/src/app/(main)/historias/page.tsx`: paréntesis alrededor de `??` + `||` para que compile Next. **No es del lote de hoy.** Reportado porque E pedía `npm run build`.
