"""Zona horaria operativa de Scale: Europe/Madrid, fija en código."""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

COMPANY_TIMEZONE = "Europe/Madrid"
_COMPANY_TZ = ZoneInfo(COMPANY_TIMEZONE)


def get_company_timezone_name() -> str:
    return COMPANY_TIMEZONE


def get_company_tz() -> ZoneInfo:
    return _COMPANY_TZ


def company_now() -> datetime:
    return datetime.now(get_company_tz())


def company_today() -> date:
    return company_now().date()


def company_month_key() -> str:
    return company_now().strftime("%Y-%m")


def naive_utc_to_company(dt: datetime, tz: ZoneInfo | None = None) -> datetime:
    """Timestamps naive se interpretan como UTC (criterio histórico de Scale)."""
    zone = tz or get_company_tz()
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.replace(tzinfo=timezone.utc).astimezone(zone)


def datetime_month_tuple(dt: datetime | None, tz: ZoneInfo | None = None) -> tuple[int, int] | None:
    if dt is None:
        return None
    local = naive_utc_to_company(dt, tz)
    return (local.year, local.month)
