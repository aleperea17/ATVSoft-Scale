"""Un único punto para escribir `Lead.pago` y estampar/limpiar `fecha_cobro`.

Reutilizable (Ventas ahora; Equipo no se cablea en este lote).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from src.services.company_config_service import company_today, naive_utc_to_company
from src.services.date_range_filter import stored_wall_date

UNSET: object = object()


def lead_pago_amount(row: Any) -> float:
    return float(getattr(row, "pago", None) or 0)


def lead_has_pago(row: Any) -> bool:
    return lead_pago_amount(row) > 0


def lead_effective_dt(row: Any) -> datetime | None:
    """call > agendo > fecha_bot > created_at (misma prioridad que GET /leads)."""
    return (
        getattr(row, "call", None)
        or getattr(row, "agendo", None)
        or getattr(row, "fecha_bot", None)
        or getattr(row, "created_at", None)
    )


def lead_effective_wall_date(row: Any) -> date | None:
    """Día operativo en España del lead (call > agendo > fecha_bot > created_at).

    call/agendo/fecha_bot ya se guardan en hora de pared de Madrid: se usan tal cual.
    created_at se guarda en UTC: se pasa a Madrid antes de tomar el día.
    """
    for attr in ("call", "agendo", "fecha_bot"):
        v = getattr(row, attr, None)
        if v:
            return stored_wall_date(v)
    created = getattr(row, "created_at", None)
    if isinstance(created, datetime):
        return naive_utc_to_company(created).date()
    return stored_wall_date(created)


def lead_effective_month_tuple(row: Any) -> tuple[int, int] | None:
    """(año, mes) operativo en España; mismo día que `lead_effective_wall_date`."""
    d = lead_effective_wall_date(row)
    return (d.year, d.month) if d else None


def lead_cobro_wall_date(row: Any) -> date | None:
    """Fecha de pared para modo pago: `fecha_cobro` o fallback de llamada, sin convertir zona."""
    fc = getattr(row, "fecha_cobro", None)
    if isinstance(fc, datetime):
        wall = fc.replace(tzinfo=None) if fc.tzinfo is not None else fc
        return wall.date()
    if isinstance(fc, date):
        return fc
    return lead_effective_wall_date(row)


def lead_fecha_cobro_missing(row: Any) -> bool:
    return lead_has_pago(row) and getattr(row, "fecha_cobro", None) is None


def apply_lead_pago(
    row: Any,
    *,
    pago: float | object = UNSET,
    fecha_cobro: date | None | object = UNSET,
) -> None:
    """Aplica pago y la regla de `fecha_cobro`.

    - pago vacío/0 → `fecha_cobro = None`
    - 0 → >0, sin fecha explícita y `fecha_cobro` null → hoy (zona empresa)
    - request con `fecha_cobro` → se respeta (si pago > 0)
    - pago cambia entre dos valores > 0 → no tocar la fecha (salvo explícita)
    """
    old = lead_pago_amount(row)
    if pago is not UNSET:
        new = float(pago or 0)
        row.pago = new
    else:
        new = old

    if new <= 0:
        row.fecha_cobro = None
        return

    if fecha_cobro is not UNSET:
        row.fecha_cobro = fecha_cobro
        return

    if old <= 0 and getattr(row, "fecha_cobro", None) is None:
        row.fecha_cobro = company_today()
