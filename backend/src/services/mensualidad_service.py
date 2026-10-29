"""Mensualidad de la cuenta: días que le quedan y extensión desde el panel admin."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from pony.orm import db_session

from src.models import AuthUser
from src.services.company_config_service import company_today

DIAS_POR_MENSUALIDAD = 30


def mensualidad_dias_restantes(vence: date | None) -> int | None:
    if vence is None:
        return None
    return (vence - company_today()).days


def get_mensualidad_vence(user_id: int) -> date | None:
    with db_session:
        user = AuthUser.get(id=user_id)
        return user.mensualidad_vence if user else None


def set_mensualidad_vence(user_id: int, vence: date | None) -> date | None:
    with db_session:
        user = AuthUser[user_id]
        user.mensualidad_vence = vence
        user.updated_at = datetime.utcnow()
        return user.mensualidad_vence


def extender_mensualidad(user_id: int, dias: int = DIAS_POR_MENSUALIDAD) -> date:
    """Suma días desde el vencimiento actual; si ya venció o no tenía, desde hoy."""
    with db_session:
        user = AuthUser[user_id]
        hoy = company_today()
        base = user.mensualidad_vence if user.mensualidad_vence and user.mensualidad_vence >= hoy else hoy
        user.mensualidad_vence = base + timedelta(days=dias)
        user.updated_at = datetime.utcnow()
        return user.mensualidad_vence
