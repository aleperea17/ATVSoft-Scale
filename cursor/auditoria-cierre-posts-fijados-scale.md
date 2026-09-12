# Auditoría de cierre — Módulo Post fijados (Scale Boost)

**Fecha:** 2026-09-11  
**Modo:** solo lectura (sin correcciones)  
**Código revisado:** working tree local del módulo `FeedPostContent` / `/posts-fijados`

---

## Semáforo final

**🟢 Listo para cerrar / deploy**, con **un hallazgo menor** (conteo de agendas en tarjeta de post) y una **nota de UX** en métricas mensuales de chats.

No hay regresión detectada en la clasificación Reels vs `post:`. El refresh de feed posts **sí** usa `asyncio.to_thread` (mismo patrón que Reels). Migración idempotente. Persistencia solo después de `validate_insights`. Backend `py_compile` OK.

---

## 1. Idempotencia de la migración

**OK.** `_migrate_postgres_feed_post_content` en `backend/src/db.py` (~L1365):

- `CREATE TABLE IF NOT EXISTS feed_post_content (...)`
- `CREATE INDEX IF NOT EXISTS idx_feed_post_content_user_id`
- Sin `DROP`, sin `ALTER` destructivo, sin seed de filas

Reinicios repetidos del backend no duplican tabla ni índices. Alineado al patrón de `avatar_type` / `lead_status_type`. Pony `generate_mapping(create_tables=True)` también es seguro si la tabla ya existe.

---

## 2. Clasificadores de `punto_agenda` (búsqueda amplia)

Lugares que interpretan el canal / patrón de agenda:

| Ubicación | ¿Chequea `post:` antes de `^\d+$` → Reels? | Notas |
|-----------|---------------------------------------------|--------|
| `dashboard-view.tsx` `classifyLeadCashSource` | **Sí** | `post:` / `post_fijado_instagram` → Posts; luego `^\d+$` → Reels |
| `dashboard-view.tsx` `classifyLeadChatSource` | **Sí** | Idem |
| `leads-analytics.ts` `classifyLeadChatSource` | **Sí** | Idem |
| `leads_controller._normalize_channel_anchor_value` | **Sí** | Prefijo `post:` validado; enteros siguen siendo reels |
| `agenda-point-picker` / badge leads | N/A (display) | Badge `[POST] · #id` para `post:` |
| `content-page.tsx` `parseContentRef` | N/A | Solo parsea texto legacy `"Historia DD/MM/YY"` / `"Reel …"` — no usa `^\d+$` |
| BIO | N/A | Sin clasificador de `punto_agenda` |
| `reels_services` / `stories_service` / `youtube_controller` | N/A | Match exacto `tid` (`"5"`, `story:5`, `youtube:5`) — no confunden `post:5` con reel `5` |

**No se encontró** un clasificador FE/BE con `^\d+$` → Reels que ignore `post:` y esté en la ruta de métricas/dashboard.

### Matiz (no es el bug de dashboard)

En `feed_posts_services._count_agendas` / `_sum_pago_agendas`:

```python
if ap == token or ap == str(post_id):  # token = "post:5", también acepta "5"
```

Si un **reel** y un **feed post** comparten el mismo id interno numérico, un lead con `punto_agenda="5"` (reel) podría **inflar agendas/cash en la tarjeta del post**. El **dashboard** seguiría contándolo como Reels.  
**Severidad:** baja/media en UI de `/posts-fijados`.  
**Fix propuesto (no implementar ahora):** contar solo `ap == f"post:{post_id}"` (quitar el fallback `str(post_id)`).

### Matiz chats mensuales

Con `viewRange == null`, `computeChannelChats` usa `monthMetrics.otros` del backend/agregados; luego la UI resta `viewPostsChats` de `otros`. El cash donut sí usa `viewCashBySource('Posts')`. Riesgo bajo de doble conteo en el total de chats del mes si `otros` del mes no se recalcula igual — conviene smoke-testear con un lead `post:` en vista mensual.

---

