"""Renueva miniaturas de Instagram vencidas (reels y posts fijados).

Las URLs del CDN de Instagram vienen firmadas con `oe=<hex unix>` y dejan de servir
(403) a los pocos días. Guardamos la URL al sincronizar, así que hay que pedirla de nuevo
a Graph API cuando vence o está por vencer.
"""

from __future__ import annotations

import re
import threading
import time
import urllib.parse

from pony.orm import db_session, flush

from src.models import FeedPostContent, ReelContent
from src.services.feed_posts_services import _GRAPH, FeedPostsServices

_OE_RE = re.compile(r"[?&]oe=([0-9A-Fa-f]+)")
# Renovar si vence en menos de este margen.
_RENEW_MARGIN_SECONDS = 24 * 3600
# Como mucho una pasada automática por usuario cada este intervalo.
_AUTO_MIN_INTERVAL_SECONDS = 30 * 60

_last_auto_run: dict[int, float] = {}
_running: set[int] = set()
_lock = threading.Lock()


def thumbnail_needs_renewal(url: str | None, now: float | None = None) -> bool:
    """True si la URL falta, ya venció o vence dentro del margen."""
    u = (url or "").strip()
    if not u:
        return True
    m = _OE_RE.search(u)
    if not m:
        # Sin firma de vencimiento (p. ej. YouTube u otra fuente): no tocar.
        return False
    try:
        expires = int(m.group(1), 16)
    except ValueError:
        return True
    return expires - (now if now is not None else time.time()) < _RENEW_MARGIN_SECONDS


def _fresh_thumbnail(svc: FeedPostsServices, access_token: str, media_id: str) -> str:
    media = svc._http_json(
        f"{_GRAPH}/{urllib.parse.quote(media_id)}"
        f"?fields=thumbnail_url,media_url,children{{media_url,thumbnail_url}}"
        f"&access_token={urllib.parse.quote(access_token)}"
    )
    return svc._thumbnail_from_media(media)


def renew_expired_thumbnails_blocking(user_id: str) -> dict[str, int]:
    """Pide a Graph API la miniatura nueva de cada reel / post fijado vencido del usuario."""
    uid = int(user_id)
    svc = FeedPostsServices()
    try:
        access_token, _ = svc._resolve_instagram_conn(user_id)
    except Exception:
        return {"renewed": 0, "failed": 0, "checked": 0}

    now = time.time()
    with db_session:
        reels = [
            (r.id, str(r.instagram_id or ""))
            for r in list(ReelContent.select())
            if int(r.user_id) == uid and r.instagram_id and thumbnail_needs_renewal(r.thumbnail_url, now)
        ]
        posts = [
            (p.id, str(p.instagram_id or ""))
            for p in list(FeedPostContent.select())
            if int(p.user_id) == uid and p.instagram_id and thumbnail_needs_renewal(p.thumbnail_url, now)
        ]

    renewed = 0
    failed = 0
    for entity, rows in ((ReelContent, reels), (FeedPostContent, posts)):
        for row_id, media_id in rows:
            try:
                thumb = _fresh_thumbnail(svc, access_token, media_id)
            except Exception as e:
                failed += 1
                print(f"[thumbnails] no se pudo renovar {entity.__name__} id={row_id}: {e}")
                continue
            if not thumb:
                failed += 1
                continue
            with db_session:
                row = entity.get(id=row_id)
                if row is None or int(row.user_id) != uid:
                    continue
                row.thumbnail_url = thumb
                flush()
            renewed += 1
    return {"renewed": renewed, "failed": failed, "checked": len(reels) + len(posts)}


def renew_expired_thumbnails_auto(user_id: str) -> None:
    """Versión para BackgroundTasks: con throttle por usuario y sin correr dos veces a la vez."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return
    with _lock:
        if uid in _running or time.time() - _last_auto_run.get(uid, 0) < _AUTO_MIN_INTERVAL_SECONDS:
            return
        _running.add(uid)
        _last_auto_run[uid] = time.time()
    try:
        result = renew_expired_thumbnails_blocking(user_id)
        if result["checked"]:
            print(f"[thumbnails] user={uid} {result}")
    except Exception as e:
        print(f"[thumbnails] error user={uid}: {e}")
    finally:
        with _lock:
            _running.discard(uid)
