/*
 * DevServerDto.java — DTOs for project detection and dev server management
 */
package com.debugsync.dto;

import java.util.List;
import java.util.Map;

public class DevServerDto {

    /* ── Request: Detect project type ── */
    public static class DetectRequest {
        private String sessionId;

        public DetectRequest() {}
        public String getSessionId() { return sessionId; }
        public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    }

    /* ── Response: Detected project info ── */
    public static class DetectedProject {
        private String type;        // "frontend" | "backend" | "fullstack"
        private String framework;   // "react-vite" | "react-cra" | "express" | "nextjs" etc.
        private String directory;   // Root directory of this project within the upload
        private String displayName; // Human-readable name (e.g. "React (Vite)")
        private int defaultPort;    // Default port (e.g. 3000, 5173, 8081)
        private String startCommand; // e.g. "npm run dev"
        private String icon;        // Emoji for UI: ⚛️, 🟢, etc.

        public DetectedProject() {}

        public DetectedProject(String type, String framework, String directory,
                               String displayName, int defaultPort, String startCommand, String icon) {
            this.type = type;
            this.framework = framework;
            this.directory = directory;
            this.displayName = displayName;
            this.defaultPort = defaultPort;
            this.startCommand = startCommand;
            this.icon = icon;
        }

        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getFramework() { return framework; }
        public void setFramework(String framework) { this.framework = framework; }
        public String getDirectory() { return directory; }
        public void setDirectory(String directory) { this.directory = directory; }
        public String getDisplayName() { return displayName; }
        public void setDisplayName(String displayName) { this.displayName = displayName; }
        public int getDefaultPort() { return defaultPort; }
        public void setDefaultPort(int defaultPort) { this.defaultPort = defaultPort; }
        public String getStartCommand() { return startCommand; }
        public void setStartCommand(String startCommand) { this.startCommand = startCommand; }
        public String getIcon() { return icon; }
        public void setIcon(String icon) { this.icon = icon; }
    }

    /* ── Response: Detection results ── */
    public static class DetectionResult {
        private List<DetectedProject> projects;
        private boolean isFullstack;

        public DetectionResult() {}

        public List<DetectedProject> getProjects() { return projects; }
        public void setProjects(List<DetectedProject> projects) { this.projects = projects; }
        public boolean isFullstack() { return isFullstack; }
        public void setFullstack(boolean fullstack) { isFullstack = fullstack; }
    }

    /* ── Request: Start/Stop server ── */
    public static class ServerActionRequest {
        private String sessionId;
        private String directory; // Which detected project directory to run
        private String type;     // "frontend" | "backend"

        public ServerActionRequest() {}
        public String getSessionId() { return sessionId; }
        public void setSessionId(String sessionId) { this.sessionId = sessionId; }
        public String getDirectory() { return directory; }
        public void setDirectory(String directory) { this.directory = directory; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
    }

    /* ── Response: Server status ── */
    public static class ServerStatus {
        private String serverId;    // Unique key: sessionId + type
        private String type;        // "frontend" | "backend"
        private String state;       // IDLE | INSTALLING | STARTING | RUNNING | STOPPED | ERROR
        private String directory;   
        private int port;
        private String url;         // e.g. "http://localhost:3000"
        private String framework;
        private String displayName;
        private List<String> recentLogs;
        private String errorMessage;

        public ServerStatus() {}

        public String getServerId() { return serverId; }
        public void setServerId(String serverId) { this.serverId = serverId; }
        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getState() { return state; }
        public void setState(String state) { this.state = state; }
        public String getDirectory() { return directory; }
        public void setDirectory(String directory) { this.directory = directory; }
        public int getPort() { return port; }
        public void setPort(int port) { this.port = port; }
        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }
        public String getFramework() { return framework; }
        public void setFramework(String framework) { this.framework = framework; }
        public String getDisplayName() { return displayName; }
        public void setDisplayName(String displayName) { this.displayName = displayName; }
        public List<String> getRecentLogs() { return recentLogs; }
        public void setRecentLogs(List<String> recentLogs) { this.recentLogs = recentLogs; }
        public String getErrorMessage() { return errorMessage; }
        public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    }

    /* ── Response: All servers status ── */
    public static class AllServersStatus {
        private Map<String, ServerStatus> servers;

        public AllServersStatus() {}
        public Map<String, ServerStatus> getServers() { return servers; }
        public void setServers(Map<String, ServerStatus> servers) { this.servers = servers; }
    }
}
