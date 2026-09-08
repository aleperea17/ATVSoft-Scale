from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from src.schemas import (
    LeadStatusTypeCreateRequest,
    LeadStatusTypeOut,
    LeadStatusTypePatchRequest,
    LeadStatusTypesListResponse,
)
from src.services.lead_statuses_services import LeadStatusesServices

router = APIRouter(prefix="/api/lead-statuses", tags=["lead-statuses"], redirect_slashes=False)

_service = LeadStatusesServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.") from e


@router.get("", response_model=LeadStatusTypesListResponse)
def list_lead_statuses(user_id: Annotated[str, Depends(require_user_id)]) -> LeadStatusTypesListResponse:
    return _service.list_for_user(_parse_uid(user_id))


@router.post("", response_model=LeadStatusTypeOut)
def create_lead_status(
    body: LeadStatusTypeCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadStatusTypeOut:
    return _service.create(_parse_uid(user_id), body)


@router.patch("/{status_id}", response_model=LeadStatusTypeOut)
def patch_lead_status(
    status_id: int,
    body: LeadStatusTypePatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadStatusTypeOut:
    return _service.update(_parse_uid(user_id), status_id, body)


@router.delete("/{status_id}", response_model=LeadStatusTypesListResponse)
def delete_lead_status(
    status_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadStatusTypesListResponse:
    return _service.delete(_parse_uid(user_id), status_id)
