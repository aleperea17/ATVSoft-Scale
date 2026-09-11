"""CRUD de estados de Lead + resolución de roles de embudo (no comparar labels en métricas)."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from pony.orm import db_session, flush

from src.models import ApiConnection, Lead, LeadStatusType
from src.schemas import (
    LeadStatusTypeCreateRequest,
    LeadStatusTypeOut,
    LeadStatusTypePatchRequest,
    LeadStatusTypesListResponse,
)

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

# nombre, color, counts_as_cierre, counts_as_no_show, requires_followup_date, is_default
DEFAULT_LEAD_STATUSES: list[tuple[str, str, bool, bool, bool, bool]] = [
    ("Pendiente de pago", "#94A3B8", False, False, False, True),
    ("Seguimiento post llamada", "#60A5FA", False, False, False, False),
    ("Reserva", "#FB923C", False, False, False, False),
    ("Cerrado PIF", "#4ADE80", True, False, False, False),
    ("Cerrado PLAZOS", "#22C55E", True, False, True, False),
    ("No show", "#F87171", False, True, False, False),
    ("Re-agendada", "#FBBF24", False, False, False, False),
    ("No compra", "#A855F7", False, False, False, False),
    ("Cancelada", "#71717A", False, False, False, False),
    ("Pendiente de llamar", "#38BDF8", False, False, False, False),
    ("Seguimiento para reagendar", "#C084FC", False, False, False, False),
]

FALLBACK_DEFAULT_STATUS = "Pendiente de pago"
FALLBACK_BOOKING_STATUS = "Reserva"

_DEFAULTS_SEEDED_PLATFORM = "_lead_status_defaults_seeded"
_LEGACY_REMAP_PLATFORM = "_lead_status_legacy_remapped"

# Status históricos → roles si el label ya no está en el catálogo
_LEGACY_ROLE_BY_KEY: dict[str, dict[str, bool]] = {
    "cerrado": {"counts_as_cierre": True, "counts_as_no_show": False, "requires_followup_date": False},
    "cerrados": {"counts_as_cierre": True, "counts_as_no_show": False, "requires_followup_date": False},
    "closed": {"counts_as_cierre": True, "counts_as_no_show": False, "requires_followup_date": False},
    "won": {"counts_as_cierre": True, "counts_as_no_show": False, "requires_followup_date": False},
    "cerrado pif": {"counts_as_cierre": True, "counts_as_no_show": False, "requires_followup_date": False},
    "cerrado plazos": {"counts_as_cierre": True, "counts_as_no_show": False, "requires_followup_date": True},
    "no show": {"counts_as_cierre": False, "counts_as_no_show": True, "requires_followup_date": False},
    "noshow": {"counts_as_cierre": False, "counts_as_no_show": True, "requires_followup_date": False},
    "sena": {"counts_as_cierre": False, "counts_as_no_show": False, "requires_followup_date": False},
    "seña": {"counts_as_cierre": False, "counts_as_no_show": False, "requires_followup_date": False},
}

# Remapeo one-shot de labels viejos → nombres del seed Scale
_LEGACY_NAME_REMAP: dict[str, str] = {
    "pendiente": "Pendiente de pago",
    "pending": "Pendiente de pago",
    "seguimiento": "Seguimiento post llamada",
    "en seguimiento": "Seguimiento post llamada",
    "follow": "Seguimiento post llamada",
    "follow up": "Seguimiento post llamada",
    "agendado": "Reserva",
    "re-agenda": "Re-agendada",
    "re agenda": "Re-agendada",
    "reagenda": "Re-agendada",
    "descalificado": "No compra",
    "disqualified": "No compra",
    "cerrado": "Cerrado PIF",
    "cerrados": "Cerrado PIF",
    "closed": "Cerrado PIF",
    "won": "Cerrado PIF",
}


def normalize_status_lookup_key(name: str) -> str:
    t = unicodedata.normalize("NFD", (name or "").strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().replace("-", " ").split())


def _valid_hex_color(raw: str | None) -> str:
    s = (raw or "").strip()
    if _HEX_COLOR_RE.match(s):
        return s
    return "#6B7280"


def empty_status_flags() -> dict[str, bool]:
    return {
        "counts_as_cierre": False,
        "counts_as_no_show": False,
        "requires_followup_date": False,
    }


class LeadStatusesServices:
    def _rows_for_user(self, uid: int) -> list[LeadStatusType]:
        return [a for a in list(LeadStatusType.select()) if int(a.user_id) == uid]

    def _leads_for_user(self, uid: int) -> list[Lead]:
        return [l for l in list(Lead.select()) if int(l.user_id) == uid]

    def _nombre_taken(self, uid: int, nombre: str, exclude_id: int | None = None) -> bool:
        key = normalize_status_lookup_key(nombre)
        if not key:
            return False
        for row in self._rows_for_user(uid):
            if exclude_id is not None and int(row.id) == exclude_id:
                continue
            if normalize_status_lookup_key(row.nombre or "") == key:
                return True
        return False

    def _next_sort_order(self, uid: int) -> int:
        rows = self._rows_for_user(uid)
        if not rows:
            return 0
        return max(int(r.sort_order or 0) for r in rows) + 1

    def _to_out(self, row: LeadStatusType) -> LeadStatusTypeOut:
        return LeadStatusTypeOut(
            id=int(row.id),
            nombre=str(row.nombre or "").strip(),
            color=_valid_hex_color(row.color),
            activo=bool(row.activo),
            sort_order=int(row.sort_order or 0),
            counts_as_cierre=bool(row.counts_as_cierre),
            counts_as_no_show=bool(row.counts_as_no_show),
            requires_followup_date=bool(row.requires_followup_date),
            is_default=bool(row.is_default),
        )

    def _lead_count_using_status(self, uid: int, nombre: str) -> int:
        key = normalize_status_lookup_key(nombre)
        if not key:
            return 0
        count = 0
        for lead in self._leads_for_user(uid):
            st = normalize_status_lookup_key(lead.status or lead.estado or "")
            if st and st == key:
                count += 1
        return count

    def _defaults_already_seeded(self, user_id: int) -> bool:
        return any(
            c
            for c in list(ApiConnection.select())
            if int(c.user_id) == user_id and str(c.platform or "") == _DEFAULTS_SEEDED_PLATFORM
        )

    def _mark_defaults_seeded(self, user_id: int) -> None:
        if self._defaults_already_seeded(user_id):
            return
        ApiConnection(
            user_id=user_id,
            platform=_DEFAULTS_SEEDED_PLATFORM,
            credentials={"v": 1},
        )

    def _legacy_already_remapped(self, user_id: int) -> bool:
        return any(
            c
            for c in list(ApiConnection.select())
            if int(c.user_id) == user_id and str(c.platform or "") == _LEGACY_REMAP_PLATFORM
        )

    def _mark_legacy_remapped(self, user_id: int) -> None:
        if self._legacy_already_remapped(user_id):
            return
        ApiConnection(
            user_id=user_id,
            platform=_LEGACY_REMAP_PLATFORM,
            credentials={"v": 1},
        )

    def _ensure_default_catalog(self, user_id: int) -> None:
        """Inserta filas del seed faltantes por nombre (idempotente; sirve para ampliar el catálogo)."""
        rows = self._rows_for_user(user_id)
        existing_keys = {normalize_status_lookup_key(r.nombre or "") for r in rows}
        missing = [
            item
            for item in DEFAULT_LEAD_STATUSES
            if normalize_status_lookup_key(item[0]) not in existing_keys
        ]
        if missing:
            now = datetime.utcnow()
            next_order = self._next_sort_order(user_id)
            for i, (nombre, color, cierre, noshow, followup, is_def) in enumerate(missing):
                LeadStatusType(
                    user_id=user_id,
                    nombre=nombre,
                    color=_valid_hex_color(color),
                    activo=True,
                    sort_order=next_order + i,
                    counts_as_cierre=cierre,
                    counts_as_no_show=noshow,
                    requires_followup_date=followup,
                    is_default=is_def,
                    created_at=now,
                )
            flush()
        if not self._defaults_already_seeded(user_id):
            self._mark_defaults_seeded(user_id)
            flush()

    def _remap_legacy_lead_statuses(self, user_id: int) -> None:
        """One-shot: Pendiente→Pendiente de pago, Agendado→Reserva, etc."""
        if self._legacy_already_remapped(user_id):
            return
        catalog_keys = {
            normalize_status_lookup_key(r.nombre or "") for r in self._rows_for_user(user_id)
        }
        for lead in self._leads_for_user(user_id):
            raw = (lead.status or lead.estado or "").strip()
            if not raw:
                continue
            key = normalize_status_lookup_key(raw)
            if key in catalog_keys:
                continue
            new_name = _LEGACY_NAME_REMAP.get(key)
            if not new_name:
                continue
            lead.status = new_name
            lead.estado = new_name
        self._mark_legacy_remapped(user_id)
        flush()

    def _clear_other_defaults(self, uid: int, keep_id: int | None) -> None:
        for row in self._rows_for_user(uid):
            if keep_id is not None and int(row.id) == keep_id:
                continue
            if row.is_default:
                row.is_default = False

    def list_for_user(self, user_id: int) -> LeadStatusTypesListResponse:
        try:
            with db_session:
                self._ensure_default_catalog(user_id)
                self._remap_legacy_lead_statuses(user_id)
                rows = sorted(
                    self._rows_for_user(user_id),
                    key=lambda r: (int(r.sort_order or 0), int(r.id)),
                )
                statuses = [self._to_out(r) for r in rows]
            return LeadStatusTypesListResponse(statuses=statuses)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al leer estados.") from None

    def create(self, user_id: int, body: LeadStatusTypeCreateRequest) -> LeadStatusTypeOut:
        nombre = (body.nombre or "").strip()
        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
        color = _valid_hex_color(body.color)
        try:
            with db_session:
                self._ensure_default_catalog(user_id)
                if self._nombre_taken(user_id, nombre):
                    raise HTTPException(status_code=400, detail="Ya existe un estado con ese nombre.")
                is_def = bool(body.is_default)
                if is_def:
                    self._clear_other_defaults(user_id, None)
                row = LeadStatusType(
                    user_id=user_id,
                    nombre=nombre,
                    color=color,
                    activo=bool(body.activo),
                    sort_order=self._next_sort_order(user_id),
                    counts_as_cierre=bool(body.counts_as_cierre),
                    counts_as_no_show=bool(body.counts_as_no_show),
                    requires_followup_date=bool(body.requires_followup_date),
                    is_default=is_def,
                    created_at=datetime.utcnow(),
                )
                flush()
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al crear estado.") from None

    def update(
        self,
        user_id: int,
        status_id: int,
        body: LeadStatusTypePatchRequest,
    ) -> LeadStatusTypeOut:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == status_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Estado no encontrado.")
                row = rows[0]
                old_nombre = str(row.nombre or "").strip()
                if body.nombre is not None:
                    nn = body.nombre.strip()
                    if not nn:
                        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
                    if self._nombre_taken(user_id, nn, exclude_id=status_id):
                        raise HTTPException(status_code=400, detail="Ya existe un estado con ese nombre.")
                    row.nombre = nn
                    if nn != old_nombre:
                        old_key = normalize_status_lookup_key(old_nombre)
                        for lead in self._leads_for_user(user_id):
                            st = normalize_status_lookup_key(lead.status or lead.estado or "")
                            if st == old_key:
                                lead.status = nn
                                lead.estado = nn
                if body.color is not None:
                    row.color = _valid_hex_color(body.color)
                if body.activo is not None:
                    row.activo = bool(body.activo)
                if body.sort_order is not None:
                    row.sort_order = int(body.sort_order)
                if body.counts_as_cierre is not None:
                    row.counts_as_cierre = bool(body.counts_as_cierre)
                if body.counts_as_no_show is not None:
                    row.counts_as_no_show = bool(body.counts_as_no_show)
                if body.requires_followup_date is not None:
                    row.requires_followup_date = bool(body.requires_followup_date)
                if body.is_default is not None:
                    if body.is_default:
                        self._clear_other_defaults(user_id, status_id)
                        row.is_default = True
                    else:
                        row.is_default = False
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al actualizar estado.") from None

    def delete(self, user_id: int, status_id: int) -> LeadStatusTypesListResponse:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == status_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Estado no encontrado.")
                row = rows[0]
                in_use = self._lead_count_using_status(user_id, row.nombre or "")
                if in_use > 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No se puede eliminar: hay {in_use} lead(s) con este estado.",
                    )
                was_default = bool(row.is_default)
                row.delete()
                if was_default:
                    remaining = sorted(
                        self._rows_for_user(user_id),
                        key=lambda r: (int(r.sort_order or 0), int(r.id)),
                    )
                    if remaining:
                        remaining[0].is_default = True
                if not self._rows_for_user(user_id):
                    self._mark_defaults_seeded(user_id)
            return self.list_for_user(user_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al eliminar estado.") from None


_service = LeadStatusesServices()


def ensure_catalog_for_user(user_id: int) -> None:
    with db_session:
        _service._ensure_default_catalog(user_id)
        _service._remap_legacy_lead_statuses(user_id)


def default_lead_status_name(user_id: int) -> str:
    """Nombre del estado marcado is_default (o fallback del seed)."""
    with db_session:
        _service._ensure_default_catalog(user_id)
        rows = [r for r in _service._rows_for_user(user_id) if r.activo and r.is_default]
        if rows:
            return str(rows[0].nombre or "").strip() or FALLBACK_DEFAULT_STATUS
        active = sorted(
            [r for r in _service._rows_for_user(user_id) if r.activo],
            key=lambda r: (int(r.sort_order or 0), int(r.id)),
        )
        if active:
            return str(active[0].nombre or "").strip() or FALLBACK_DEFAULT_STATUS
    return FALLBACK_DEFAULT_STATUS


def booking_lead_status_name(user_id: int) -> str:
    """Estado que escriben Calendly/GHL al agendar (Reserva del catálogo)."""
    with db_session:
        _service._ensure_default_catalog(user_id)
        key = normalize_status_lookup_key(FALLBACK_BOOKING_STATUS)
        for row in _service._rows_for_user(user_id):
            if normalize_status_lookup_key(row.nombre or "") == key and row.activo:
                return str(row.nombre or "").strip() or FALLBACK_BOOKING_STATUS
    return FALLBACK_BOOKING_STATUS


def resolve_status_flags(user_id: int, status_raw: str | None) -> dict[str, bool]:
    """Roles de embudo para un label de status (catálogo o legado)."""
    raw = (status_raw or "").strip()
    key = normalize_status_lookup_key(raw)
    flags = empty_status_flags()
    if not key:
        return flags
    with db_session:
        _service._ensure_default_catalog(user_id)
        for row in _service._rows_for_user(user_id):
            if normalize_status_lookup_key(row.nombre or "") == key:
                return {
                    "counts_as_cierre": bool(row.counts_as_cierre),
                    "counts_as_no_show": bool(row.counts_as_no_show),
                    "requires_followup_date": bool(row.requires_followup_date),
                }
    legacy = _LEGACY_ROLE_BY_KEY.get(key)
    if legacy:
        return {**empty_status_flags(), **legacy}
    return flags


def status_counts_as_cierre(user_id: int, status_raw: str | None) -> bool:
    return bool(resolve_status_flags(user_id, status_raw).get("counts_as_cierre"))


def status_counts_as_no_show(user_id: int, status_raw: str | None) -> bool:
    return bool(resolve_status_flags(user_id, status_raw).get("counts_as_no_show"))


def catalog_rows_as_dicts(user_id: int) -> list[dict[str, Any]]:
    """Para inyectar en prompts / front sin abrir otra sesión HTTP."""
    resp = _service.list_for_user(user_id)
    return [s.model_dump() for s in resp.statuses]
