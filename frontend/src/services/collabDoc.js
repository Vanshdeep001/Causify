/* -------------------------------------------------------
 * collabDoc.js — CRDT (Yjs) collaboration layer
 *
 * Replaces the old "send the whole file on every keystroke,
 * last-write-wins" model with a proper CRDT. Two people can now
 * edit the same line at the same time and BOTH edits survive —
 * no clobbering, no cursor thrash.
 *
 * Architecture (no separate y-websocket server):
 *   - One shared Y.Doc per session, living in every client.
 *   - One Y.Text per file path (keyed "file:<path>").
 *   - Yjs binary updates are base64-encoded and relayed over the
 *     EXISTING STOMP channel (/app/session/{id}/yjs → /topic/...).
 *     The Java backend just rebroadcasts them (a dumb relay).
 *   - On join, a sync handshake pulls current state from peers;
 *     if nobody else has the file, it is seeded from the backend's
 *     persisted plain text.
 *   - Plain text is persisted back to the backend on a debounce
 *     (per file, ~1.5s idle) — one write per pause instead of one
 *     write per keystroke.
 *
 * The Monaco binding here is a small custom one (not y-monaco) so we
 * reuse the exact `monaco` instance the editor was mounted with and
 * avoid the classic "two monaco-editor copies" hazard.
 * ------------------------------------------------------- */

import * as Y from 'yjs';
import useEditorStore from '../store/useEditorStore';
import { saveFile } from './api';

/* ── Module state (one active session at a time) ── */
let doc = null;
let sessionId = null;
let userId = null;
let sendFn = null;                 // (message) => void — publishes over STOMP
const seededPaths = new Set();     // paths we've already tried to seed this session
/* Whether a peer has actually handed us their state since we joined.
 * Seeding used to wait a flat 700ms and then assume the answer had arrived —
 * a guess, not a fact. When the sync landed later than that, this client
 * inserted its own copy of a file the host had already put in the document,
 * and Yjs merged the two insertions exactly as it should: one file, twice. */
let syncReceived = false;
const persistTimers = {};          // { [path]: timeoutId } — debounced backend saves

const textKey = (path) => `file:${path}`;

/* ── base64 <-> Uint8Array (Yjs updates are binary) ── */
const toB64 = (u8) => {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
};
const fromB64 = (b64) => {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
};

/* ─────────────────────────────────────────────────────────
 * Lifecycle
 * ───────────────────────────────────────────────────────── */

/**
 * Start a fresh CRDT document for a session and begin syncing.
 * @param {string} sid   session id
 * @param {string} uid   this user's id (used to ignore our own echoes)
 * @param {(msg:object)=>void} send  publishes a message to the /yjs topic
 */
export function initCollab(sid, uid, send) {
  destroyCollab();

  doc = new Y.Doc();
  sessionId = sid;
  userId = uid;
  sendFn = send;

  // Outgoing: broadcast every LOCAL change as an incremental update.
  // Updates we applied from the network carry origin.remote — never re-broadcast those.
  //
  // `bulk` travels with the message because the receiver cannot infer it. A
  // seeded file is one update carrying an entire file, and it is indistinguish-
  // able on the wire from somebody having typed that file. Without the flag the
  // seeder is recorded as the author of every line in it.
  doc.on('update', (update, origin) => {
    if (origin && origin.remote) return;
    if (!sendFn) return;
    sendFn({
      kind: 'update',
      senderId: userId,
      payload: toB64(update),
      bulk: Boolean(origin && (origin.bulk || origin.seed)),
    });
  });

  // Report remote edits wherever they land, not only in the open file.
  doc.on('afterTransaction', handleAfterTransaction);

  useEditorStore.setState({ collabReady: true });

  // Ask peers for the current document state.
  sendFn({ kind: 'sync-request', senderId: userId });
}

/** Tear everything down (on disconnect / session leave). */
export function destroyCollab() {
  Object.values(persistTimers).forEach(clearTimeout);
  for (const k in persistTimers) delete persistTimers[k];
  seededPaths.clear();
  syncReceived = false;
  if (doc) {
    try { doc.off('afterTransaction', handleAfterTransaction); } catch (e) { /* ignore */ }
    try { doc.destroy(); } catch (e) { /* ignore */ }
  }
  doc = null;
  sessionId = null;
  userId = null;
  sendFn = null;
  useEditorStore.setState({ collabReady: false });
}

export const isCollabActive = () => !!doc;

/** Get (or lazily create) the Y.Text for a file path. */
export function getFileText(path) {
  if (!doc || !path) return null;
  return doc.getText(textKey(path));
}

