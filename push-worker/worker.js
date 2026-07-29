// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DARDIDOG Push Worker — Cloudflare Workers (format classique)
//
// DÉPLOIEMENT :
// 1. dash.cloudflare.com → Workers & Pages → Créer un Worker
//    → Nommer "dardidog-push" → Upload and deploy → ce fichier
// 2. Paramètres → Variables & Secrets → ajouter secret :
//    VAPID_PRIVATE_KEY = PkXM4dHgcbvFALB-vtclXgZOBAg1kbZIyTm6Q_1X63c
// 3. KV → Créer namespace "DARDIDOG_KV"
//    → Settings du Worker → Bindings → KV → variable name: KV
// 4. Triggers → Cron → ajouter : */5 * * * *
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const VAPID_PUBLIC_KEY  = 'BKWBZk6fttcxjtGGTm2WmIapg1nnYoLaMZ_MlogG098mvgSXycyZzC8QiRUVfX0KIeJh5Wz2XJync3YnyEi0eus';
const VAPID_SUBJECT     = 'mailto:contact@dardidog.fr';
const MINUTES_BEFORE    = 30;
const CRON_INTERVAL_MIN = 1;
const ALLOWED_ORIGINS   = ['https://dardidog.fr', 'http://localhost:8080'];

// ── Crypto helpers ──────────────────────────────────────────

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  const pad = (4 - (str.length % 4)) % 4;
  return Uint8Array.from(
    atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)),
    c => c.charCodeAt(0)
  );
}

function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

const enc = s => new TextEncoder().encode(s);

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, len) {
  const blocks = [];
  let prev = new Uint8Array(0);
  let n = 0;
  while (n < len) {
    const block = await hmacSha256(prk, concat(prev, info, new Uint8Array([blocks.length + 1])));
    blocks.push(block);
    prev = block;
    n += 32;
  }
  return concat(...blocks).slice(0, len);
}

// ── Web Push encryption (RFC 8291 + RFC 8188 aes128gcm) ────

async function encryptPayload(subscription, payload) {
  const p256dh = b64urlDecode(subscription.keys.p256dh);
  const auth   = b64urlDecode(subscription.keys.auth);
  const plain  = enc(payload);

  const salt      = crypto.getRandomValues(new Uint8Array(16));
  const serverKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey));

  const clientKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKey.privateKey, 256));

  const prkExtract = await hkdfExtract(auth, ecdh);
  const ikm        = await hkdfExpand(prkExtract, concat(enc('WebPush: info\0'), p256dh, serverPub), 32);

  const prk   = await hkdfExtract(salt, ikm);
  const cek   = await hkdfExpand(prk, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, enc('Content-Encoding: nonce\0'), 12);

  const aesKey    = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plain, new Uint8Array([0x02]))));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([serverPub.length]), serverPub, encrypted);
}

// ── VAPID JWT ───────────────────────────────────────────────

async function makeVapidJWT(endpoint) {
  const audience = new URL(endpoint).origin;
  const exp      = Math.floor(Date.now() / 1000) + 43200;
  const header   = b64url(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims   = b64url(enc(JSON.stringify({ aud: audience, exp, sub: VAPID_SUBJECT })));
  const unsigned = `${header}.${claims}`;

  const pubBytes = b64urlDecode(VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64url(pubBytes.slice(1, 33)),
    y: b64url(pubBytes.slice(33, 65)),
    d: VAPID_PRIVATE_KEY, // global secret binding
    key_ops: ['sign'],
  };
  const sigKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig    = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKey, enc(unsigned)));
  return `${unsigned}.${b64url(sig)}`;
}

// ── Send one push notification ──────────────────────────────

async function sendPush(subscription, title, body) {
  const payload    = JSON.stringify({ title, body, icon: '/images/logo_192.png' });
  const ciphertext = await encryptPayload(subscription, payload);
  const jwt        = await makeVapidJWT(subscription.endpoint);

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL':              '86400',
    },
    body: ciphertext,
  });
}

// ── Cron: envoyer les notifications en attente ──────────────

function parseDatetime(ev) {
  if (ev.datetimeISO) {
    const dt = new Date(ev.datetimeISO);
    const body = ev.heureDebut ? `${ev.nom} à ${ev.heureDebut}` : ev.nom;
    return { target: new Date(dt.getTime() - MINUTES_BEFORE * 60000), eventTime: dt, body };
  }
  return null;
}

async function sendPendingNotifications() {
  const subStr = await KV.get('subscription'); // KV = global binding
  if (!subStr) return;
  const subscription = JSON.parse(subStr);

  const evStr = await KV.get('events');
  if (!evStr) return;
  const events = JSON.parse(evStr);

  const now      = Date.now();
  const windowMs = CRON_INTERVAL_MIN * 60 * 1000;
  const sentStr  = await KV.get('sent_notifs') || '{}';
  const sent     = JSON.parse(sentStr);
  let changed    = false;

  for (const ev of events) {
    const parsed = parseDatetime(ev);
    if (!parsed) continue;
    const diff = parsed.target.getTime() - now;
    if (diff > windowMs) continue;                         // trop tôt
    if (now >= parsed.eventTime.getTime()) continue;       // événement déjà commencé

    const key = `${ev.id}_${parsed.target.toISOString()}`;
    if (sent[key]) continue;

    const res = await sendPush(subscription, 'Dardidog', parsed.body);
    if (res.status === 410 || res.status === 404) {
      await KV.delete('subscription');
      break;
    }
    if (res.ok || res.status === 201) {
      sent[key] = now;
      changed = true;
    }
  }

  for (const k of Object.keys(sent)) {
    if (now - sent[k] > 7 * 24 * 3600 * 1000) delete sent[k];
  }

  if (changed) await KV.put('sent_notifs', JSON.stringify(sent));
}

// ── HTTP handlers ───────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };
}

async function handleFetch(request) {
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders(origin) });
  }

  const url = new URL(request.url);

  if (url.pathname === '/subscribe' && request.method === 'POST') {
    const sub = await request.json();
    await KV.put('subscription', JSON.stringify(sub));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders(origin) });
  }

  if (url.pathname === '/sync-events' && request.method === 'POST') {
    const incoming = await request.json();
    const existingStr = await KV.get('events');
    const existing = existingStr ? JSON.parse(existingStr) : [];
    const merged = new Map();
    for (const ev of existing) merged.set(ev.id, ev);
    for (const ev of incoming) merged.set(ev.id, ev);
    await KV.put('events', JSON.stringify([...merged.values()]));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders(origin) });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders(origin) });
}

addEventListener('fetch', event => {
  event.respondWith(handleFetch(event.request));
});

addEventListener('scheduled', event => {
  event.waitUntil(sendPendingNotifications());
});
