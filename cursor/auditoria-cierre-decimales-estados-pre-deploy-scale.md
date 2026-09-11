# Auditoría de cierre — Decimales + 3 estados (pre-deploy Scale Boost)

**Fecha:** 2026-09-11  
**Modo:** solo lectura (sin correcciones en esta pasada)  
**Cambios bajo revisión:** working tree local (aún sin push/deploy de este lote)

---

## Semáforo final

**🟢 Listo para deployar** con matices cosméticos / deuda menor (no bloqueantes).

No se detectó riesgo de que el seed **resetee** colores/flags/orden de estados ya editados. Backend de dinero compila (`py_compile` OK). Los dos features no se pisan entre sí (archivos distintos salvo convivencia en el mismo deploy).

---

## 1. Decimales — los ~12 puntos del reporte

| # | Área | Veredicto | Evidencia |
|---|------|-----------|-----------|
| 1 | `formatCash` 2 decimales | OK | `format-utils.ts` L19–28 |
| 2 | Leads currency | OK | `leads-page.tsx` `step="0.01"` + parse coma/punto |
| 3 | Panel diario Pagó/Debe | OK | `daily-calls-table.tsx` `step="0.01"` |
| 4 | Programas precio | OK | input text decimal previo; display vía `formatCash` |
| 5 | Seguimiento monto | OK | `parseFloat` + label € |
| 6 | daily-report `numField` currency | OK | `step="0.01"` |
| 7 | Reels cash | OK | step + parse |
| 8 | Historias FE+BE | OK | schemas `float`; service sin `int(round)`; `py_compile` OK |
| 9 | YouTube FE+BE | OK | sin `Math.round` en save; controller float; schema `float` |
| 10 | Objetivos cash metas | OK | step decimal en `*cash*` |
| 11 | Content tracking cash | OK a nivel input | Persistencia API sigue pendiente (preexistente) |
| 12 | `agent_content_service` | OK | `sum(float(...))` |

**Regresiones de tipos:** no quedan `cash_manual: int` / `int(round(...cash...))` en backend de stories/youtube tras el grep.

**Compilación:** `py_compile` de `stories_service`, `youtube_controller`, `agent_content_service`, `lead_statuses_services`, `schemas` → exit 0.

Los cambios de decimales y de estados **no comparten** lógica; riesgo de interacción = nulo.

---

## 2. `formatCash` siempre con 2 decimales — ¿rompe KPIs?

**No rompe cálculos** (solo formato de string). Sí cambia la apariencia en **todos** los consumidores de `formatCash` (dashboard, sales dashboard, leads totales, BIO, reels, etc.).

| Efecto | Severidad | Notas |
|--------|-----------|--------|
| Enteros se ven como `€12.500,00` | Bajo / UX | Ruido visual en KPIs grandes; correcto para dinero con centavos |
| Ejes de charts | OK | Siguen usando `formatCashAxisShort` (abreviado / round a k) |
| Conteos no-monetarios | OK | Visitas etc. usan `formatK` / `formatIntegerEsAr`, no `formatCash` |

**Propuesta post-deploy (opcional, no bloquear):**  
`formatCash(n, { compactIntegers?: true })` o variante que omita `,00` cuando `Number.isInteger(n)` — solo si el cliente se queja del ruido.

---

## 3. `parseMoneyInput` — consistencia

| Hallazgo | Detalle |
|----------|---------|
| Helper definido | `format-utils.ts` L32–40 |
| **Usos en el repo** | **Ninguno** (solo la definición) |
| Inputs reales | Usan el **mismo patrón inline** (`Number(...replace(',', '.'))` / `parseFloat`) |

No hay `parseInt` residual sobre campos de dinero en el grep FE.

**Deuda menor (no bloquea deploy):** el reporte anterior sobrevendió “uso consistente” del helper; hoy es código muerto útil. Conviene o bien adoptarlo en un refactor chico, o documentarlo como opcional.

---

## 4. Punto crítico — ¿el seed pisa estados editados?

**No.** `_ensure_default_catalog` (L180–208):

1. Lee filas existentes del usuario.
2. Calcula `missing` solo por **nombre normalizado ausente**.
3. **INSERT** de faltantes con valores del seed.
4. **No hace UPDATE** de color, `sort_order`, flags, `activo` ni `is_default` de filas ya presentes.
5. El flag `_lead_status_defaults_seeded` solo se marca si aún no existía; ya no corta el insert de nombres nuevos.

Si alguien cambió color/orden/flags de “Cerrado PIF”, etc., **permanecen**.

### Matices (conocer, no bloquean el pedido)

| Caso | Comportamiento |
|------|----------------|
| Usuario **borró** un estado del seed (ej. “No compra”) | En el próximo listado **vuelve a insertarse** (mismo mecanismo que agrega los 3 nuevos) |
| Usuario **renombró** un seed (ej. “Reserva” → “Seña”) | Queda el renombrado **y** se inserta de nuevo “Reserva” (dos filas) |
| Borró “Pendiente de pago” (único `is_default` del seed) | Se reinserta con `is_default=True` **sin** limpiar otro default manual → posible doble default (raro) |

Ninguno de estos resetea ediciones in-place del catálogo actual.

---

## 5. Flags de las 3 filas nuevas

Confirmado en BE y mirror FE:

| Nombre | cierre | no_show | followup | is_default | Color |
|--------|--------|---------|----------|------------|-------|
| Cancelada | false | false | false | false | `#71717A` |
| Pendiente de llamar | false | false | false | false | `#38BDF8` |
| Seguimiento para reagendar | false | false | false | false | `#C084FC` |

No heredan flags de otros estados (tuplas literales independientes en `DEFAULT_LEAD_STATUSES`).

---

## 6. ¿Afecta Avatares u otros catálogos?

**No.** `avatars_services._ensure_default_catalog` sigue el patrón **viejo** (early-return si `_defaults_already_seeded`). Cambio **acotado** a `lead_statuses_services.py` (+ mirror FE `lead-status-defaults.ts`).

---

## Checklist pre-deploy sugerido

1. Deploy backend+frontend juntos (schemas float + FE).
2. Abrir **Ajustes → Estados** una vez (dispara seed de los 3).
3. Verificar que estados editados previos no cambiaron color/flags.
4. Smoke `199.99` en Pagó (Leads) + Panel diario + un cash YouTube/Historias.
5. Mirar un KPI grande del dashboard: aceptar `€X,00` o planear omitir ceros post-deploy.

---

## Si hubiera que corregir antes (propuestas — no implementadas)

| Prioridad | Ítem | ¿Bloquea? |
|-----------|------|-----------|
| — | Ningún bug funcional detectado | — |
| Baja | Adoptar `parseMoneyInput` o quitar helper muerto | No |
| Baja | `formatCash` sin `,00` en enteros | No |
| Baja | Documentar que borrar un estado del seed lo reincorpora | No |

**Veredicto:** deployable tal cual.
