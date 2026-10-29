"""Mensualidad por cuenta: solo Franco, con X-Mensualidad-Key (no usa el login del cliente)."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pony.orm import ObjectNotFound
from pydantic import BaseModel, Field

from src.services.mensualidad_service import (
    extender_mensualidad,
    list_mensualidades,
    mensualidad_dias_restantes,
    set_mensualidad_vence,
    verify_mensualidad_key,
)

router = APIRouter(prefix="/api/admin/mensualidad", tags=["mensualidad"], redirect_slashes=False)


def require_mensualidad_key(
    x_mensualidad_key: Annotated[str | None, Header(alias="X-Mensualidad-Key")] = None,
) -> None:
    if not verify_mensualidad_key(x_mensualidad_key):
        raise HTTPException(status_code=403, detail="Clave incorrecta.")


class MensualidadCuentaOut(BaseModel):
    user_id: int
    username: str
    vence: date | None = None
    dias_restantes: int | None = None


class MensualidadSetBody(BaseModel):
    vence: date | None = None


class MensualidadExtenderBody(BaseModel):
    dias: int = Field(default=30, ge=1, le=366)


def _cuenta(user_id: int, vence: date | None) -> MensualidadCuentaOut:
    username = next((c["username"] for c in list_mensualidades() if c["user_id"] == user_id), "")
    return MensualidadCuentaOut(
        user_id=user_id, username=username, vence=vence, dias_restantes=mensualidad_dias_restantes(vence)
    )


@router.get("", response_model=list[MensualidadCuentaOut], dependencies=[Depends(require_mensualidad_key)])
def listar() -> list[MensualidadCuentaOut]:
    return [MensualidadCuentaOut(**c) for c in list_mensualidades()]


@router.put("/{user_id}", response_model=MensualidadCuentaOut, dependencies=[Depends(require_mensualidad_key)])
def fijar(user_id: int, body: MensualidadSetBody) -> MensualidadCuentaOut:
    try:
        return _cuenta(user_id, set_mensualidad_vence(user_id, body.vence))
    except ObjectNotFound as e:
        raise HTTPException(status_code=404, detail="Cuenta inexistente.") from e


@router.post("/{user_id}/extender", response_model=MensualidadCuentaOut, dependencies=[Depends(require_mensualidad_key)])
def extender(user_id: int, body: MensualidadExtenderBody) -> MensualidadCuentaOut:
    try:
        return _cuenta(user_id, extender_mensualidad(user_id, body.dias))
    except ObjectNotFound as e:
        raise HTTPException(status_code=404, detail="Cuenta inexistente.") from e
