/*
 * ExecutionController.java — REST endpoint for running code
 * Thin controller — delegates all logic to ExecutionService.
 */
package com.debugsync.controller;

import com.debugsync.dto.ExecutionRequest;
import com.debugsync.dto.ExecutionResponse;
import com.debugsync.service.ExecutionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ExecutionController {

    private final ExecutionService executionService;

    public ExecutionController(ExecutionService executionService) {
        this.executionService = executionService;
    }

    @PostMapping("/execute")
    public ResponseEntity<ExecutionResponse> execute(@RequestBody ExecutionRequest request) {
        return ResponseEntity.ok(executionService.executeCode(request));
    }
}
