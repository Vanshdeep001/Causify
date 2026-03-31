/*
 * ExecutionResponse.java — Full response from code execution
 * Contains output, errors, snapshot, root cause, and causality graph.
 */
package com.debugsync.dto;

import java.util.List;

public class ExecutionResponse {
    private String output;
    private String error;
    private long executionTimeMs;
    private SnapshotData snapshot;
    private RootCauseData rootCause;
    private CausalityGraphData causalityGraph;

    public ExecutionResponse() {}

    public String getOutput() { return output; }
    public void setOutput(String output) { this.output = output; }
    public String getError() { return error; }
    public void setError(String error) { this.error = error; }
    public long getExecutionTimeMs() { return executionTimeMs; }
    public void setExecutionTimeMs(long executionTimeMs) { this.executionTimeMs = executionTimeMs; }
    public SnapshotData getSnapshot() { return snapshot; }
    public void setSnapshot(SnapshotData snapshot) { this.snapshot = snapshot; }
    public RootCauseData getRootCause() { return rootCause; }
    public void setRootCause(RootCauseData rootCause) { this.rootCause = rootCause; }
    public CausalityGraphData getCausalityGraph() { return causalityGraph; }
    public void setCausalityGraph(CausalityGraphData causalityGraph) { this.causalityGraph = causalityGraph; }

    /* ---- Nested data classes ---- */

    public static class SnapshotData {
        private String id;
        private String code;
        private String userId;
        private String timestamp;
        private String diff;
        private boolean hasError;

        public SnapshotData() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getCode() { return code; }
        public void setCode(String code) { this.code = code; }
        public String getUserId() { return userId; }
        public void setUserId(String userId) { this.userId = userId; }
        public String getTimestamp() { return timestamp; }
        public void setTimestamp(String timestamp) { this.timestamp = timestamp; }
        public String getDiff() { return diff; }
        public void setDiff(String diff) { this.diff = diff; }
        public boolean isHasError() { return hasError; }
        public void setHasError(boolean hasError) { this.hasError = hasError; }
    }

    public static class RootCauseData {
        private String errorType;
        private String errorMessage;
        private int errorLine;
        private List<StepData> steps;
        private String suspectedVariable;
        private String suspectedChange;
        private String explanation;
        private double confidence;

        public RootCauseData() {}

        public String getErrorType() { return errorType; }
        public void setErrorType(String errorType) { this.errorType = errorType; }
        public String getErrorMessage() { return errorMessage; }
        public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
        public int getErrorLine() { return errorLine; }
        public void setErrorLine(int errorLine) { this.errorLine = errorLine; }
        public List<StepData> getSteps() { return steps; }
        public void setSteps(List<StepData> steps) { this.steps = steps; }
        public String getSuspectedVariable() { return suspectedVariable; }
        public void setSuspectedVariable(String suspectedVariable) { this.suspectedVariable = suspectedVariable; }
        public String getSuspectedChange() { return suspectedChange; }
        public void setSuspectedChange(String suspectedChange) { this.suspectedChange = suspectedChange; }
        public String getExplanation() { return explanation; }
        public void setExplanation(String explanation) { this.explanation = explanation; }
        public double getConfidence() { return confidence; }
        public void setConfidence(double confidence) { this.confidence = confidence; }
    }

    public static class StepData {
        private int step;
        private String label;
        private String detail;

        public StepData() {}

        public StepData(int step, String label, String detail) {
            this.step = step;
            this.label = label;
            this.detail = detail;
        }

        public int getStep() { return step; }
        public void setStep(int step) { this.step = step; }
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
        public String getDetail() { return detail; }
        public void setDetail(String detail) { this.detail = detail; }
    }

    public static class CausalityGraphData {
        private List<GraphNode> nodes;
        private List<GraphEdge> edges;

        public CausalityGraphData() {}

        public List<GraphNode> getNodes() { return nodes; }
        public void setNodes(List<GraphNode> nodes) { this.nodes = nodes; }
        public List<GraphEdge> getEdges() { return edges; }
        public void setEdges(List<GraphEdge> edges) { this.edges = edges; }
    }

    public static class GraphNode {
        private String id;
        private String type;
        private String label;
        private String detail;
        private String user;

        public GraphNode() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
        public String getDetail() { return detail; }
        public void setDetail(String detail) { this.detail = detail; }
        public String getUser() { return user; }
        public void setUser(String user) { this.user = user; }
    }

    public static class GraphEdge {
        private String id;
        private String source;
        private String target;
        private String label;

        public GraphEdge() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getSource() { return source; }
        public void setSource(String source) { this.source = source; }
        public String getTarget() { return target; }
        public void setTarget(String target) { this.target = target; }
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
    }
}
