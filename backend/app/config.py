from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    database_url: str = "postgresql://encrypta:encrypta@localhost:5432/encrypta"
    jwt_secret: str = "change-me"
    access_token_minutes: int = 30
    refresh_token_days: int = 30

    # One-time passcodes
    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_seconds: int = 30

    # Email. "smtp", or an HTTPS API ("resend" / "brevo") for hosts that block
    # SMTP ports, such as Render's free plan. With no provider configured,
    # codes are printed to the server log.
    email_provider: str = "smtp"
    email_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "Encrypta <no-reply@encrypta.local>"
    smtp_starttls: bool = True
    smtp_ssl: bool = False

    # Preset administrator. Leave the password empty to disable the console.
    admin_username: str = "admin"
    admin_password: str = ""

    cors_origins: str = "http://localhost:5173"

    # WebRTC relay. STUN works for most networks; TURN is needed behind strict NAT.
    stun_urls: str = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    turn_urls: str = ""
    turn_username: str = ""
    turn_credential: str = ""

    frontend_dist: Path = BASE_DIR.parent / "frontend" / "dist"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def async_database(self) -> tuple[str, dict]:
        """Normalise a hosted Postgres URL (Neon, Supabase, RDS…) for asyncpg.

        Providers hand out `postgres://…?sslmode=require`; asyncpg wants the
        `postgresql+asyncpg` scheme and takes TLS as a connect argument.
        """
        parts = urlsplit(self.database_url)
        scheme = "postgresql+asyncpg"
        query = dict(parse_qsl(parts.query))
        connect_args: dict = {}
        sslmode = query.pop("sslmode", None)
        query.pop("channel_binding", None)
        if sslmode in {"require", "verify-ca", "verify-full"}:
            connect_args["ssl"] = "require" if sslmode == "require" else True
        if "-pooler" in (parts.hostname or ""):
            # Neon's pooled endpoint runs PgBouncer in transaction mode, which
            # can't keep prepared statements between queries.
            connect_args["statement_cache_size"] = 0
            query["prepared_statement_cache_size"] = "0"
        url = urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
        return url, connect_args


@lru_cache
def get_settings() -> Settings:
    return Settings()
