# Auditoría final pre-push — lote Equipo + Calendly + Plazos (Scale Boost)

Fecha: 2026-09-21. Solo lectura. Builds ejecutados en esta pasada.

**Semáforo deploy conjunto: VERDE.** Franco puede pushear. Lo que queda es operativo (env en prod), no un bug de código que bloquee el lote.

| Feature | Semáforo |
|---|---|
| Equipo + Ingresos en vivo | Verde |
| Doble Calendly (incl. P0/P1/P4) | Verde |
| Plazos de pago | Verde |
| **Lote junto** | **Verde** |

---

## 1. Fixes P0/P1/P4 (código actual, no el reporte previo)

### 1.1 Matching vs cuotas — **OK, sin hueco de crash**

`_find_lead_for_calendly` (`webhook_controller.py` L477–500): el set de candidatos es `user_id` **y** `not lead_is_cuota_plazo(r)`. Luego IG, luego nombre, o `return None`.

`_find_lead_by_email` (`calendly_controller.py` L114–131): `continue` si `lead_is_cuota_plazo(row)`. Si `matches` queda vacío → `return None` (L128–129).

Si **todos** los homónimos/emails son cuotas:

- Webhook: `row is None` → crea un **Lead nuevo** (L634+), no toca cuotas, no lanza.
- Sync: `_apply_invitee_to_lead` con `row is None` → `"created"` (L487+), mismo criterio.

El padre real sigue siendo candidato (no es cuota). El caso “solo cuotas” solo ocurre si no hay padre con ese IG/nombre/email (p. ej. padre sin email y sync solo por email): entonces se crea otro lead — comportamiento previo a plazos, no un crash.

### 1.2 Backfill `calendly_user_uri` — **OK en check/sync; fail-soft en webhook**

Check (`calendly_controller.py` L359–371) y sync one (L594–606): tras `/users/me` exitoso, `persist_calendly_user_uri_if_missing` sin tocar la UI.

Persistencia (`calendly_webhook_service.py` L51–80): no-op si la URI ya está; no pisa credenciales.

**PAT sin permiso a `/users/me`:**

- En **check/sync**, `_calendly_get` ya abortaba el flujo entero con 502/401 (L186–190) **antes** de este fix: el listado de eventos usa `user_uri` de `/users/me`. El persist **no se llega a ejecutar**. No es un fallo nuevo del backfill.
- En **webhook**, `fetch_calendly_user_identity` traga la excepción (`except Exception: return {}`, L46–48). El evento se skippea con `no_matching_calendly_user` si aún no hay URI. No 500.

Webhook extra: si no hay match, backfill de filas sin URI y reintenta (`webhook_controller.py` L578–583).

### 1.3 Proxy Next — **POST correcto; GET de salud es laxo**

`frontend/src/app/api/webhooks/calendly/route.ts`:

- POST: `getBackendInternalUrl()` → `{BACKEND_INTERNAL_URL|BACKEND_URL|http://127.0.0.1:8000}/webhooks/calendly`.
- Fetch falla → **502** `{ error: 'Backend unavailable' }` (L35–36). **No** `success: true`.
- Reenvía status y body del FastAPI (L31–34).

GET si el backend cae: `{ status: 'ok', service: 'calendly-webhook' }` (L48). Solo probe; Calendly usa POST `invitee.created`. No bloquea el deploy. En prod el servicio Next debe tener `BACKEND_INTERNAL_URL` al FastAPI (mismo criterio que ManyChat).

### 1.4 PII — **OK en archivos del lote Calendly**

- No queda `print(...payload...)` en `webhook_controller.py`.
- Log: `event=` + último segmento de URI del invitee (L516–519), no nombre/email/tel.
- `calendly_controller.py`: sin `print`/`logger` de payloads.
- `calendly_webhook_service.py`: `connection_id` y stack de `/users/me` fallido (`exc_info=True`) — no el invitee.
- `route.ts`: sin `console.log`.

Prints con datos en **GHL** (`ghl_controller.py`) y stories son **otros** flujos, no este lote.

---

## 2. Regresión cuenta clienta — **OK**

- `account_key` default / migración `'clienta'`; upsert y `_pick_calendly_row` siguen resolviendo `clienta` y `""`.
- Sync de una cuenta: mismo PAT, misma allowlist en **sus** `credentials`.
- Webhook: match por URI persistida (o backfill en el primer evento/check), allowlist de **esa** fila — no `conn[0]`.
- Ventana: si el primer webhook llega **antes** de un check/sync y `/users/me` del backfill falla, ese evento se ignora (200 skip). El PAT de clienta que ya sincronizaba **sí** puede `/users/me`; el auto-sync o un sync manual cierra el hueco. No hay pérdida de la fila ni de la allowlist.

---

## 3. Atribución `calendly_account_key` — **OK para no-Calendly**

- Modelo: `Optional(str, default="")`.
- API: vacío → `null` (`leads_controller.py` L323–325).
- Grilla: `formatCalendlyAccountKey('')` → `'—'` (`leads-page.tsx` L213–215). Select incluye `''`.
- ManyChat / alta manual / cuotas **no** escriben el campo → columna `—`, sin valor raro. No rompe columnas vecinas.

Leads Calendly: webhook/sync escriben `clienta`/`closer`. Editable a mano.

---

## 4. Interacción Closer → Cerrado PLAZOS → cuota

Escenario: lead de Calendly Closer, luego plazos genera hijo.

| Efecto | Evidencia | Resultado |
|---|---|---|
| Nuevo Calendly no pisa la cuota | Match excluye `es_cuota_plazo`; padre sigue en el set | Actualiza el padre |
| Equipo: ingreso sí, llamada no | `_live_closer_month_stats`: `pago` antes del `continue` de cuota (L884–886) | Cuota con `pago` suma ingreso; no calls/shows/cierres |
| Atribución en la cuota | `plazos_pago_service.py` L86–110 **no** copia `calendly_account_key` | La cuota muestra **—** en Calendly; el padre conserva `closer`. Decisión implícita: atribución solo en el booking original |

Closer se copia al hijo (`closer=parent.closer`), así el ingreso de la cuota cae en la tarjeta del closer correcto.

---

## 5. Build

| Comando | Resultado |
|---|---|
| `python -m compileall backend -q` | Exit 0 |
| `npm run build` (frontend) | OK, Next 16.2.4, 64 páginas. Sigue `Skipping validation of types` (config previa `ignoreBuildErrors`) |

No se modificó código en esta pasada.

---

## Qué falta (sin ambigüedad)

Nada de código bloqueante.

Checklist **operativo** al deploy (no son bugs abiertos):

1. En el contenedor/servicio **Next**: `BACKEND_INTERNAL_URL` = URL interna de FastAPI (si no, el proxy POST da 502).
2. Primer check/sync (o primer webhook con PAT válido) para completar `calendly_user_uri` de clienta.
3. Cargar PAT + allowlist de la cuenta Closer cuando vayan a usarla.

El catch-up del agente (`fecha_bot`/`created_at` vs `call`) y `_norm_program_key` **siguen fuera de este lote**, como se acordó.

**Push manual del lote conjunto: sí.**
