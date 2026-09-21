# Fix pre-deploy — Doble Calendly (Scale Boost)

Fecha: 2026-09-21. Local, sin deploy.

## Diff

- `backend/src/controllers/webhook_controller.py` — match ignora cuotas; backfill URI si no hay match; atribución `calendly_account_key`; log sin PII
- `backend/src/controllers/calendly_controller.py` — `_find_lead_by_email` excluye cuotas; persist URI en check/sync; atribución en `_apply_invitee_to_lead`; import de `compute_dias_para_agendar` (NameError latente en update)
- `backend/src/services/calendly_webhook_service.py` — `persist_calendly_user_uri_if_missing` / `backfill_calendly_user_uris`
- `backend/src/models.py` + `db.py` + `schemas.py` + `leads_controller.py` — columna `calendly_account_key`
- `frontend/src/app/api/webhooks/calendly/route.ts` — proxy a FastAPI (mismo patrón que ManyChat)
- `frontend/src/features/leads/types/index.ts` + `leads-page.tsx` — columna Calendly (Clienta/Closer), editable

## Pruebas

1. **Cuotas:** `_find_lead_for_calendly` / `_find_lead_by_email` filtran `lead_is_cuota_plazo`. Helper verificado con `SimpleNamespace`. No hay BD local de cliente para un webhook real.
2. **URI:** check y sync llaman `persist_calendly_user_uri_if_missing` tras `/users/me`. Webhook, si no hay match, backfill de filas sin URI y reintenta.
3. **Ruta pública:** `PUBLIC_SITE_URL/api/webhooks/calendly` es Next; ahora reenvía a `{BACKEND_INTERNAL_URL}/webhooks/calendly`. Confirmar en prod `BACKEND_INTERNAL_URL` (Docker) o `127.0.0.1:8000`.
4. **Atribución:** webhook/sync escriben `calendly_account_key`; grilla columna **Calendly**.
5. **PII:** el `print` del payload ya no está; log `event=` + último segmento de URI del invitee.

## Semáforo deploy doble Calendly + plazos

**Verde para este lote de P0/P1**, con checklist operativo:

- Tras deploy: un check/sync (o el primer webhook) completa `calendly_user_uri` de clienta.
- `BACKEND_INTERNAL_URL` apunta al FastAPI en el contenedor Next.
- Cargar PAT Closer + allowlist de **sus** event types.

No se tocó `_norm_program_key`. No hay dashboard de comparación.
