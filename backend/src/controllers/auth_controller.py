import hmac
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
from decouple import config
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pony.orm import db_session

from src.models import AuthUser
from src.schemas import (
    AuthChangePasswordRequest,
    AuthChangePasswordResponse,
    AuthLoginRequest,
    AuthMeResponse,
    AuthRegisterRequest,
    AuthTokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

_INSECURE_JWT_SECRETS = {"", "change-this-secret"}
_INSECURE_REGISTER_KEYS = {"", "change-this-register-key"}

JWT_SECRET = (config("JWT_SECRET", default="") or "").strip()
if JWT_SECRET in _INSECURE_JWT_SECRETS:
    raise RuntimeError(
        "JWT_SECRET no está configurado (o usa el valor por defecto inseguro). "
        "Definilo en el .env antes de levantar el backend."
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = config("JWT_EXPIRE_MINUTES", cast=int, default=60 * 24)
REGISTER_ADMIN_KEY = (config("REGISTER_ADMIN_KEY", default="") or "").strip()


def _create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.post("/register", response_model=AuthTokenResponse)
def register_user(
    body: AuthRegisterRequest,
    x_register_admin_key: Annotated[str | None, Header(alias="X-Register-Admin-Key")] = None,
):
    # Registro cerrado: solo con REGISTER_ADMIN_KEY configurada y enviada en el header.
    if REGISTER_ADMIN_KEY in _INSECURE_REGISTER_KEYS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Registro deshabilitado")
    if not x_register_admin_key or not hmac.compare_digest(
        x_register_admin_key.strip().encode("utf-8"), REGISTER_ADMIN_KEY.encode("utf-8")
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Registro no autorizado")

    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        existing = AuthUser.get(username=username)
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = AuthUser(username=username, password_hash=password_hash, updated_at=datetime.utcnow())
        user.flush()
        uid = user.id

    return AuthTokenResponse(access_token=_create_access_token(username), user_id=uid)


@router.post("/login", response_model=AuthTokenResponse)
def login_user(body: AuthLoginRequest):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        user = AuthUser.get(username=username)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        valid_password = bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
        if not valid_password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        uid = user.id

    return AuthTokenResponse(access_token=_create_access_token(username), user_id=uid)


def get_current_username(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


def get_current_user_id(username: str = Depends(get_current_username)) -> int:
    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user.id


def require_user_id(
    token_user_id: Annotated[int, Depends(get_current_user_id)],
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    """Id del usuario autenticado, tomado del JWT (Authorization: Bearer).

    X-User-Id es opcional; si viene y no coincide con el token, se rechaza.
    """
    if x_user_id is not None and x_user_id.strip() and x_user_id.strip() != str(token_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="X-User-Id no coincide con el usuario autenticado.",
        )
    return str(token_user_id)


@router.get("/me", response_model=AuthMeResponse)
def me(username: str = Depends(get_current_username)):
    return AuthMeResponse(username=username)


@router.post("/change-password", response_model=AuthChangePasswordResponse)
def change_password(
    body: AuthChangePasswordRequest,
    username: str = Depends(get_current_username),
):
    current_password = body.current_password
    new_password = body.new_password
    if not current_password or not new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="current_password and new_password are required",
        )
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 6 caracteres",
        )

    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        valid_password = bcrypt.checkpw(
            current_password.encode("utf-8"),
            user.password_hash.encode("utf-8"),
        )
        if not valid_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contraseña actual incorrecta",
            )

        if bcrypt.checkpw(new_password.encode("utf-8"), user.password_hash.encode("utf-8")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La nueva contraseña debe ser distinta a la actual",
            )

        user.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user.updated_at = datetime.utcnow()

    return AuthChangePasswordResponse()
