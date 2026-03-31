/*
 * RootCauseController.java — Standalone root cause analysis endpoint
 */
package com.debugsync.controller;

import com.debugsync.dto.ExecutionResponse;
import com.debugsync.dto.RootCauseResponse;
import com.debugsync.model.ErrorLog;
import com.debugsync.service.CausalityGraphService;
import com.debugsync.service.RootCauseService;
import com.debugsync.util.ErrorParser;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class RootCauseController {

    private final RootCauseService rootCauseService;
    private final CausalityGraphService causalityGraphService;

    public RootCauseController(RootCauseService rootCauseService, CausalityGraphService causalityGraphService) {
        this.rootCauseService = rootCauseService;
        this.causalityGraphService = causalityGraphService;
    }

    @PostMapping("/root-cause")
    public ResponseEntity<RootCauseResponse> analyzeRootCause(@RequestBody Map<String, String> body) {
        String sessionId = body.getOrDefault("sessionId", "");
        String error = body.getOrDefault("error", "");
        String code = body.getOrDefault("code", "");

        ErrorLog parsedError = ErrorParser.parse(error, code);
        if (parsedError == null) return ResponseEntity.badRequest().build();

        ExecutionResponse.RootCauseData rootCauseData = rootCauseService.analyze(parsedError, code, sessionId);

        ExecutionResponse.CausalityGraphData graphData = null;
        if (rootCauseData != null)
            graphData = causalityGraphService.buildCausalityGraph(parsedError, rootCauseData, code);

        RootCauseResponse response = new RootCauseResponse();
        response.setErrorType(rootCauseData != null ? rootCauseData.getErrorType() : parsedError.getType());
        response.setErrorMessage(rootCauseData != null ? rootCauseData.getErrorMessage() : parsedError.getMessage());
        response.setErrorLine(rootCauseData != null ? rootCauseData.getErrorLine() : parsedError.getLineNumber());
        response.setSteps(rootCauseData != null ? rootCauseData.getSteps() : null);
        response.setSuspectedVariable(rootCauseData != null ? rootCauseData.getSuspectedVariable() : null);
        response.setSuspectedChange(rootCauseData != null ? rootCauseData.getSuspectedChange() : null);
        response.setExplanation(rootCauseData != null ? rootCauseData.getExplanation() : null);
        response.setConfidence(rootCauseData != null ? rootCauseData.getConfidence() : 0);
        response.setCausalityGraph(graphData);

        return ResponseEntity.ok(response);
    }
}
