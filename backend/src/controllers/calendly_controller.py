"""Calendly: sync manual vía API v2 (PAT en ApiConnection)."""

from __future__ import annotations

import calendar
import re
import time
from datetime import datetime
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pony.orm import ObjectNotFound, db_session
from pydantic import BaseModel, Field

from src.controllers.webhook_controller import (
    _apply_calendly_form_fields,
    _extract_calendly_form_fields,
    _merge_calendly_email_notas,
    _parse_calendly_start_time,
)
from src.lead_display_utils import compute_dias_para_agendar
from src.models import ApiConnection, Lead
from src.services.calendly_event_type_filter import (
    extract_event_type_uri,
    is_event_type_allowed,
)
from src.services.calendly_webhook_service import persist_calendly_user_uri_if_missing
from src.services.lead_agenda_utils import lead_is_cuota_plazo
from src.services.lead_statuses_services import booking_lead_status_name

router = APIRouter(prefix="/calendly", tags=["calendly"], redirect_slashes=False)

_CALENDLY_API = "https://api.calendly.com"
_MAX_EVENT_PAGES = 1
_MAX_EVENT_PAGES_MONTH = 5
_PAGE_COUNT = 20
_INVITEE_REQUEST_DELAY_S = 0.3
_RATE_LIMIT_MESSAGE = "Rate limit de Calendly alcanzado. Esperá 1 minuto y volvé a intentar."
_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
CALENDLY_AUTO_INTERVAL_HOURS = 6


class CalendlySyncRequest(BaseModel):
    month: str | None = Field(default=None, description="YYYY-MM opcional para filtrar eventos")
    account_key: str | None = Field(
        default=None,
        description='Cuenta Calendly: "clienta", "closer", etc. Si omite, sincroniza todas.',
    )


class CalendlyRateLimitError(Exception):
    pass


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _uid_int(user_id: str) -> int:
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.")


def _rows_for_user(user_id: int) -> list[Lead]:
    return [r for r in list(Lead.select()) if int(r.user_id) == user_id]


def _uri_uuid(uri: str) -> str:
    return str(uri or "").strip().rstrip("/").split("/")[-1]


def _month_time_bounds(month: str) -> tuple[str, str]:
    match = _MONTH_RE.match(month.strip())
    if not match:
        raise HTTPException(status_code=400, detail="month debe tener formato YYYY-MM.")
    year = int(match.group(1))
    mon = int(match.group(2))
    if mon < 1 or mon > 12:
        raise HTTPException(status_code=400, detail="month debe tener formato YYYY-MM.")
    last_day = calendar.monthrange(year, mon)[1]
    min_start = f"{year:04d}-{mon:02d}-01T00:00:00Z"
    max_start = f"{year:04d}-{mon:02d}-{last_day:02d}T23:59:59Z"
    return min_start, max_start


def _resolve_sync_month(body: CalendlySyncRequest | None, month_query: str | None) -> str | None:
    raw = ""
    if body and body.month:
        raw = body.month.strip()
    elif month_query:
        raw = month_query.strip()
    return raw or None


