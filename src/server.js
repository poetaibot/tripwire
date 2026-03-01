import http from 'node:http';
import { createHmac, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

const PORT = Number(process.env.PORT || 8787);
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const DATA_DIR = new URL('../data/', import.meta.url);
const DB_PATH = new URL('../data/db.json', import.meta.url);
const ALERT_SECRET = process.env.ALERT_SECRET || 'tripwire-dev-secret';
const USER_API_KEY = process.env.USER_API_KEY || 'tripwire-dev-key';

const MAX_ACTIVE_WATCHES = Number(process.env.MAX_ACTIVE_WATCHES || 5);
const MIN_POLL_SECONDS = Number(process.env.MIN_POLL_SECONDS || 60);
const REQUESTS_PER_MINUTE = Number(process.env.REQUESTS_PER_MINUTE || 120);
const MAX_RETRIES = 3;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const rate = new Map();
const recentEvents = new Map();

const DEFAULT_DB = { watches: [], events: [] };

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(DB_PATH, 'utf8');
  } catch {
    await writeFile(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

async function loadDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_PATH, 'utf8'));
}

async function saveDb(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function json(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('payload_too_large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function requireApiKey(req) {
  const key = req.headers['x-api-key'];
  return key && key === USER_API_KEY;
}

function enforceRateLimit(req) {
  const key = req.headers['x-api-key'] || req.socket.remoteAddress || 'anon';
  const minute = Math.floor(Date.now() / 60000);
  const bucketKey = `${key}:${minute}`;
  const count = (rate.get(bucketKey) || 0) + 1;
  rate.set(bucketKey, count);
  return count <= REQUESTS_PER_MINUTE;
}

function isPrivateIPv4(ip) {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('127.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  return ['localhost', '0.0.0.0', '::1', 'metadata.google.internal'].includes(h);
}

async function validateExternalUrl(u) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, reason: 'invalid_protocol' };
  if (isBlockedHost(parsed.hostname)) return { ok: false, reason: 'blocked_host' };

  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    for (const r of records) {
      if (net.isIP(r.address) === 4 && isPrivateIPv4(r.address)) return { ok: false, reason: 'private_ip_blocked' };
      if (r.address === '::1') return { ok: false, reason: 'private_ip_blocked' };
    }
  } catch {
    return { ok: false, reason: 'dns_lookup_failed' };
  }

  return { ok: true };
}

function signPayload(payload) {
  return createHmac('sha256', ALERT_SECRET).update(payload).digest('hex');
}

function eventFingerprint(event) {
  // Use stable fields only for dedupe (avoid dynamic jitter like latencyMs/timestamps)
  const d = event.details || {};
  let stable = '';

  if (event.eventType === 'http_status_alert') {
    const bucketedStatus = Number(d.status || 0);
    stable = `${event.watchId}:${event.eventType}:${d.targetUrl || ''}:${bucketedStatus}`;
  } else if (event.eventType === 'page_change_alert') {
    // one fingerprint per watch/type to avoid repeated change-spam in short windows
    stable = `${event.watchId}:${event.eventType}:${d.targetUrl || ''}`;
  } else if (event.eventType === 'json_threshold_alert') {
    stable = `${event.watchId}:${event.eventType}:${d.targetUrl || ''}:${d.field || ''}:${d.operator || ''}`;
  } else {
    stable = `${event.watchId}:${event.eventType}`;
  }

  return createHash('sha256').update(stable).digest('hex');
}

function shouldDedupe(event) {
  const fp = eventFingerprint(event);
  const last = recentEvents.get(fp);
  const now = Date.now();
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  recentEvents.set(fp, now);
  return false;
}

async function deliverWebhookWithRetry(watch, event) {
  const body = JSON.stringify(event);
  const sig = signPayload(body);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(watch.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tripwire-signature': sig,
          'x-tripwire-watch-id': watch.id,
          'x-tripwire-attempt': String(attempt),
          'x-tripwire-timestamp': new Date().toISOString()
        },
        body
      });

      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
    } catch {
      // retry
    }

    await new Promise((r) => setTimeout(r, attempt * 1000));
  }

  return { ok: false, status: 0, attempts: MAX_RETRIES };
}

