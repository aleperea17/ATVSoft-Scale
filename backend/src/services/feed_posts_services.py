"""Posts de feed Instagram (IMAGE / CAROUSEL_ALBUM) — trackeo manual de posts fijados."""

from __future__ import annotations

import asyncio
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any

import certifi
from fastapi import HTTPException
from pony.orm import ObjectNotFound, db_session, flush

from src.models import ApiConnection, FeedPostContent, Lead
from src.schemas import (
    FeedPostAddRequest,
    FeedPostKeywordPatchRequest,
    FeedPostPatchRequest,
    FeedPostResponse,
    FeedPostsListResponse,
)

_GRAPH = "https://graph.facebook.com/v25.0"
_PERMALINK_RE = re.compile(
    r"(?:https?://)?(?:www\.)?instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)/?",
    re.I,
)


class FeedPostsServices:
    def _resolve_instagram_conn(self, user_id: str) -> tuple[str, str]:
        uid = int(user_id)
        with db_session:
            conn = next(
                (
                    c
                    for c in list(ApiConnection.select())
                    if c.user_id == uid and c.platform == "instagram"
                ),
                None,
            )
            if conn is None:
                raise HTTPException(
                    status_code=400,
                    detail="No hay conexión de Instagram configurada. Configúrala en Conexiones API.",
                )
            creds = conn.credentials if isinstance(conn.credentials, dict) else {}
            token = str(creds.get("access_token") or "").strip()
            ig_user_id = str(creds.get("instagram_user_id") or "").strip()
            if not token or not ig_user_id:
                raise HTTPException(
                    status_code=400,
                    detail="Faltan access_token o instagram_user_id en la conexión de Instagram.",
                )
            return token, ig_user_id

    def _http_json(self, url: str) -> dict:
        req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        try:
            with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as e:
            try:
                err_raw = e.read().decode("utf-8")
            except Exception:
                err_raw = ""
            raise HTTPException(
                status_code=502,
                detail=f"Error HTTP Graph API ({e.code}): {err_raw[:280]}",
            ) from e
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error al llamar Graph API: {e}") from e

    def _insight_value(self, access_token: str, media_id: str, metric: str) -> int:
        url = (
            f"{_GRAPH}/{urllib.parse.quote(media_id)}/insights"
            f"?metric={urllib.parse.quote(metric)}"
            f"&access_token={urllib.parse.quote(access_token)}"
        )
        try:
            payload = self._http_json(url)
        except HTTPException:
            return 0
        rows = payload.get("data") if isinstance(payload.get("data"), list) else []
        for m in rows:
            if not isinstance(m, dict):
                continue
            values = m.get("values")
            if isinstance(values, list) and values and isinstance(values[0], dict):
                return int(values[0].get("value") or 0)
        return 0

    def fetch_feed_post_metrics(self, access_token: str, media_id: str) -> dict[str, int]:
        """Paso 0 / refresh: views (no impressions), reach, likes, comments, saved, shares."""
        metrics = {
            "views": self._insight_value(access_token, media_id, "views"),
            "reach": self._insight_value(access_token, media_id, "reach"),
            "likes": self._insight_value(access_token, media_id, "likes"),
            "comentarios": self._insight_value(access_token, media_id, "comments"),
            "guardados": self._insight_value(access_token, media_id, "saved"),
            "shares": self._insight_value(access_token, media_id, "shares"),
        }
        try:
            mf = self._http_json(
                f"{_GRAPH}/{urllib.parse.quote(media_id)}"
                f"?fields=like_count,comments_count"
                f"&access_token={urllib.parse.quote(access_token)}"
            )
            metrics["likes"] = max(metrics["likes"], int(mf.get("like_count") or 0))
            metrics["comentarios"] = max(metrics["comentarios"], int(mf.get("comments_count") or 0))
        except HTTPException:
            pass
        return metrics

    def validate_insights(self, user_id: str, media_id: str) -> dict[str, Any]:
        """Validación explícita Paso 0: una llamada real a insights."""
        access_token, _ = self._resolve_instagram_conn(user_id)
        mid = (media_id or "").strip()
        if not mid:
            raise HTTPException(status_code=400, detail="media_id requerido.")
        wanted = ["views", "reach", "likes", "comments", "saved", "shares"]
        url = (
            f"{_GRAPH}/{urllib.parse.quote(mid)}/insights"
            f"?metric={urllib.parse.quote(','.join(wanted))}"
            f"&access_token={urllib.parse.quote(access_token)}"
        )
        names: list[str] = []
        try:
            payload = self._http_json(url)
            rows = payload.get("data") if isinstance(payload.get("data"), list) else []
            names = [str(r.get("name") or "") for r in rows if isinstance(r, dict)]
        except HTTPException:
            # Fallback: métricas una a una (algunas cuentas rechazan el batch)
            for m in wanted:
                if self._insight_value(access_token, mid, m) > 0 or m == "views":
                    # views puede ser 0 y aún así ser métrica válida
                    try:
                        self._http_json(
                            f"{_GRAPH}/{urllib.parse.quote(mid)}/insights"
                            f"?metric={urllib.parse.quote(m)}"
                            f"&access_token={urllib.parse.quote(access_token)}"
                        )
                        names.append(m)
                    except HTTPException:
                        continue
        if not names:
            raise HTTPException(
                status_code=502,
                detail="Insights vacíos/fallidos para este media (permiso, tipo o métricas no disponibles).",
            )
        return {"ok": True, "media_id": mid, "metrics_returned": names}

    def _count_leads_matching_keyword(self, user_id: int, keyword: str | None) -> int:
        kw = (keyword or "").strip().casefold()
        if not kw:
            return 0
        n = 0
        for lead in list(Lead.select()):
            if int(lead.user_id) != user_id:
                continue
            raw = (lead.keyword or "").strip()
            if not raw:
                continue
            tokens = [t.strip().casefold() for t in raw.split(",") if t.strip()]
            if kw in tokens:
                n += 1
        return n

    def _count_agendas(self, user_id: int, post_id: int) -> int:
        token = f"post:{post_id}"
        n = 0
        for lead in list(Lead.select()):
            if int(lead.user_id) != user_id:
                continue
            ap = (lead.punto_agenda or "").strip()
            if ap == token:
                n += 1
        return n

    def _sum_pago_agendas(self, user_id: int, post_id: int) -> float:
        token = f"post:{post_id}"
        total = 0.0
        for lead in list(Lead.select()):
            if int(lead.user_id) != user_id:
                continue
            ap = (lead.punto_agenda or "").strip()
            if ap == token:
                total += float(lead.pago or 0)
        return total

    def _to_response(self, row: FeedPostContent, *, user_id: str, finalize: bool = True) -> FeedPostResponse:
        uid = int(user_id)
        pid = int(row.id)
        keyword = (row.keyword or "").strip() or None
        manual_chats = int(row.chats_manuales or 0)
        chats_kw = self._count_leads_matching_keyword(uid, keyword) if finalize else 0
        chats = manual_chats + chats_kw
        agendas = self._count_agendas(uid, pid) if finalize else 0
        cash_leads = self._sum_pago_agendas(uid, pid) if finalize else 0.0
        cash_manual = float(row.cash or 0)
        cash_total = cash_manual + cash_leads
        cpc = (cash_total / chats) if chats > 0 else 0.0
        thumb = (row.thumbnail_url or "").strip()
        return FeedPostResponse(
            id=str(pid),
            title=(row.title or "").strip() or None,
            media_type=(row.media_type or "").strip() or None,
            metrics={
                "views": int(row.views or 0),
                "reach": int(row.reach or 0),
                "likes": int(row.likes or 0),
                "comentarios": int(row.comentarios or 0),
                "shares": int(row.shares or 0),
                "guardados": int(row.guardados or 0),
                "thumbnail": thumb,
            },
            classification={
                "dolor": (row.dolor or "").strip() or None,
                "angulos": (row.angulos or "").strip() or None,
                "cta": (row.cta or "").strip() or None,
            },
            cash=cash_total,
            chats=chats,
            published_at=row.fecha_publicacion,
            url=(row.permalink or "").strip() or None,
            external_id=str(row.instagram_id),
            keyword=keyword,
            manual_chats=manual_chats,
            cash_total=cash_total,
            cpc=cpc,
            agendas=agendas,
            is_pinned_manual=bool(row.is_pinned_manual),
            agenda_token=f"post:{pid}",
        )

    def list_posts(self, user_id: str) -> FeedPostsListResponse:
        uid = int(user_id)
        with db_session:
            rows = sorted(
                [r for r in list(FeedPostContent.select()) if int(r.user_id) == uid],
                key=lambda r: (r.fecha_publicacion or datetime.min, int(r.id)),
                reverse=True,
            )
            posts = [self._to_response(r, user_id=user_id) for r in rows]
        return FeedPostsListResponse(
            posts=posts,
            total=len(posts),
            total_cash=sum(float(p.cash_total or 0) for p in posts),
            total_chats=sum(int(p.chats or 0) for p in posts),
        )

    def _extract_shortcode(self, raw: str) -> str | None:
        m = _PERMALINK_RE.search(raw.strip())
        return m.group(1) if m else None

    def _find_media_by_shortcode_or_id(
        self, access_token: str, ig_user_id: str, raw: str
    ) -> dict[str, Any]:
        s = raw.strip()
        shortcode = self._extract_shortcode(s)
        # Si parece solo ID numérico de Graph
        if re.fullmatch(r"\d{5,}", s) and not shortcode:
            media = self._http_json(
                f"{_GRAPH}/{urllib.parse.quote(s)}"
                f"?fields=id,media_type,media_product_type,caption,permalink,timestamp,"
                f"thumbnail_url,media_url,like_count,comments_count,children{{media_url,thumbnail_url}}"
                f"&access_token={urllib.parse.quote(access_token)}"
            )
            return media

        target_code = (shortcode or s).strip()
        if not target_code:
            raise HTTPException(status_code=400, detail="Permalink o media_id inválido.")

        fields = (
            "id,media_type,media_product_type,caption,permalink,timestamp,"
            "thumbnail_url,media_url,like_count,comments_count,children{media_url,thumbnail_url}"
        )
        url = (
            f"{_GRAPH}/{urllib.parse.quote(ig_user_id)}/media"
            f"?fields={fields}&limit=50&access_token={urllib.parse.quote(access_token)}"
        )
        pages = 0
        while url and pages < 20:
            pages += 1
            payload = self._http_json(url)
            data = payload.get("data") if isinstance(payload.get("data"), list) else []
            for item in data:
                if not isinstance(item, dict):
                    continue
                permalink = str(item.get("permalink") or "")
                code = self._extract_shortcode(permalink) or ""
                mid = str(item.get("id") or "")
                if code == target_code or mid == target_code or target_code in permalink:
                    return item
            paging = payload.get("paging") if isinstance(payload.get("paging"), dict) else {}
            url = str(paging.get("next") or "").strip() or ""
        raise HTTPException(
            status_code=404,
            detail="No se encontró ese post en el media de la cuenta Instagram conectada.",
        )

    def _thumbnail_from_media(self, media: dict[str, Any]) -> str:
        thumb = str(media.get("thumbnail_url") or media.get("media_url") or "").strip()
        if thumb:
            return thumb
        children = media.get("children")
        if isinstance(children, dict):
            data = children.get("data")
            if isinstance(data, list) and data and isinstance(data[0], dict):
                return str(data[0].get("thumbnail_url") or data[0].get("media_url") or "").strip()
        return ""

    def add_from_permalink_or_id(self, user_id: str, body: FeedPostAddRequest) -> FeedPostResponse:
        access_token, ig_user_id = self._resolve_instagram_conn(user_id)
        media = self._find_media_by_shortcode_or_id(
            access_token, ig_user_id, body.permalink_or_media_id
        )
        media_id = str(media.get("id") or "").strip()
        if not media_id:
            raise HTTPException(status_code=502, detail="Media sin id de Graph.")

        media_type = str(media.get("media_type") or "").strip().upper()
        product = str(media.get("media_product_type") or "").strip().upper()
        if media_type not in {"IMAGE", "CAROUSEL_ALBUM"}:
            if product == "REELS" or media_type in {"REELS", "VIDEO"}:
                raise HTTPException(
                    status_code=400,
                    detail=f"Este media es {media_type or product or 'desconocido'}; "
                    "usá Reels para clips. Posts fijados aceptan IMAGE o CAROUSEL_ALBUM (feed).",
                )

        # Paso 0 embebido: si insights fallan del todo, no persistir
        self.validate_insights(user_id, media_id)

        metrics = self.fetch_feed_post_metrics(access_token, media_id)
        caption = str(media.get("caption") or "").strip()
        title = caption[:120] if caption else f"Post {media_id[-6:]}"
        permalink = str(media.get("permalink") or "").strip() or None
        thumb = self._thumbnail_from_media(media)
        ts_raw = str(media.get("timestamp") or "").strip()
        fecha = None
        if ts_raw:
            try:
                fecha = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                fecha = None

        uid = int(user_id)
        now = datetime.utcnow()
        with db_session:
            existing = None
            try:
                existing = FeedPostContent.get(instagram_id=media_id)
            except ObjectNotFound:
                existing = None
            if existing is not None:
                if int(existing.user_id) != uid:
                    raise HTTPException(status_code=409, detail="Ese media ya está trackeado por otro usuario.")
                row = existing
            else:
                row = FeedPostContent(
                    user_id=uid,
                    instagram_id=media_id,
                    created_at=now,
                )
            row.media_type = media_type or (row.media_type or "")
            row.title = title
            row.thumbnail_url = thumb or row.thumbnail_url
            row.permalink = permalink
            row.fecha_publicacion = fecha or row.fecha_publicacion
            row.views = metrics["views"]
            row.reach = metrics["reach"]
            row.likes = metrics["likes"]
            row.comentarios = metrics["comentarios"]
            row.shares = metrics["shares"]
            row.guardados = metrics["guardados"]
            row.is_pinned_manual = True
            row.updated_at = now
            flush()
            return self._to_response(row, user_id=user_id)

    def patch_post(self, user_id: str, post_id: str, body: FeedPostPatchRequest) -> FeedPostResponse:
        uid = int(user_id)
        pid = int(post_id)
        with db_session:
            row = FeedPostContent.get(id=pid)
            if row is None or int(row.user_id) != uid:
                raise HTTPException(status_code=404, detail="Post no encontrado.")
            data = body.model_dump(exclude_unset=True)
            if "cash" in data and data["cash"] is not None:
                row.cash = float(max(0.0, float(data["cash"])))
            if "chats_manuales" in data and data["chats_manuales"] is not None:
                row.chats_manuales = max(0, int(data["chats_manuales"]))
            if "dolor" in data:
                row.dolor = str(data.get("dolor") or "").strip()
            if "angulos" in data:
                row.angulos = str(data.get("angulos") or "").strip()
            if "cta" in data:
                row.cta = str(data.get("cta") or "").strip()
            if "is_pinned_manual" in data and data["is_pinned_manual"] is not None:
                row.is_pinned_manual = bool(data["is_pinned_manual"])
            row.updated_at = datetime.utcnow()
            flush()
            return self._to_response(row, user_id=user_id)

    def patch_keyword(
        self, user_id: str, post_id: str, body: FeedPostKeywordPatchRequest
    ) -> FeedPostResponse:
        uid = int(user_id)
        pid = int(post_id)
        kw = (body.keyword or "").strip() or None
        with db_session:
            row = FeedPostContent.get(id=pid)
            if row is None or int(row.user_id) != uid:
                raise HTTPException(status_code=404, detail="Post no encontrado.")
            if kw:
                for other in list(FeedPostContent.select()):
                    if int(other.user_id) != uid or int(other.id) == pid:
                        continue
                    if (other.keyword or "").strip().casefold() == kw.casefold():
                        raise HTTPException(
                            status_code=409,
                            detail="Esa keyword ya está asignada a otro post fijado.",
                        )
            row.keyword = kw
            row.updated_at = datetime.utcnow()
            flush()
            return self._to_response(row, user_id=user_id)

    def delete_post(self, user_id: str, post_id: str) -> dict[str, bool]:
        uid = int(user_id)
        pid = int(post_id)
        with db_session:
            row = FeedPostContent.get(id=pid)
            if row is None or int(row.user_id) != uid:
                raise HTTPException(status_code=404, detail="Post no encontrado.")
            row.delete()
            flush()
        return {"ok": True}

    def refresh_metrics_blocking(self, user_id: str) -> dict[str, int]:
        uid = int(user_id)
        access_token, _ = self._resolve_instagram_conn(user_id)
        updated = 0
        failed = 0
        with db_session:
            rows = [r for r in list(FeedPostContent.select()) if int(r.user_id) == uid]
            ids = [(int(r.id), str(r.instagram_id)) for r in rows]
        for _pid, ig_id in ids:
            try:
                metrics = self.fetch_feed_post_metrics(access_token, ig_id)
                with db_session:
                    row = FeedPostContent.get(id=_pid)
                    if row is None:
                        continue
                    row.views = metrics["views"]
                    row.reach = metrics["reach"]
                    row.likes = metrics["likes"]
                    row.comentarios = metrics["comentarios"]
                    row.shares = metrics["shares"]
                    row.guardados = metrics["guardados"]
                    row.updated_at = datetime.utcnow()
                    flush()
                updated += 1
            except Exception:
                failed += 1
        return {"updated": updated, "failed": failed, "total": len(ids)}

    async def refresh_metrics(self, user_id: str) -> dict[str, int]:
        return await asyncio.to_thread(self.refresh_metrics_blocking, user_id)
