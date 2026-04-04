package com.debugsync.service;

import com.debugsync.model.ProjectFile;
import com.debugsync.repository.ProjectFileRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
@Service
public class FileService {

    private final ProjectFileRepository projectFileRepository;

    public FileService(ProjectFileRepository projectFileRepository) {
        this.projectFileRepository = projectFileRepository;
    }

    @Transactional
    public ProjectFile saveFile(String sessionId, String path, String content) {
        ProjectFile projectFile = projectFileRepository
            .findBySessionIdAndPath(sessionId, path)
            .orElse(new ProjectFile(sessionId, path, content));
        
        projectFile.setContent(content);
        return projectFileRepository.save(projectFile);
    }

    @Transactional
    public void deleteFileRecursive(String sessionId, String path) {
        projectFileRepository.deleteBySessionIdAndPathRecursive(sessionId, path);
    }

    @Transactional
    public List<Map<String, String>> uploadFiles(String sessionId, List<Map<String, String>> files) {
        for (Map<String, String> fileData : files) {
            String path = fileData.get("path");
            String content = fileData.get("content");
            saveFile(sessionId, path, content);
        }
        // Return in the same format as getFilesForSession
        return getFilesForSession(sessionId);
    }

    public List<Map<String, String>> getFilesForSession(String sessionId) {
        List<ProjectFile> projectFiles = projectFileRepository.findBySessionId(sessionId);
        List<Map<String, String>> result = new java.util.ArrayList<>();
        for (ProjectFile pf : projectFiles) {
            Map<String, String> fileMap = new java.util.HashMap<>();
            fileMap.put("path", pf.getPath());
            fileMap.put("content", pf.getContent());
            result.add(fileMap);
        }
        return result;
    }
}
