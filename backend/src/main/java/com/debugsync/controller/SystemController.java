/*
 * SystemController.java — Process-level endpoints for the desktop shell
 *
 * The Electron app previously terminated the backend with `taskkill /F`, so the
 * Spring context never closed: dev-server child processes were orphaned and H2
 * never got a clean shutdown. This gives the shell a way to ask for an orderly
 * exit, with the force-kill kept only as a timeout fallback.
 */
package com.debugsync.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/system")
public class SystemController {

    private static final Logger log = LoggerFactory.getLogger(SystemController.class);

    /** Only the machine running the backend may shut it down. */
    private static final Set<String> LOOPBACK = Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1");

    private final ApplicationContext context;

    public SystemController(ApplicationContext context) {
        this.context = context;
    }

    /** Liveness probe — lets the shell confirm the backend is reachable. */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "UP"));
    }

    /**
     * Close the application context and exit.
     *
     * We reply before exiting so the caller gets a response rather than a
     * connection reset, then shut down on a separate thread. Closing the context
     * runs {@code @PreDestroy} hooks — notably DevServerService.cleanup(), which
     * kills running dev servers — and closes the connection pool so H2 releases
     * its file lock cleanly.
     */
    @PostMapping("/shutdown")
    public ResponseEntity<Map<String, String>> shutdown(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        if (!LOOPBACK.contains(remote)) {
            log.warn("[System] Rejected shutdown request from non-loopback address {}", remote);
            return ResponseEntity.status(403).body(Map.of("message", "Shutdown is only permitted from localhost"));
        }

        log.info("[System] Graceful shutdown requested — closing application context");

        Thread closer = new Thread(() -> {
            try {
                // Give the HTTP response time to flush before the server stops.
                Thread.sleep(250);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            int code = SpringApplication.exit(context, () -> 0);
            System.exit(code);
        }, "causify-shutdown");
        closer.setDaemon(false);
        closer.start();

        return ResponseEntity.ok(Map.of("status", "SHUTTING_DOWN"));
    }
}
