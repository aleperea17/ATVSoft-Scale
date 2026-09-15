# Implementación — 3 pedidos cliente (Scale Boost)

**Fecha:** 2026-09-14  
**Alcance:** Formularios/Bienvenidas IG · Notas panel diario · Allowlist Calendly

---

## 1) Formularios + rename Outbounds → Bienvenidas IG

### Diff (archivos)

| Archivo | Cambio |
|---------|--------|
| `backend/src/models.py` | `SetterReport.formularios = Required(int, default=0)` |
| `backend/src/db.py` | `ADD COLUMN IF NOT EXISTS formularios` |
| `backend/src/controllers/team_controller.py` | body/save/list/discord payload incluyen `formularios` |
| `backend/src/services/discord_service.py` | labels Bienvenidas IG + Formularios |
| `backend/src/team_reports_pdf.py` | idem |
| `frontend/.../daily-report-form.tsx` | input Formularios; label Bienvenidas IG |
| `frontend/.../historial-reportes/page.tsx` | muestra ambos |

Columna BD interna sigue siendo `outbounds` (solo cambia el texto visible).

### Prueba

- [ ] Cargar reporte setter con Bienvenidas IG = N y Formularios = M → guardar OK  
- [ ] Historial muestra ambos labels y valores  
- [ ] PDF export incluye Bienvenidas IG / Formularios  
- [ ] Discord (si webhook configurado) muestra los dos campos  

*(Smoke local de código: modelo + migración + body cableados; validación E2E post-deploy.)*

---

## 2) Notas en Dashboard diario (llamadas)

### Diff

| Archivo | Cambio |
|---------|--------|
| `backend/src/schemas.py` | `AgentLlamadaHoyItemOut.notes` |
| `backend/src/services/agent_closer_service.py` | `_llamada_item` incluye `notes` desde `Lead.notas` |
| `frontend/.../daily-panel/types.ts` | `DailyCall.notes` |
| `frontend/.../daily-panel-service.ts` | map + `patchLeadNotes` → `PATCH { notes }` |
| `frontend/.../daily-calls-table.tsx` | columna Notas + `NotesCell` editable |
| `frontend/.../daily-panel-page.tsx` | `onNotesChange` |
| `frontend/.../daily-panel.css` | `--neo-cols` + estilos notas |

**No** se activó edición de Notas en la grilla principal de Leads.

### Aviso (documentado, no bloquea)

Calendly a veces escribe en el mismo `Lead.notas` (p.ej. `Calendly email: …`). El closer edita ese mismo campo desde el panel.

### Prueba

- [ ] Escribir nota en una llamada del día → blur/Ctrl+Enter guarda  
- [ ] Recargar panel → la nota persiste  
- [ ] PATCH no inventa endpoint nuevo (usa `/leads/{id}` existente)

---

## 3) Calendly — excluir Onboarding (allowlist de event types)

### Diff

| Archivo | Cambio |
|---------|--------|
| `backend/src/services/calendly_event_type_filter.py` | **nuevo** — parse/extract/`is_event_type_allowed` (fail-closed) |
| `backend/src/controllers/calendly_controller.py` | sync + check-pending filtran por allowlist |
| `backend/src/controllers/webhook_controller.py` | webhook salta persistencia si no matchea |
| `backend/src/services/conexiones_services.py` | credencial `event_type_allowlist` permitida |
| `frontend/.../connection-platforms.ts` | campo textarea en Conexiones |
| `frontend/.../connection-card.tsx` | guarda/carga la allowlist + textarea UI |

**Semántica:** allowlist **vacía** → no se procesa ningún evento (ni sync ni webhook).

### Prueba unitaria (local)

```
empty allowlist → False
URI en lista → True
URI onboarding fuera → False
extract desde event / scheduled_event → OK
→ PASS
```

### Cómo cargar la allowlist real (post-deploy)

1. Con el PAT de la clienta ya en Conexiones, listar event types:
   ```http
   GET https://api.calendly.com/event_types?user={user_uri}
   Authorization: Bearer {PAT}
   ```
   (`user_uri` sale de `GET /users/me` → `resource.uri`).
2. Copiar la **URI** del event type **Valoración** (no el nombre).  
   Ejemplo de forma (no usar como valor real):  
   `https://api.calendly.com/event_types/<uuid>`
3. Pegarla en **Conexiones → Calendly → “Event types permitidos (URIs)”** (una por línea si hay varias) → Guardar.
4. Alternativa directa en BD (si hace falta): en `apiconnection.credentials` (JSON de platform=`calendly`) setear:
   ```json
   "event_type_allowlist": "https://api.calendly.com/event_types/<uuid-valoracion>"
   ```
5. Verificar: un webhook/sync de Onboarding no crea leads; Valoración sí.

**No se inventaron URIs de ejemplo como si fueran de la cuenta** — hay que obtenerlas del PAT real.

---

## Resumen de archivos nuevos

- `backend/src/services/calendly_event_type_filter.py`

## No tocado (a propósito)

- Generación de `CloserReport`  
- Dashboard marketing  
- Edición de Notas en grilla Leads  
- Nombre de columna `outbounds` en Postgres
