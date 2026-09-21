from datetime import datetime, timedelta, timezone
import re

from fastapi import HTTPException
from pony.orm import db_session

from src.env_public import public_site_url
from src.models import ApiConnection
from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest
from src.services.anthropic_service import invalidate_claude_status_cache
from src.services.calendly_webhook_service import ensure_calendly_webhook_subscription

_CALENDLY_CREDENTIAL_KEYS = frozenset(
    {
        "api_key",
        "signing_key",
        "webhook_subscription_uri",
        "event_type_allowlist",
        "calendly_user_uri",
        "calendly_user_email",
        "calendly_user_name",
        "account_label",
    }
)

_ACCOUNT_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def normalize_account_key(platform: str, raw: str | None) -> str:
    """Calendly: key no vacía (default clienta). Otras plataformas: ''."""
    pl = (platform or "").strip().casefold()
    key = (raw or "").strip().casefold()
    if pl != "calendly":
        return ""
    if not key:
        return "clienta"
    if not _ACCOUNT_KEY_RE.match(key):
        raise HTTPException(
            status_code=400,
            detail='account_key inválido (usar letras/números/_/-, ej. "clienta" o "closer").',
        )
    return key


def _sanitize_calendly_credentials(creds: dict) -> dict:
    """Solo persiste keys conocidas de Calendly; ignora q_* legacy."""
    return {k: str(v) if v is not None else "" for k, v in creds.items() if k in _CALENDLY_CREDENTIAL_KEYS}


def _enrich_calendly_webhook_credentials(credentials: dict) -> dict:
    """Registra webhook + calendly_user_uri; nunca falla el upsert si Calendly falla."""
    new_key = str(credentials.get("api_key") or "").strip()
    if not new_key:
        return credentials
    webhook_data = ensure_calendly_webhook_subscription(new_key, public_site_url())
    if not webhook_data:
        return credentials
    return {**credentials, **webhook_data}


