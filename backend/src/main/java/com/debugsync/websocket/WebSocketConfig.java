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

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
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
        // Enable a simple in-memory message broker for /topic destinations
        registry.enableSimpleBroker("/topic");
        // Prefix for messages FROM the client TO the server
        registry.setApplicationDestinationPrefixes("/app");
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
