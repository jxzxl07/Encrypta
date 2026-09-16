import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .models import Connection, User
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_access_token(creds.credentials) if creds else None
    if not payload or payload.get("role") != "user":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.email_verified:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return user


def current_admin(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    payload = decode_access_token(creds.credentials) if creds else None
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin sign-in required")
    return payload["sub"]


def connection_between(a: uuid.UUID, b: uuid.UUID):
    return select(Connection).where(
        or_(
            and_(Connection.requester_id == a, Connection.addressee_id == b),
            and_(Connection.requester_id == b, Connection.addressee_id == a),
        )
    )


async def are_connected(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    conn = (await db.execute(connection_between(a, b))).scalar_one_or_none()
    return conn is not None and conn.status == "accepted"


async def contact_ids(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(
        select(Connection.requester_id, Connection.addressee_id).where(
            Connection.status == "accepted",
            or_(Connection.requester_id == user_id, Connection.addressee_id == user_id),
        )
    )
    return [b if a == user_id else a for a, b in rows.all()]
