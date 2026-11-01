// Run with: npx tsx tests/webpush.test.ts
// Checks Leela's Web Push code against the reference implementation (http_ece, by the RFC 8188
// author) and that its VAPID tokens verify with the public key push services will hold.
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import ece from 'http_ece'
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidHeader } from '../supabase/functions/sweetspot-push/webpush'

// base64url round trip, including lengths that need padding.
for (const n of [0, 1, 2, 3, 16, 65]) {
  const b = new Uint8Array(randomBytes(n))
  assert.deepEqual(b64urlToBytes(bytesToB64url(b)), b)
}

// 1. A browser's keys, as PushManager.subscribe() would make them.
const browser = createECDH('prime256v1')
browser.generateKeys()
const auth = randomBytes(16)
const target = { p256dh: bytesToB64url(new Uint8Array(browser.getPublicKey())), auth: bytesToB64url(new Uint8Array(auth)) }

// 2. Encrypt as Leela's server does, decrypt as a browser would.
for (const text of ['{}', JSON.stringify({ title: 'Mira’s nap sweet spot in 15 min', body: 'Sweet spot 12:25 – 12:55 PM. Start winding down.', url: '/leela/' }), 'x'.repeat(3000)]) {
  const sealed = await encryptPayload(new TextEncoder().encode(text), target)
  const opened = ece.decrypt(Buffer.from(sealed), { version: 'aes128gcm', privateKey: browser, authSecret: auth })
  assert.equal(opened.toString('utf8'), text)
}

// 3. Someone else's keys can't open it.
{
  const other = createECDH('prime256v1')
  other.generateKeys()
  const sealed = await encryptPayload(new TextEncoder().encode('secret'), target)
  assert.throws(() => ece.decrypt(Buffer.from(sealed), { version: 'aes128gcm', privateKey: other, authSecret: auth }))
}

// 4. VAPID: an ES256 token for the push service's origin, valid for under an hour, that verifies.
{
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const now = Date.parse('2026-11-01T09:00:00Z')
  const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc:def', { publicKey, privateJwk, subject: 'https://shiven-goel.github.io/leela/' }, now)
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
  assert.ok(m, header)
  assert.equal(m![4], publicKey)
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(m![2])))
  assert.equal(claims.aud, 'https://fcm.googleapis.com')
  assert.equal(claims.sub, 'https://shiven-goel.github.io/leela/')
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 3600, 'expires within the hour')
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlToBytes(m![1]))), { typ: 'JWT', alg: 'ES256' })
  const pub = await crypto.subtle.importKey('raw', b64urlToBytes(m![4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlToBytes(m![3]), new TextEncoder().encode(`${m![1]}.${m![2]}`))
  assert.ok(ok, 'the signature verifies')
}

console.log('webpush: all good')
