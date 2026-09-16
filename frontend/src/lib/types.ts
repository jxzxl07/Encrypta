export interface UserPublic {
  id: string
  username: string
  display_name: string
  public_key: string
  online: boolean
  last_seen_at: string | null
}

export interface Account {
  id: string
  username: string
  display_name: string
  email: string
  created_at: string
}

export interface KeyBundle {
  public_key: string
  encrypted_private_key: string
  private_key_iv: string
  kdf_iterations: number
}

export interface SessionResponse {
  access_token: string
  refresh_token: string
  user: Account
  keys: KeyBundle
}

export interface Challenge {
  challenge_id: string
  purpose: 'verify' | 'login'
  email_hint: string
}

export interface ConnectionItem {
  connection_id: string
  user: UserPublic
  since: string
}

export interface SealedGroupKey {
  version: number
  wrapped_key: string
  iv: string
  wrapped_by: string
}

export interface Group {
  id: string
  name: string
  owner_id: string
  key_version: number
  rotation_needed: boolean
  created_at: string
  members: UserPublic[]
  keys: SealedGroupKey[]
  wrappers: Record<string, string>
}

export interface WireMessage {
  id: string
  sender_id: string
  recipient_id: string | null
  group_id: string | null
  ciphertext: string
  iv: string
  key_version: number | null
  created_at: string
}

export interface ChatMessage {
  id: string
  sender_id: string
  created_at: string
  text: string
  failed?: boolean // could not be decrypted
  pending?: boolean
}

export type ConversationKey = `dm:${string}` | `g:${string}`
