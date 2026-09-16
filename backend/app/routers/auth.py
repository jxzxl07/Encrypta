import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import current_user
from ..mailer import send_code
from ..models import EmailCode, RefreshToken, User
from ..ratelimit import RateLimiter, client_ip
from ..schemas import (
    ChallengeOut,
    KeyBundle,
    LoginIn,
    Me,
    OtpIn,
    RefreshIn,
    ResendIn,
    SessionOut,
    SignupIn,
)
from ..security import (
    create_access_token,
    generate_otp,
    hash_otp,
    hash_refresh_token,
    hash_secret,
    new_refresh_token,
    now,
    verify_secret,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("encrypta.auth")

signup_limit = RateLimiter(10, 3600)
login_limit = RateLimiter(20, 900)
otp_limit = RateLimiter(30, 900)


def _email_hint(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}{'•' * max(1, len(name) - 2)}@{domain}"


async def _issue_code(db: AsyncSession, user: User, purpose: str) -> ChallengeOut:
    settings = get_settings()
    # Only one live challenge per user and purpose.
    await db.execute(
        delete(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose)
    )
    challenge = EmailCode(id=uuid.uuid4(), user_id=user.id, purpose=purpose)
    code = generate_otp()
    challenge.code_hash = hash_otp(challenge.id, code)
    challenge.sent_at = now()
    challenge.expires_at = now() + timedelta(minutes=settings.otp_ttl_minutes)
    challenge.attempts = 0
    db.add(challenge)
    await db.commit()
    await _deliver(user.email, code, purpose)
    return ChallengeOut(challenge_id=challenge.id, purpose=purpose, email_hint=_email_hint(user.email))


async def _deliver(email: str, code: str, purpose: str) -> None:
    try:
        await send_code(email, code, purpose)
    except Exception:
        log.exception("failed to send %s code", purpose)
        raise HTTPException(502, "We couldn't send the email. Check the SMTP settings and try again.")


async def _new_session(db: AsyncSession, user: User) -> SessionOut:
    token, token_hash = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=now() + timedelta(days=get_settings().refresh_token_days),
        )
    )
    await db.commit()
    return SessionOut(
        access_token=create_access_token(str(user.id)),
        refresh_token=token,
        user=Me.model_validate(user, from_attributes=True),
        keys=KeyBundle.model_validate(user, from_attributes=True),
    )


@router.post("/signup", response_model=ChallengeOut)
async def signup(body: SignupIn, request: Request, db: AsyncSession = Depends(get_db)):
    signup_limit.check(client_ip(request))
    email = body.email.lower()

    existing = (
        await db.execute(select(User).where(or_(User.username == body.username, User.email == email)))
    ).scalars().all()
    for user in existing:
        # An abandoned, never-verified signup doesn't hold a name hostage forever.
        if not user.email_verified and now() - user.created_at > timedelta(hours=1):
            await db.delete(user)
            continue
        if user.username == body.username:
            raise HTTPException(409, "That username is taken")
        raise HTTPException(409, "An account with that email already exists")
    await db.flush()

    user = User(
        username=body.username,
        display_name=body.display_name.strip(),
        email=email,
        auth_hash=hash_secret(body.auth_secret),
        public_key=body.public_key,
        encrypted_private_key=body.encrypted_private_key,
        private_key_iv=body.private_key_iv,
        kdf_iterations=body.kdf_iterations,
    )
    db.add(user)
    await db.flush()
    return await _issue_code(db, user, "verify")


@router.post("/login", response_model=ChallengeOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    login_limit.check(client_ip(request))
    login_limit.check(f"user:{body.username.lower()}")
    user = (
        await db.execute(select(User).where(User.username == body.username.strip().lower()))
    ).scalar_one_or_none()
    if not verify_secret(user.auth_hash if user else None, body.auth_secret) or user is None:
        raise HTTPException(401, "Incorrect username or password")
    return await _issue_code(db, user, "login" if user.email_verified else "verify")


@router.post("/otp/verify", response_model=SessionOut)
async def verify_otp(body: OtpIn, request: Request, db: AsyncSession = Depends(get_db)):
    otp_limit.check(client_ip(request))
    settings = get_settings()
    challenge = await db.get(EmailCode, body.challenge_id)
    if not challenge or challenge.consumed_at or challenge.expires_at < now():
        raise HTTPException(400, "This code has expired. Request a new one.")
    if challenge.attempts >= settings.otp_max_attempts:
        raise HTTPException(400, "Too many incorrect attempts. Request a new code.")

    if hash_otp(challenge.id, body.code) != challenge.code_hash:
        challenge.attempts += 1
        await db.commit()
        remaining = settings.otp_max_attempts - challenge.attempts
        raise HTTPException(400, f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} left.")

    challenge.consumed_at = now()
    user = await db.get(User, challenge.user_id)
    if challenge.purpose == "verify":
        user.email_verified = True
    return await _new_session(db, user)


@router.post("/otp/resend", response_model=ChallengeOut)
async def resend_otp(body: ResendIn, request: Request, db: AsyncSession = Depends(get_db)):
    otp_limit.check(client_ip(request))
    challenge = await db.get(EmailCode, body.challenge_id)
    if not challenge or challenge.consumed_at:
        raise HTTPException(400, "This sign-in attempt has ended. Start again.")
    wait = get_settings().otp_resend_seconds - (now() - challenge.sent_at).total_seconds()
    if wait > 0:
        raise HTTPException(429, f"Please wait {int(wait) + 1}s before requesting another code.")
    user = await db.get(User, challenge.user_id)
    return await _issue_code(db, user, challenge.purpose)


@router.post("/refresh", response_model=SessionOut)
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    record = (
        await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token))
        )
    ).scalar_one_or_none()
    if not record or record.expires_at < now():
        raise HTTPException(401, "Session expired")
    if record.revoked_at:
        if now() - record.revoked_at < timedelta(seconds=60):
            # Another tab refreshed moments ago; it holds the new token.
            raise HTTPException(401, "Session rotated")
        # A rotated token being replayed long after means it leaked: end every session.
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == record.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now())
        )
        await db.commit()
        raise HTTPException(401, "Session expired")
    record.revoked_at = now()
    user = await db.get(User, record.user_id)
    return await _new_session(db, user)


@router.post("/logout", status_code=204)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token))
        .values(revoked_at=now())
    )
    await db.commit()


@router.get("/me", response_model=Me)
async def me(user: User = Depends(current_user)):
    return Me.model_validate(user, from_attributes=True)