/* ─────────────────────────────────────────────────────────
 * Cursor anchoring
 *
 * A cursor sent as "line 12, column 4" is a claim about a document that is
 * still moving. By the time it is drawn, an edit above it may have shifted
 * everything down, and the marker ends up pointing at the wrong text — the
 * further someone is from you in the file, the more wrong it looks.
 *
 * A Yjs relative position names the character it sits beside rather than a
 * coordinate, so it survives every insert and delete around it. Peers resolve
 * it against their own copy at the moment they draw, and it lands in the right
 * place regardless of what has happened in between.
 * ───────────────────────────────────────────────────────── */

/** Anchor an offset in `path` to the character there. Returns base64 or null. */
/**
 * Overwrite a file's shared text, wherever it is.
 *
 * Session Rewind needs this: restoring the project to an earlier moment has to
 * reach every file, not just the one on screen. The Monaco binding only covers
 * the open file, so any other path would otherwise change locally and never
 * reach the other participants.
 *
 * Written as one transaction so collaborators see a single replacement rather
 * than a delete followed by an insert — a gap between the two would briefly
 * blank the file on their screen and, worse, land in their own undo history as
 * two separate steps.
 *
 * A no-op when the text already matches, so restoring a mostly-unchanged
 * project does not spam every peer with updates for files nobody touched.
 */
export function replaceFileText(path, text) {
  if (!doc) return false;
  const ytext = getFileText(path);
  if (!ytext) return false;

  const next = text || '';
  if (ytext.toString() === next) return false;

  /* Tagged bulk. Every caller of this is a history operation — restoring a
   * checkpoint, reverting a change, undoing a person — and a wholesale file
   * replacement is never someone typing. Untagged, peers recorded the initiator
   * as the author of every line in every file a rewind touched, so restoring
   * the project made the restorer look like they had just rewritten it. */
  doc.transact(() => {
    ytext.delete(0, ytext.length);
    if (next) ytext.insert(0, next);
  }, { bulk: true });
  return true;
}

export function encodeCursor(path, index) {
  const ytext = getFileText(path);
  if (!ytext) return null;
  try {
    const rel = Y.createRelativePositionFromTypeIndex(ytext, index);
    return toB64(Y.encodeRelativePosition(rel));
  } catch (e) {
    return null;
  }
}