class ConexionesServices:
    @staticmethod
    def _iso_utc(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat()

    def _to_response(self, row: ApiConnection) -> ApiConnectionResponse:
        creds = row.credentials if isinstance(row.credentials, dict) else {}
        return ApiConnectionResponse(
            id=str(row.id),
            user_id=str(row.user_id),
            platform=row.platform,
            account_key=str(getattr(row, "account_key", "") or ""),
            credentials=creds,
            last_sync_at=row.last_sync_at,
            updated_at=row.updated_at,
        )

    def list_by_user(self, user_id: int) -> list[ApiConnectionResponse]:
        with db_session:
            rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            rows.sort(
                key=lambda r: (
                    str(r.platform or ""),
                    str(getattr(r, "account_key", "") or ""),
                    int(r.id),
                )
            )
            return [self._to_response(r) for r in rows]

    def _merge_previous_credentials(
        self,
        platform: str,
        incoming: dict,
        previous: dict,
    ) -> dict:
        merged = dict(incoming)
        pl = platform.lower()
        if pl == "instagram":
            previous_token = str(previous.get("access_token") or "").strip()
            incoming_token = str(merged.get("access_token") or "").strip()
            if not incoming_token and previous_token:
                merged["access_token"] = previous_token
        elif pl == "calendly":
            for key in _CALENDLY_CREDENTIAL_KEYS:
                if not str(merged.get(key) or "").strip() and str(previous.get(key) or "").strip():
                    merged[key] = previous[key]
        elif pl == "manychat":
            for key in ("api_key", "webhook_token", "bio_keyword"):
                if not str(merged.get(key) or "").strip() and str(previous.get(key) or "").strip():
                    merged[key] = previous[key]
            for key, val in previous.items():
                if key not in merged:
                    merged[key] = val
        else:
            for key, val in previous.items():
                if key not in merged or not str(merged.get(key) or "").strip():
                    if str(val or "").strip() and not str(merged.get(key) or "").strip():
                        merged[key] = val
        return merged

    def upsert(self, user_id: int, platform: str, body: ApiConnectionUpsertRequest) -> ApiConnectionResponse:
        if not platform.strip():
            raise HTTPException(status_code=400, detail="La plataforma no puede estar vacía.")
        platform = platform.strip()
        account_key = normalize_account_key(platform, body.account_key)
        now = datetime.now(timezone.utc)

        with db_session:
            user_rows = [c for c in list(ApiConnection.select()) if c.user_id == user_id]
            matches = [
                c
                for c in user_rows
                if c.platform == platform
                and str(getattr(c, "account_key", "") or "") == account_key
            ]
            # Legacy: calendly sin account_key en filas viejas migradas a clienta — ya cubierto por migración
            if not matches and platform.lower() == "calendly" and account_key == "clienta":
                matches = [
                    c
                    for c in user_rows
                    if c.platform == platform and str(getattr(c, "account_key", "") or "") in ("", "clienta")
                ]
            matches.sort(key=lambda c: c.id)
            existing = matches[0] if matches else None
            existing_id = int(existing.id) if existing else None
            incoming_credentials = dict(body.credentials or {})
            if platform.lower() == "calendly":
                incoming_credentials = _sanitize_calendly_credentials(incoming_credentials)
                if not str(incoming_credentials.get("account_label") or "").strip():
                    label_map = {"clienta": "Clienta", "closer": "Closer"}
                    incoming_credentials["account_label"] = label_map.get(
                        account_key, account_key.replace("_", " ").title()
                    )
            if existing:
                previous_credentials = existing.credentials if isinstance(existing.credentials, dict) else {}
                incoming_credentials = self._merge_previous_credentials(
                    platform, incoming_credentials, previous_credentials
                )
                if platform.lower() == "instagram":
                    previous_token = str(previous_credentials.get("access_token") or "").strip()
                    incoming_token = str(incoming_credentials.get("access_token") or "").strip()
                    if incoming_token and incoming_token != previous_token:
                        incoming_credentials["token_saved_at"] = self._iso_utc(now)
                        incoming_credentials["token_expires_at"] = self._iso_utc(now + timedelta(days=60))
                    elif incoming_token and incoming_token == previous_token:
                        for key in ("token_saved_at", "token_expires_at"):
                            if key not in incoming_credentials and key in previous_credentials:
                                incoming_credentials[key] = previous_credentials[key]
            elif platform.lower() == "instagram" and str(incoming_credentials.get("access_token") or "").strip():
                incoming_credentials = {
                    **incoming_credentials,
                    "token_saved_at": self._iso_utc(now),
                    "token_expires_at": self._iso_utc(now + timedelta(days=60)),
                }

        if platform.lower() == "calendly":
            incoming_credentials = _enrich_calendly_webhook_credentials(incoming_credentials)

        with db_session:
            if existing_id is not None:
                existing = ApiConnection.get(id=existing_id)
                if existing is None:
                    raise HTTPException(status_code=404, detail="Conexión no encontrada.")
                existing.credentials = incoming_credentials
                existing.account_key = account_key
                existing.updated_at = now
                if platform.lower() == "claude":
                    invalidate_claude_status_cache(user_id)
                return self._to_response(existing)

            row = ApiConnection(
                user_id=user_id,
                platform=platform,
                account_key=account_key,
                credentials=incoming_credentials,
                updated_at=now,
            )
            if platform.lower() == "claude":
                invalidate_claude_status_cache(user_id)
            return self._to_response(row)

    def delete(self, user_id: int, platform: str, account_key: str | None = None) -> None:
        platform = (platform or "").strip()
        if not platform:
            raise HTTPException(status_code=400, detail="La plataforma no puede estar vacía.")
        key = normalize_account_key(platform, account_key)
        with db_session:
            matches = [
                c
                for c in list(ApiConnection.select())
                if int(c.user_id) == user_id
                and c.platform == platform
                and str(getattr(c, "account_key", "") or "") == key
            ]
            if not matches and platform.lower() == "calendly" and key == "clienta":
                matches = [
                    c
                    for c in list(ApiConnection.select())
                    if int(c.user_id) == user_id
                    and c.platform == platform
                    and str(getattr(c, "account_key", "") or "") in ("", "clienta")
                ]
            if not matches:
                raise HTTPException(status_code=404, detail="Conexión no encontrada.")
            matches[0].delete()
            if platform.lower() == "claude":
                invalidate_claude_status_cache(user_id)
