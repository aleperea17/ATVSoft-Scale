"""Auto-registro de la suscripción de webhook de Calendly al conectar una cuenta."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from pony.orm import ObjectNotFound, db_session

from src.models import ApiConnection

logger = logging.getLogger(__name__)

_CALENDLY_API = "https://api.calendly.com"
_TIMEOUT = 10.0


def _norm_uri(uri: str | None) -> str:
    return (uri or "").strip().rstrip("/")


def fetch_calendly_user_identity(api_key: str) -> dict[str, str]:
    """GET /users/me → calendly_user_uri / email / name. {} si falla."""
    key = (api_key or "").strip()
    if not key:
        return {}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            me = client.get(f"{_CALENDLY_API}/users/me", headers=headers)
            me.raise_for_status()
            resource = me.json().get("resource") or {}
            user_uri = _norm_uri(str(resource.get("uri") or ""))
            if not user_uri:
                return {}
            out: dict[str, str] = {"calendly_user_uri": user_uri}
            email = str(resource.get("email") or "").strip()
            name = str(resource.get("name") or "").strip()
            if email:
                out["calendly_user_email"] = email
            if name:
                out["calendly_user_name"] = name
            return out
    except Exception:
        logger.warning("Calendly /users/me falló al backfill de calendly_user_uri", exc_info=True)
        return {}


def persist_calendly_user_uri_if_missing(
    connection_id: int,
    user_uri: str,
    *,
    user_email: str = "",
    user_name: str = "",
) -> bool:
    """Persiste URI (y email/nombre si faltan) solo si credentials no tenía calendly_user_uri."""
    uri = _norm_uri(user_uri)
    if not uri:
        return False
    with db_session:
        try:
            conn = ApiConnection.get(id=connection_id)
        except ObjectNotFound:
            return False
        if conn is None:
            return False
        creds = dict(conn.credentials) if isinstance(conn.credentials, dict) else {}
        stored = _norm_uri(str(creds.get("calendly_user_uri") or ""))
        if stored:
            return False
        creds["calendly_user_uri"] = uri
        if user_email and not str(creds.get("calendly_user_email") or "").strip():
            creds["calendly_user_email"] = user_email.strip()
        if user_name and not str(creds.get("calendly_user_name") or "").strip():
            creds["calendly_user_name"] = user_name.strip()
        conn.credentials = creds
        conn.updated_at = datetime.now(timezone.utc)
        return True


def connections_missing_calendly_user_uri(connections: list[Any]) -> list[tuple[int, str]]:
    """(connection_id, api_key) de filas Calendly sin URI persistida."""
    out: list[tuple[int, str]] = []
    for conn in connections:
        creds = conn.credentials if isinstance(getattr(conn, "credentials", None), dict) else {}
        stored = _norm_uri(str(creds.get("calendly_user_uri") or ""))
        api_key = str(creds.get("api_key") or "").strip()
        if stored or not api_key:
            continue
        out.append((int(conn.id), api_key))
    return out


def backfill_calendly_user_uris(targets: list[tuple[int, str]]) -> int:
    """Resuelve /users/me y persiste URI. Devuelve cuántas filas se escribieron."""
    written = 0
    for conn_id, api_key in targets:
        ident = fetch_calendly_user_identity(api_key)
        uri = ident.get("calendly_user_uri") or ""
        if not uri:
            continue
        if persist_calendly_user_uri_if_missing(
            conn_id,
            uri,
            user_email=ident.get("calendly_user_email") or "",
            user_name=ident.get("calendly_user_name") or "",
        ):
            written += 1
            logger.info("calendly_user_uri backfill connection_id=%s", conn_id)
    return written


def ensure_calendly_webhook_subscription(api_key: str, public_site_url: str) -> dict:
    """
    Crea (si no existe) la suscripción de webhook invitee.created apuntando a
    {public_site_url}/api/webhooks/calendly.

    Devuelve un dict para mergear en las credenciales guardadas:
      {"webhook_subscription_uri": "...", "signing_key": "..."}
    o {} si algo falló (no debe romper el flujo de guardado de la conexión).
    """
    if not api_key or not public_site_url:
        return {}

    target_url = f"{public_site_url.rstrip('/')}/api/webhooks/calendly"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            me = client.get(f"{_CALENDLY_API}/users/me", headers=headers)
            me.raise_for_status()
            resource = me.json().get("resource") or {}
            user_uri = str(resource.get("uri") or "").strip()
            org_uri = str(resource.get("current_organization") or "").strip()
            user_email = str(resource.get("email") or "").strip()
            user_name = str(resource.get("name") or "").strip()
            if not user_uri or not org_uri:
                logger.warning(
                    "Calendly /users/me sin user_uri u organization; no se registra webhook"
                )
                return {}

            def _identity_fields() -> dict[str, str]:
                out: dict[str, str] = {"calendly_user_uri": user_uri}
                if user_email:
                    out["calendly_user_email"] = user_email
                if user_name:
                    out["calendly_user_name"] = user_name
                return out

            existing = client.get(
                f"{_CALENDLY_API}/webhook_subscriptions",
                headers=headers,
                params={"organization": org_uri, "scope": "user", "user": user_uri},
            )
            existing.raise_for_status()
            for sub in existing.json().get("collection") or []:
                if not isinstance(sub, dict):
                    continue
                callback = str(sub.get("callback_url") or sub.get("url") or "").strip()
                state = str(sub.get("state") or "").strip().casefold()
                if callback == target_url and state == "active":
                    uri = str(sub.get("uri") or "").strip()
                    if not uri:
                        return _identity_fields()
                    return {"webhook_subscription_uri": uri, **_identity_fields()}

            created = client.post(
                f"{_CALENDLY_API}/webhook_subscriptions",
                headers=headers,
                json={
                    "url": target_url,
                    "events": ["invitee.created"],
                    "organization": org_uri,
                    "user": user_uri,
                    "scope": "user",
                },
            )
            created.raise_for_status()
            payload = created.json().get("resource") or {}
            uri = str(payload.get("uri") or "").strip()
            if not uri:
                return _identity_fields()
            result: dict[str, str] = {"webhook_subscription_uri": uri, **_identity_fields()}
            signing_key = str(payload.get("signing_key") or "").strip()
            if signing_key:
                result["signing_key"] = signing_key
            return result
    except Exception:
        logger.warning("No se pudo auto-registrar el webhook de Calendly", exc_info=True)
        return {}
