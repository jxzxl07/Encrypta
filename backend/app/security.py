import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import get_settings

_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)
# Verified against when the username does not exist, so timing does not
# reveal which usernames are registered.
_DUMMY_HASH = _hasher.hash("encrypta-dummy")


def now() -> datetime:
    return datetime.now(UTC)


def hash_secret(secret: str) -> str:
    return _hasher.hash(secret)


def verify_secret(stored: str | None, secret: str) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY_HASH, secret) and stored is not None
    except (VerificationError, InvalidHashError):
        return False


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(challenge_id: uuid.UUID, code: str) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()


def new_refresh_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    return token, hashlib.sha256(token.encode()).hexdigest()


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(subject: str, role: str = "user", minutes: int | None = None) -> str:
    settings = get_settings()
    issued = now()
    payload = {
        "sub": subject,
        "role": role,
        "iat": issued,
        "exp": issued + timedelta(minutes=minutes or settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
