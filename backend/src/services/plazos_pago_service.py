"""Generación automática de cuotas Lead (PLAZO PAGADO) a partir de fecha_seguimiento_pago."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from pony.orm import db_session, flush

from src.models import Lead
from src.services.company_config_service import company_today
from src.services.lead_agenda_utils import PLAZO_PAGADO_STATUS
from src.services.lead_statuses_services import (
    LeadStatusesServices,
    normalize_status_lookup_key,
)

_status_svc = LeadStatusesServices()


def _plazo_pagado_name(user_id: int) -> str:
    key = normalize_status_lookup_key(PLAZO_PAGADO_STATUS)
    for row in _status_svc._rows_for_user(user_id):
        if normalize_status_lookup_key(row.nombre or "") == key and row.activo:
            return str(row.nombre or "").strip() or PLAZO_PAGADO_STATUS
    return PLAZO_PAGADO_STATUS


def _child_exists_for_fecha(parent_id: int, fecha: date) -> bool:
    for child in list(Lead.select()):
        if not bool(getattr(child, "es_cuota_plazo", False)):
            continue
        if int(getattr(child, "lead_origen_id", 0) or 0) != parent_id:
            continue
        call = getattr(child, "call", None)
        if call is None:
            continue
        call_d = call.date() if isinstance(call, datetime) else call
        if call_d == fecha:
            return True
    return False


def _anchor_dt(fecha: date) -> datetime:
    return datetime.combine(fecha, time(12, 0, 0))


@db_session
def generate_plazos_pago(*, user_id: int | None = None, as_of: date | None = None) -> dict[str, Any]:
    """
    Crea un Lead-cuota por cada fila con fecha_seguimiento_pago <= hoy
    que aún no tenga hijo para esa fecha. Vacía la fecha del padre.
    """
    today = as_of or company_today()
    created: list[dict[str, Any]] = []
    skipped = 0
    candidates = [
        row
        for row in list(Lead.select())
        if getattr(row, "fecha_seguimiento_pago", None) is not None
        and row.fecha_seguimiento_pago <= today
        and (user_id is None or int(row.user_id) == int(user_id))
    ]
    candidates.sort(key=lambda r: int(r.id))

    users_touched: set[int] = set()
    for parent in candidates:
        uid = int(parent.user_id)
        if uid not in users_touched:
            _status_svc._ensure_default_catalog(uid)
            users_touched.add(uid)

        fecha = parent.fecha_seguimiento_pago
        if fecha is None:
            continue
        parent_id = int(parent.id)
        if _child_exists_for_fecha(parent_id, fecha):
            parent.fecha_seguimiento_pago = None
            skipped += 1
            continue

        status_name = _plazo_pagado_name(uid)
        nro = int(getattr(parent, "nro_plazo", None) or 1) + 1
        when = _anchor_dt(fecha)
        now = datetime.utcnow()
        child = Lead(
            user_id=uid,
            nombre=(parent.nombre or "").strip(),
            ig=(parent.ig or "").strip(),
            telefono=(parent.telefono or "").strip(),
            email=(parent.email or "").strip(),
            avatar=(parent.avatar or "").strip(),
            setter=(parent.setter or "").strip(),
            closer=(parent.closer or "").strip(),
            programada_ofrecido_llamada=(parent.programada_ofrecido_llamada or "").strip(),
            programa_ofrecido="",
            punto_agenda="",
            status=status_name,
            estado=status_name,
            es_cuota_plazo=True,
            lead_origen_id=parent_id,
            nro_plazo=nro,
            call=when,
            agendo=when,
            pago=0,
            debe=0,
            fecha_seguimiento_pago=None,
            notas=f"Cuota automática · plazo {nro} · origen #{parent_id}",
            created_at=now,
        )
        parent.fecha_seguimiento_pago = None
        flush()
        created.append(
            {
                "parent_id": parent_id,
                "child_id": int(child.id),
                "user_id": uid,
                "fecha": fecha.isoformat(),
                "nro_plazo": nro,
            }
        )

    return {
        "as_of": today.isoformat(),
        "created": len(created),
        "skipped": skipped,
        "items": created,
    }
