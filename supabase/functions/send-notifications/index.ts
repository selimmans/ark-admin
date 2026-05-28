// ARK OS — Daily Push Notification Edge Function
// Pure Deno/Web Crypto implementation — no npm dependencies for push.

import { createClient } from 'npm:@supabase/supabase-js@2'

// ── Helpers ─────────────────────────────────────────────────────────────────

function b64uDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - s.length % 4) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let off = 0; for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

function u16be(n: number): Uint8Array {
  const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b
}

function lenPrefix(b: Uint8Array): Uint8Array { return concat(u16be(b.length), b) }

const enc = (s: string) => new TextEncoder().encode(s)

// ── VAPID JWT (ECDSA P-256) ──────────────────────────────────────────────────

async function vapidJwt(endpoint: string, pub: string, priv: string): Promise<string> {
  const { protocol, host } = new URL(endpoint)
  const now = Math.floor(Date.now() / 1000)
  const header  = b64uEncode(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64uEncode(enc(JSON.stringify({ aud: `${protocol}//${host}`, exp: now + 43200, sub: 'mailto:admin@ark.local' })))
  const sigInput = `${header}.${payload}`

  const pubBytes = b64uDecode(pub)
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: priv,
    x: b64uEncode(pubBytes.slice(1, 33)),
    y: b64uEncode(pubBytes.slice(33, 65)),
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])

  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(sigInput))
  return `${sigInput}.${b64uEncode(sig)}`
}

// ── RFC 8291 Web Push payload encryption ────────────────────────────────────

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8))
}

async function encryptPayload(sub: { p256dh: string; auth: string }, plaintext: string): Promise<{
  body: Uint8Array; salt: Uint8Array; serverPublic: Uint8Array
}> {
  // 1. Server ephemeral key pair
  const serverPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverPair.publicKey))

  // 2. ECDH with subscription p256dh
  const clientKey = await crypto.subtle.importKey('raw', b64uDecode(sub.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverPair.privateKey, 256))

  // 3. Derive keys via HKDF (RFC 8291 §3.3)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const subscriptionAuth = b64uDecode(sub.auth)
  const subscriptionKey  = b64uDecode(sub.p256dh)

  const prk = await hkdf(subscriptionAuth, sharedSecret, enc('Content-Encoding: auth\0'), 32)

  const keyInfo   = concat(enc('Content-Encoding: aesgcm\0P-256\0'), lenPrefix(subscriptionKey), lenPrefix(serverPublic))
  const nonceInfo = concat(enc('Content-Encoding: nonce\0P-256\0'),   lenPrefix(subscriptionKey), lenPrefix(serverPublic))

  const cek   = await hkdf(salt, prk, keyInfo,   16)
  const nonce = await hkdf(salt, prk, nonceInfo, 12)

  // 4. AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const padded  = concat(u16be(0), enc(plaintext))   // 0 bytes of padding
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded))

  return { body: ciphertext, salt, serverPublic }
}

// ── Send one push notification ───────────────────────────────────────────────

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string, vapidPub: string, vapidPriv: string): Promise<number> {
  const jwt = await vapidJwt(sub.endpoint, vapidPub, vapidPriv)
  const { body, salt, serverPublic } = await encryptPayload(sub, payload)

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':     `vapid t=${jwt},k=${vapidPub}`,
      'Content-Encoding':  'aesgcm',
      'Content-Type':      'application/octet-stream',
      'Encryption':        `salt=${b64uEncode(salt)}`,
      'Crypto-Key':        `dh=${b64uEncode(serverPublic)};p256ecdsa=${vapidPub}`,
      'TTL':               '86400',
    },
    body,
  })

  return res.status
}

// ── Main handler ─────────────────────────────────────────────────────────────

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async () => {
  const vapidPub  = Deno.env.get('VAPID_PUBLIC_KEY')!
  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY')!

  const today    = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0]

  const [{ data: bookings }, { data: cleaning }, { data: subs }] = await Promise.all([
    supabase.from('bookings').select('status,payment_status,check_in,check_out').neq('status', 'cancelled'),
    supabase.from('cleaning_tasks').select('id').eq('date', today).eq('status', 'pending'),
    supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth'),
  ])

  const arrivals   = (bookings || []).filter(b => b.check_in?.startsWith(today)).length
  const departures = (bookings || []).filter(b => b.check_out?.startsWith(today)).length
  const cleanings  = (cleaning || []).length
  const unpaidSoon = (bookings || []).filter(b =>
    b.status === 'confirmed' && b.payment_status === 'unpaid' &&
    b.check_in >= today && b.check_in <= tomorrow
  ).length

  if (!arrivals && !departures && !cleanings && !unpaidSoon) {
    return new Response(JSON.stringify({ sent: 0, reason: 'nothing today' }))
  }

  const parts: string[] = []
  if (arrivals)   parts.push(`${arrivals} arrival${arrivals   > 1 ? 's' : ''}`)
  if (departures) parts.push(`${departures} departure${departures > 1 ? 's' : ''}`)
  if (cleanings)  parts.push(`${cleanings} cleaning${cleanings  > 1 ? 's' : ''} pending`)
  if (unpaidSoon) parts.push(`${unpaidSoon} unpaid booking${unpaidSoon > 1 ? 's' : ''} due soon`)

  const count = arrivals + departures + cleanings + unpaidSoon

  const payload = JSON.stringify({
    title: 'ARK OS · Today',
    body:  parts.join(' · '),
    icon:  '/ark-admin/icons/icon-192.png',
    url:   'https://selimmans.github.io/ark-admin/index.html',
    count,
  })

  let sent = 0
  const expired: string[] = []

  for (const sub of subs || []) {
    try {
      const status = await sendPush(sub, payload, vapidPub, vapidPriv)
      if (status === 201 || status === 200) sent++
      else if (status === 410 || status === 404) expired.push(sub.id)
    } catch (e) {
      console.error('Push failed for', sub.endpoint, e)
    }
  }

  if (expired.length) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return new Response(JSON.stringify({ sent, expired: expired.length, summary: parts.join(' · ') }))
})
