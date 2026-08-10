/*
 * WebSocketConfig.java — WebSocket + STOMP Configuration
 * 
 * Configures the WebSocket connection for real-time collaboration.
 * Uses STOMP protocol over SockJS for browser compatibility.
 * 
 * How it works:
 *   1. Client connects to /ws endpoint via SockJS
 *   2. Messages sent to /app/... are handled by controllers
 *   3. Messages broadcast to /topic/... are sent to all subscribers
 */
package com.debugsync.websocket;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.config.annotation.*;

@Configuration
@EnableWebSocketMessageBroker  // Enables STOMP messaging over WebSocket
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    /*
     * Configure the message broker:
     *   - /topic → broadcast messages to all subscribers
     *   - /app  → messages sent from client to server
     */
    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        /* Heartbeats, every 10s in both directions.
         *
         * Without them a connection can die without either side noticing. The
         * host's laptop sleeps, the Wi-Fi drops, Cloudflare rotates the edge
         * node — the socket is dead, but no close event fires because neither
         * end has tried to send anything. Collaborators keep typing into a
         * session that is no longer there.
         *
         * A missed beat is what turns that silent half-open connection into a
         * detectable close, which is what the client's disconnect monitor
         * needs in order to say anything at all.
         *
         * setTaskScheduler is not optional here: the simple broker silently
         * declines to negotiate heartbeats without one, so the values above
         * would be advertised and never honoured. */
        registry.enableSimpleBroker("/topic")
                .setHeartbeatValue(new long[] { 10000, 10000 })
                .setTaskScheduler(heartbeatScheduler());
        // Prefix for messages FROM the client TO the server
        registry.setApplicationDestinationPrefixes("/app");
    }

    /** Drives broker heartbeats. One thread is ample for a handful of peers. */
    @Bean
    public TaskScheduler heartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("ws-heartbeat-");
        scheduler.initialize();
        return scheduler;
    }

    /*
     * Register the WebSocket endpoint that clients connect to.
     * SockJS is used as a fallback for browsers that don't support WebSocket.
     */
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
            .setAllowedOriginPatterns("*")  // Allow all origins (dev mode)
            .withSockJS();                   // Enable SockJS fallback
    }
}
