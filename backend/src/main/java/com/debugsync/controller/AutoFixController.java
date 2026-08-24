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

    /**
     * A rejection that says why.
     *
     * These used to be {@code badRequest().build()} — a bare 400 with no body,
     * which axios reports to the user as "Request failed with status code 400"
     * and nothing else. That is the whole message: no file named, no reason, no
     * next step. The endpoint knows exactly what was missing, so it says so,
     * and the panel already renders `message` from an error body.
     */
    private ResponseEntity<AutoFixResponse> reject(String why) {
        AutoFixResponse body = new AutoFixResponse();
        body.setStatus(AutoFixResponse.NO_FIX);
        body.setMessage(why);
        return ResponseEntity.badRequest().body(body);
    }

    @PostMapping("/auto-fix")
    public ResponseEntity<AutoFixResponse> autoFix(@RequestBody AutoFixRequest request) {
        if (request == null) {
            return reject("The auto-fix request was empty.");
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
                return reject("The agent was asked to repair a project but not told which folder.");
            }
        } else if (!request.hasInstruction()
                && (request.getCode() == null || request.getCode().isBlank())) {
            /* Blank code is only a bad request when nobody said what to do with
             * it. Asked to WRITE something, an empty file is the normal
             * starting point — a file created a second ago is exactly when you
             * want to tell an agent what to put in it, and rejecting that at
             * the door turned it into an unexplained 400. The service decides
             * everything past this point; see resolveFileTarget. */
            return reject("This file is empty, so there is nothing to repair. "
                    + "Tell the agent what to write and it will fill it in.");
        }

        return ResponseEntity.ok(autoFixService.generateFix(request));
    }
}
