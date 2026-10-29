"""Mensualidad de cada cuenta: días que le quedan y extensión (solo con MENSUALIDAD_ADMIN_KEY)."""

from __future__ import annotations

import hmac
from datetime import date, datetime, timedelta

from decouple import config
from pony.orm import db_session

from src.models import AuthUser
from src.services.company_config_service import company_today

DIAS_POR_MENSUALIDAD = 30
# Clave aparte de ADMIN_PANEL_PASSWORD: esa la conoce el equipo del cliente. Vacía = deshabilitado.
MENSUALIDAD_ADMIN_KEY = (config("MENSUALIDAD_ADMIN_KEY", default="") or "").strip()


def verify_mensualidad_key(candidate: str | None) -> bool:
    if len(MENSUALIDAD_ADMIN_KEY) < 12 or not candidate:
        return False
    return hmac.compare_digest(candidate.strip().encode(), MENSUALIDAD_ADMIN_KEY.encode())


def mensualidad_dias_restantes(vence: date | None) -> int | None:
    if vence is None:
        return None
    return (vence - company_today()).days


def list_mensualidades() -> list[dict]:
    with db_session:
        users = list(AuthUser.select().order_by(AuthUser.username))
        return [
            {
                "user_id": u.id,
                "username": u.username,
                "vence": u.mensualidad_vence,
                "dias_restantes": mensualidad_dias_restantes(u.mensualidad_vence),
            }
            for u in users
        ]


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
