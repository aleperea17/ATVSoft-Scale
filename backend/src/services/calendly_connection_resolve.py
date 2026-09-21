"""Resolución de conexión Calendly multi-cuenta + hosts del payload."""

from __future__ import annotations

from typing import Any


def _norm_uri(uri: str | None) -> str:
    return (uri or "").strip().rstrip("/")


def extract_calendly_host_uris(*sources: Any) -> list[str]:
    """URIs de usuarios host/organizador del evento (event_memberships, created_by, etc.)."""
    found: list[str] = []
    seen: set[str] = set()

    def add(raw: Any) -> None:
        if isinstance(raw, dict):
            raw = raw.get("uri") or raw.get("user")
        u = _norm_uri(str(raw or ""))
        if u and u not in seen:
            seen.add(u)
            found.append(u)

    for src in sources:
        if not isinstance(src, dict):
            continue
        add(src.get("created_by"))
        add(src.get("user"))
        scheduled = src.get("scheduled_event")
        if isinstance(scheduled, dict):
            add(scheduled.get("created_by"))
            memberships = scheduled.get("event_memberships") or []
            if isinstance(memberships, list):
                for m in memberships:
                    if isinstance(m, dict):
                        add(m.get("user"))
        memberships2 = src.get("event_memberships") or []
        if isinstance(memberships2, list):
            for m in memberships2:
                if isinstance(m, dict):
                    add(m.get("user"))
    return found


def match_calendly_connection(
    connections: list[Any],
    host_uris: list[str],
) -> Any | None:
    """
    Elige ApiConnection cuya credentials.calendly_user_uri matchea algún host del evento.
    No hace fallback a la primera conexión.
    """
    hosts = {_norm_uri(u) for u in host_uris if _norm_uri(u)}
    if not hosts:
        return None
    for conn in connections:
        creds = conn.credentials if isinstance(getattr(conn, "credentials", None), dict) else {}
        stored = _norm_uri(str(creds.get("calendly_user_uri") or ""))
        if stored and stored in hosts:
            return conn
    return None
