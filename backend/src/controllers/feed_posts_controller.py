from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.schemas import (
    FeedPostAddRequest,
    FeedPostKeywordPatchRequest,
    FeedPostPatchRequest,
    FeedPostResponse,
    FeedPostsListResponse,
)
from src.services.feed_posts_services import FeedPostsServices

router = APIRouter(prefix="/api/feed-posts", tags=["feed-posts"], redirect_slashes=False)
service = FeedPostsServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


@router.get("", response_model=FeedPostsListResponse)
def list_feed_posts(user_id: Annotated[str, Depends(require_user_id)]) -> FeedPostsListResponse:
    try:
        return service.list_posts(user_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al listar posts fijados.")


@router.post("/validate-insights")
def validate_insights(
    user_id: Annotated[str, Depends(require_user_id)],
    media_id: str = Query(..., min_length=1),
) -> dict:
    """Paso 0: prueba real GET /{media-id}/insights sin persistir."""
    try:
        return service.validate_insights(user_id, media_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al validar insights.")


@router.post("/add", response_model=FeedPostResponse)
def add_feed_post(
    body: FeedPostAddRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> FeedPostResponse:
    try:
        return service.add_from_permalink_or_id(user_id, body)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al agregar el post.")


@router.patch("/{post_id}", response_model=FeedPostResponse)
def patch_feed_post(
    post_id: str,
    body: FeedPostPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> FeedPostResponse:
    try:
        return service.patch_post(user_id, post_id, body)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al actualizar el post.")


@router.patch("/{post_id}/keyword", response_model=FeedPostResponse)
def patch_feed_post_keyword(
    post_id: str,
    body: FeedPostKeywordPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> FeedPostResponse:
    try:
        return service.patch_keyword(user_id, post_id, body)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al actualizar keyword.")


@router.delete("/{post_id}")
def delete_feed_post(
    post_id: str,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict:
    try:
        return service.delete_post(user_id, post_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al eliminar el post.")


@router.post("/refresh-metrics")
async def refresh_feed_post_metrics(
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict:
    try:
        return await service.refresh_metrics(user_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error al refrescar métricas.")