def _email_from_notas(notas: str | None) -> str:
    for line in (notas or "").splitlines():
        match = re.match(r"Calendly email:\s*(.+)", line.strip(), re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def _find_lead_by_email(user_id: int, email: str) -> Lead | None:
    key = email.strip().casefold()
    if not key:
        return None
    matches: list[Lead] = []
    for row in _rows_for_user(user_id):
        if lead_is_cuota_plazo(row):
            continue
        stored_email = (row.email or "").strip()
        stored_notes = _email_from_notas(row.notas)
        if (stored_email and stored_email.casefold() == key) or (
            stored_notes and stored_notes.casefold() == key
        ):
            matches.append(row)
    if not matches:
        return None
    matches.sort(key=lambda r: r.created_at.timestamp() if r.created_at else 0.0, reverse=True)
    return matches[0]


def _retry_after_seconds(response: httpx.Response) -> float:
    raw = str(response.headers.get("Retry-After") or "").strip()
    if not raw:
        return 60.0
    try:
        return max(float(raw), 0.0)
    except ValueError:
        return 60.0


def _calendly_get(
    client: httpx.Client,
    headers: dict[str, str],
    *,
    url: str | None = None,
    path: str = "",
    params: dict | None = None,
    retried: bool = False,
) -> dict:
    if url:
        request_url = url
        request_params = None
    else:
        request_url = path if path.startswith("http") else f"{_CALENDLY_API}{path}"
        request_params = params
    try:
        response = client.get(request_url, headers=headers, params=request_params)
        if response.status_code == 429:
            if not retried:
                time.sleep(_retry_after_seconds(response))
                return _calendly_get(
                    client,
                    headers,
                    url=url,
                    path=path,
                    params=params,
                    retried=True,
                )
            raise CalendlyRateLimitError
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}
    except CalendlyRateLimitError:
        raise
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            raise CalendlyRateLimitError from exc
        detail = ""
        try:
            detail = exc.response.text[:500]
        except Exception:
            pass
        if exc.response.status_code in (401, 403):
            raise HTTPException(
                status_code=502,
                detail="Calendly rechazó el Personal Access Token (revisá que sea válido y tenga permisos).",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=f"Error Calendly {exc.response.status_code}: {detail}",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo contactar a Calendly: {exc!s}") from exc


def _pagination_next_page(data: dict) -> str:
    pagination = data.get("pagination") if isinstance(data.get("pagination"), dict) else {}
    return str(pagination.get("next_page") or "").strip()


def _fetch_scheduled_events(
    client: httpx.Client,
    headers: dict[str, str],
    *,
    user_uri: str,
    org_uri: str,
    month: str | None = None,
    max_pages: int | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    min_start: str | None = None
    max_start: str | None = None
    if month:
        min_start, max_start = _month_time_bounds(month)
    pages = max_pages if max_pages is not None else (_MAX_EVENT_PAGES_MONTH if month else _MAX_EVENT_PAGES)
    next_page_url: str | None = None

    for _ in range(pages):
        if next_page_url:
            data = _calendly_get(client, headers, url=next_page_url)
        else:
            params: dict[str, str | int] = {
                "user": user_uri,
                "count": _PAGE_COUNT,
                "sort": "start_time:desc",
            }
            if org_uri:
                params["organization"] = org_uri
            if min_start and max_start:
                params["min_start_time"] = min_start
                params["max_start_time"] = max_start
            data = _calendly_get(client, headers, path="/scheduled_events", params=params)

        collection = data.get("collection") or []
        if isinstance(collection, list):
            events.extend(item for item in collection if isinstance(item, dict))

        next_page_url = _pagination_next_page(data)
        if not next_page_url:
            break

    return events


def _naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def _event_activity_at(event: dict[str, Any]) -> datetime | None:
    for key in ("updated_at", "created_at"):
        dt = _naive_utc(_parse_calendly_start_time(str(event.get(key) or "")))
        if dt is not None:
            return dt
    return None


def _event_is_newer_than(event: dict[str, Any], since: datetime | None) -> bool:
    if since is None:
        return True
    activity = _event_activity_at(event)
    if activity is None:
        return True
    return activity > since


def _calendly_rows_for_user(uid: int) -> list[ApiConnection]:
    rows = [
        c
        for c in list(ApiConnection.select())
        if int(c.user_id) == uid and str(c.platform or "").strip().casefold() == "calendly"
    ]
    rows.sort(key=lambda c: (str(getattr(c, "account_key", "") or ""), int(c.id)))
    return rows


def _pick_calendly_row(uid: int, account_key: str | None = None) -> ApiConnection:
    rows = _calendly_rows_for_user(uid)
    if not rows:
        raise HTTPException(
            status_code=400,
            detail='No hay conexión Calendly. Configurá la plataforma "calendly" en Conexiones API.',
        )
    if account_key is None or not str(account_key).strip():
        return rows[0]
    key = str(account_key).strip().casefold()
    for row in rows:
        ak = str(getattr(row, "account_key", "") or "").casefold()
        if ak == key or (key == "clienta" and ak in ("", "clienta")):
            return row
    raise HTTPException(
        status_code=404,
        detail=f'No hay conexión Calendly con account_key="{account_key}".',
    )


def _load_calendly_connection(
    uid: int,
    account_key: str | None = None,
) -> tuple[int, str, dict[str, Any], datetime | None]:
    """Devuelve (connection_id, account_key, creds, last_sync)."""
    with db_session:
        conn = _pick_calendly_row(uid, account_key=account_key)
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        api_key = str(creds.get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Falta api_key (Personal Access Token) en las credenciales de Calendly.",
            )
        last_sync = conn.last_sync_at
        if last_sync is not None and last_sync.tzinfo is not None:
            last_sync = last_sync.replace(tzinfo=None)
        ak = str(getattr(conn, "account_key", "") or "") or "clienta"
        return int(conn.id), ak, dict(creds), last_sync


def _list_calendly_connection_targets(uid: int) -> list[tuple[int, str]]:
    """Lista (connection_id, account_key) con PAT para sync multi-cuenta."""
    with db_session:
        out: list[tuple[int, str]] = []
        for row in _calendly_rows_for_user(uid):
            creds = row.credentials if isinstance(row.credentials, dict) else {}
            if not str(creds.get("api_key") or "").strip():
                continue
            ak = str(getattr(row, "account_key", "") or "") or "clienta"
            out.append((int(row.id), ak))
        return out


def _set_calendly_last_check(connection_id: int, *, has_pending: bool) -> None:
    with db_session:
        try:
            conn = ApiConnection.get(id=connection_id)
        except ObjectNotFound:
            return
        if conn is None:
            return
        creds = dict(conn.credentials) if isinstance(conn.credentials, dict) else {}
        now = datetime.utcnow()
        creds["last_check_at"] = now.isoformat() + "Z"
        creds["last_check_has_pending"] = "1" if has_pending else "0"
        conn.credentials = creds
        conn.updated_at = now


def check_calendly_pending(uid: int, account_key: str | None = None) -> dict[str, Any]:
    """Revisa Calendly (1 página de eventos) sin traer invitees ni escribir leads."""
    conn_id, ak, creds, last_sync = _load_calendly_connection(uid, account_key=account_key)
    api_key = str(creds.get("api_key") or "").strip()
    headers = {"Authorization": f"Bearer {api_key}"}

    with httpx.Client(timeout=45.0) as client:
        me = _calendly_get(client, headers, path="/users/me")
        resource = me.get("resource") if isinstance(me.get("resource"), dict) else {}
        user_uri = str(resource.get("uri") or "").strip()
        org_uri = str(resource.get("current_organization") or "").strip()
        if not user_uri:
            raise HTTPException(status_code=502, detail="Calendly no devolvió current_user.uri.")
        persist_calendly_user_uri_if_missing(
            conn_id,
            user_uri,
            user_email=str(resource.get("email") or ""),
            user_name=str(resource.get("name") or ""),
        )

        if last_sync is None:
            _set_calendly_last_check(conn_id, has_pending=True)
            return {
                "has_pending": True,
                "reason": "never_synced",
                "last_sync_at": None,
                "events_scanned": 0,
                "account_key": ak,
                "connection_id": conn_id,
            }

        events = _fetch_scheduled_events(
            client,
            headers,
            user_uri=user_uri,
            org_uri=org_uri,
            month=None,
            max_pages=1,
        )
        pending_events = [
            e
            for e in events
            if _event_is_newer_than(e, last_sync)
            and is_event_type_allowed(creds, extract_event_type_uri(e))
        ]
        has_pending = len(pending_events) > 0
        _set_calendly_last_check(conn_id, has_pending=has_pending)
        return {
            "has_pending": has_pending,
            "reason": "new_events" if has_pending else "up_to_date",
            "last_sync_at": last_sync.isoformat() + "Z",
            "events_scanned": len(events),
            "pending_events": len(pending_events),
            "account_key": ak,
            "connection_id": conn_id,
        }


def _fetch_event_invitees(
    client: httpx.Client,
    headers: dict[str, str],
    event_uuid: str,
) -> list[dict[str, Any]]:
    invitees: list[dict[str, Any]] = []
    next_page_url: str | None = None

    for page_index in range(_MAX_EVENT_PAGES):
        if page_index > 0:
            time.sleep(_INVITEE_REQUEST_DELAY_S)
        if next_page_url:
            data = _calendly_get(client, headers, url=next_page_url)
        else:
            data = _calendly_get(
                client,
                headers,
                path=f"/scheduled_events/{event_uuid}/invitees",
                params={"count": _PAGE_COUNT},
            )

        collection = data.get("collection") or []
        if isinstance(collection, list):
            invitees.extend(item for item in collection if isinstance(item, dict))

        next_page_url = _pagination_next_page(data)
        if not next_page_url:
            break

    return invitees


@db_session
def _apply_invitee_to_lead(
    user_id: int,
    *,
    name: str,
    email: str,
    call_at: datetime | None,
    agendo_at: datetime | None,
    form_fields: dict[str, str] | None = None,
    calendly_account_key: str | None = None,
) -> str:
    """Returns 'created' or 'updated'."""
    display_name = name.strip() or (email.split("@")[0] if email else "Invitado Calendly")
    row = _find_lead_by_email(user_id, email) if email else None
    fields = form_fields or {}
    account_key = (calendly_account_key or "").strip().casefold()

    if row is not None:
        if display_name:
            row.nombre = display_name
        if email:
            row.email = email
            row.notas = _merge_calendly_email_notas(row.notas, email)
        if call_at is not None:
            row.call = call_at
        if agendo_at is not None:
            row.agendo = agendo_at
        booking = booking_lead_status_name(user_id)
        row.status = booking
        row.estado = booking
        row.agendo_en = "Calendly"
        if account_key:
            row.calendly_account_key = account_key
        _apply_calendly_form_fields(row, fields)
        row.dias_para_agendar = compute_dias_para_agendar(row.primer_contacto, row.agendo)
        return "updated"

    notas_parts: list[str] = []
    if email:
        notas_parts.append(f"Calendly email: {email}")
    if call_at is not None:
        notas_parts.append(f"Cita: {call_at.isoformat()}")

    booking = booking_lead_status_name(user_id)
    row = Lead(
        user_id=user_id,
        nombre=display_name,
        email=email or "",
        notas="\n".join(notas_parts),
        call=call_at,
        agendo=agendo_at or call_at,
        status=booking,
        estado=booking,
        agendo_en="Calendly",
        calendly_account_key=account_key,
    )
    _apply_calendly_form_fields(row, fields)
    return "created"


@router.get("/auto-sync-status")
def calendly_auto_sync_status(
    user_id: Annotated[str, Depends(require_user_id)],
    account_key: Annotated[str | None, Query()] = None,
):
    """Estado del auto-sync (sin pegarle a Calendly)."""
    uid = _uid_int(user_id)
    with db_session:
        conn = _pick_calendly_row(uid, account_key=account_key)
        creds = conn.credentials if isinstance(conn.credentials, dict) else {}
        last_sync = conn.last_sync_at
        last_check_at = str(creds.get("last_check_at") or "").strip() or None
        last_check_has_pending = str(creds.get("last_check_has_pending") or "").strip() == "1"
        has_key = bool(str(creds.get("api_key") or "").strip())
        ak = str(getattr(conn, "account_key", "") or "") or "clienta"
        conn_id = int(conn.id)

    next_run: str | None = None
    try:
        from src.services.sync_scheduler_service import CALENDLY_JOB_ID, next_job_run_time
        from src.services.sync_settings_service import get_calendly_interval_minutes

        interval_minutes = get_calendly_interval_minutes()
        nxt = next_job_run_time(CALENDLY_JOB_ID)
        if nxt is not None:
            next_run = nxt.isoformat()
    except Exception:
        interval_minutes = CALENDLY_AUTO_INTERVAL_HOURS * 60
        next_run = None

    return {
        "enabled": has_key,
        "interval_hours": max(1, round(interval_minutes / 60)),
        "interval_minutes": interval_minutes,
        "last_sync_at": last_sync.isoformat() + "Z" if last_sync else None,
        "last_check_at": last_check_at,
        "last_check_has_pending": last_check_has_pending,
        "next_run_at": next_run,
        "account_key": ak,
        "connection_id": conn_id,
    }


@router.get("/check-pending")
def calendly_check_pending(
    user_id: Annotated[str, Depends(require_user_id)],
    account_key: Annotated[str | None, Query()] = None,
):
    """Consulta liviana a Calendly: ¿hay eventos nuevos desde la última sync?"""
    uid = _uid_int(user_id)
    try:
        return check_calendly_pending(uid, account_key=account_key)
    except CalendlyRateLimitError:
        return JSONResponse(status_code=429, content={"error": _RATE_LIMIT_MESSAGE})


@router.post("/sync")
def sync_calendly(
    user_id: Annotated[str, Depends(require_user_id)],
    body: CalendlySyncRequest | None = None,
    month: str | None = Query(default=None, description="YYYY-MM opcional"),
):
    uid = _uid_int(user_id)
    sync_month = _resolve_sync_month(body, month)
    account_key = body.account_key if body is not None else None
    try:
        return _run_calendly_sync(
            uid,
            month=sync_month,
            only_newer_than_last_sync=False,
            account_key=account_key,
        )
    except CalendlyRateLimitError:
        return JSONResponse(status_code=429, content={"error": _RATE_LIMIT_MESSAGE})


def _run_calendly_sync_one(
    uid: int,
    *,
    account_key: str,
    month: str | None = None,
    only_newer_than_last_sync: bool = False,
) -> dict[str, Any]:
    conn_id, ak, creds, last_sync = _load_calendly_connection(uid, account_key=account_key)
    api_key = str(creds.get("api_key") or "").strip()
    headers = {"Authorization": f"Bearer {api_key}"}
    since = last_sync if only_newer_than_last_sync else None
    created = 0
    updated = 0
    events_skipped = 0

    with httpx.Client(timeout=60.0) as client:
        me = _calendly_get(client, headers, path="/users/me")
        resource = me.get("resource") if isinstance(me.get("resource"), dict) else {}
        user_uri = str(resource.get("uri") or "").strip()
        org_uri = str(resource.get("current_organization") or "").strip()
        if not user_uri:
            raise HTTPException(status_code=502, detail="Calendly no devolvió current_user.uri.")
        persist_calendly_user_uri_if_missing(
            conn_id,
            user_uri,
            user_email=str(resource.get("email") or ""),
            user_name=str(resource.get("name") or ""),
        )

        events = _fetch_scheduled_events(
            client,
            headers,
            user_uri=user_uri,
            org_uri=org_uri,
            month=month,
        )

        pending: list[dict[str, Any]] = []
        invitee_request_count = 0
        for event in events:
            if since is not None and not _event_is_newer_than(event, since):
                events_skipped += 1
                continue

            event_type_uri = extract_event_type_uri(event)
            if not is_event_type_allowed(creds, event_type_uri):
                events_skipped += 1
                continue

            event_uuid = _uri_uuid(str(event.get("uri") or ""))
            if not event_uuid:
                continue
            start_dt = _parse_calendly_start_time(str(event.get("start_time") or ""))
            if invitee_request_count > 0:
                time.sleep(_INVITEE_REQUEST_DELAY_S)
            invitee_request_count += 1
            invitees = _fetch_event_invitees(client, headers, event_uuid)

            for invitee in invitees:
                status = str(invitee.get("status") or "active").strip().casefold()
                if status == "canceled":
                    continue

                email = str(invitee.get("email") or "").strip()
                if not email:
                    continue

                pending.append(
                    {
                        "name": str(invitee.get("name") or "").strip(),
                        "email": email,
                        "call_at": start_dt,
                        "agendo_at": _parse_calendly_start_time(str(invitee.get("created_at") or "")),
                        "form_fields": _extract_calendly_form_fields(invitee, invitee),
                    }
                )

    for item in pending:
        result = _apply_invitee_to_lead(
            uid,
            name=item["name"],
            email=item["email"],
            call_at=item["call_at"],
            agendo_at=item["agendo_at"],
            form_fields=item.get("form_fields") or {},
            calendly_account_key=ak,
        )
        if result == "created":
            created += 1
        else:
            updated += 1

    _touch_calendly_last_sync(conn_id)
    _set_calendly_last_check(conn_id, has_pending=False)

    synced = created + updated
    return {
        "synced": synced,
        "created": created,
        "updated": updated,
        "month": month,
        "events_skipped": events_skipped,
        "only_newer": only_newer_than_last_sync,
        "account_key": ak,
        "connection_id": conn_id,
    }


def _run_calendly_sync(
    uid: int,
    *,
    month: str | None = None,
    only_newer_than_last_sync: bool = False,
    account_key: str | None = None,
) -> dict[str, Any]:
    """Sync de una cuenta (account_key) o de todas las conexiones Calendly del usuario."""
    if account_key is not None and str(account_key).strip():
        return _run_calendly_sync_one(
            uid,
            account_key=str(account_key).strip(),
            month=month,
            only_newer_than_last_sync=only_newer_than_last_sync,
        )

    targets = _list_calendly_connection_targets(uid)
    if not targets:
        raise HTTPException(
            status_code=400,
            detail='No hay conexión Calendly. Configurá la plataforma "calendly" en Conexiones API.',
        )

    accounts: list[dict[str, Any]] = []
    created = 0
    updated = 0
    events_skipped = 0
    for _conn_id, ak in targets:
        one = _run_calendly_sync_one(
            uid,
            account_key=ak,
            month=month,
            only_newer_than_last_sync=only_newer_than_last_sync,
        )
        accounts.append(one)
        created += int(one.get("created") or 0)
        updated += int(one.get("updated") or 0)
        events_skipped += int(one.get("events_skipped") or 0)

    return {
        "synced": created + updated,
        "created": created,
        "updated": updated,
        "month": month,
        "events_skipped": events_skipped,
        "only_newer": only_newer_than_last_sync,
        "accounts": accounts,
    }


def run_calendly_auto_sync_for_user(uid: int) -> dict[str, Any]:
    """Por cada conexión Calendly: check liviano → sync solo si hay pendientes."""
    targets = _list_calendly_connection_targets(uid)
    if not targets:
        return {"user_id": uid, "skipped": True, "reason": "no_connection"}

    accounts: list[dict[str, Any]] = []
    any_synced = False
    for _conn_id, ak in targets:
        try:
            check = check_calendly_pending(uid, account_key=ak)
        except CalendlyRateLimitError:
            accounts.append({"account_key": ak, "skipped": True, "reason": "rate_limit"})
            continue
        except HTTPException as exc:
            accounts.append({"account_key": ak, "skipped": True, "reason": str(exc.detail)})
            continue

        if not check.get("has_pending"):
            accounts.append(
                {"account_key": ak, "skipped": True, "reason": "up_to_date", "check": check}
            )
            continue

        try:
            result = _run_calendly_sync_one(
                uid,
                account_key=ak,
                month=None,
                only_newer_than_last_sync=True,
            )
        except CalendlyRateLimitError:
            accounts.append(
                {"account_key": ak, "skipped": True, "reason": "rate_limit", "check": check}
            )
            continue

        any_synced = True
        accounts.append(
            {"account_key": ak, "skipped": False, "check": check, "sync": result}
        )

    return {
        "user_id": uid,
        "skipped": not any_synced,
        "reason": "ok" if any_synced else "all_up_to_date_or_errors",
        "accounts": accounts,
    }


def list_calendly_user_ids_with_token() -> list[int]:
    with db_session:
        rows = list(
            ApiConnection.select_by_sql(
                "SELECT * FROM apiconnection WHERE platform = $platform",
                {"platform": "calendly"},
            )
        )
        seen: set[int] = set()
        out: list[int] = []
        for row in rows:
            creds = row.credentials if isinstance(row.credentials, dict) else {}
            if str(creds.get("api_key") or "").strip():
                uid = int(row.user_id)
                if uid not in seen:
                    seen.add(uid)
                    out.append(uid)
        return out


@db_session
def _touch_calendly_last_sync(connection_id: int) -> None:
    try:
        conn_row = ApiConnection.get(id=connection_id)
        if conn_row is None:
            return
        now = datetime.utcnow()
        conn_row.last_sync_at = now
        conn_row.updated_at = now
    except ObjectNotFound:
        pass
