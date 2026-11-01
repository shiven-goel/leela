// Web Push with nothing but Web Crypto and fetch, so it runs the same in Deno (the edge function)
// and Node (the tests). Payloads are encrypted as RFC 8291 says (aes128gcm, RFC 8188) and each
// request is signed with VAPID (RFC 8292). Tested against the reference implementation, http_ece.

const enc = new TextEncoder()

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64url(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

export interface PushTarget {
  endpoint: string
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string
  /** The browser's auth secret, base64url (16 bytes). */
  auth: string
}

/** Encrypts one message for one browser: a single aes128gcm record. */
export async function encryptPayload(payload: Uint8Array, target: Pick<PushTarget, 'p256dh' | 'auth'>, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(target.p256dh)
  const authSecret = b64urlToBytes(target.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh key')
  if (authSecret.length < 16) throw new Error('bad auth secret')
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // The 0x02 delimiter marks the last (and only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, concat(payload, new Uint8Array([2]))))
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, sealed)
}

export interface Vapid {
  /** The application server's public key, base64url (65 bytes uncompressed). */
  publicKey: string
  /** Its private key as a JWK (EC P-256, with d). */
  privateJwk: JsonWebKey
  /** A mailto: or https: contact for push services. */
  subject: string
}

const b64json = (o: unknown) => bytesToB64url(enc.encode(JSON.stringify(o)))

/** The Authorization header for one push service: a short-lived ES256 token. */
export async function vapidHeader(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600 - 60, sub: vapid.subject }
  const input = `${b64json({ typ: 'JWT', alg: 'ES256' })}.${b64json(claims)}`
  const key = await crypto.subtle.importKey('jwk', { ...vapid.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // Web Crypto returns the raw r||s signature that JWTs use.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)))
  return `vapid t=${input}.${bytesToB64url(sig)}, k=${vapid.publicKey}`
}

export interface PushResult {
  status: number
  /** The subscription is gone for good: stop sending to it. */
  gone: boolean
  detail: string
}

export async function sendPush(target: PushTarget, message: unknown, vapid: Vapid, opts: { ttl?: number; urgency?: 'normal' | 'high'; topic?: string } = {}): Promise<PushResult> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target)
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 1800),
      Urgency: opts.urgency ?? 'high',
      ...(opts.topic ? { Topic: opts.topic } : {}),
    },
    body,
  })
  const detail = await res.text().catch(() => '')
  return { status: res.status, gone: res.status === 404 || res.status === 410, detail: detail.slice(0, 300) }
}
