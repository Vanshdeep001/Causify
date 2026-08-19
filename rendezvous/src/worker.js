/* -------------------------------------------------------
 * worker.js — the phone book
 *
 * A Causify session runs on the host's own machine and is published through a
 * Cloudflare tunnel. That tunnel hands out a different random hostname every
 * launch, so an invitation stops working the moment the host restarts — the
 * session and its files are fine, but the address on the invite is wrong. In
 * practice that means re-sending the code after every restart, and a link in
 * yesterday's chat is always a dead end.
 *
 * This holds one line of text per session: a short code, and wherever the host
 * is right now. The host republishes on launch; a joiner resolves the code
 * before connecting. The code never changes, so an invitation stays good.
 *
 * What it deliberately is NOT: it never sees the project, the password, the
 * files, or any traffic between participants. It answers one question — "where
 * is PLUM-42 today?" — and nothing else. Everything about the session stays on
 * the host's machine, which is the property that makes Causify local-first in
 * the first place.
 *
 * It also cannot make a session reachable while the host is offline. It knows
 * the address; it cannot answer the door. A joiner then gets an honest "this
 * session is not running right now" instead of a broken link.
 * ------------------------------------------------------- */

/* An entry nobody has republished in this long is from a session that is not
 * coming back. KV expires it for us, so the store never needs sweeping. */
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/* Codes are user-visible and read aloud, so they are short and unambiguous.
 * Validated rather than trusted: the code becomes a KV key, and unbounded
 * user input as a key is how a store fills up with junk. */
const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

/* Only real tunnel/HTTPS endpoints. Without this the phone book would happily
 * point people at javascript: or file: URLs — it hands its answer straight to a
 * client that is about to make requests against it. */
function isPublishableUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Room for a self-hosted tunnel; the point is to exclude everything exotic.
  return url.hostname.length > 0 && url.hostname.includes('.');
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      /* The desktop app is an Electron origin, and a browser client is served
         from somewhere else again — neither is a fixed origin worth pinning.
         Nothing here is secret or user-specific: publishing needs the secret in
         the body, and resolving returns an address that is about to be handed
         out to collaborators anyway. */
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
    },
  });

/**
 * Publish where a session lives right now.
 *
 * Body: { code, url, secret }
 *
 * The secret is what stops a stranger repointing somebody else's code at their
 * own machine — the one genuinely dangerous thing this service could be made to
 * do. First publish claims the code and sets its secret; every later publish
 * for that code must present the same one.
 */
async function publish(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  const { code, url, secret } = body || {};

  if (!code || !CODE_RE.test(code)) {
    return json({ error: 'A code of 4-32 letters, digits or dashes is required' }, 400);
  }
  if (!url || !isPublishableUrl(url)) {
    return json({ error: 'An https URL is required' }, 400);
  }
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    return json({ error: 'A secret of at least 16 characters is required' }, 400);
  }

  const key = `s:${code.toUpperCase()}`;
  const existing = await env.SESSIONS.get(key, { type: 'json' });

  if (existing && existing.secret !== secret) {
    /* Deliberately the same wording a client would get for any refusal: saying
       "wrong secret" confirms the code exists and is worth attacking. */
    return json({ error: 'Cannot publish to this code' }, 403);
  }

  await env.SESSIONS.put(
    key,
    JSON.stringify({ url, secret, updatedAt: Date.now() }),
    { expirationTtl: TTL_SECONDS },
  );

  return json({ ok: true, code: code.toUpperCase() });
}

/**
 * Resolve a code to wherever the host is now.
 *
 * The secret is never returned — a joiner needs the address and nothing else.
 */
async function resolve(code, env) {
  if (!code || !CODE_RE.test(code)) {
    return json({ error: 'Bad code' }, 400);
  }

  const entry = await env.SESSIONS.get(`s:${code.toUpperCase()}`, { type: 'json' });
  if (!entry) {
    return json({ error: 'No session is published under that code' }, 404);
  }

  return json({ url: entry.url, updatedAt: entry.updatedAt });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return json({}, 204);

    if (request.method === 'POST' && url.pathname === '/publish') {
      return publish(request, env);
    }

    // /resolve/PLUM-42
    const match = url.pathname.match(/^\/resolve\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      return resolve(decodeURIComponent(match[1]), env);
    }

    // A liveness check, so the app can tell "the phone book is down" from
    // "that code is not published" — different problems, different messages.
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
