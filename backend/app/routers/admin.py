"""Administrator console: accounts and live presence. No access to message content."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import current_admin
from ..hub import hub
from ..models import Connection, Group, Message, User
from ..ratelimit import RateLimiter, client_ip
from ..schemas import AdminLoginIn
from ..security import constant_time_equals, create_access_token, now

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_login_limit = RateLimiter(10, 900)


@router.post("/login")
async def admin_login(body: AdminLoginIn, request: Request):
    settings = get_settings()
    if not settings.admin_password:
        raise HTTPException(503, "The admin console is disabled. Set ADMIN_PASSWORD on the server.")
    admin_login_limit.check(client_ip(request))
    user_ok = constant_time_equals(body.username, settings.admin_username)
    pass_ok = constant_time_equals(body.password, settings.admin_password)
    if not (user_ok and pass_ok):
        raise HTTPException(401, "Incorrect admin username or password")
    return {"access_token": create_access_token(settings.admin_username, role="admin", minutes=8 * 60)}


@router.get("/overview")
async def overview(_: str = Depends(current_admin), db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    sessions_by_user: dict = {}
    for s in hub.all_sessions():
        sessions_by_user.setdefault(s.user_id, []).append(
            {"ip": s.ip, "user_agent": s.user_agent, "connected_at": s.connected_at.isoformat()}
        )

    connections = await db.scalar(select(func.count()).select_from(Connection).where(Connection.status == "accepted"))
    groups = await db.scalar(select(func.count()).select_from(Group))
    messages = await db.scalar(select(func.count()).select_from(Message))

    return {
        "generated_at": now().isoformat(),
        "stats": {
            "users": len(users),
            "verified": sum(u.email_verified for u in users),
            "online": len(hub.online_user_ids()),
            "sessions": len(hub.all_sessions()),
            "connections": connections,
            "groups": groups,
            "messages": messages,
        },
        "users": [
            {
                "id": str(u.id),
                "username": u.username,
                "display_name": u.display_name,
                "email": u.email,
                "email_verified": u.email_verified,
                "created_at": u.created_at.isoformat(),
                "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
                "online": hub.is_online(u.id),
                "sessions": sessions_by_user.get(u.id, []),
            }
            for u in users
        ],
    }
