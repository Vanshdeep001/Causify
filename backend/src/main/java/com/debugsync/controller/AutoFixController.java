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
        if (request == null) {
            return ResponseEntity.badRequest().build();
        }

        /* Only file mode can be rejected for having no code. In project mode the
         * code is the thing being looked for — the caller sends a log and a
         * folder, and the agent finds the file itself. Rejecting on a blank
         * `code` here would make project mode unreachable.
         *
         * A project request still has to say WHERE, so that is checked instead;
         * anything past that is the service's to answer, including "I couldn't
         * work out which file this is about", which is a real answer and not a
         * bad request. */
        if (request.isProjectMode()) {
            if (request.getProjectPath() == null || request.getProjectPath().isBlank()) {
                return ResponseEntity.badRequest().build();
            }
        } else if (request.getCode() == null || request.getCode().isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(autoFixService.generateFix(request));
    }
}
