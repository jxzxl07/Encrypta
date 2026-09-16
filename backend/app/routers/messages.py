"""Encrypted direct messages and group chats.

Every payload here is ciphertext produced in the browser. The server checks
who may talk to whom, stores the envelope, and pushes it to live sockets.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import are_connected, current_user
from ..hub import hub
from ..models import Group, GroupKey, GroupMember, Message, User
from ..schemas import (
    GroupAddMemberIn,
    GroupCreateIn,
    GroupKeyOut,
    GroupOut,
    GroupRotateIn,
    MessageIn,
    MessageOut,
    WrappedKey,
)
from .social import public

router = APIRouter(prefix="/api", tags=["messages"])


def _out(m: Message) -> dict:
    return MessageOut.model_validate(m, from_attributes=True).model_dump(mode="json")


async def _page(db: AsyncSession, where, before: datetime | None, limit: int) -> list[dict]:
    q = select(Message).where(where)
    if before:
        q = q.where(Message.created_at < before)
    rows = (await db.execute(q.order_by(Message.created_at.desc()).limit(limit))).scalars().all()
    return [_out(m) for m in reversed(rows)]


# ── Direct messages ─────────────────────────────────────────────────────────


def _dm_where(a: uuid.UUID, b: uuid.UUID):
    return or_(
        and_(Message.sender_id == a, Message.recipient_id == b),
        and_(Message.sender_id == b, Message.recipient_id == a),
    )


@router.get("/dm/{user_id}/messages")
async def dm_history(
    user_id: uuid.UUID,
    before: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await are_connected(db, me.id, user_id):
        raise HTTPException(403, "You're not connected with this person")
    return await _page(db, _dm_where(me.id, user_id), before, limit)


@router.post("/dm/{user_id}/messages")
async def dm_send(
    user_id: uuid.UUID, body: MessageIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    if not await are_connected(db, me.id, user_id):
        raise HTTPException(403, "You're not connected with this person")
    msg = Message(sender_id=me.id, recipient_id=user_id, ciphertext=body.ciphertext, iv=body.iv)
    db.add(msg)
    await db.commit()
    event = {"type": "message.new", "message": _out(msg)}
    await hub.send_to_users([me.id, user_id], event)
    return event["message"]


# ── Groups ──────────────────────────────────────────────────────────────────


async def _membership(db: AsyncSession, group_id: uuid.UUID, me: User) -> Group:
    group = await db.get(Group, group_id)
    member = await db.get(GroupMember, (group_id, me.id))
    if not group or not member:
        raise HTTPException(404, "Group not found")
    return group


async def _member_ids(db: AsyncSession, group_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (await db.execute(select(GroupMember.user_id).where(GroupMember.group_id == group_id))).scalars()
    )


async def _group_out(db: AsyncSession, group: Group, me: User) -> dict:
    members = (
        await db.execute(
            select(User).join(GroupMember, GroupMember.user_id == User.id).where(GroupMember.group_id == group.id)
        )
    ).scalars().all()
    keys = (
        await db.execute(
            select(GroupKey)
            .where(GroupKey.group_id == group.id, GroupKey.user_id == me.id)
            .order_by(GroupKey.version)
        )
    ).scalars().all()
    wrapper_ids = {k.wrapped_by for k in keys}
    wrappers = (
        (await db.execute(select(User.id, User.public_key).where(User.id.in_(wrapper_ids)))).all()
        if wrapper_ids
        else []
    )
    return GroupOut(
        id=group.id,
        name=group.name,
        owner_id=group.owner_id,
        key_version=group.key_version,
        rotation_needed=group.rotation_needed,
        created_at=group.created_at,
        members=[public(u) for u in members],
        keys=[GroupKeyOut.model_validate(k, from_attributes=True) for k in keys],
        wrappers={uid: pk for uid, pk in wrappers},
    ).model_dump(mode="json")


async def _notify_group(db: AsyncSession, group: Group, extra_user_ids=()) -> None:
    ids = await _member_ids(db, group.id)
    await hub.send_to_users([*ids, *extra_user_ids], {"type": "groups.changed", "group_id": str(group.id)})


def _check_keys(keys: list[WrappedKey], expected: set[uuid.UUID]) -> None:
    got = [k.user_id for k in keys]
    if len(got) != len(set(got)) or set(got) != expected:
        raise HTTPException(400, "A sealed group key is required for exactly every member")


@router.get("/groups")
async def list_groups(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    groups = (
        await db.execute(
            select(Group)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .where(GroupMember.user_id == me.id)
            .order_by(Group.created_at)
        )
    ).scalars().all()
    return [await _group_out(db, g, me) for g in groups]


@router.get("/groups/{group_id}")
async def get_group(group_id: uuid.UUID, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await _group_out(db, await _membership(db, group_id, me), me)


@router.post("/groups")
async def create_group(body: GroupCreateIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    member_ids = set(body.member_ids) - {me.id}
    if not member_ids:
        raise HTTPException(400, "Add at least one other person")
    for uid in member_ids:
        if not await are_connected(db, me.id, uid):
            raise HTTPException(403, "You can only add people you're connected with")
    everyone = member_ids | {me.id}
    _check_keys(body.keys, everyone)

    group = Group(name=body.name.strip(), owner_id=me.id, key_version=1)
    db.add(group)
    await db.flush()
    for uid in everyone:
        db.add(GroupMember(group_id=group.id, user_id=uid))
    for k in body.keys:
        db.add(GroupKey(group_id=group.id, user_id=k.user_id, version=1, wrapped_key=k.wrapped_key, iv=k.iv, wrapped_by=me.id))
    await db.commit()
    await _notify_group(db, group)
    return await _group_out(db, group, me)


@router.post("/groups/{group_id}/members")
async def add_member(
    group_id: uuid.UUID, body: GroupAddMemberIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    group = await _membership(db, group_id, me)
    if group.owner_id != me.id:
        raise HTTPException(403, "Only the group owner can add people")
    if group.rotation_needed:
        raise HTTPException(409, "The group key must be rotated first")
    if not await are_connected(db, me.id, body.user_id):
        raise HTTPException(403, "You can only add people you're connected with")
    if await db.get(GroupMember, (group_id, body.user_id)):
        raise HTTPException(409, "Already in the group")
    if body.key.user_id != body.user_id:
        raise HTTPException(400, "Key is sealed for the wrong person")

    # New members receive the current key only, so earlier history stays unreadable to them.
    db.add(GroupMember(group_id=group_id, user_id=body.user_id))
    db.add(
        GroupKey(
            group_id=group_id,
            user_id=body.user_id,
            version=group.key_version,
            wrapped_key=body.key.wrapped_key,
            iv=body.key.iv,
            wrapped_by=me.id,
        )
    )
    await db.commit()
    await _notify_group(db, group)
    return await _group_out(db, group, me)


@router.delete("/groups/{group_id}/members/{user_id}", status_code=204)
async def remove_member(
    group_id: uuid.UUID, user_id: uuid.UUID, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    group = await _membership(db, group_id, me)
    if user_id != me.id and group.owner_id != me.id:
        raise HTTPException(403, "Only the group owner can remove people")
    member = await db.get(GroupMember, (group_id, user_id))
    if not member:
        raise HTTPException(404, "Not a member")
    await db.delete(member)
    await db.flush()

    remaining = await _member_ids(db, group_id)
    if not remaining:
        await db.delete(group)
        await db.commit()
        await hub.send_to_user(user_id, {"type": "groups.changed", "group_id": str(group_id)})
        return
    if group.owner_id == user_id:
        oldest = (
            await db.execute(
                select(GroupMember.user_id).where(GroupMember.group_id == group_id).order_by(GroupMember.joined_at).limit(1)
            )
        ).scalar_one()
        group.owner_id = oldest
    group.rotation_needed = True
    await db.commit()
    await _notify_group(db, group, extra_user_ids=[user_id])


@router.post("/groups/{group_id}/rotate")
async def rotate_key(
    group_id: uuid.UUID, body: GroupRotateIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    group = await _membership(db, group_id, me)
    if body.version != group.key_version + 1:
        raise HTTPException(409, "Someone else rotated the key first")
    _check_keys(body.keys, set(await _member_ids(db, group_id)))
    for k in body.keys:
        db.add(
            GroupKey(group_id=group_id, user_id=k.user_id, version=body.version, wrapped_key=k.wrapped_key, iv=k.iv, wrapped_by=me.id)
        )
    group.key_version = body.version
    group.rotation_needed = False
    await db.commit()
    await _notify_group(db, group)
    return await _group_out(db, group, me)


@router.patch("/groups/{group_id}")
async def rename_group(
    group_id: uuid.UUID, body: dict, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    group = await _membership(db, group_id, me)
    name = str(body.get("name", "")).strip()
    if not 1 <= len(name) <= 64:
        raise HTTPException(400, "Group names are 1–64 characters")
    group.name = name
    await db.commit()
    await _notify_group(db, group)
    return await _group_out(db, group, me)


@router.get("/groups/{group_id}/messages")
async def group_history(
    group_id: uuid.UUID,
    before: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await _membership(db, group_id, me)
    member = await db.get(GroupMember, (group_id, me.id))
    # History from before you joined is sealed under keys you were never given.
    where = and_(Message.group_id == group_id, Message.created_at >= member.joined_at)
    return await _page(db, where, before, limit)


@router.post("/groups/{group_id}/messages")
async def group_send(
    group_id: uuid.UUID, body: MessageIn, me: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    group = await _membership(db, group_id, me)
    if group.rotation_needed or body.key_version != group.key_version:
        raise HTTPException(409, "The group key has changed. Refresh and try again.")
    msg = Message(sender_id=me.id, group_id=group_id, ciphertext=body.ciphertext, iv=body.iv, key_version=body.key_version)
    db.add(msg)
    await db.commit()
    event = {"type": "message.new", "message": _out(msg)}
    await hub.send_to_users(await _member_ids(db, group_id), event)
    return event["message"]


# ── Inbox summary ───────────────────────────────────────────────────────────


@router.get("/conversations")
async def conversations(me: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Latest message per DM partner and per group, for the sidebar."""
    partner = func.coalesce(
        func.nullif(Message.recipient_id, me.id), Message.sender_id
    ).label("partner")
    latest_dm = (
        select(Message, partner)
        .where(Message.group_id.is_(None), or_(Message.sender_id == me.id, Message.recipient_id == me.id))
        .distinct(partner)
        .order_by(partner, Message.created_at.desc())
    )
    dms = {str(p): _out(m) for m, p in (await db.execute(latest_dm)).all()}

    latest_group = (
        select(Message)
        .join(GroupMember, and_(GroupMember.group_id == Message.group_id, GroupMember.user_id == me.id))
        .where(Message.created_at >= GroupMember.joined_at)
        .distinct(Message.group_id)
        .order_by(Message.group_id, Message.created_at.desc())
    )
    groups = {str(m.group_id): _out(m) for m in (await db.execute(latest_group)).scalars().all()}
    return {"dms": dms, "groups": groups}

