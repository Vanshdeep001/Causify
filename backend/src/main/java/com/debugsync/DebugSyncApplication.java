/*
 * DebugSyncApplication.java — Main Entry Point
 * 
 * This is the starting point for the DebugSync backend.
 * Spring Boot will scan this package and all sub-packages
 * for components, controllers, services, and repositories.
 */
package com.debugsync;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DebugSyncApplication {

    public static void main(String[] args) {
        SpringApplication.run(DebugSyncApplication.class, args);
    }
}
