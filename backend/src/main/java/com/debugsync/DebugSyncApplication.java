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
import org.springframework.scheduling.annotation.EnableScheduling;

// Scheduling drives SessionCleanupService's sweep, which keeps abandoned
// sessions from accumulating in the database.
@EnableScheduling
@SpringBootApplication
public class DebugSyncApplication {

    public static void main(String[] args) {
        SpringApplication.run(DebugSyncApplication.class, args);
    }

}