## 3. Regresión Reels (caso concreto)

Orden en clasificadores:

1. `post:` / `post_fijado_instagram` → Posts  
2. …  
3. `includes('reel')` **o** `^\d+$` → Reels  

**Ejemplo:** `punto_agenda = "42"` (reel id 42)  
- No empieza por `post:`  
- Match `^\d+$` → **Reels** (igual que antes)

**Ejemplo:** `punto_agenda = "post:42"`  
- Match `post:` → **Posts** (no entra a `^\d+$`)

Normalización backend: entero puro sigue resolviendo a `ReelContent` y guarda `"42"`, no `post:42`.

**Veredicto:** sin regresión de clasificación Reels en los clasificadores auditados.

---

## 4. Event loop / sync bloqueante

### Estado real en este repo

| Pieza | Comportamiento |
|-------|----------------|
| `ReelsServices.refresh_metrics` | `async` → `await asyncio.to_thread(self.refresh_metrics_blocking, …)` |
| `FeedPostsServices.refresh_metrics` | **Igual:** `await asyncio.to_thread(self.refresh_metrics_blocking, …)` |
| Job `auto_refresh_reels_metrics` | `await service.refresh_metrics` luego `await feed_service.refresh_metrics` |

Dentro del thread se usa `urllib` síncrono (igual que Reels). **No bloquea el event loop** del proceso FastAPI mientras corre el refresh, porque está offloaded.

### Riesgo residual (no freeze del event loop)

- El job es **más largo en wall-clock** (reels + hasta N posts × varias métricas HTTP).
- Sigue siendo **secuencial** por usuario (primero todos los reels, luego todos los posts).
- El cron `auto_sync_new_reels` (23:59) **no** refresca feed posts (solo el interval job compartido) — gap menor de sincronización, no de event loop.

**Dimensionamiento:** con ~3 posts el overhead es pequeño frente a un refresh de muchos reels. **No es un bloqueante para cerrar** el módulo.

**Fix opcional (si más adelante hay muchos posts):** parallelizar métricas por media_id dentro del thread, o un job dedicado con el mismo `to_thread`. **No urgente.**

---

## 5. Validación antes de persistir

**OK.** En `add_from_permalink_or_id`:

1. Resuelve media Graph  
2. Check tipo IMAGE/CAROUSEL  
3. **`self.validate_insights(...)`** — si lanza, sale  
4. `fetch_feed_post_metrics`  
5. Recién ahí `with db_session:` crea/actualiza + `flush()`

Si falla insights, **no** entra al `db_session` de escritura → no queda fila nueva a medias.  
(Re-add sobre un post ya existente solo ocurre si insights pasan.)

---

## 6. Build / compilación

| Check | Resultado |
|-------|-----------|
| `py_compile` de `feed_posts_*`, `main`, `models`, `schemas`, `leads_controller`, `db` | **exit 0** |
| `tsc` local | No hay `frontend/node_modules/typescript` en este entorno → no se pudo tipar FE aquí |
| Revisión sintaxis TSX | Página `/posts-fijados`, picker y dashboard se leyeron sin errores de sintaxis evidentes (sin el patrón roto de `historias` previo) |

Recomendación: en CI/local con deps instaladas, un `npm run build` o `tsc --noEmit` antes del deploy.

---

## Propuestas (sin implementar)

| Prioridad | Ítem |
|-----------|------|
| Media-baja | Quitar `ap == str(post_id)` en `_count_agendas` / `_sum_pago_agendas` |
| Baja | Incluir refresh de feed posts en el cron 23:59 (opcional) |
| Baja | Smoke test vista mensual: lead `post:` no se pierde en “Otros” de chats agregados |

---

## Veredicto

**Listo tal cual** para dar por cerrado el módulo y deployar, con smoke post-deploy:

1. Agregar un carrusel (insights OK).  
2. Lead `post:<id>` → canal Posts.  
3. Lead `"<reelId>"` numérico → sigue Reels.  
4. Fallar a propósito un media_id inválido → no aparece fila nueva.
