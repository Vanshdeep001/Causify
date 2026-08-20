/* -------------------------------------------------------
 * rendezvous.js — asking the phone book where a session lives
 *
 * A Causify session runs on the host's own machine, published through a
 * Cloudflare quick tunnel that hands out a different hostname every launch.
 * The join code carries that hostname as a suffix (see backendHost.js), which
 * is why an invite dies the moment the host restarts: the session is fine, the
 * address on the invite is not.
 *
 * The rendezvous worker (rendezvous/src/worker.js) holds one line of text per
 * session — a code and wherever the host is right now. The host republishes on
 * launch; a joiner looks the code up before connecting. The code never changes,
 * so yesterday's invitation still works.
 *
 * ── Everything here is optional ──
 * If no worker URL is configured, or the worker is unreachable, or the code was
 * never published, every function in this module reports that plainly and the
 * caller falls back to exactly the behaviour Causify had before: the address
 * baked into the code, or this machine. Nothing about joining depends on the
 * phone book being up — it makes stale invites work, it does not gate the app.
 *
 * It never sees the project, the password, the files, or any traffic. The only
 * thing it learns is that some code points at some tunnel hostname.
 * ------------------------------------------------------- */

/* Paste the deployed worker origin here after `wrangler deploy` prints it —
 * e.g. 'https://causify-rendezvous.<your-subdomain>.workers.dev'.
 *
 * Left empty on purpose: an empty value disables lookups entirely rather than
 * pointing the app at a host that does not exist, so a build that nobody has
 * configured behaves like the build before this feature landed. */
const BUILT_IN_URL = '';

/* Overridable without a rebuild — handy for pointing a packaged app at a
 * `wrangler dev` worker, and for anyone self-hosting their own phone book. */
const URL_OVERRIDE_KEY = 'causify.rendezvousUrl';

/* The phone book sits between a person and the session they are trying to
 * reach, so it is never allowed to be the slow part. If it has not answered in
 * this long, the caller stops waiting and uses what it already had. */
const TIMEOUT_MS = 5000;

/* Mirrors CODE_RE in the worker. Checked here as well so a code that could
 * never be valid is answered locally instead of by a round trip that can only
 * return 400. */
const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

/** The worker origin, or '' when the feature is not configured. */
function baseUrl() {
  let configured = '';
  try {
    configured = localStorage.getItem(URL_OVERRIDE_KEY) || '';
  } catch {
    /* private mode — fall through to the build-time value */
  }
  if (!configured) {
    try {
      configured = import.meta.env?.VITE_RENDEZVOUS_URL || '';
    } catch {
      configured = '';
    }
  }
  return String(configured || BUILT_IN_URL).trim().replace(/\/+$/, '');
}

/** True when a worker is configured; every entry point no-ops without one. */
export const isRendezvousEnabled = () => Boolean(baseUrl());

/**
 * The key a session is filed under.
 *
 * Session ids are UUIDs — 36 characters, which is longer than the worker
 * accepts. Dropping the dashes leaves the 32 hex characters that carry all of
 * the identity, which fits exactly and stays a one-to-one mapping, so two
 * sessions can never collide on a code. The worker upper-cases keys and hex is
 * case-insensitive, so publishing and resolving always agree.
 *
 * Returns null for anything that still would not be a valid code, which is the
 * signal to skip the phone book rather than send a request that must fail.
 */
export function codeForSession(sessionId) {
  const code = String(sessionId || '').trim().replace(/-/g, '');
  return CODE_RE.test(code) ? code : null;
}

/* ── The publishing secret ──
 *
 * Without it, anyone who knows a code could repoint it at their own machine and
 * collaborators would connect there instead — the one genuinely dangerous thing
 * the phone book could be made to do. First publish claims the code and sets the
 * secret; later publishes must present the same one.
 *
 * So it has to outlive the process: a host who restarts republishes the *same*
 * session id, and a fresh secret would be refused with a 403 by its own entry.
 * localStorage, per session id, alongside the session identity itself (which
 * useEditorStore also persists to localStorage for exactly this reason).
 */
