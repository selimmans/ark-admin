// ARK OS — Instant push notification when a guest request is submitted.
// Called by a Postgres trigger via pg_net on INSERT into guest_requests.

import { createClient } from 'npm:@supabase/supabase-js@2'

// ── Helpers (shared with send-notifications) ─────────────────────────────────

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
function u16be(n: number): Uint8Array { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b }
function lenPrefix(b: Uint8Array): Uint8Array { return concat(u16be(b.length), b) }
const enc = (s: string) => new TextEncoder().encode(s)

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

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8))
}

async function encryptPayload(sub: { p256dh: string; auth: string }, plaintext: string) {
  const serverPair   = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverPair.publicKey))
  const clientKey    = await crypto.subtle.importKey('raw', b64uDecode(sub.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverPair.privateKey, 256))
  const salt         = crypto.getRandomValues(new Uint8Array(16))
  const subKey       = b64uDecode(sub.p256dh)
  const prk          = await hkdf(b64uDecode(sub.auth), sharedSecret, enc('Content-Encoding: auth\0'), 32)
  const cek   = await hkdf(salt, prk, concat(enc('Content-Encoding: aesgcm\0P-256\0'), lenPrefix(subKey), lenPrefix(serverPublic)), 16)
  const nonce = await hkdf(salt, prk, concat(enc('Content-Encoding: nonce\0P-256\0'),   lenPrefix(subKey), lenPrefix(serverPublic)), 12)
  const aesKey     = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(u16be(0), enc(plaintext))))
  return { body: ciphertext, salt, serverPublic }
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string, vapidPub: string, vapidPriv: string): Promise<number> {
  const jwt = await vapidJwt(sub.endpoint, vapidPub, vapidPriv)
  const { body, salt, serverPublic } = await encryptPayload(sub, payload)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${jwt},k=${vapidPub}`,
      'Content-Encoding': 'aesgcm',
      'Content-Type':     'application/octet-stream',
      'Encryption':       `salt=${b64uEncode(salt)}`,
      'Crypto-Key':       `dh=${b64uEncode(serverPublic)};p256ecdsa=${vapidPub}`,
      'TTL':              '3600',
    },
    body,
  })
  return res.status
}

// ── Main ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type':                 'application/json',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    // Supabase DB webhook sends { type, table, record, ... }
    // pg_net trigger sends our custom payload { type, booking_id, guest_name }
    const record    = body.record || body
    const reqType   = record.type   || body.type   || 'general'
    const guestName = record.guest_name || body.guest_name || ''

    const vapidPub  = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY')!

    const { data: subs } = await supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth')
    if (!subs?.length) return new Response(JSON.stringify({ sent: 0, reason: 'no_subscribers' }), { headers: CORS })

    // Allow callers to pass a fully custom title + body (e.g. task notifications)
    let notifTitle: string, notifBody: string, notifUrl: string
    if (body.notif_title) {
      notifTitle = body.notif_title
      notifBody  = body.notif_body  || ''
      notifUrl   = body.notif_url   || 'https://selimmans.github.io/ark-admin/tasks.html'
    } else {
      const label   = reqType === 'grocery' ? 'Grocery order' : 'Guest message'
      const nameStr = guestName ? ` from ${guestName}` : ''
      notifTitle = 'ARK — New Request'
      notifBody  = `${label}${nameStr} just came in.`
      notifUrl   = 'https://selimmans.github.io/ark-admin/requests.html'
    }

    const payload = JSON.stringify({
      title: notifTitle,
      body:  notifBody,
      icon:  '/ark-admin/icons/icon-192.png',
      url:   notifUrl,
      count: 1,
    })

    let sent = 0
    const expired: string[] = []
    for (const sub of subs) {
      try {
        const status = await sendPush(sub, payload, vapidPub, vapidPriv)
        if (status === 201 || status === 200) sent++
        else if (status === 410 || status === 404) expired.push(sub.id)
      } catch (e) {
        console.error('Push failed for', sub.endpoint, e)
      }
    }

    if (expired.length) await supabase.from('push_subscriptions').delete().in('id', expired)

    return new Response(JSON.stringify({ sent, expired: expired.length }), { headers: CORS })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: CORS })
  }
})
