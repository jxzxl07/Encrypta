"""Live WebSocket sessions and fan-out.

Sessions are held in process memory, so run a single API process (uvicorn
without --workers). Every durable fact — accounts, contacts, messages, last
seen — lives in Postgres; this only tracks who has a socket open right now.
"""

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import WebSocket

from .security import now

log = logging.getLogger("encrypta.hub")


class Session:
    def __init__(self, user_id: uuid.UUID, ws: WebSocket, ip: str, user_agent: str):
        self.id = uuid.uuid4()
        self.user_id = user_id
        self.ws = ws
        self.ip = ip
        self.user_agent = user_agent
        self.connected_at: datetime = now()
        self.last_heartbeat: datetime = now()
        self._send_lock = asyncio.Lock()

    async def send(self, event: dict) -> None:
        async with self._send_lock:
            await self.ws.send_json(event)


class Hub:
    def __init__(self) -> None:
        self._sessions: dict[uuid.UUID, dict[uuid.UUID, Session]] = defaultdict(dict)

    def add(self, session: Session) -> bool:
        """Register a session. Returns True if the user just came online."""
        first = not self._sessions[session.user_id]
        self._sessions[session.user_id][session.id] = session
        return first

    def remove(self, session: Session) -> bool:
        """Drop a session. Returns True if the user is now fully offline."""
        user_sessions = self._sessions.get(session.user_id, {})
        user_sessions.pop(session.id, None)
        if not user_sessions:
            self._sessions.pop(session.user_id, None)
            return True
        return False

    def is_online(self, user_id: uuid.UUID) -> bool:
        return bool(self._sessions.get(user_id))

    def online_user_ids(self) -> set[uuid.UUID]:
        return {uid for uid, s in self._sessions.items() if s}

    def sessions_for(self, user_id: uuid.UUID) -> list[Session]:
        return list(self._sessions.get(user_id, {}).values())

    def all_sessions(self) -> list[Session]:
        return [s for sessions in self._sessions.values() for s in sessions.values()]

    async def send_to_user(self, user_id: uuid.UUID, event: dict) -> int:
        delivered = 0
        for session in self.sessions_for(user_id):
            try:
                await session.send(event)
                delivered += 1
            except Exception:  # socket closed mid-send; its own loop will clean up
                log.debug("send failed for session %s", session.id)
        return delivered

    async def send_to_users(self, user_ids, event: dict) -> None:
        await asyncio.gather(*(self.send_to_user(uid, event) for uid in set(user_ids)))


hub = Hub()
