"""Llamadas del closer para el agente externo (bot WhatsApp)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from pony.orm import db_session

from src.models import Lead
from src.services.company_config_service import company_now, company_today


def _naive_now_company() -> datetime:
    return company_now().replace(tzinfo=None)


def _fmt_hora(call: datetime | None) -> str:
    if call is None:
        return ""
    return call.strftime("%H:%M")


def _leads_with_call(user_id: int) -> list[Lead]:
    return [
        l
        for l in list(Lead.select())
        if int(l.user_id) == user_id and l.call is not None
    ]


@db_session
def list_llamadas_hoy(user_id: int) -> dict:
    hoy = company_today()
    return list_llamadas_dia(user_id, hoy)


@db_session
def list_llamadas_dia(user_id: int, fecha: date) -> dict:
    inicio = datetime.combine(fecha, time.min)
    fin = datetime.combine(fecha, time.max)
    rows = [l for l in _leads_with_call(user_id) if inicio <= l.call <= fin]
    rows.sort(key=lambda l: l.call or datetime.min)
    return {
        "fecha": fecha.isoformat(),
        "llamadas": [_llamada_item(l) for l in rows],
    }


def _llamada_item(l: Lead) -> dict:
    from src.services.lead_statuses_services import default_lead_status_name

    fallback = default_lead_status_name(int(l.user_id))
    status = (l.status or l.estado or fallback).strip() or fallback
    return {
        "id": int(l.id),
        "hora": _fmt_hora(l.call),
        "lead": (l.nombre or "").strip(),
        "closer": (l.closer or "").strip(),
        "link_llamada": (l.link_llamada or "").strip(),
        "status": status,
        "payment": float(l.pago or 0),
        "owed": float(l.debe or 0),
        "program_offered": (l.programa_ofrecido or "").strip(),
        "programada_ofrecido_llamada": (l.programada_ofrecido_llamada or "").strip(),
        "calificacion_llamada": (getattr(l, "calificacion_llamada", None) or "").strip(),
    }


@db_session
def list_proximas_llamadas(user_id: int, ventana: int) -> dict:
    ahora = _naive_now_company()
    limite = ahora + timedelta(minutes=ventana)
    rows = [
        l
        for l in _leads_with_call(user_id)
        if ahora <= l.call <= limite and not bool(l.recordatorio_enviado)
    ]
    resultado = [
        {
            "hora": _fmt_hora(l.call),
            "lead": (l.nombre or "").strip(),
            "closer": (l.closer or "").strip(),
        }
        for l in rows
    ]
    for l in rows:
        l.recordatorio_enviado = True
    return {"llamadas": resultado}