const secretKey = (sessionId) => `causify.rendezvous.secret.${sessionId}`;

function randomSecret() {
  const bytes = new Uint8Array(16); // 32 hex chars — the worker demands 16+
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The secret for this session, minting and storing one on first use.
 *
 * Returns a usable secret even when storage is unavailable; publishing then
 * works for as long as the app stays open and starts failing after a restart,
 * which is a better outcome than not publishing at all.
 */
export function secretForSession(sessionId) {
  const key = secretKey(sessionId);
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 16) return existing;
  } catch {
    return randomSecret();
  }

  const fresh = randomSecret();
  try { localStorage.setItem(key, fresh); } catch { /* best effort */ }
  return fresh;
}

/* Secrets are deliberately never cleaned up on leaving a session. A host who
 * leaves and later reopens the same session id needs the same secret to
 * republish; throwing it away would answer that host with a 403 from its own
 * entry, permanently, for a code people are still holding. The cost of keeping
 * them is 32 characters per session the app has ever hosted. */

/* ── Requests ──
 *
 * Both helpers below resolve rather than throw. A phone book that is down must
 * look like a phone book that is quiet, because every caller is in the middle
 * of something more important than this.
 */
async function request(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl()}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Publish where this session lives right now.
 *
 * Only https addresses are published: the worker rejects anything else, and a
 * LAN or loopback address is useless to the people a published code is for.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>} — never throws.
 */
export async function publishSession(sessionId, url) {
  if (!isRendezvousEnabled()) return { ok: false, reason: 'disabled' };

  const code = codeForSession(sessionId);
  if (!code) return { ok: false, reason: 'unusable-code' };
  if (!/^https:\/\//i.test(String(url || ''))) return { ok: false, reason: 'not-public' };

  try {
    const res = await request('/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, url, secret: secretForSession(sessionId) }),
    });

    if (res.ok) return { ok: true };

    if (res.status === 403) {
      /* Someone else holds this code, or this install lost the secret it first
         published with (cleared storage, a different profile). Either way the
         entry stays as it is — worth saying out loud, because the invite people
         are holding now points somewhere this app does not control. */
      console.warn('[Causify] The rendezvous refused this code — the published address is not ours to change.');
      return { ok: false, reason: 'forbidden' };
    }
    return { ok: false, reason: `http-${res.status}` };
  } catch (err) {
    console.warn('[Causify] Could not reach the rendezvous to publish:', err.message);
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * Look up where a session lives now.
 *
 * @returns {Promise<{url: string|null, reason?: string}>} — never throws.
 *   url set          → use it
 *   reason 'unpublished' → the code is real but nobody has published it
 *   anything else    → we could not ask; the caller keeps what it had
 */
export async function resolveSession(sessionId) {
  if (!isRendezvousEnabled()) return { url: null, reason: 'disabled' };

  const code = codeForSession(sessionId);
  if (!code) return { url: null, reason: 'unusable-code' };

  try {
    const res = await request(`/resolve/${encodeURIComponent(code)}`, { method: 'GET' });

    if (res.status === 404) return { url: null, reason: 'unpublished' };
    if (!res.ok) return { url: null, reason: `http-${res.status}` };

    const body = await res.json();
    /* The worker only ever stores an https URL, but this is the one value that
       comes from off-machine and goes straight into the origin every subsequent
       request uses — so it is checked here too rather than trusted. */
    if (!body?.url || !/^https:\/\//i.test(body.url)) {
      return { url: null, reason: 'bad-answer' };
    }
    return { url: body.url, updatedAt: body.updatedAt };
  } catch (err) {
    console.warn('[Causify] Could not reach the rendezvous to resolve:', err.message);
    return { url: null, reason: 'unreachable' };
  }
}
