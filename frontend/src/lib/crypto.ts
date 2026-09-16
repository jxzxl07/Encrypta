/**
 * All cryptography runs here, in the browser, on WebCrypto primitives.
 *
 *  Account     password ─PBKDF2-SHA256(600k, salt=username)─► master
 *              master ─HKDF("auth")─► auth secret   (sent to server, Argon2id-hashed there)
 *              master ─HKDF("wrap")─► AES-256-GCM   (seals the identity private key)
 *  Identity    X25519 key pair per account
 *  Direct msg  X25519(me, them) ─HKDF─► AES-256-GCM  (asymmetric key agreement)
 *  Group msg   random AES-256-GCM group key shared by every member,
 *              sealed to each member with their X25519 public key
 *
 * The server only ever receives the auth secret, public keys and ciphertext.
 */
import { fromB64, toB64, utf8 } from './b64'

const subtle = crypto.subtle
export const KDF_ITERATIONS = 600_000
const X25519 = { name: 'X25519' } as const

export interface AccountSecrets {
  authSecret: string
  wrapKey: CryptoKey
}

async function hkdfBits(master: CryptoKey, info: string, salt: Uint8Array<ArrayBuffer>, bits = 256) {
  return subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, master, bits)
}

export async function deriveAccountSecrets(
  username: string,
  password: string,
  iterations = KDF_ITERATIONS,
): Promise<AccountSecrets> {
  const pw = await subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
  const masterBits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: utf8(`encrypta.v2:${username.trim().toLowerCase()}`), iterations },
    pw,
    256,
  )
  const master = await subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const empty = new Uint8Array(32)
  const authSecret = toB64(await hkdfBits(master, 'encrypta.v2 auth', empty))
  const wrapKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: empty, info: utf8('encrypta.v2 key-wrap') },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { authSecret, wrapKey }
}

export interface SealedIdentity {
  public_key: string
  encrypted_private_key: string
  private_key_iv: string
  kdf_iterations: number
}

const IDENTITY_AAD = utf8('encrypta.v2 identity-key')

export async function createIdentity(wrapKey: CryptoKey): Promise<SealedIdentity> {
  const pair = (await subtle.generateKey(X25519, true, ['deriveBits'])) as CryptoKeyPair
  const pub = await subtle.exportKey('raw', pair.publicKey)
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: IDENTITY_AAD }, wrapKey, pkcs8)
  return {
    public_key: toB64(pub),
    encrypted_private_key: toB64(sealed),
    private_key_iv: toB64(iv),
    kdf_iterations: KDF_ITERATIONS,
  }
}

/** Throws if the password is wrong (the GCM tag fails to verify). */
export async function openIdentity(wrapKey: CryptoKey, sealed: SealedIdentity): Promise<CryptoKey> {
  const pkcs8 = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.private_key_iv), additionalData: IDENTITY_AAD },
    wrapKey,
    fromB64(sealed.encrypted_private_key),
  )
  // Non-extractable: once imported, script on the page can use it but never read it out.
  return subtle.importKey('pkcs8', pkcs8, X25519, false, ['deriveBits'])
}

// ── Pairwise keys ──────────────────────────────────────────────────────────

const publicKeyCache = new Map<string, Promise<CryptoKey>>()
const pairCache = new Map<string, Promise<CryptoKey>>()

function importPublic(b64: string) {
  let key = publicKeyCache.get(b64)
  if (!key) {
    key = subtle.importKey('raw', fromB64(b64), X25519, true, [])
    publicKeyCache.set(b64, key)
  }
  return key
}

/**
 * Derive the symmetric key two people share, from my private key and their
 * public key. `purpose` separates DM keys from group-key sealing keys.
 */
async function pairwiseKey(myPrivate: CryptoKey, myPublic: string, theirPublic: string, purpose: string) {
  const cacheKey = `${purpose}|${myPublic}|${theirPublic}`
  let key = pairCache.get(cacheKey)
  if (!key) {
    key = (async () => {
      const shared = await subtle.deriveBits({ name: 'X25519', public: await importPublic(theirPublic) }, myPrivate, 256)
      const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
      // Bind both identities, in a fixed order, into the derived key.
      const [a, b] = [myPublic, theirPublic].sort()
      const salt = new Uint8Array(await subtle.digest('SHA-256', utf8(`${a}|${b}`)))
      return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(`encrypta.v2 ${purpose}`) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    })()
    key.catch(() => pairCache.delete(cacheKey))
    pairCache.set(cacheKey, key)
  }
  return key
}

