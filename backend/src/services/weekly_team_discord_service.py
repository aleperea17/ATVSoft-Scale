"""Reporte semanal agregado del equipo comercial → Discord (domingo 23:30 TZ empresa)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from pony.orm import db_session

from src.models import AuthUser, Lead, SetterReport
from src.services.company_config_service import company_today
from src.services.discord_service import DiscordServices

_discord = DiscordServices()


def iso_week_monday_sunday(day: date) -> tuple[date, date]:
    """Lunes–domingo ISO de la semana que contiene `day` (lunes=0)."""
    monday = day - timedelta(days=day.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _user_ids() -> list[int]:
    ids: set[int] = set()
    with db_session:
        for u in list(AuthUser.select()):
            ids.add(int(u.id))
        for r in list(SetterReport.select()):
            ids.add(int(r.user_id))
        for lead in list(Lead.select()):
            ids.add(int(lead.user_id))
    return sorted(ids)


def _metrics_for_user(uid: int, start: date, end: date) -> dict[str, Any]:
    from src.controllers.team_controller import _live_closer_range_stats

    with db_session:
        closer_stats = _live_closer_range_stats(uid, start, end)
        calls = sum(int(t.get("llamadas_agendadas") or 0) for t in closer_stats.values())
        cierres = sum(int(t.get("cierres") or 0) for t in closer_stats.values())
        conversaciones = sum(
            int(r.conversaciones)
            for r in list(SetterReport.select())
            if int(r.user_id) == uid and start <= r.fecha <= end
        )
    return {
        "user_id": uid,
        "desde": start.isoformat(),
        "hasta": end.isoformat(),
        "calls": calls,
        "calls_cerradas": cierres,
        "conversaciones": conversaciones,
    }


def generate_weekly_team_reports(
    *,
    as_of: date | None = None,
    send_discord: bool = True,
) -> list[dict[str, Any]]:
    """
    Semana lun–dom que contiene `as_of` (por defecto hoy empresa).
    El cron del domingo 23:30 usa el domingo en curso = esa misma semana.
    """
    day = as_of or company_today()
    start, end = iso_week_monday_sunday(day)
    out: list[dict[str, Any]] = []
    send = bool(send_discord)
    webhook_ok = _discord.is_weekly_webhook_configured() if send else False
    if send and not webhook_ok:
        print("[weekly-discord] DISCORD_WEEKLY_WEBHOOK_URL vacío; no se envía.")
    for uid in _user_ids():
        payload = _metrics_for_user(uid, start, end)
        out.append(payload)
        if not send or not webhook_ok:
            continue
        try:
            _discord.send_weekly_team_report_to_discord(payload)
        except Exception as exc:
            print(f"[weekly-discord] user={uid} error: {exc}")
    return out
