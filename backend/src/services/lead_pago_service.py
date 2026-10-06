"""Un único punto para escribir `Lead.pago` y estampar/limpiar `fecha_cobro`.

Reutilizable (Ventas ahora; Equipo no se cablea en este lote).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from src.services.company_config_service import company_today
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


def lead_cobro_wall_date(row: Any) -> date | None:
    """Fecha de pared para modo pago: `fecha_cobro` o fallback de llamada, sin convertir zona."""
    fc = getattr(row, "fecha_cobro", None)
    if isinstance(fc, datetime):
        wall = fc.replace(tzinfo=None) if fc.tzinfo is not None else fc
        return wall.date()
    if isinstance(fc, date):
        return fc
    return stored_wall_date(lead_effective_dt(row))


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
