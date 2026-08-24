/*
 * AiConfigStore.java — the AI provider settings, kept across restarts
 *
 * ── Why this exists at all ──
 *
 * The key already had a home: Electron encrypts it with the OS keychain
 * (safeStorage) and hands it to the backend as AI_API_KEY. That works, and it
 * is the better store — but only along one path, when the packaged app spawns
 * the packaged jar. Run the backend any other way — `mvn spring-boot:run`, a
 * jar started by hand, the browser at :5173 with no Electron at all — and the
 * env var is never set, so the key is asked for again on every restart. The
 * user had entered one; nothing was reading it.
 *
 * So the backend keeps its own copy. It is the one process that is always
 * present whichever way the app was started, which makes it the only place a
 * setting can live and be found again every time.
 *
 * ── Precedence ──
 *
 * AI_API_KEY (env) wins when set: an explicitly supplied credential should not
 * be quietly overruled by a file. This is consulted only when nothing else has
 * configured the service, and it is written on every successful activation, so
 * the two stay in step rather than competing.
 *
 * ── What is stored, and how safe it is ──
 *
 * The whole configuration, not just the key. A key alone cannot restore a
 * custom provider, a named model or a base URL, so restoring one would silently
 * drop the other three and send the next request to a different model than the
 * user chose.
 *
 * The file is NOT encrypted, and this is worth being plain about: it is a
 * credential in a JSON file under the user's own profile, the same shape as
 * ~/.aws/credentials, .git-credentials or .npmrc. Anything with read access to
 * that profile can read the key. Java has no portable binding to DPAPI or the
 * macOS keychain, and encrypting with a second secret kept beside it would be
 * theatre rather than protection. Where the desktop app is doing the launching,
 * the safeStorage copy remains the primary one and this is a mirror; run any
 * other way, this is the only thing standing between the user and typing their
 * key in again every morning. Permissions are narrowed to the owner wherever
 * the filesystem supports it.
 */
package com.debugsync.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

@Component
public class AiConfigStore {

    private static final Logger log = LoggerFactory.getLogger(AiConfigStore.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Beside the H2 database, for the same reason: the user profile survives updates. */
    @Value("${CAUSIFY_DATA_DIR:./data}")
    private String dataDir;

    /** What was last activated. Every field may be blank except the key. */
    public static class Saved {
        public final String key;
        public final String provider;
        public final String model;
        public final String baseUrl;

        Saved(String key, String provider, String model, String baseUrl) {
            this.key = key;
            this.provider = provider;
            this.model = model;
            this.baseUrl = baseUrl;
        }
    }

    private Path file() {
        return Paths.get(dataDir, "ai-config.json");
    }

    /** @return the stored configuration, or null when there is none to read */
    public Saved load() {
        Path path = file();
        if (!Files.exists(path)) return null;

        try {
            JsonNode root = MAPPER.readTree(Files.readString(path));
            String key = root.path("key").asText("");
            // A file with no key in it configures nothing, and treating it as a
            // configuration would leave the service "set up" with no credential.
            if (key.isBlank()) return null;

            return new Saved(
                    key,
                    root.path("provider").asText(""),
                    root.path("model").asText(""),
                    root.path("baseUrl").asText(""));
        } catch (Exception e) {
            log.warn("[AiConfig] Could not read {}: {}", path, e.getMessage());
            return null;
        }
    }

    /** Remember this configuration for the next launch. Never throws. */
    public void save(String key, String provider, String model, String baseUrl) {
        if (key == null || key.isBlank()) {
            clear();
            return;
        }

        Path path = file();
        try {
            Files.createDirectories(path.getParent());

            ObjectNode root = MAPPER.createObjectNode();
            root.put("key", key);
            root.put("provider", provider == null ? "" : provider);
            root.put("model", model == null ? "" : model);
            root.put("baseUrl", baseUrl == null ? "" : baseUrl);

            Files.writeString(path, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root));
            restrictToOwner(path);
            log.info("[AiConfig] Saved provider settings to {}", path);
        } catch (Exception e) {
            /* Best effort by design. Failing to remember the key must never fail
               the activation the user just completed successfully — they end up
               with a working session that asks again next launch, which is the
               old behaviour rather than a new fault. */
            log.warn("[AiConfig] Could not save provider settings: {}", e.getMessage());
        }
    }

    /** Forget it. Called when the user removes their key. */
    public void clear() {
        try {
            Files.deleteIfExists(file());
        } catch (Exception e) {
            log.warn("[AiConfig] Could not delete stored provider settings: {}", e.getMessage());
        }
    }

    /**
     * Owner-only, where the filesystem has an opinion.
     *
     * A no-op on Windows, whose ACLs are not reachable through this API — the
     * file is already inside the user's own profile there. Silent on failure
     * because a permission that could not be tightened is not a reason to
     * refuse to store the setting.
     */
    private void restrictToOwner(Path path) {
        try {
            Files.setPosixFilePermissions(path, Set.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException | java.io.IOException ignored) {
            // Windows, or a filesystem without POSIX bits.
        }
    }
}
