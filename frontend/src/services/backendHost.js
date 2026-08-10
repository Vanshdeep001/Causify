/* -------------------------------------------------------
 * backendHost.js — where the backend lives
 *
 * Every desktop install runs its own backend on 127.0.0.1:8080, so the
 * API and WebSocket origins used to be compile-time constants pointing
 * there. That made cross-machine collaboration impossible: a joiner's app
 * dutifully connected to the joiner's own backend and sat in an empty room.
 *
 * The origin is a runtime value now. It stays 127.0.0.1 for everyone who
 * hosts (unchanged behaviour), and is repointed at the host's machine when
 * someone joins a session that lives elsewhere.
 *
 * ── The join code ──────────────────────────────────────────
 * The sharing flow must not grow a second field, so the host address rides
 * inside the code the owner already shares:
 *
 *   A3F9K2                     → this machine (local / same-backend, as before)
 *   A3F9K2@calm-fox-42         → https://calm-fox-42.trycloudflare.com
 *   A3F9K2@192.168.1.42:8080   → http://192.168.1.42:8080  (same wifi)
 *   A3F9K2@https://host.dev    → used verbatim
 *
 * A code with no "@" behaves exactly the way it always has, which is what
 * keeps every existing session and every existing habit working.
 * ------------------------------------------------------- */

/* In the browser/dev build the page is served by the backend itself, so
 * relative URLs are correct and must stay relative. Only the packaged
 * desktop app (file://) needs an absolute origin. */
const isElectronProd =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' || window.electronAPI);

export const DEFAULT_ORIGIN = 'http://127.0.0.1:8080';
const STORAGE_KEY = 'causify.backendOrigin';

/** Cloudflare quick tunnels are always <name>.trycloudflare.com. */
const QUICK_TUNNEL_SUFFIX = '.trycloudflare.com';

const read = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
};

let origin = read();

/**
 * Absolute origin of the backend, e.g. "http://127.0.0.1:8080".
 * Empty string in the browser build so URLs stay relative.
 */
export const getOrigin = () => (isElectronProd ? origin : '');

/** Base URL for REST calls. */
export const getApiBase = () => `${getOrigin()}/api`;

/**
 * SockJS endpoint. SockJS is given an http(s) URL — it negotiates the
 * ws(s) upgrade itself — so the scheme is passed through as-is and a
 * tunnelled https host correctly yields a wss connection.
 */
export const getWsUrl = () => `${getOrigin()}/ws`;

/** True when we are pointed at something other than this machine. */
export const isRemoteHost = () => origin !== DEFAULT_ORIGIN;

/* ── Session token ──
 *
 * Handed back by /session/create and /session/join, and presented on calls that
 * run commands on the host. The backend only demands it for requests arriving
 * from off-machine, so a local session never notices it exists.
 *
 * It lives here rather than in the editor store because api.js needs it on
 * every request and already imports this module — reaching into the store from
 * there would be a circular import, since the store imports api.js.
 *
 * sessionStorage, to match how the session id itself is kept: a refresh keeps
 * the collaborator working, closing the window ends the session anyway.
 */
const TOKEN_KEY = 'causify-session-token';

const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

let sessionToken = readToken();

export const getSessionToken = () => sessionToken;

export function setSessionToken(token) {
  sessionToken = token || '';
  try {
    if (sessionToken) sessionStorage.setItem(TOKEN_KEY, sessionToken);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — the in-memory copy still serves this window */
  }
}

export const clearSessionToken = () => setSessionToken('');

/** Point every subsequent request at `newOrigin` (absolute, with scheme). */
export function setOrigin(newOrigin) {
  origin = normalizeOrigin(newOrigin);
  try { localStorage.setItem(STORAGE_KEY, origin); } catch { /* best effort */ }
  return origin;
}

/** Back to this machine's own backend — used when leaving a remote session. */
export function resetOrigin() {
  origin = DEFAULT_ORIGIN;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
  return origin;
}

/* ─────────────────────────────────────────────────────────
 * Origin / token conversion
 * ───────────────────────────────────────────────────────── */

/** Accepts "host:port", "http://…", "https://…" and returns a full origin. */
export function normalizeOrigin(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_ORIGIN;
  if (/^https?:\/\//i.test(raw)) return raw;
  // A bare host with no port is only meaningful for the tunnel case, which
  // hostFromToken handles; anything reaching here is a LAN address.
  return `http://${raw.includes(':') ? raw : `${raw}:8080`}`;
}

/**
 * Expand the short token from a join code into a full origin.
 *
 * A token with no dot and no colon is a Cloudflare quick-tunnel name —
 * that is the common case, and keeping it to a few words is what stops the
 * shared code from turning into an unreadable URL.
 */
export function hostFromToken(token) {
  const t = String(token || '').trim().replace(/\/+$/, '');
  if (!t) return DEFAULT_ORIGIN;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.endsWith(QUICK_TUNNEL_SUFFIX)) return `https://${t}`;
  if (/^[a-z0-9][a-z0-9-]*$/i.test(t)) return `https://${t}${QUICK_TUNNEL_SUFFIX}`;
  return normalizeOrigin(t);
}

/** Inverse of hostFromToken — the shortest token that round-trips. */
export function tokenFromHost(fullOrigin) {
  const o = String(fullOrigin || '').trim().replace(/\/+$/, '');
  if (!o || o === DEFAULT_ORIGIN) return '';
  const quick = o.match(/^https:\/\/([a-z0-9-]+)\.trycloudflare\.com$/i);
  if (quick) return quick[1];
  return o.replace(/^http:\/\//i, '');
}

/* ─────────────────────────────────────────────────────────
 * Join codes
 * ───────────────────────────────────────────────────────── */

/**
 * Build the single code the owner shares.
 * Falls back to the bare session id when we are not reachable from outside,
 * so a purely local session still shows the short code it always showed.
 */
export function buildJoinCode(sessionId, fullOrigin) {
  const token = tokenFromHost(fullOrigin);
  return token ? `${sessionId}@${token}` : String(sessionId || '');
}

/**
 * Split a pasted code into { sessionId, origin }.
 * `origin` is null when the code carries no host, meaning "leave the current
 * origin alone" — which is what preserves the old same-machine behaviour.
 */
export function parseJoinCode(code) {
  const raw = String(code || '').trim();
  const at = raw.lastIndexOf('@');
  if (at === -1) return { sessionId: raw, origin: null };
  return {
    sessionId: raw.slice(0, at).trim(),
    origin: hostFromToken(raw.slice(at + 1)),
  };
}
