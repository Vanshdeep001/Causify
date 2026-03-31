/*
 * CausalityGraphService.java — Builds cause-effect chain and execution flow graphs
 */
package com.debugsync.service;

import com.debugsync.dto.ExecutionResponse.*;
import com.debugsync.model.ErrorLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.*;

@Service
public class CausalityGraphService {

    private static final Logger log = LoggerFactory.getLogger(CausalityGraphService.class);

    /**
     * Build a causality graph for ERRORS (backwards from error to root cause)
     */
    public CausalityGraphData buildCausalityGraph(ErrorLog error, RootCauseData rootCause, String code) {
        log.info("Building causality graph for {} at line {}", error.getType(), error.getLineNumber());

        List<GraphNode> nodes = new ArrayList<>();
        List<GraphEdge> edges = new ArrayList<>();
        int nodeId = 1;

        // Node 1: The CHANGE
        GraphNode changeNode = createNode("n" + nodeId++, "change", 
            rootCause.getSuspectedVariable() != null ? "Set " + rootCause.getSuspectedVariable() + " = ..." : "Recent code change",
            rootCause.getSuspectedChange() != null ? rootCause.getSuspectedChange() : "Code modification");
        nodes.add(changeNode);

        // Node 2: The VARIABLE
        GraphNode varNode = createNode("n" + nodeId++, "variable",
            rootCause.getSuspectedVariable() != null ? rootCause.getSuspectedVariable() : "affected variable",
            "Variable involved in the error");
        nodes.add(varNode);

        edges.add(createEdge(changeNode.getId(), varNode.getId(), "modifies"));

        // Node 3: The FUNCTION
        String funcName = findFunctionAtLine(code, error.getLineNumber());
        GraphNode funcNode = createNode("n" + nodeId++, "function", funcName, "Function at line " + error.getLineNumber());
        nodes.add(funcNode);

        edges.add(createEdge(varNode.getId(), funcNode.getId(), "used_in"));

        // Node 4: The ERROR
        GraphNode errorNode = createNode("n" + nodeId++, "error", error.getType(), error.getMessage());
        nodes.add(errorNode);

        edges.add(createEdge(funcNode.getId(), errorNode.getId(), "throws"));

        CausalityGraphData graph = new CausalityGraphData();
        graph.setNodes(nodes);
        graph.setEdges(edges);
        return graph;
    }

