import re
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
B64 = r"^[A-Za-z0-9+/=_-]+$"


class UserPublic(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    public_key: str
    online: bool = False
    last_seen_at: datetime | None = None


class KeyBundle(BaseModel):
    public_key: str = Field(pattern=B64, max_length=128)
    encrypted_private_key: str = Field(pattern=B64, max_length=512)
    private_key_iv: str = Field(pattern=B64, max_length=32)
    kdf_iterations: int = Field(ge=100_000, le=10_000_000)


class SignupIn(KeyBundle):
    username: str
    display_name: str = Field(min_length=1, max_length=64)
    email: EmailStr
    auth_secret: str = Field(min_length=32, max_length=128)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("3–32 characters: lowercase letters, numbers and underscores")
        return v


class LoginIn(BaseModel):
    username: str = Field(max_length=32)
    auth_secret: str = Field(min_length=32, max_length=128)


class ChallengeOut(BaseModel):
    challenge_id: uuid.UUID
    purpose: str
    email_hint: str


class OtpIn(BaseModel):
    challenge_id: uuid.UUID
    code: str = Field(pattern=r"^\d{6}$")


class ResendIn(BaseModel):
    challenge_id: uuid.UUID


class Me(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    email: str
    created_at: datetime


class SessionOut(BaseModel):
    access_token: str
    refresh_token: str
    user: Me
    keys: KeyBundle


class RefreshIn(BaseModel):
    refresh_token: str


class ConnectionRequestIn(BaseModel):
    username: str


class MessageIn(BaseModel):
    ciphertext: str = Field(pattern=B64, max_length=200_000)
    iv: str = Field(pattern=B64, max_length=32)
    key_version: int | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    sender_id: uuid.UUID
    recipient_id: uuid.UUID | None
    group_id: uuid.UUID | None
    ciphertext: str
    iv: str
    key_version: int | None
    created_at: datetime


class WrappedKey(BaseModel):
    user_id: uuid.UUID
    wrapped_key: str = Field(pattern=B64, max_length=256)
    iv: str = Field(pattern=B64, max_length=32)


class GroupCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    member_ids: list[uuid.UUID] = Field(max_length=100)
    keys: list[WrappedKey]


class GroupAddMemberIn(BaseModel):
    user_id: uuid.UUID
    key: WrappedKey


class GroupRotateIn(BaseModel):
    version: int
    keys: list[WrappedKey]


class GroupKeyOut(BaseModel):
    version: int
    wrapped_key: str
    iv: str
    wrapped_by: uuid.UUID


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    key_version: int
    rotation_needed: bool
    created_at: datetime
    members: list[UserPublic]
    keys: list[GroupKeyOut]
    # Public keys of anyone who wrapped a key we hold, including former members,
    # so older key versions stay decryptable.
    wrappers: dict[uuid.UUID, str]


class AdminLoginIn(BaseModel):
    username: str
    password: str