async function seal(key: CryptoKey, plaintext: BufferSource, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, plaintext)
  return { ciphertext: toB64(ct), iv: toB64(iv) }
}

async function open(key: CryptoKey, ciphertext: string, iv: string, aad: string) {
  return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: utf8(aad) }, key, fromB64(ciphertext))
}

export interface Me {
  id: string
  privateKey: CryptoKey
  publicKey: string
}

export interface MessageBody {
  kind: 'text'
  text: string
}

// The sender and recipient ids are authenticated with every message, so the
// server cannot re-address or re-attribute a stored ciphertext.

export async function encryptDirect(me: Me, peer: { id: string; public_key: string }, body: MessageBody) {
  const key = await pairwiseKey(me.privateKey, me.publicKey, peer.public_key, 'direct-message')
  return seal(key, utf8(JSON.stringify(body)), `dm|${me.id}|${peer.id}`)
}

export async function decryptDirect(
  me: Me,
  peer: { public_key: string },
  msg: { sender_id: string; recipient_id: string; ciphertext: string; iv: string },
): Promise<MessageBody> {
  const key = await pairwiseKey(me.privateKey, me.publicKey, peer.public_key, 'direct-message')
  const plain = await open(key, msg.ciphertext, msg.iv, `dm|${msg.sender_id}|${msg.recipient_id}`)
  return JSON.parse(new TextDecoder().decode(plain))
}

// ── Group keys ─────────────────────────────────────────────────────────────

export function newGroupKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function sealGroupKey(
  me: Me,
  member: { id: string; public_key: string },
  groupKey: Uint8Array<ArrayBuffer>,
  version: number,
) {
  const key = await pairwiseKey(me.privateKey, me.publicKey, member.public_key, 'group-key-seal')
  const { ciphertext, iv } = await seal(key, groupKey, `gk|v${version}|${member.id}`)
  return { user_id: member.id, wrapped_key: ciphertext, iv }
}

const groupKeyCache = new Map<string, Promise<CryptoKey>>()

export function openGroupKey(
  me: Me,
  groupId: string,
  sealed: { version: number; wrapped_key: string; iv: string; wrapped_by: string },
  wrapperPublicKey: string,
): Promise<CryptoKey> {
  const cacheKey = `${groupId}|${sealed.version}`
  let key = groupKeyCache.get(cacheKey)
  if (!key) {
    key = (async () => {
      const pk = await pairwiseKey(me.privateKey, me.publicKey, wrapperPublicKey, 'group-key-seal')
      const raw = await open(pk, sealed.wrapped_key, sealed.iv, `gk|v${sealed.version}|${me.id}`)
      return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    })()
    key.catch(() => groupKeyCache.delete(cacheKey))
    groupKeyCache.set(cacheKey, key)
  }
  return key
}

/** Raw group key bytes are needed to re-seal the current key for a new member. */
export async function openGroupKeyRaw(
  me: Me,
  sealed: { version: number; wrapped_key: string; iv: string },
  wrapperPublicKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const pk = await pairwiseKey(me.privateKey, me.publicKey, wrapperPublicKey, 'group-key-seal')
  return new Uint8Array(await open(pk, sealed.wrapped_key, sealed.iv, `gk|v${sealed.version}|${me.id}`))
}

export async function encryptGroup(groupKey: CryptoKey, groupId: string, senderId: string, body: MessageBody) {
  return seal(groupKey, utf8(JSON.stringify(body)), `grp|${groupId}|${senderId}`)
}

export async function decryptGroup(
  groupKey: CryptoKey,
  msg: { group_id: string; sender_id: string; ciphertext: string; iv: string },
): Promise<MessageBody> {
  const plain = await open(groupKey, msg.ciphertext, msg.iv, `grp|${msg.group_id}|${msg.sender_id}`)
  return JSON.parse(new TextDecoder().decode(plain))
}

/** Short, human-comparable fingerprint of a public key. */
export async function fingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', fromB64(publicKey)))
  return Array.from(digest.slice(0, 10), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .match(/.{4}/g)!
    .join(' ')
}

export function clearCryptoCaches() {
  pairCache.clear()
  groupKeyCache.clear()
}
