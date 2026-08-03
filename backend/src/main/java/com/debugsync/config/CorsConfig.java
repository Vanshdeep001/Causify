/*
 * CorsConfig.java — CORS configuration for frontend-backend communication
 *
 * The allow-list used to be localhost and 127.0.0.1 only, which was correct
 * while every client ran on the same machine as the backend. It is not, now
 * that a session can be joined from another laptop:
 *
 *   - a peer on the same wifi calls in from http://192.168.x.x:8080
 *   - a peer over the internet calls in from https://<name>.trycloudflare.com
 *   - the packaged desktop app loads from file://, whose requests carry the
 *     opaque origin "null"
 *
 * All three were rejected. Patterns are open here because the sensitive
 * surface is closed elsewhere and by stronger means: RemoteAccessGuardFilter
 * keeps the H2 console and process-control endpoints off the network
 * entirely, and joining a session still requires its id and password.
 *
 * Credentials are off deliberately. Nothing in this app authenticates with
 * cookies, and browsers refuse the "null" origin when credentials are
 * allowed — so leaving it on would block the desktop app for no benefit.
 */
package com.debugsync.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns("*")
            .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            .allowCredentials(false)
            .maxAge(3600);
    }
}