async function evaluateWatch(watch) {
  const now = new Date().toISOString();
  if (!watch.active) return { event: null, mutated: false };

  if (watch.type === 'http_status') {
    const started = Date.now();
    let status = 0;
    let ok = false;
    try {
      const res = await fetch(watch.targetUrl, { method: 'GET' });
      status = res.status;
      ok = status < 500;
    } catch {
      ok = false;
    }
    const latencyMs = Date.now() - started;
    const shouldAlert = !ok || (watch.maxLatencyMs && latencyMs > watch.maxLatencyMs);
    if (!shouldAlert) return { event: null, mutated: false };
    return {
      event: {
        id: randomUUID(),
        watchId: watch.id,
        eventType: 'http_status_alert',
        createdAt: now,
        details: { status, latencyMs, targetUrl: watch.targetUrl }
      },
      mutated: false
    };
  }

  if (watch.type === 'page_change') {
    try {
      const res = await fetch(watch.targetUrl);
      const text = await res.text();
      const hash = createHmac('sha256', 'page').update(text).digest('hex');
      if (!watch.lastHash) {
        watch.lastHash = hash;
        return { event: null, mutated: true };
      }
      if (hash !== watch.lastHash) {
        const prev = watch.lastHash;
        watch.lastHash = hash;
        return {
          event: {
            id: randomUUID(),
            watchId: watch.id,
            eventType: 'page_change_alert',
            createdAt: now,
            details: { targetUrl: watch.targetUrl, previousHash: prev, currentHash: hash }
          },
          mutated: true
        };
      }
      return { event: null, mutated: false };
    } catch {
      return {
        event: {
          id: randomUUID(),
          watchId: watch.id,
          eventType: 'page_change_error',
          createdAt: now,
          details: { targetUrl: watch.targetUrl, error: 'fetch_failed' }
        },
        mutated: false
      };
    }
  }

  if (watch.type === 'json_threshold') {
    try {
      const res = await fetch(watch.targetUrl);
      const data = await res.json();
      const value = Number(data?.[watch.field]);
      if (Number.isNaN(value)) return { event: null, mutated: false };
      const op = watch.operator;
      const t = Number(watch.threshold);
      const hit = op === 'gt' ? value > t : op === 'lt' ? value < t : value === t;
      if (!hit) return { event: null, mutated: false };
      return {
        event: {
          id: randomUUID(),
          watchId: watch.id,
          eventType: 'json_threshold_alert',
          createdAt: now,
          details: { targetUrl: watch.targetUrl, field: watch.field, operator: op, threshold: t, value }
        },
        mutated: false
      };
    } catch {
      return { event: null, mutated: false };
    }
  }

  return { event: null, mutated: false };
}

async function runPollCycle() {
  const db = await loadDb();
  let dirty = false;
  for (const watch of db.watches) {
    const { event, mutated } = await evaluateWatch(watch);
    if (mutated) dirty = true;
    if (!event) continue;
    if (shouldDedupe(event)) continue;

    db.events.push(event);
    const delivery = await deliverWebhookWithRetry(watch, event);
    event.delivery = delivery;
    dirty = true;
  }
  if (dirty) await saveDb(db);
}

setInterval(() => {
  runPollCycle().catch((err) => console.error('poll_cycle_error', err.message));
}, Math.max(POLL_SECONDS, MIN_POLL_SECONDS) * 1000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'TripWire',
      pollSeconds: Math.max(POLL_SECONDS, MIN_POLL_SECONDS),
      limits: { maxActiveWatches: MAX_ACTIVE_WATCHES, requestsPerMinute: REQUESTS_PER_MINUTE }
    });
  }

  if (!requireApiKey(req)) return json(res, 401, { error: 'unauthorized' });
  if (!enforceRateLimit(req)) return json(res, 429, { error: 'rate_limited' });

  if (req.method === 'POST' && url.pathname === '/v1/watches') {
    try {
      const body = await parseBody(req);
      const { type, targetUrl, webhookUrl } = body;
      if (!type || !targetUrl || !webhookUrl) return json(res, 400, { error: 'missing_required_fields' });
      if (!['http_status', 'page_change', 'json_threshold'].includes(type)) return json(res, 400, { error: 'invalid_type' });

      const targetCheck = await validateExternalUrl(targetUrl);
      if (!targetCheck.ok) return json(res, 400, { error: `invalid_target_${targetCheck.reason}` });
      const webhookCheck = await validateExternalUrl(webhookUrl);
      if (!webhookCheck.ok) return json(res, 400, { error: `invalid_webhook_${webhookCheck.reason}` });

      const db = await loadDb();
      const activeCount = db.watches.filter((w) => w.active).length;
      if (activeCount >= MAX_ACTIVE_WATCHES) return json(res, 403, { error: 'active_watch_limit_reached' });

      const watch = {
        id: randomUUID(),
        type,
        targetUrl,
        webhookUrl,
        active: true,
        createdAt: new Date().toISOString(),
        maxLatencyMs: body.maxLatencyMs || 5000,
        field: body.field,
        operator: body.operator || 'gt',
        threshold: body.threshold
      };
      db.watches.push(watch);
      await saveDb(db);
      return json(res, 201, { watch });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/v1/watches') {
    const db = await loadDb();
    return json(res, 200, { watches: db.watches });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/v1/watches/') && url.pathname.endsWith('/events')) {
    const id = url.pathname.split('/')[3];
    const db = await loadDb();
    return json(res, 200, { events: db.events.filter((e) => e.watchId === id).slice(-100) });
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/v1/watches/')) {
    const id = url.pathname.split('/')[3];
    const body = await parseBody(req).catch(() => ({}));
    const db = await loadDb();
    const watch = db.watches.find((w) => w.id === id);
    if (!watch) return json(res, 404, { error: 'not_found' });
    if (typeof body.active === 'boolean') watch.active = body.active;
    await saveDb(db);
    return json(res, 200, { watch });
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`TripWire running on http://localhost:${PORT}`);
  console.log(`Polling every ${Math.max(POLL_SECONDS, MIN_POLL_SECONDS)}s`);
});
