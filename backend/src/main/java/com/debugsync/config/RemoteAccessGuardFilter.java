/*
 * RemoteAccessGuardFilter.java — keeps machine-local endpoints off the internet
 *
 * The desktop app can publish its backend through a Cloudflare tunnel so an
 * invited collaborator can reach a session hosted on someone's laptop. That
 * makes port 8080 publicly addressable, and a few endpoints exist only to
 * serve the machine the backend runs on:
 *
 *   /h2-console/**   — a full database console; catastrophic if exposed
 *   /api/system/**   — process control, including shutdown
 *   /actuator/**     — environment and configuration detail
 *
 * A remote-address check alone does not defend these. cloudflared runs ON the
 * host and forwards to 127.0.0.1, so tunnelled requests arrive at Spring
 * looking exactly like local ones — request.getRemoteAddr() is loopback for
 * both. What separates them is the proxy headers Cloudflare adds on the way
 * in, so those are what this inspects.
 *
 * Guarded paths answer 404 rather than 403: a forbidden response confirms the
 * console is there, and there is no reason to tell a scanner that.
 */
package com.debugsync.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Set;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RemoteAccessGuardFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RemoteAccessGuardFilter.class);

    private static final Set<String> LOOPBACK =
        Set.of("127.0.0.1", "0:0:0:0:0:0:0:1", "::1", "localhost");

    /** Endpoints that must only ever serve the machine running the backend. */
    private static final List<String> GUARDED_PREFIXES =
        List.of("/h2-console", "/api/system", "/actuator");

    /**
     * Headers a reverse proxy adds. Their presence means the request did not
     * originate on this machine, whatever the socket address claims.
     */
    private static final List<String> PROXY_HEADERS = List.of(
        "cf-connecting-ip",
        "cf-ray",
        "cf-ipcountry",
        "cf-visitor",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-real-ip",
        "forwarded"
    );

    /**
     * True when a request reached us from anywhere other than this machine —
     * including via a tunnel, which is invisible to an address check alone.
     */
    public static boolean isRemote(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        if (remote != null && !LOOPBACK.contains(remote)) {
            return true;
        }
        for (String header : PROXY_HEADERS) {
            if (request.getHeader(header) != null) {
                return true;
            }
        }
        return false;
    }

    private static boolean isGuarded(String path) {
        if (path == null) return false;
        for (String prefix : GUARDED_PREFIXES) {
            if (path.equals(prefix) || path.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {

        String path = request.getRequestURI();
        if (isGuarded(path) && isRemote(request)) {
            log.warn("[Security] Blocked remote access to {} (from {})",
                path, request.getRemoteAddr());
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        chain.doFilter(request, response);
    }
}
