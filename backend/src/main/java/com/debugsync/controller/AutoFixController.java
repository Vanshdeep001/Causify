/*
 * AutoFixController.java — Autonomous repair endpoint
 *
 * Returns a proposed patch. It never writes to the user's file: the frontend
 * shows the diff and applies it only once the user accepts.
 */
package com.debugsync.controller;

import com.debugsync.dto.AutoFixRequest;
import com.debugsync.dto.AutoFixResponse;
import com.debugsync.service.AutoFixService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AutoFixController {

    private final AutoFixService autoFixService;

    public AutoFixController(AutoFixService autoFixService) {
        this.autoFixService = autoFixService;
    }

    @PostMapping("/auto-fix")
    public ResponseEntity<AutoFixResponse> autoFix(@RequestBody AutoFixRequest request) {
        if (request == null || request.getCode() == null || request.getCode().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(autoFixService.generateFix(request));
    }
}
