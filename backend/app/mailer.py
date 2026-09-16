import logging
from email.message import EmailMessage

import aiosmtplib

from .config import get_settings

log = logging.getLogger("encrypta.mail")

_SUBJECTS = {
    "verify": "Confirm your Encrypta account",
    "login": "Your Encrypta sign-in code",
}


def _html(code: str, purpose: str) -> str:
    lead = (
        "Welcome to Encrypta. Enter this code to confirm your email address."
        if purpose == "verify"
        else "Someone is signing in to your Encrypta account. If this was you, enter this code."
    )
    return f"""\
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0d17;padding:40px 0">
  <div style="max-width:440px;margin:0 auto;background:#141726;border-radius:16px;padding:32px;color:#e6e8f2">
    <div style="font-size:20px;font-weight:700;letter-spacing:-.01em">Encrypta</div>
    <p style="color:#a3a8c3;line-height:1.5">{lead}</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:.3em;text-align:center;
                background:#0b0d17;border-radius:12px;padding:18px 0;margin:24px 0">{code}</div>
    <p style="color:#6b7090;font-size:13px">The code expires in {get_settings().otp_ttl_minutes} minutes.
    If you didn't request it, you can ignore this email.</p>
  </div>
</div>"""


async def send_code(to: str, code: str, purpose: str) -> None:
    settings = get_settings()
    if not settings.smtp_host:
        log.warning("[DEV MAIL] %s code for %s: %s", purpose, to, code)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = _SUBJECTS[purpose]
    msg.set_content(f"Your Encrypta code is {code}. It expires in {settings.otp_ttl_minutes} minutes.")
    msg.add_alternative(_html(code, purpose), subtype="html")

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username or None,
        password=settings.smtp_password or None,
        start_tls=settings.smtp_starttls and not settings.smtp_ssl,
        use_tls=settings.smtp_ssl,
        timeout=20,
    )
