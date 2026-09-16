# Encrypta 

End-to-end encrypted messaging, group chat, and voice and video calls between
people anywhere on the internet, not just on the same LAN.

Try: https://encrypta-2-0.onrender.com

You sign up with a username and verify your email with a one-time code. You add
people by username, then message them directly, create groups, or call them
from the browser. Everything is encrypted on your device before it is sent. The
server stores ciphertext in Postgres and relays it. It can see who is signed
up, who is online and who is connected to whom. It cannot read messages.

A preset administrator can sign in to a console that lists every account and
shows who is online or offline right now.

## Features

| Area | What you get |
|---|---|
| Accounts | Sign up with a username and email; email one-time passcode to verify; every sign-in is password + emailed code |
| Connections | Search by username; send, accept, decline and cancel requests; remove contacts |
| Direct messages | Asymmetric (X25519 public-key) end-to-end encryption, live delivery, history, typing indicators, unread counts |
| Group messages | Symmetric encryption with one shared AES-256 group key; add/remove members, rename, leave; key rotation when someone leaves |
| Calls | 1:1 voice and video over WebRTC with mute, camera toggle, minimise, ringing, busy/declined/missed handling |
| Presence | Online / last-seen for your contacts, updated live |
| Admin console | `/admin`: preset username + password; totals; each user's online/offline status, last seen, join date, email verification |
| UI | Dark, responsive React interface that works on phones and desktops |

## Stack

```
React 19 + TypeScript + Tailwind CSS 4 (Vite)
   │   all encryption/decryption happens here (WebCrypto)
   │
   ├── REST (/api/…) ─────►  FastAPI  ──►  PostgreSQL
   ├── WebSocket (/api/ws) ─►   │           accounts, sealed keys, contacts,
   │   presence, live messages, │           groups, ciphertext messages
   │   call signalling          │
   │                            └──►  SMTP  one-time passcodes
   │
   └── WebRTC ◄──── peer-to-peer, DTLS-SRTP ────► the other browser
                    (STUN for NAT traversal, optional TURN relay)
```

## Cryptography

Every primitive is a standard, audited one: browser WebCrypto on the client,
`argon2-cffi` on the server. None of it is custom-built.

| Purpose | How |
|---|---|
| Password | Never sent. The browser runs PBKDF2-SHA256 (600,000 iterations, salted with the username) to derive a master secret |
| Server authentication | `HKDF(master, "auth")` is sent instead of the password, and stored as an Argon2id hash |
| Identity key | An X25519 key pair is generated in the browser at signup |
| Private key storage | Sealed with AES-256-GCM under `HKDF(master, "key-wrap")` and stored on the server as an opaque blob. After sign-in it is unsealed and kept in IndexedDB as a non-extractable `CryptoKey` |
| Direct messages (asymmetric) | X25519(my private key, their public key) → HKDF-SHA256 → AES-256-GCM, with a fresh 96-bit IV per message. Sender and recipient ids are bound in as associated data, so the server can't redirect a stored message to someone else or change who it appears to be from |
| Group messages (symmetric) | One random AES-256 key per group version. The creator seals a copy to each member's public key (X25519 → HKDF → AES-GCM). Every member encrypts and decrypts with that same shared key |
| Membership changes | When someone leaves or is removed, the server flags the group, and the next member to send generates a new key (v2, v3, …) sealed only to the remaining members. New members get the current key only, so they can't read earlier history |
| Calls | WebRTC media is encrypted with DTLS-SRTP by the browser. The server only relays SDP and ICE, and only between connected contacts |
| Verification | Each profile shows a safety number (a hash of the public key). Compare it with your contact's to rule out key substitution |
| Sessions | Short-lived JWT access tokens plus rotating refresh tokens (stored as SHA-256). Reusing a rotated token revokes every session |
| Email codes | 6 digits, HMAC-hashed at rest, 10-minute expiry, 5 attempts, resend cooldown, rate-limited |

**Limits, stated plainly.** There is no forward secrecy (no Double Ratchet),
so anyone who later learns a user's password and gets hold of stored ciphertext
could decrypt that user's history. Because the private key is sealed under the
password, a forgotten password cannot be reset without losing the ability to
read old messages. Everything is only as trustworthy as the JavaScript the
server delivers, which is true of every web-based E2EE app. The admin console
shows account metadata (usernames, emails, online status), never message
content.

## Running locally

Requirements: Python 3.12+, Node 20+, Docker (for a local Postgres).

```bash
# 1. Database
docker compose up -d

# 2. Backend (http://localhost:8000)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
#   set JWT_SECRET:     python -c "import secrets; print(secrets.token_urlsafe(48))"
#   set ADMIN_PASSWORD: anything strong
uvicorn app.main:app --port 8000

# 3. Frontend (http://localhost:5173), in another terminal
cd frontend
npm install
npm run dev
```

Tables are created automatically on first start.

**Email in development.** With `SMTP_HOST` empty, one-time codes are printed to
the backend log instead of being emailed:

```
WARNING encrypta.mail: [DEV MAIL] verify code for ada@example.com: 583396
```

To try messaging, open a second browser profile or a private window and sign
up a second user. Calls need camera and microphone permission. `localhost`
counts as a secure context, so calls work locally without HTTPS.

