/*
 * SessionTokenStore.java — proof that a remote caller actually joined
 *
 * The desktop app publishes its backend through a Cloudflare tunnel so an
 * invited collaborator can reach a session. That also makes every endpoint
 * publicly addressable, and some of them run commands on the host: /api/execute
 * compiles and runs submitted code, /api/dev-server/start runs npm scripts,
 * /api/auto-fix executes model-written patches.
 *
 * The session password guards JOINING a session. It never guarded the API, so
 * anyone holding the tunnel URL could call those endpoints directly and run
 * code on the host — no session membership required. This closes that gap:
 * joining hands back a token, and RemoteAccessGuardFilter demands one for
 * command-running endpoints when the request arrives from off-machine.
 *
 * Deliberately in memory. Sessions are ephemeral and a restart mints a new
 * tunnel URL anyway, so tokens surviving a restart would buy nothing and would
 * mean persisting credentials that no longer address anything.
 *
 * This is a membership check, not a sandbox. It reduces the reachable set from
 * "anyone with the URL" to "people who were invited"; it does not defend
 * against an invited collaborator who is hostile. That needs process isolation.
 */
package com.debugsync.config;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SessionTokenStore {

    private final Map<String, String> tokenToSession = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    /** Mint a token for someone who has just proved they belong in a session. */
    public String issue(String sessionId) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        tokenToSession.put(token, sessionId);
        return token;
    }

    /** @return true when this token was issued by us and has not been revoked */
    public boolean isValid(String token) {
        return token != null && !token.isBlank() && tokenToSession.containsKey(token);
    }

    /** The session a token belongs to, or null. */
    public String sessionFor(String token) {
        return token == null ? null : tokenToSession.get(token);
    }

    public void revoke(String token) {
        if (token != null) tokenToSession.remove(token);
    }

    /** Drop every token for a session — used when the session itself goes away. */
    public void revokeSession(String sessionId) {
        if (sessionId == null) return;
        tokenToSession.entrySet().removeIf(e -> sessionId.equals(e.getValue()));
    }
}
