"""Mensualidad de cada cuenta: días vigentes, días de plazo y bloqueo al terminar el plazo."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from pony.orm import db_session

from src.models import AuthUser
from src.services.company_config_service import company_today


def mensualidad_dias_restantes(vence: date | None) -> int | None:
    if vence is None:
        return None
    return (vence - company_today()).days


def mensualidad_estado(user: AuthUser) -> dict:
    """Llamar dentro de db_session. Bloqueada = pasó el vencimiento y también los días de plazo."""
    dias = mensualidad_dias_restantes(user.mensualidad_vence)
    plazo = max(int(user.mensualidad_plazo_dias or 0), 0)
    return {
        "user_id": user.id,
        "username": user.username,
        "vence": user.mensualidad_vence,
        "dias_restantes": dias,
        "plazo_dias": plazo,
        "bloqueada": dias is not None and dias < -plazo,
    }


def list_mensualidades() -> list[dict]:
    with db_session:
        return [mensualidad_estado(u) for u in list(AuthUser.select().order_by(AuthUser.username))]


def activar_mensualidad(user_id: int, dias: int, plazo_dias: int) -> dict:
    """Arranca la cuenta desde hoy: vence en `dias` días y después tiene `plazo_dias` de gracia."""
    with db_session:
        user = AuthUser[user_id]
        user.mensualidad_vence = company_today() + timedelta(days=dias)
        user.mensualidad_plazo_dias = plazo_dias
        user.updated_at = datetime.utcnow()
        return mensualidad_estado(user)


def quitar_mensualidad(user_id: int) -> dict:
    with db_session:
        user = AuthUser[user_id]
        user.mensualidad_vence = None
        user.mensualidad_plazo_dias = 0
        user.updated_at = datetime.utcnow()
        return mensualidad_estado(user)