    /**
     * Build an execution graph for SUCCESSFUL runs.
     * ADAPTIVE: shows fine detail for small code, high-level architecture for large code.
     */
    public CausalityGraphData buildExecutionGraph(String code) {
        log.info("Building execution interaction graph");

        List<GraphNode> nodes = new ArrayList<>();
        List<GraphEdge> edges = new ArrayList<>();
        int nodeId = 1;

        // Strip comment/blank lines for a real line count
        String[] allLines = code.split("\n");
        int realLines = 0;
        for (String l : allLines) {
            String t = l.trim();
            if (!t.isEmpty() && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")) realLines++;
        }
        boolean isSmallCode = realLines < 40;
        // Max functions/vars to show depends on code size
        int maxFunctions = isSmallCode ? 6 : 3;
        int maxVars      = isSmallCode ? 4 : 0;  // No individual vars for large code

        // ── 1. Entry Point ──────────────────────────────────────
        String mainClass = findMainClass(code);
        String entryLabel = mainClass != null ? mainClass + ".main()" : "Program Entry";
        GraphNode entryNode = createNode("e" + nodeId++, "entry", entryLabel, realLines + " lines of code");
        nodes.add(entryNode);

        // ── 2. Detect Functions (capped) ────────────────────────
        Map<String, String> functionNodes = new LinkedHashMap<>();
        Pattern funcPatterns = Pattern.compile(
            "(?:function\\s+([a-zA-Z_$][\\w$]*))|" +
            "(?:(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=\\s*(?:\\(|async))|" +
            "(?:def\\s+([a-zA-Z_][\\w]*)\\s*\\()|" +
            "(?:(?:public|private|protected|static|\\s)+[\\w<>\\[\\]]+\\s+([a-zA-Z_][\\w]*)\\s*\\()"
        );

        List<String> allFuncNames = new ArrayList<>();
        for (int i = 0; i < allLines.length; i++) {
            Matcher m = funcPatterns.matcher(allLines[i]);
            while (m.find()) {
                String name = m.group(1) != null ? m.group(1) :
                              m.group(2) != null ? m.group(2) :
                              m.group(3) != null ? m.group(3) : m.group(4);
                if (name != null && !name.equals("main") && !name.equals("if") && !name.equals("for") && !name.equals("while")) {
                    allFuncNames.add(name);
                    if (functionNodes.size() < maxFunctions) {
                        String nid = "e" + nodeId++;
                        functionNodes.put(name, nid);
                        nodes.add(createNode(nid, "function", name + "()", "Line " + (i + 1)));
                        edges.add(createEdge(entryNode.getId(), nid, "calls"));
                    }
                }
            }
        }
        // If we trimmed functions, add a summary node
        if (allFuncNames.size() > maxFunctions) {
            String nid = "e" + nodeId++;
            nodes.add(createNode(nid, "function", "+" + (allFuncNames.size() - maxFunctions) + " more functions", "Not all shown"));
            edges.add(createEdge(entryNode.getId(), nid, "also defines"));
        }

        // ── 3. Variables (only for small code) ──────────────────
        if (maxVars > 0) {
            Pattern varPattern = Pattern.compile(
                "(?:(?:let|const|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=)|" +
                "(?:(?:int|String|double|float|boolean|long|char|List|Map|Set|ArrayList|HashMap)(?:<[^>]*>)?(?:\\[\\])?\\s+([a-zA-Z_][\\w]*))"
            );
            int varCount = 0;
            for (int i = 0; i < allLines.length && varCount < maxVars; i++) {
                Matcher m = varPattern.matcher(allLines[i]);
                while (m.find() && varCount < maxVars) {
                    String name = m.group(1) != null ? m.group(1) : m.group(2);
                    if (name != null && name.length() > 1 && !name.equals("return") && !name.equals("this")) {
                        String nid = "e" + nodeId++;
                        nodes.add(createNode(nid, "variable", name, "Line " + (i + 1)));
                        edges.add(createEdge(entryNode.getId(), nid, "declares"));
                        varCount++;
                    }
                }
            }
        }

        // ── 4. Loops (only for small code, max 2) ───────────────
        if (isSmallCode) {
            int loopCount = 0;
            for (int i = 0; i < allLines.length && loopCount < 2; i++) {
                String trimmed = allLines[i].trim();
                if (trimmed.startsWith("for ") || trimmed.startsWith("for(") ||
                    trimmed.startsWith("while ") || trimmed.startsWith("while(") ||
                    trimmed.contains(".forEach(") || trimmed.contains(".map(")) {
                    String loopType = trimmed.contains("for") ? "for loop" :
                                      trimmed.contains("while") ? "while loop" : "iteration";
                    String nid = "e" + nodeId++;
                    nodes.add(createNode(nid, "loop", loopType, "Line " + (i + 1)));
                    String parentId = findParentFunction(allLines, i, functionNodes);
                    edges.add(createEdge(parentId != null ? parentId : entryNode.getId(), nid, "iterates"));
                    loopCount++;
                }
            }
        }

        // ── 5. High-level features (always shown) ──────────────

        // HTML Structure
        Set<String> htmlElements = new LinkedHashSet<>();
        Pattern htmlTagPattern = Pattern.compile("<(input|form|button|ul|ol|div|section|header|footer|nav|table|canvas|video|audio|img)\\b", Pattern.CASE_INSENSITIVE);
        for (String line : allLines) {
            Matcher m = htmlTagPattern.matcher(line);
            while (m.find()) htmlElements.add(m.group(1).toLowerCase());
        }
        String htmlNodeId = null;
        if (!htmlElements.isEmpty()) {
            htmlNodeId = "e" + nodeId++;
            nodes.add(createNode(htmlNodeId, "class", "HTML UI", String.join(", ", htmlElements)));
            edges.add(createEdge(entryNode.getId(), htmlNodeId, "renders"));
        }

        // DOM + Events (collapsed into one node)
        boolean hasDom = false;
        boolean hasEvents = false;
        for (String line : allLines) {
            if (line.contains("getElementById") || line.contains("querySelector") ||
                line.contains(".innerHTML") || line.contains(".appendChild") ||
                line.contains("document.createElement")) hasDom = true;
            if (line.contains("addEventListener") || line.contains(".onclick")) hasEvents = true;
        }
        if (hasDom || hasEvents) {
            String nid = "e" + nodeId++;
            String label = (hasDom && hasEvents) ? "DOM + Events" : hasDom ? "DOM Manipulation" : "Event Handling";
            nodes.add(createNode(nid, "condition", label, "User interaction & page updates"));
            if (htmlNodeId != null) {
                edges.add(createEdge(nid, htmlNodeId, "updates"));
            }
            edges.add(createEdge(entryNode.getId(), nid, "wires"));
            // Connect to key functions
            for (Map.Entry<String, String> fn : functionNodes.entrySet()) {
                // Check if any event handler references this function
                for (String line : allLines) {
                    if (line.contains("addEventListener") && line.contains(fn.getKey())) {
                        edges.add(createEdge(nid, fn.getValue(), "triggers"));
                        break;
                    }
                }
            }
        }

        // External APIs (localStorage, fetch, Notification, etc.)
        Set<String> apis = new LinkedHashSet<>();
        for (String line : allLines) {
            if (line.contains("localStorage") || line.contains("sessionStorage")) apis.add("Storage");
            if (line.contains("fetch(") || line.contains("XMLHttpRequest") || line.contains("axios")) apis.add("Network");
            if (line.contains("Notification")) apis.add("Notifications");
            if (line.contains("setInterval") || line.contains("setTimeout")) apis.add("Timers");
        }
        if (!apis.isEmpty()) {
            String nid = "e" + nodeId++;
            nodes.add(createNode(nid, "output", String.join(" + ", apis), "Browser APIs used"));
            edges.add(createEdge(entryNode.getId(), nid, "uses"));
        }

        // Console / Output
        boolean hasOutput = false;
        for (String line : allLines) {
            if (line.contains("console.log") || line.contains("System.out.print") ||
                line.contains("print(") || line.contains("alert(")) {
                hasOutput = true; break;
            }
        }
        if (hasOutput) {
            String nid = "e" + nodeId++;
            nodes.add(createNode(nid, "output", "Console Output", "Prints to stdout"));
            edges.add(createEdge(entryNode.getId(), nid, "outputs"));
        }

        // ── 6. Function call edges ──────────────────────────────
        for (Map.Entry<String, String> fn : functionNodes.entrySet()) {
            for (Map.Entry<String, String> otherFn : functionNodes.entrySet()) {
                if (otherFn.getKey().equals(fn.getKey())) continue;
                for (String line : allLines) {
                    if (line.contains(fn.getKey() + "(") && !line.contains("function " + fn.getKey())
                        && !line.contains("def " + fn.getKey())) {
                        edges.add(createEdge(otherFn.getValue(), fn.getValue(), "calls"));
                        break;
                    }
                }
            }
        }

        // ── 7. Success Node ─────────────────────────────────────
        String nid = "e" + nodeId++;
        int totalFunctions = allFuncNames.size();
        String summary = totalFunctions + " functions, " + realLines + " lines";
        nodes.add(createNode(nid, "success", "✓ Ran Successfully", summary));
        if (!functionNodes.isEmpty()) {
            String lastFnId = new ArrayList<>(functionNodes.values()).get(functionNodes.size() - 1);
            edges.add(createEdge(lastFnId, nid, "completes"));
        } else {
            edges.add(createEdge(entryNode.getId(), nid, "completes"));
        }

        // Deduplicate edges
        Set<String> seenEdges = new HashSet<>();
        edges.removeIf(e -> !seenEdges.add(e.getSource() + "->" + e.getTarget()));

        CausalityGraphData graph = new CausalityGraphData();
        graph.setNodes(nodes);
        graph.setEdges(edges);
        return graph;
    }

    /**
     * Find which function a given line index is inside.
     */
    private String findParentFunction(String[] lines, int lineIndex, Map<String, String> functionNodes) {
        Pattern funcStart = Pattern.compile(
            "(?:function\\s+([a-zA-Z_$][\\w$]*))|(?:def\\s+([a-zA-Z_][\\w]*)\\s*\\()|" +
            "(?:(?:public|private|protected|static|\\s)+[\\w<>\\[\\]]+\\s+([a-zA-Z_][\\w]*)\\s*\\()"
        );
        for (int i = lineIndex; i >= 0; i--) {
            Matcher m = funcStart.matcher(lines[i]);
            if (m.find()) {
                String name = m.group(1) != null ? m.group(1) : m.group(2) != null ? m.group(2) : m.group(3);
                if (name != null && functionNodes.containsKey(name)) {
                    return functionNodes.get(name);
                }
            }
        }
        return null;
    }

    private GraphNode createNode(String id, String type, String label, String detail) {
        GraphNode node = new GraphNode();
        node.setId(id);
        node.setType(type);
        node.setLabel(label);
        node.setDetail(detail);
        return node;
    }

    private GraphEdge createEdge(String source, String target, String label) {
        GraphEdge edge = new GraphEdge();
        edge.setId(source + "-" + target);
        edge.setSource(source);
        edge.setTarget(target);
        edge.setLabel(label);
        return edge;
    }

    private String findMainClass(String code) {
        int mainIndex = code.indexOf("public static void main");
        if (mainIndex == -1) return null;
        String beforeMain = code.substring(0, mainIndex);
        Pattern classPattern = Pattern.compile("class\\s+(\\w+)");
        Matcher matcher = classPattern.matcher(beforeMain);
        String lastClass = null;
        while (matcher.find()) lastClass = matcher.group(1);
        return lastClass;
    }

    private String findFunctionAtLine(String code, int lineNumber) {
        if (code == null || lineNumber <= 0) return "anonymous()";
        String[] lines = code.split("\n");
        Pattern funcPattern = Pattern.compile("(?:function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*))|(?:class\\s+([a-zA-Z_$][a-zA-Z0-9_$]*))");
        for (int i = Math.min(lineNumber - 1, lines.length - 1); i >= 0; i--) {
            Matcher m = funcPattern.matcher(lines[i]);
            if (m.find()) {
                String name = m.group(1) != null ? m.group(1) : m.group(2);
                return name != null ? name + "()" : "context";
            }
        }
        return "main scope";
    }
}