## Configuration

All settings live in `backend/.env`. See [backend/.env.example](backend/.env.example).

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Any Postgres URL. Hosted URLs with `?sslmode=require` (Neon, Supabase, RDS) are handled |
| `JWT_SECRET` | Long random string. Required in production |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | The preset administrator login for `/admin`. An empty password disables the console |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY` | `smtp` (default), or `brevo` / `resend` to send over HTTPS. Needed on hosts that block SMTP ports, including Render's free plan. The sender comes from `SMTP_FROM` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, `SMTP_SSL` | Outgoing mail for passcodes (Gmail app password, Resend, SendGrid, Postmark, SES…) |
| `CORS_ORIGINS` | Only needed if the frontend is served from a different origin than the API |
| `STUN_URLS` | STUN servers for WebRTC (Google's public ones by default) |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | A TURN relay for users behind strict NAT (some corporate and mobile networks) |

## Deploying globally

For people to use it from anywhere, you need three things:

1. **A hosted Postgres.** Create a database on [Neon](https://neon.tech),
   [Supabase](https://supabase.com) or similar, ideally in a region close to
   your API, and set `DATABASE_URL`.
2. **The app on a public HTTPS host.** Browsers only allow WebCrypto and camera
   or microphone access on HTTPS. The included `Dockerfile` builds the frontend
   and serves it from FastAPI in a single container, so it runs on Render,
   Railway, Fly.io, Google Cloud Run (enable session affinity for WebSockets),
   or a VPS behind Caddy or nginx:

   ```bash
   docker build -t encrypta .
   docker run -p 8000:8000 --env-file backend/.env encrypta
   ```

3. **Email and, ideally, TURN.** Set the `SMTP_*` variables so codes get
   delivered. Add a TURN relay (such as coturn, Metered or Cloudflare TURN) so
   calls connect on restrictive networks. STUN alone connects most home and
   office networks.

Run **one** API process. Live WebSocket sessions (presence, delivery, call
signalling) are tracked in memory in [backend/app/hub.py](backend/app/hub.py).
Everything durable is in Postgres. Scaling to several processes means adding a
pub/sub layer (Redis, or Postgres `LISTEN/NOTIFY`) behind the hub.

## Testing

```bash
# Start the API with its log captured, SMTP_HOST empty
cd backend && uvicorn app.main:app --port 8000 2>&1 | tee api.log

# In another terminal
cd frontend
API_LOG=../backend/api.log ADMIN_PASSWORD=<your admin password> npm run test:e2e
```

The end-to-end test uses the same crypto module as the browser and exercises
the real API and Postgres: signup and email verification, two-step login,
wrong-password rejection, refresh rotation, connection requests, DM encryption
(including confirming that a third party can't decrypt and that swapping
sender and recipient breaks authentication), group key sealing, member removal
and key rotation, call signalling relay, and admin presence (online, then
offline after disconnect).

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/signup` | Create an account with its public key and sealed private key; emails a code |
| POST | `/api/auth/login` | Check the derived auth secret; emails a code |
| POST | `/api/auth/otp/verify` | Exchange a code for tokens and the sealed key bundle |
| POST | `/api/auth/otp/resend` | Send a new code |
| POST | `/api/auth/refresh` · `/api/auth/logout` | Rotate or revoke the session |
| GET | `/api/auth/me` | Current account |
| GET | `/api/users/search?q=` | Find people by username prefix |
| GET/POST | `/api/connections` | List contacts and requests / send a request |
| POST/DELETE | `/api/connections/{id}[/accept]` | Accept, decline, cancel or remove |
| GET/POST | `/api/dm/{user_id}/messages` | Direct message history / send |
| GET/POST | `/api/groups` | List / create groups |
| GET/PATCH | `/api/groups/{id}` | Group details (members, your sealed keys) / rename |
| POST/DELETE | `/api/groups/{id}/members[/{user_id}]` | Add a member / remove or leave |
| POST | `/api/groups/{id}/rotate` | Install a new group key version |
| GET/POST | `/api/groups/{id}/messages` | Group history / send |
| GET | `/api/conversations` | Latest message in each conversation |
| POST | `/api/admin/login` | Preset admin sign-in |
| GET | `/api/admin/overview` | All users, online status, totals |
| WS | `/api/ws?token=` | Presence, live messages, typing, call signalling |

Interactive docs are at `http://localhost:8000/docs`.

## Project layout

```
backend/
  app/
    main.py            app, startup, serves frontend/dist in production
    config.py          settings from .env
    models.py          SQLAlchemy tables
    security.py        Argon2id, JWT, OTP hashing
    mailer.py          SMTP / dev-log email
    hub.py             live WebSocket sessions
    routers/           auth, social (search/connections), messages (DMs/groups), realtime (WS), admin
frontend/
  src/
    lib/crypto.ts      all cryptography
    lib/api.ts         REST client with token refresh
    lib/socket.ts      reconnecting WebSocket
    store/             auth, chat and call state (zustand)
    components/        sidebar, chat, people, modals, call overlay
    pages/             sign in/up, messenger, admin console
  tests/e2e.ts         end-to-end test
Dockerfile             single-container production build
docker-compose.yml     local Postgres
```