/** Resolve an anchor against the current document. Returns an offset or null. */
export function decodeCursor(encoded) {
  if (!doc || !encoded) return null;
  try {
    const rel = Y.decodeRelativePosition(fromB64(encoded));
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
    return abs ? abs.index : null;
  } catch (e) {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────
 * Remote edit notifications
 *
 * Only the file on screen carries a Monaco binding, so its observer is the
 * only thing that ever reported a remote change. Edits to every other file
 * still reached the shared document but were invisible to the rest of the app:
 * the store kept stale text for them, and in a local workspace they never
 * reached disk at all.
 *
 * This watches the document itself, so a change is reported wherever it lands.
 * ───────────────────────────────────────────────────────── */

/** Root types are registered by name on the doc, so the name is a lookup. */
function pathOfType(type) {
  if (!doc) return null;
  for (const [name, shared] of doc.share.entries()) {
    if (shared === type && name.startsWith('file:')) return name.slice(5);
  }
  return null;
}

/*
 * The resolved text travels with the notification rather than the receiver
 * reading it back out of the document. The store would otherwise have to
 * import this module, which already imports the store.
 */
function handleAfterTransaction(transaction) {
  const origin = transaction.origin;
  if (!origin || !origin.remote) return;

  /* transaction.changed, NOT changedParentTypes.
   *
   * changedParentTypes is built from observer events, and Yjs only produces
   * those for root types this client has declared by calling getText(). A file
   * nobody here has opened is a bare AbstractType with no observer, so it
   * contributes no event and the whole set comes back empty — which is exactly
   * the case this listener exists for: somebody edits a file you do not have
   * open, and it breaks the one you do. transaction.changed is populated
   * whenever items are added or removed, declared or not. */
  const paths = [];
  transaction.changed.forEach((_subs, type) => {
    const path = pathOfType(type);
    if (path) paths.push(path);
  });
  if (paths.length === 0) return;

  const author = origin.userId || null;
  const bulk = Boolean(origin.bulk);

  /* Reading the text means calling getText(), which upgrades a placeholder
   * root type in place — not something to do while the transaction that
   * produced it is still being cleaned up. */
  queueMicrotask(() => {
    if (!doc) return;
    const edits = [];
    paths.forEach((path) => {
      const ytext = getFileText(path);
      if (ytext) edits.push({ path, text: ytext.toString() });
    });
    if (edits.length > 0) {
      useEditorStore.getState().applyRemoteFileEdits(edits, author, bulk);
    }
  });
}

/* ─────────────────────────────────────────────────────────
 * Incoming messages (from the /yjs STOMP topic)
 * ───────────────────────────────────────────────────────── */

export function handleYjsMessage(msg) {
  if (!doc || !msg) return;
  if (msg.senderId && msg.senderId === userId) return; // our own echo

  switch (msg.kind) {
    case 'update':
    case 'sync-state': {
      if (!msg.payload) return;
      /* Arriving is not authoring.
       *
       * `sync-state` is the entire project handed to somebody who has just
       * joined, and a `bulk` update is a file being seeded for the first time.
       * Both land as one large remote transaction, which the attribution layer
       * would otherwise read as the sender having typed every line of every
       * file — so joining a session made whoever answered the sync look like
       * the author of the whole project, and offered to "undo" it. */
      if (msg.kind === 'sync-state') syncReceived = true;
      const bulk = msg.kind === 'sync-state' || Boolean(msg.bulk);
      Y.applyUpdate(doc, fromB64(msg.payload), { remote: true, userId: msg.senderId, bulk });
      break;
    }
    case 'sync-request': {
      // A peer just joined — hand them our full current state.
      const state = Y.encodeStateAsUpdate(doc);
      sendFn?.({ kind: 'sync-state', senderId: userId, payload: toB64(state) });
      break;
    }
    default:
      break;
  }
}

/* ─────────────────────────────────────────────────────────
 * Seeding — populate a fresh file from the backend's plain text
 * ───────────────────────────────────────────────────────── */

/**
 * If a file's Y.Text is still empty after the join sync, seed it from
 * the backend content already loaded into the store. Whoever opens the
 * file first seeds it; later joiners get it via sync and skip seeding.
 */
export function maybeSeed(path) {
  if (!doc || !path || seededPaths.has(path)) return;
  const ytext = getFileText(path);
  if (!ytext || ytext.length > 0) { seededPaths.add(path); return; }

  const state = useEditorStore.getState();
  const content = (state.files && state.files[path]) || '';
  if (!content) return; // nothing to seed with

  const doSeed = () => {
    if (ytext.length > 0) { seededPaths.add(path); return; } // sync beat us to it
    seededPaths.add(path);
    doc.transact(() => { ytext.insert(0, content); }, { seed: true });
  };

  const others = (state.connectedUsers || []).length;
  if (others <= 1) {
    doSeed(); // we're effectively alone — safe to seed immediately (no flash)
    return;
  }

  /* Somebody else is here, so this document may already hold the file. Wait for
   * the fact rather than for a duration: poll until a peer's state has actually
   * merged, then seed only if the text is still empty afterwards.
   *
   * The owner goes first. If two clients both hold the file and both find the
   * document empty, both would seed and the merge would double it again — so
   * the host claims the right to seed, and everyone else allows an extra beat
   * for that to land. A tie is impossible when only one player may move first.
   */
  const isOwner = state.userRole === 'owner';
  const graceMs = isOwner ? 0 : 1500;
  const deadline = Date.now() + 8000;

  const attempt = () => {
    if (ytext.length > 0) { seededPaths.add(path); return; }   // someone got there
    if (syncReceived) { setTimeout(doSeed, graceMs); return; } // we know it is empty
    if (Date.now() > deadline) { doSeed(); return; }           // no peer ever answered
    setTimeout(attempt, 250);
  };
  attempt();
}

/* ─────────────────────────────────────────────────────────
 * Persistence — debounced plain-text save to the backend
 * ───────────────────────────────────────────────────────── */

export function schedulePersist(path, text) {
  if (!sessionId || !path) return;
  clearTimeout(persistTimers[path]);
  persistTimers[path] = setTimeout(() => {
    saveFile(sessionId, path, text).catch((err) =>
      console.error('[collab] persist failed for', path, err)
    );
  }, 1500);
}

/* ─────────────────────────────────────────────────────────
 * Custom Monaco <-> Y.Text binding
 * Applies remote deltas surgically with model.applyEdits (preserving
 * the cursor/selection) and translates local Monaco edits into Y ops.
 * ───────────────────────────────────────────────────────── */

/* Depth of in-flight remote applies.
 *
 * Monaco puts no "this came from the network" flag on its content-change
 * events — IModelContentChange carries only range/offset/length/text. So
 * anything that must tell a collaborator's edit apart from the user's own
 * typing has to ask us. Follow mode is the main caller: it exits when you
 * start editing, and without this it would read every incoming keystroke from
 * the person you're following as your own and drop you out.
 *
 * A counter, not a boolean, so overlapping applies can't have the inner one
 * clear the flag while the outer is still running.
 */
let remoteApplyDepth = 0;

/** True while a remote edit is being written into a Monaco model. */
export const isApplyingRemote = () => remoteApplyDepth > 0;

/**
 * @returns {{destroy: () => void}}
 */
export function createBinding(ytext, model, monaco, { path, onLocalChange, onRemoteChange }) {
  let applyingRemote = false;
  const bindingOrigin = { binding: true };

  /* Wrap every write this binding makes into the model. The try/finally
   * matters: a throw that left the flag raised would silently disable
   * follow-mode's exit-on-typing for the rest of the session. */
  const asRemoteApply = (fn) => {
    applyingRemote = true;
    remoteApplyDepth += 1;
    try {
      fn();
    } finally {
      remoteApplyDepth = Math.max(0, remoteApplyDepth - 1);
      applyingRemote = false;
    }
  };

  // Initial content sync: make the model match the shared Y.Text. Seeding of a
  // fresh file happens in maybeSeed() (called before this), which is
  // collaboration-aware — so by now the Y.Text already holds the right content.
  const initial = ytext.toString();
  if (model.getValue() !== initial) asRemoteApply(() => model.setValue(initial));

  // Y.Text -> Monaco (remote edits arrive here)
  const yObserver = (event, transaction) => {
    // Our own local edits are already in the model — skip re-applying them.
    if (transaction.origin === bindingOrigin) return;

    asRemoteApply(() => {
      let index = 0;
      event.delta.forEach((op) => {
        if (op.retain != null) {
          index += op.retain;
        } else if (op.insert != null) {
          const pos = model.getPositionAt(index);
          model.applyEdits([{
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: op.insert,
            forceMoveMarkers: true,
          }]);
          index += op.insert.length;
        } else if (op.delete != null) {
          const from = model.getPositionAt(index);
          const to = model.getPositionAt(index + op.delete);
          model.applyEdits([{
            range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
            text: '',
          }]);
        }
      });
    });

    const text = ytext.toString();
    const remoteUid = transaction.origin && transaction.origin.remote ? transaction.origin.userId : null;
    /* Seeding is this client pushing already-existing content into an empty
       shared document — an upload, or a file opened for the first time. It runs
       as a local transaction, so without this flag the attribution layer reads
       it as the local user having typed the entire file, and a freshly uploaded
       project shows its opener as the author of every line in it. maybeSeed
       tags the transaction; this is where that tag has to be honoured. */
    const seed = Boolean(transaction.origin && transaction.origin.seed);

    /* The same distinction, for content arriving from a PEER.
     *
     * `seed` above covers this client pushing a file into the shared document.
     * The other half is receiving one: the sync handshake, or a peer's own seed
     * relayed to us. Both are already tagged `bulk` on the incoming
     * transaction — handleAfterTransaction reads it and suppresses attribution
     * for every file that is not open.
     *
     * The open file took the other road and the flag was simply dropped here,
     * so the ONE file the user happened to be looking at got the whole of its
     * arriving contents recorded as the sender's work. That is why a checkpoint
     * taken after nothing more than an upload credited whoever opened a file
     * with authoring every line in it. */
    const bulk = Boolean(transaction.origin && transaction.origin.bulk);
    if (remoteUid) onRemoteChange?.(path, text, remoteUid, bulk);
    else onLocalChange?.(path, text, { seed });
  };
  ytext.observe(yObserver);

  // Monaco -> Y.Text (local typing)
  // NB: on a text *model* the event is onDidChangeContent
  // (onDidChangeModelContent exists only on the editor instance).
  const modelListener = model.onDidChangeContent((e) => {
    if (applyingRemote) return;
    doc.transact(() => {
      // Apply highest offset first so earlier offsets stay valid.
      const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
      changes.forEach((c) => {
        if (c.rangeLength > 0) ytext.delete(c.rangeOffset, c.rangeLength);
        if (c.text) ytext.insert(c.rangeOffset, c.text);
      });
    }, bindingOrigin);
    onLocalChange?.(path, model.getValue());
  });

  return {
    destroy() {
      try { ytext.unobserve(yObserver); } catch (e) { /* ignore */ }
      try { modelListener.dispose(); } catch (e) { /* ignore */ }
    },
  };
}
