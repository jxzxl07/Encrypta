"""WebSocket for presence, live message delivery and WebRTC call signalling."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update

from ..config import get_settings
from ..db import SessionLocal
from ..deps import are_connected, contact_ids
from ..hub import Session, hub
from ..models import GroupMember, User
from ..security import decode_access_token, now

router = APIRouter(tags=["realtime"])
log = logging.getLogger("encrypta.ws")

# Call signalling envelopes relayed verbatim between connected contacts.
CALL_EVENTS = {"call.invite", "call.accept", "call.decline", "call.end", "call.offer", "call.answer", "call.ice", "call.busy"}
MAX_FRAME = 64_000


async def _touch_last_seen(user_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.id == user_id).values(last_seen_at=now()))
        await db.commit()


async def _broadcast_presence(user_id: uuid.UUID, online: bool) -> None:
    async with SessionLocal() as db:
        ids = await contact_ids(db, user_id)
    await hub.send_to_users(
        ids, {"type": "presence", "user_id": str(user_id), "online": online, "at": now().isoformat()}
    )


@router.websocket("/api/ws")
async def socket(ws: WebSocket):
    payload = decode_access_token(ws.query_params.get("token", ""))
    if not payload or payload.get("role") != "user":
        await ws.close(code=4401)
        return
    user_id = uuid.UUID(payload["sub"])
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        if not user or not user.email_verified:
            await ws.close(code=4401)
            return

    await ws.accept()
    ip = ws.headers.get("x-forwarded-for", "").split(",")[0].strip() or (ws.client.host if ws.client else "")
    session = Session(user_id, ws, ip, ws.headers.get("user-agent", "")[:200])
    came_online = hub.add(session)
    await _touch_last_seen(user_id)
    if came_online:
        await _broadcast_presence(user_id, True)

    async with SessionLocal() as db:
        online_contacts = [str(c) for c in await contact_ids(db, user_id) if hub.is_online(c)]
    settings = get_settings()
    await session.send({"type": "hello", "online": online_contacts, "ice_servers": ice_servers(settings)})

    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=90)
            except TimeoutError:
                break  # client heartbeats every 25s; silence means the link is dead
            if len(raw) > MAX_FRAME:
                continue
            try:
                event = json.loads(raw)
            except ValueError:
                continue
            await _handle(session, event)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("socket error")
    finally:
        went_offline = hub.remove(session)
        await _touch_last_seen(user_id)
        if went_offline:
            await _broadcast_presence(user_id, False)


async def _handle(session: Session, event: dict) -> None:
    kind = event.get("type")
    if kind == "ping":
        session.last_heartbeat = now()
        await session.send({"type": "pong"})
        return

    if kind == "typing":
        target = event.get("to")
        group = event.get("group_id")
        try:
            async with SessionLocal() as db:
                if target:
                    target_id = uuid.UUID(target)
                    if await are_connected(db, session.user_id, target_id):
                        await hub.send_to_user(target_id, {"type": "typing", "from": str(session.user_id)})
                elif group:
                    group_id = uuid.UUID(group)
                    if await db.get(GroupMember, (group_id, session.user_id)):
                        ids = (await db.execute(select(GroupMember.user_id).where(GroupMember.group_id == group_id))).scalars()
                        await hub.send_to_users(
                            [i for i in ids if i != session.user_id],
                            {"type": "typing", "from": str(session.user_id), "group_id": group},
                        )
        except ValueError:
            pass
        return

    if kind in CALL_EVENTS:
        try:
            target_id = uuid.UUID(str(event.get("to")))
        except ValueError:
            return
        async with SessionLocal() as db:
            if not await are_connected(db, session.user_id, target_id):
                return
        delivered = await hub.send_to_user(
            target_id,
            {
                "type": kind,
                "from": str(session.user_id),
                "call_id": event.get("call_id"),
                "data": event.get("data"),
            },
        )
        if kind in {"call.accept", "call.decline"}:
            # Stop the user's other devices from ringing.
            for other in hub.sessions_for(session.user_id):
                if other is not session:
                    try:
                        await other.send({"type": "call.handled", "call_id": event.get("call_id")})
                    except Exception:
                        pass
        if kind == "call.invite" and not delivered:
            await session.send({"type": "call.unavailable", "call_id": event.get("call_id"), "from": str(target_id)})


def ice_servers(settings) -> list[dict]:
    servers = [{"urls": [u.strip() for u in settings.stun_urls.split(",") if u.strip()]}]
    if settings.turn_urls:
        servers.append(
            {
                "urls": [u.strip() for u in settings.turn_urls.split(",") if u.strip()],
                "username": settings.turn_username,
                "credential": settings.turn_credential,
            }
        )
    return servers
