"""Rango inclusive YYYY-MM-DD. Fechas naive de leads: .date() de pared, sin asumir UTC."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException


def parse_optional_date_range(
    desde: date | None,
    hasta: date | None,
) -> tuple[date, date] | None:
    if desde is None and hasta is None:
        return None
    if desde is None or hasta is None:
        raise HTTPException(
            status_code=422,
            detail="desde y hasta deben enviarse juntos (YYYY-MM-DD).",
        )
    if hasta < desde:
        raise HTTPException(
            status_code=400,
            detail="La fecha hasta debe ser mayor o igual que desde.",
        )
    return desde, hasta


def require_month_or_range(
    month: str | None,
    desde: date | None,
    hasta: date | None,
) -> tuple[date, date] | None:
    """Si hay par desde/hasta, lo devuelve. Si no, None (el caller usa month). Error si no hay ninguno."""
    pair = parse_optional_date_range(desde, hasta)
    if pair is not None:
        return pair
    if month and str(month).strip():
        return None
    raise HTTPException(
        status_code=422,
        detail="Se requiere month (YYYY-MM) o el par desde y hasta (YYYY-MM-DD).",
    )


def stored_wall_date(value: datetime | date | None) -> date | None:
    """Calendario del valor guardado, sin naive_utc_to_company."""
    if value is None:
        return None
    if isinstance(value, datetime):
        wall = value.replace(tzinfo=None) if value.tzinfo is not None else value
        return wall.date()
    if isinstance(value, date):
        return value
    return None


def in_inclusive_range(day: date | None, start: date, end: date) -> bool:
    if day is None:
        return False
    return start <= day <= end
