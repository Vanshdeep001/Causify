/*
 * RootCauseResponse.java — Standalone root cause analysis response
 */
package com.debugsync.dto;

import java.util.List;

public class RootCauseResponse {
    private String errorType;
    private String errorMessage;
    private int errorLine;
    private List<ExecutionResponse.StepData> steps;
    private String suspectedVariable;
    private String suspectedChange;
    private String explanation;
    private double confidence;
    private String whatHappened;
    private String rootCauseChain;
    private String howToFix;
    private String proTip;
    private String fullAiAnalysis;
    private java.util.Map<String, String> semanticContext;
    private ExecutionResponse.CausalityGraphData causalityGraph;

    public RootCauseResponse() {}

    public String getErrorType() { return errorType; }
    public void setErrorType(String errorType) { this.errorType = errorType; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public int getErrorLine() { return errorLine; }
    public void setErrorLine(int errorLine) { this.errorLine = errorLine; }
    public List<ExecutionResponse.StepData> getSteps() { return steps; }
    public void setSteps(List<ExecutionResponse.StepData> steps) { this.steps = steps; }
    public String getSuspectedVariable() { return suspectedVariable; }
    public void setSuspectedVariable(String suspectedVariable) { this.suspectedVariable = suspectedVariable; }
    public String getSuspectedChange() { return suspectedChange; }
    public void setSuspectedChange(String suspectedChange) { this.suspectedChange = suspectedChange; }
    public String getExplanation() { return explanation; }
    public void setExplanation(String explanation) { this.explanation = explanation; }
    public double getConfidence() { return confidence; }
    public void setConfidence(double confidence) { this.confidence = confidence; }

    public String getWhatHappened() { return whatHappened; }
    public void setWhatHappened(String whatHappened) { this.whatHappened = whatHappened; }
    public String getRootCauseChain() { return rootCauseChain; }
    public void setRootCauseChain(String rootCauseChain) { this.rootCauseChain = rootCauseChain; }
    public String getHowToFix() { return howToFix; }
    public void setHowToFix(String howToFix) { this.howToFix = howToFix; }
    public String getProTip() { return proTip; }
    public void setProTip(String proTip) { this.proTip = proTip; }
    public String getFullAiAnalysis() { return fullAiAnalysis; }
    public void setFullAiAnalysis(String fullAiAnalysis) { this.fullAiAnalysis = fullAiAnalysis; }
    public java.util.Map<String, String> getSemanticContext() { return semanticContext; }
    public void setSemanticContext(java.util.Map<String, String> semanticContext) { this.semanticContext = semanticContext; }

    public ExecutionResponse.CausalityGraphData getCausalityGraph() { return causalityGraph; }
    public void setCausalityGraph(ExecutionResponse.CausalityGraphData causalityGraph) { this.causalityGraph = causalityGraph; }
}
