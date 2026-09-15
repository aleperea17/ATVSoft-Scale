"""Filtro de event types de Calendly (allowlist fail-closed)."""

from __future__ import annotations

import re
from typing import Any


def parse_event_type_allowlist(creds: dict[str, Any] | None) -> list[str]:
    """URIs permitidas desde credentials['event_type_allowlist'] (separadas por coma/salto/espacio)."""
    raw = str((creds or {}).get("event_type_allowlist") or "")
    out: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[\s,;]+", raw):
        uri = part.strip().rstrip("/")
        if not uri or uri in seen:
            continue
        seen.add(uri)
        out.append(uri)
    return out


def extract_event_type_uri(*sources: Any) -> str:
    """Saca la URI de event_type de un scheduled event / event de Calendly."""
    for src in sources:
        if not isinstance(src, dict):
            continue
        et = src.get("event_type")
        if isinstance(et, str) and et.strip():
            return et.strip().rstrip("/")
        if isinstance(et, dict):
            uri = str(et.get("uri") or "").strip()
            if uri:
                return uri.rstrip("/")
        scheduled = src.get("scheduled_event")
        if isinstance(scheduled, dict):
            nested = extract_event_type_uri(scheduled)
            if nested:
                return nested
    return ""


def is_event_type_allowed(creds: dict[str, Any] | None, event_type_uri: str | None) -> bool:
    """
    True solo si hay allowlist no vacía y la URI está en ella.
    Allowlist vacía → False (fail-closed: no sincronizar nada).
    """
    allow = parse_event_type_allowlist(creds)
    if not allow:
        return False
    key = (event_type_uri or "").strip().rstrip("/")
    if not key:
        return False
    return key in set(allow)
