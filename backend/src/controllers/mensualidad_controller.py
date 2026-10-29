"""Mensualidad por cuenta: se maneja desde el panel admin (X-Admin-Panel-Token)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pony.orm import ObjectNotFound
from pydantic import BaseModel, Field

from src.controllers.admin_panel_controller import require_admin_panel
from src.services.mensualidad_service import activar_mensualidad, list_mensualidades, quitar_mensualidad

router = APIRouter(
    prefix="/api/admin/panel/mensualidades",
    tags=["mensualidad"],
    redirect_slashes=False,
    dependencies=[Depends(require_admin_panel)],
)


class MensualidadCuentaOut(BaseModel):
    user_id: int
    username: str
    vence: date | None = None
    dias_restantes: int | None = None
    plazo_dias: int = 0
    bloqueada: bool = False


class MensualidadActivarBody(BaseModel):
    dias: int = Field(ge=1, le=366)
    plazo_dias: int = Field(default=0, ge=0, le=60)


@router.get("", response_model=list[MensualidadCuentaOut])
def listar() -> list[MensualidadCuentaOut]:
    return [MensualidadCuentaOut(**c) for c in list_mensualidades()]


@router.put("/{user_id}", response_model=MensualidadCuentaOut)
def activar(user_id: int, body: MensualidadActivarBody) -> MensualidadCuentaOut:
    try:
        return MensualidadCuentaOut(**activar_mensualidad(user_id, body.dias, body.plazo_dias))
    except ObjectNotFound as e:
        raise HTTPException(status_code=404, detail="Cuenta inexistente.") from e


@router.delete("/{user_id}", response_model=MensualidadCuentaOut)
def quitar(user_id: int) -> MensualidadCuentaOut:
    try:
        return MensualidadCuentaOut(**quitar_mensualidad(user_id))
    except ObjectNotFound as e:
        raise HTTPException(status_code=404, detail="Cuenta inexistente.") from e
