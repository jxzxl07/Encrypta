/**
 * End-to-end test against a running API, using the same crypto code the
 * browser runs. Start the backend with SMTP_HOST empty and its log written to
 * a file, then:
 *
 *   API=http://localhost:8000 API_LOG=../backend/api.log ADMIN_PASSWORD=... npm run test:e2e
 */
import { readFileSync } from 'node:fs'
import {
  createIdentity,
  decryptDirect,
  decryptGroup,
  deriveAccountSecrets,
  encryptDirect,
  encryptGroup,
  newGroupKey,
  openGroupKey,
  openIdentity,
  sealGroupKey,
  type Me,
} from '../src/lib/crypto'

const API = process.env.API ?? 'http://localhost:8000'
const LOG = process.env.API_LOG ?? '../backend/api.log'
const run = Date.now().toString(36)
let passed = 0

function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`  ✓ ${label}`)
}

async function call<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string; expect?: number } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const expect = opts.expect ?? 200
  const text = await res.text()
  if (res.status !== expect && !(expect === 200 && res.status === 204)) {
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status} (wanted ${expect}): ${text}`)
  }
  return text ? JSON.parse(text) : (undefined as T)
}

async function codeFor(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes('[DEV MAIL]') && l.includes(email))
    const m = lines.at(-1)?.match(/: (\d{6})$/)
    if (m) return m[1]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`no code for ${email}`)
}

interface Client {
  username: string
  password: string
  token: string
  me: Me
  ws: WebSocket
  events: any[]
}

async function signup(name: string): Promise<Client> {
  const username = `${name}_${run}`
  const email = `${username}@example.com`
  const password = `correct horse ${name} battery`
  const secrets = await deriveAccountSecrets(username, password)
  const identity = await createIdentity(secrets.wrapKey)
  const ch = await call('/api/auth/signup', { body: { username, display_name: name, email, auth_secret: secrets.authSecret, ...identity } })
  await call('/api/auth/otp/verify', { body: { challenge_id: ch.challenge_id, code: '000000' }, expect: 400 }).catch(() => {})
  const session = await call('/api/auth/otp/verify', { body: { challenge_id: ch.challenge_id, code: await codeFor(email) } })
  const privateKey = await openIdentity(secrets.wrapKey, session.keys)
  const me: Me = { id: session.user.id, privateKey, publicKey: session.keys.public_key }
  const events: any[] = []
  const ws = new WebSocket(`${API.replace('http', 'ws')}/api/ws?token=${session.access_token}`)
  ws.onmessage = (e) => events.push(JSON.parse(String(e.data)))
  await new Promise((r) => (ws.onopen = r))
  return { username, password, token: session.access_token, me, ws, events }
}

async function waitFor(c: Client, pred: (e: any) => boolean, label: string) {
  for (let i = 0; i < 50; i++) {
    const hit = c.events.find(pred)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function main() {
  console.log('Accounts')
  const alice = await signup('alice')
  const bob = await signup('bob')
  const carol = await signup('carol')
  ok(alice.me.id && bob.me.id && carol.me.id, 'three accounts signed up and verified by email code')

  // Login is two-step: password-derived secret, then emailed code.
  const secrets = await deriveAccountSecrets(alice.username, alice.password)
  await call('/api/auth/login', { body: { username: alice.username, auth_secret: (await deriveAccountSecrets(alice.username, 'wrong password')).authSecret }, expect: 401 })
  ok(true, 'wrong password rejected')
  const ch = await call('/api/auth/login', { body: { username: alice.username, auth_secret: secrets.authSecret } })
  ok(ch.purpose === 'login', 'correct password issues a login code')
  const login = await call('/api/auth/otp/verify', { body: { challenge_id: ch.challenge_id, code: await codeFor(`${alice.username}@`) } })
  await openIdentity(secrets.wrapKey, login.keys)
  ok(login.keys.public_key === alice.me.publicKey, 'login returns the sealed identity key, which unlocks with the password')
  const wrong = await deriveAccountSecrets(alice.username, 'nope')
  ok(await openIdentity(wrong.wrapKey, login.keys).then(() => false, () => true), 'identity key does not unlock with a wrong password')
  const refreshed = await call('/api/auth/refresh', { body: { refresh_token: login.refresh_token } })
  ok(refreshed.access_token, 'refresh token rotates')

  console.log('Connections')
  const found = await call(`/api/users/search?q=${bob.username.slice(0, 5)}`, { token: alice.token })
  ok(found.some((u: any) => u.username === bob.username), 'search finds bob by username prefix')
  await call(`/api/dm/${bob.me.id}/messages`, { token: alice.token, expect: 403 })
  ok(true, 'cannot message before connecting')
  await call('/api/connections', { token: alice.token, body: { username: bob.username } })
  await waitFor(bob, (e) => e.type === 'connections.changed', 'bob notified of request')
  const bobConns = await call('/api/connections', { token: bob.token })
  ok(bobConns.incoming.length === 1, 'bob sees incoming request live')
  await call(`/api/connections/${bobConns.incoming[0].connection_id}/accept`, { token: bob.token, body: {} })
  await call('/api/connections', { token: alice.token, body: { username: carol.username } })
  await call('/api/connections', { token: carol.token, body: { username: alice.username } })
  await call('/api/connections', { token: bob.token, body: { username: carol.username } })
  await call('/api/connections', { token: carol.token, body: { username: bob.username } })
  const aliceConns = await call('/api/connections', { token: alice.token })
  ok(aliceConns.contacts.length === 2, 'alice connected to bob and carol (mutual request auto-accepts)')
  const bobPublic = aliceConns.contacts.find((c: any) => c.user.id === bob.me.id).user
  ok(bobPublic.online, 'presence shows bob online')

  console.log('Direct messages (X25519 → AES-256-GCM)')
  const payload = await encryptDirect(alice.me, bobPublic, { kind: 'text', text: 'hello bob 🔐' })
  const sent = await call(`/api/dm/${bob.me.id}/messages`, { token: alice.token, body: payload })
  ok(!sent.ciphertext.includes('hello'), 'server stores only ciphertext')
  const live = await waitFor(bob, (e) => e.type === 'message.new' && e.message.id === sent.id, 'bob receives dm')
  const alicePublic = { public_key: alice.me.publicKey }
  const plain = await decryptDirect(bob.me, alicePublic, live.message)
  ok(plain.text === 'hello bob 🔐', 'bob decrypts the message delivered over WebSocket')
  ok((await decryptDirect(alice.me, bobPublic, sent)).text === 'hello bob 🔐', 'alice can read her own sent message')
  const carolTry = await decryptDirect(carol.me, alicePublic, sent).then(() => false, () => true)
  ok(carolTry, 'carol cannot decrypt a message between alice and bob')
  const reattributed = await decryptDirect(bob.me, alicePublic, { ...sent, sender_id: bob.me.id, recipient_id: alice.me.id }).then(() => false, () => true)
  ok(reattributed, 'tampering with sender/recipient breaks authentication')
  const history = await call(`/api/dm/${alice.me.id}/messages`, { token: bob.token })
  ok(history.length === 1 && history[0].id === sent.id, 'history endpoint returns the message')
  await call(`/api/dm/${bob.me.id}/messages`, { token: carol.token })
  const summary = await call('/api/conversations', { token: bob.token })
  ok(summary.dms[alice.me.id]?.id === sent.id, 'conversation summary lists latest dm')

  console.log('Groups (shared AES-256 key)')
  const contacts = Object.fromEntries(aliceConns.contacts.map((c: any) => [c.user.id, c.user]))
  const raw = newGroupKey()
  const members = [contacts[bob.me.id], contacts[carol.me.id], { id: alice.me.id, public_key: alice.me.publicKey }]
  const keys = await Promise.all(members.map((m) => sealGroupKey(alice.me, m, raw, 1)))
  const group = await call('/api/groups', { token: alice.token, body: { name: 'Trio', member_ids: [bob.me.id, carol.me.id], keys } })
  ok(group.members.length === 3, 'group created with three members')

  async function groupKeyFor(c: Client, version: number) {
    const g = await call(`/api/groups/${group.id}`, { token: c.token })
    const sealed = g.keys.find((k: any) => k.version === version)
    return openGroupKey(c.me, `${group.id}:${c.username}`, sealed, g.wrappers[sealed.wrapped_by])
  }

  const aKey = await groupKeyFor(alice, 1)
  const gp = await encryptGroup(aKey, group.id, alice.me.id, { kind: 'text', text: 'hi team' })
  const gm = await call(`/api/groups/${group.id}/messages`, { token: alice.token, body: { ...gp, key_version: 1 } })
  const carolLive = await waitFor(carol, (e) => e.type === 'message.new' && e.message.id === gm.id, 'carol receives group msg')
  ok((await decryptGroup(await groupKeyFor(carol, 1), carolLive.message)).text === 'hi team', 'carol decrypts group message')
  ok((await decryptGroup(await groupKeyFor(bob, 1), gm)).text === 'hi team', 'bob decrypts group message')

  await call(`/api/groups/${group.id}/members/${carol.me.id}`, { token: carol.token, method: 'DELETE' })
  const afterLeave = await call(`/api/groups/${group.id}`, { token: bob.token })
  ok(afterLeave.rotation_needed && afterLeave.members.length === 2, 'carol left; key rotation is now required')
  await call(`/api/groups/${group.id}/messages`, { token: bob.token, body: { ...gp, key_version: 1 }, expect: 409 })
  ok(true, 'sending with the old key is refused')
  const raw2 = newGroupKey()
  const bobContacts = Object.fromEntries((await call('/api/connections', { token: bob.token })).contacts.map((c: any) => [c.user.id, c.user]))
  const keys2 = await Promise.all(
    [bobContacts[alice.me.id], { id: bob.me.id, public_key: bob.me.publicKey }].map((m) => sealGroupKey(bob.me, m, raw2, 2)),
  )
  await call(`/api/groups/${group.id}/rotate`, { token: bob.token, body: { version: 2, keys: keys2 } })
  const bKey2 = await groupKeyFor(bob, 2)
  const gp2 = await encryptGroup(bKey2, group.id, bob.me.id, { kind: 'text', text: 'carol is gone' })
  const gm2 = await call(`/api/groups/${group.id}/messages`, { token: bob.token, body: { ...gp2, key_version: 2 } })
  ok((await decryptGroup(await groupKeyFor(alice, 2), gm2)).text === 'carol is gone', 'alice decrypts with rotated key v2 (sealed by bob)')
  await call(`/api/groups/${group.id}/messages`, { token: carol.token, expect: 404 })
  ok(true, 'carol can no longer fetch group history')

  console.log('Calls (signalling relay)')
  alice.ws.send(JSON.stringify({ type: 'call.invite', to: bob.me.id, call_id: 'c1', data: { media: 'video' } }))
  const invite = await waitFor(bob, (e) => e.type === 'call.invite', 'bob receives call invite')
  ok(invite.from === alice.me.id && invite.data.media === 'video', 'call invite relayed to bob')
  bob.ws.send(JSON.stringify({ type: 'call.answer', to: alice.me.id, call_id: 'c1', data: { type: 'answer', sdp: 'x' } }))
  ok((await waitFor(alice, (e) => e.type === 'call.answer', 'answer')).data.sdp === 'x', 'SDP answer relayed back')
  const hello = alice.events.find((e) => e.type === 'hello')
  ok(hello.ice_servers?.[0]?.urls?.length, 'ICE servers delivered on connect')

  console.log('Admin')
  await call('/api/admin/login', { body: { username: 'admin', password: 'wrong' }, expect: 401 })
  const admin = await call('/api/admin/login', { body: { username: process.env.ADMIN_USERNAME ?? 'admin', password: process.env.ADMIN_PASSWORD } })
  await call('/api/admin/overview', { token: alice.token, expect: 401 })
  ok(true, 'regular users cannot open the admin console')
  const overview = await call('/api/admin/overview', { token: admin.access_token })
  const row = overview.users.find((u: any) => u.username === bob.username)
  ok(row?.online && overview.stats.online >= 3, 'admin sees bob online')
  bob.ws.close()
  await waitFor(alice, (e) => e.type === 'presence' && e.user_id === bob.me.id && !e.online, 'bob offline presence')
  const overview2 = await call('/api/admin/overview', { token: admin.access_token })
  ok(!overview2.users.find((u: any) => u.username === bob.username).online, 'admin sees bob offline after disconnect')

  alice.ws.close()
  carol.ws.close()
  console.log(`\nAll ${passed} checks passed.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
