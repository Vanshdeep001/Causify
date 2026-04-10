/*
 * ProjectDetectorService.java — Detects project types from uploaded files
 * 
 * Analyzes package.json contents and file structure to determine:
 *   - React frontend (Vite, CRA, Next.js)
 *   - Node.js backend (Express, Fastify, Koa, NestJS)
 *   - Fullstack projects (both detected in subdirectories)
 */
package com.debugsync.service;

import com.debugsync.dto.DevServerDto.DetectedProject;
import com.debugsync.dto.DevServerDto.DetectionResult;
import com.debugsync.model.ProjectFile;
import com.debugsync.repository.ProjectFileRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class ProjectDetectorService {

    private static final Logger log = LoggerFactory.getLogger(ProjectDetectorService.class);
    private final ProjectFileRepository projectFileRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ProjectDetectorService(ProjectFileRepository projectFileRepository) {
        this.projectFileRepository = projectFileRepository;
    }

    /**
     * Detect all project types in a session's uploaded files.
     */
    public DetectionResult detect(String sessionId) {
        List<ProjectFile> allFiles = projectFileRepository.findBySessionId(sessionId);
        DetectionResult result = new DetectionResult();
        List<DetectedProject> projects = new ArrayList<>();

        // Find all package.json files (they mark project roots)
        Map<String, String> packageJsons = new HashMap<>(); // directory -> content
        for (ProjectFile pf : allFiles) {
            String path = pf.getPath();
            if (path.endsWith("package.json") && !path.contains("node_modules")) {
                // Extract the directory of this package.json
                String dir = extractDirectory(path);
                packageJsons.put(dir, pf.getContent());
            }
        }

        if (packageJsons.isEmpty()) {
            // No package.json found — check for loose JS/HTML files
            result.setProjects(projects);
            result.setFullstack(false);
            return result;
        }

        // Analyze each package.json
        for (Map.Entry<String, String> entry : packageJsons.entrySet()) {
            String dir = entry.getKey();
            String content = entry.getValue();

            try {
                JsonNode pkg = objectMapper.readTree(content);
                JsonNode deps = mergeObjects(pkg.get("dependencies"), pkg.get("devDependencies"));
                JsonNode scripts = pkg.get("scripts");
                String name = pkg.has("name") ? pkg.get("name").asText() : dir;

                DetectedProject project = analyzePackage(dir, name, deps, scripts);
                if (project != null) {
                    projects.add(project);
                }
            } catch (Exception e) {
                log.warn("Failed to parse package.json at '{}': {}", dir, e.getMessage());
            }
        }

        // If there's no detection at the subdirectory level, try root-level detection
        if (projects.isEmpty() && packageJsons.containsKey("")) {
            // Root-level package.json with no clear frontend/backend marker
            // Treat as a generic Node.js project
            projects.add(new DetectedProject(
                    "backend", "node", "",
                    "Node.js App", 3000, "npm start", "🟢"));
        }

        // Determine if fullstack
        boolean hasFrontend = projects.stream().anyMatch(p -> "frontend".equals(p.getType()));
        boolean hasBackend = projects.stream().anyMatch(p -> "backend".equals(p.getType()));
        result.setProjects(projects);
        result.setFullstack(hasFrontend && hasBackend);

        log.info("[ProjectDetector] Session {} — detected {} projects (fullstack: {})",
                sessionId, projects.size(), result.isFullstack());

        return result;
    }

    /**
     * Analyze a single package.json and determine its project type.
     */
    private DetectedProject analyzePackage(String dir, String name, JsonNode deps, JsonNode scripts) {
        if (deps == null)
            return null;

        boolean hasReact = deps.has("react") || deps.has("react-dom");
        boolean hasVite = deps.has("vite");
        boolean hasCra = deps.has("react-scripts");
        boolean hasNext = deps.has("next");
        boolean hasVue = deps.has("vue");
        boolean hasAngular = deps.has("@angular/core");
        boolean hasSvelte = deps.has("svelte");

        boolean hasExpress = deps.has("express");
        boolean hasFastify = deps.has("fastify");
        boolean hasKoa = deps.has("koa");
        boolean hasNest = deps.has("@nestjs/core");
        boolean hasHapi = deps.has("@hapi/hapi");

        // Determine start command from scripts
        String devCmd = "npm run dev";
        if (scripts != null) {
            if (scripts.has("dev"))
                devCmd = "npm run dev";
            else if (scripts.has("start"))
                devCmd = "npm start";
            else if (scripts.has("serve"))
                devCmd = "npm run serve";
        }

        // ── Frontend Detection ──
        if (hasReact || hasVue || hasAngular || hasSvelte) {
            if (hasNext) {
                return new DetectedProject(
                        "frontend", "nextjs", dir,
                        "Next.js", 3000, devCmd, "▲");
            }
            if (hasVite) {
                return new DetectedProject(
                        "frontend", "react-vite", dir,
                        "React (Vite)", 5173, devCmd, "⚛️");
            }
            if (hasCra) {
                return new DetectedProject(
                        "frontend", "react-cra", dir,
                        "React (CRA)", 3000, "npm start", "⚛️");
            }
            if (hasVue) {
                return new DetectedProject(
                        "frontend", "vue", dir,
                        "Vue.js", hasVite ? 5173 : 8080, devCmd, "💚");
            }
            if (hasAngular) {
                return new DetectedProject(
                        "frontend", "angular", dir,
                        "Angular", 4200, "npm start", "🅰️");
            }
            if (hasSvelte) {
                return new DetectedProject(
                        "frontend", "svelte", dir,
                        "Svelte", hasVite ? 5173 : 3000, devCmd, "🔥");
            }
            // Generic React without recognized bundler
            return new DetectedProject(
                    "frontend", "react", dir,
                    "React", 3000, devCmd, "⚛️");
        }

        // ── Backend Detection ──
        if (hasExpress || hasFastify || hasKoa || hasNest || hasHapi) {
            String fw = hasExpress ? "express" : hasFastify ? "fastify" : hasKoa ? "koa" : hasNest ? "nestjs" : "hapi";
            String display = hasExpress ? "Express.js"
                    : hasFastify ? "Fastify" : hasKoa ? "Koa" : hasNest ? "NestJS" : "Hapi";
            int port = hasNest ? 3000 : 8081;
            String icon = hasNest ? "🐈" : "🟢";

            return new DetectedProject(
                    "backend", fw, dir,
                    display, port, devCmd, icon);
        }

        // ── Generic Node.js app (has package.json but no recognized framework) ──
        // Check if it looks like a server (has common server files or scripts)
        boolean looksLikeServer = false;
        if (scripts != null) {
            String scriptsStr = scripts.toString().toLowerCase();
            looksLikeServer = scriptsStr.contains("server") || scriptsStr.contains("nodemon");
        }

        // Check directory name hints
        String dirLower = dir.toLowerCase();
        if (dirLower.contains("backend") || dirLower.contains("server") || dirLower.contains("api")) {
            looksLikeServer = true;
        }

        if (looksLikeServer) {
            return new DetectedProject(
                    "backend", "node", dir,
                    "Node.js Server", 3000, devCmd, "🟢");
        }

        // Check if it's a frontend by directory name
        if (dirLower.contains("frontend") || dirLower.contains("client") || dirLower.contains("web")) {
            return new DetectedProject(
                    "frontend", "node", dir,
                    "Frontend App", 3000, devCmd, "🌐");
        }

        return null;
    }

    /**
     * Extract directory from a file path (e.g., "myapp/frontend/package.json" →
     * "myapp/frontend")
     */
    private String extractDirectory(String path) {
        int lastSlash = path.lastIndexOf('/');
        return lastSlash > 0 ? path.substring(0, lastSlash) : "";
    }

    /**
     * Merge two JSON objects (dependencies + devDependencies).
     */
    private JsonNode mergeObjects(JsonNode a, JsonNode b) {
        com.fasterxml.jackson.databind.node.ObjectNode merged = objectMapper.createObjectNode();
        if (a != null && a.isObject()) {
            a.fields().forEachRemaining(e -> merged.set(e.getKey(), e.getValue()));
        }
        if (b != null && b.isObject()) {
            b.fields().forEachRemaining(e -> merged.set(e.getKey(), e.getValue()));
        }
        return merged;
    }
}
