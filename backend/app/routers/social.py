"""People search and the connection graph."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import connection_between, current_user
from ..hub import hub
from ..models import Connection, User
from ..schemas import ConnectionRequestIn, UserPublic
from ..security import now

router = APIRouter(prefix="/api", tags=["people"])


def public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        public_key=user.public_key,
        online=hub.is_online(user.id),
        last_seen_at=user.last_seen_at,
    )


@router.get("/users/search")
async def search(
    q: str = Query(min_length=1, max_length=32),
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    term = q.strip().lower().lstrip("@").replace("%", "").replace("_", r"\_")
    users = (
        await db.execute(
            select(User)
            .where(User.username.like(f"{term}%"), User.email_verified, User.id != me.id)
            .order_by(User.username)
            .limit(20)
        )
    ).scalars().all()

    ids = [u.id for u in users]
    links = (
        await db.execute(
            select(Connection).where(
                or_(
                    (Connection.requester_id == me.id) & Connection.addressee_id.in_(ids),
                    (Connection.addressee_id == me.id) & Connection.requester_id.in_(ids),
                )
            )
        )
    ).scalars().all()
    status_by_user = {}
    for c in links:
        other = c.addressee_id if c.requester_id == me.id else c.requester_id
        if c.status == "accepted":
            status_by_user[other] = "connected"
        else:
            status_by_user[other] = "outgoing" if c.requester_id == me.id else "incoming"

    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "status": status_by_user.get(u.id, "none"),
        }
        for u in users
    ]


@router.get("/connections")
async def list_connections(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Connection, User)
            .join(
                User,
                or_(
                    (Connection.requester_id == me.id) & (User.id == Connection.addressee_id),
                    (Connection.addressee_id == me.id) & (User.id == Connection.requester_id),
                ),
            )
            .order_by(User.display_name)
        )
    ).all()

    out = {"contacts": [], "incoming": [], "outgoing": []}
    for conn, user in rows:
        item = {"connection_id": conn.id, "user": public(user), "since": conn.responded_at or conn.created_at}
        if conn.status == "accepted":
            out["contacts"].append(item)
        elif conn.addressee_id == me.id:
            out["incoming"].append(item)
        else:
            out["outgoing"].append(item)
    return out


@router.post("/connections")
async def request_connection(
    body: ConnectionRequestIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    target = (
        await db.execute(
            select(User).where(User.username == body.username.strip().lower().lstrip("@"), User.email_verified)
        )
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "No one has that username")
    if target.id == me.id:
        raise HTTPException(400, "You can't add yourself")

    conn = (await db.execute(connection_between(me.id, target.id))).scalar_one_or_none()
    if conn and conn.status == "accepted":
        raise HTTPException(409, "You're already connected")
    if conn and conn.requester_id == me.id:
        raise HTTPException(409, "Request already sent")

    if conn:
        # They already asked us: sending a request back accepts theirs.
        conn.status = "accepted"
        conn.responded_at = now()
    else:
        conn = Connection(requester_id=me.id, addressee_id=target.id)
        db.add(conn)
    await db.commit()

    await hub.send_to_users([me.id, target.id], {"type": "connections.changed"})
    return {"status": "connected" if conn.status == "accepted" else "outgoing"}


async def _load_for(db: AsyncSession, connection_id: uuid.UUID, me: User) -> Connection:
    conn = await db.get(Connection, connection_id)
    if not conn or me.id not in (conn.requester_id, conn.addressee_id):
        raise HTTPException(404, "Request not found")
    return conn


@router.post("/connections/{connection_id}/accept")
async def accept(connection_id: uuid.UUID, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    conn = await _load_for(db, connection_id, me)
    if conn.addressee_id != me.id or conn.status != "pending":
        raise HTTPException(400, "Nothing to accept")
    conn.status = "accepted"
    conn.responded_at = now()
    await db.commit()
    await hub.send_to_users([conn.requester_id, conn.addressee_id], {"type": "connections.changed"})
    return {"status": "connected"}


@router.delete("/connections/{connection_id}", status_code=204)
async def remove(connection_id: uuid.UUID, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Decline, cancel, or disconnect, depending on the state."""
    conn = await _load_for(db, connection_id, me)
    await db.delete(conn)
    await db.commit()
    await hub.send_to_users([conn.requester_id, conn.addressee_id], {"type": "connections.changed"})
