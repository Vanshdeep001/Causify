/* -------------------------------------------------------
 * FileExplorer.jsx — Sidebar with Session + File Management
 * ------------------------------------------------------- */

import React, { useState, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { createSession, joinSession, uploadProject, saveFile, deleteFile } from '../../services/api';
import { connectWebSocket, sendCodeChange } from '../../services/socket';
import { detectProject } from '../../services/devserver';

const FileExplorer = ({ onToggle }) => {
  const files = useEditorStore((s) => s.files);
  const activePath = useEditorStore((s) => s.activePath);
  const openFile = useEditorStore((s) => s.openFile);
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const currentUser = useEditorStore((s) => s.currentUser);
  const userRole = useEditorStore((s) => s.userRole);

  const setSession = useEditorStore((s) => s.setSession);
  const setCurrentUser = useEditorStore((s) => s.setCurrentUser);
  const setUserRole = useEditorStore((s) => s.setUserRole);
  const setProject = useEditorStore((s) => s.setProject);
  const setConnectedUsers = useEditorStore((s) => s.setConnectedUsers);
  const addSnapshot = useEditorStore((s) => s.addSnapshot);
  const handleExecutionResult = useEditorStore((s) => s.handleExecutionResult);
  const updateRemoteFile = useEditorStore((s) => s.updateRemoteFile);
  const fileActivity = useEditorStore((s) => s.fileActivity);
  const resetSession = useEditorStore((s) => s.resetSession);
  const addFile = useEditorStore((s) => s.addFile);
  const removeFile = useEditorStore((s) => s.removeFile);
  const impactWarnings = useEditorStore((s) => s.impactWarnings);
  const setDetectedProjects = useEditorStore((s) => s.setDetectedProjects);
  const setDevServerNotification = useEditorStore((s) => s.setDevServerNotification);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setTerminalOpen = useEditorStore((s) => s.setTerminalOpen);

  // Compute set of file paths that are affected by active impacts
  const affectedPaths = new Set();
  impactWarnings.forEach(w => {
    if (w.affectedFiles) w.affectedFiles.forEach(f => affectedPaths.add(f));
    if (w.impacts) w.impacts.forEach(i => { if (i.file) affectedPaths.add(i.file); });
  });

  const inlineActionBtnSty = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', opacity: 0.7, transition: 'opacity 0.2s, color 0.2s' };

  // UI state
  const [panel, setPanel] = useState(null); // null | 'create' | 'join'
  const [projName, setProjName] = useState('My Project');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('User ' + Math.floor(Math.random() * 1000));
  const [joinId, setJoinId] = useState('');
  const [joinPwd, setJoinPwd] = useState('');
  const [joinUsername, setJoinUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [newItem, setNewItem] = useState(null); // { type: 'file'|'folder', parent: '', name: '' }

  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const initSocket = (sessId, user) => {
    connectWebSocket(sessId, user, {
      onCodeChange: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        const isOwnChange = d.userId === currentU?.id;
        updateRemoteFile(d.path, d.code, isOwnChange ? null : d.userId);
      },
      onUsersChange: (d) => setConnectedUsers(d.users || []),
      onExecutionResult: (d) => handleExecutionResult(d),
      onSnapshot: (d) => addSnapshot(d),
      onCursorUpdate: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.userId !== currentU?.id) {
          useEditorStore.getState().updateRemoteCursor(d.userId, d);
        }
      },
      onRevert: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.revertedUser === currentU?.username || d.revertedUser === currentU?.id) {
          useEditorStore.getState().setRevertNotification({
            username: d.username,
            path: d.path,
            reason: 'cross-file impact',
          });
        }
      },
      onConnected: () => console.log('[Causify] Connected to Collab'),
    });
  };

  const handleCreate = async (uploadedFiles = []) => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const session = await createSession(projName, username, password || '0000');
      if (uploadedFiles.length > 0) {
        await uploadProject(session.id, uploadedFiles);
      }
      setSession(session.id, session.name);
      setCurrentUser({ id: session.userId, username, color: '#6366f1' });
      setUserRole('owner');
      if (uploadedFiles.length > 0) {
        setProject(uploadedFiles);
      }
      initSocket(session.id, { id: session.userId, username, color: '#6366f1' });
      setPanel(null);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Failed to create session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async () => {
    setIsLoading(true);
    setErrorMsg('');
    const uname = joinUsername.trim() || 'User ' + Math.floor(Math.random() * 1000);
    try {
      const data = await joinSession(joinId, joinPwd, uname);
      setSession(data.id, data.name);
      setCurrentUser({ id: data.userId, username: uname, color: '#6366f1' });
      setUserRole(data.role || 'collaborator');
      if (data.files) {
        setProject(data.files);
      }
      initSocket(data.id, { id: data.userId, username: uname, color: '#6366f1' });
      setPanel(null);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Invalid Session ID or Password');
    } finally {
      setIsLoading(false);
    }
  };

  const readAndProcess = (allFiles) => {
    const projectFiles = [];
    let processed = 0;
    allFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        projectFiles.push({ path: file.webkitRelativePath || file.name, content: event.target.result });
        processed++;
        if (processed === allFiles.length) {
          const afterUpload = (sid) => {
            // Auto-detect project type after upload
            if (sid) {
              setTimeout(() => {
                detectProject(sid).then((result) => {
                  if (result?.projects?.length > 0) {
                    setDetectedProjects(result.projects);
                    setDevServerNotification({
                      message: `🚀 ${result.projects.map(p => p.displayName).join(' + ')} project detected!`,
                      type: 'success',
                    });
                    // Auto-open DEV SERVER tab
                    setTerminalActiveTab('devserver');
                    setTerminalOpen(true);
                  }
                }).catch(() => { /* detection is best-effort */ });
              }, 500);
            }
          };

          if (sessionId) {
            uploadProject(sessionId, projectFiles).then(() => {
              setProject(projectFiles);
              afterUpload(sessionId);
            });
          } else {
            handleCreate(projectFiles).then(() => {
              const sid = useEditorStore.getState().sessionId;
              afterUpload(sid);
            });
          }
        }
      };
      reader.readAsText(file);
    });
  };

  const handleFolderUpload = (e) => {
    const filesArray = Array.from(e.target.files).filter(f => !f.webkitRelativePath.includes('/node_modules/') && f.size < 1024*1024);
    if (filesArray.length > 0) readAndProcess(filesArray);
  };

  const handleFileUpload = (e) => {
    const filesArray = Array.from(e.target.files).filter(f => f.size < 1024*1024);
    if (filesArray.length > 0) readAndProcess(filesArray);
  };

  const handleCreateNew = async (e) => {
    if (e.key === 'Escape') { setNewItem(null); return; }
    if (e.key === 'Enter') {
      const name = e.target.value.trim();
      if (!name) { setNewItem(null); return; }

      const parentPath = newItem.parent;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      const isFolder = newItem.type === 'folder';
      const pathToSave = isFolder ? `${fullPath}/.keep` : fullPath;

      if (!sessionId) {
        handleCreate([{ path: pathToSave, content: '' }]);
        setNewItem(null);
        return;
      }

      try {
        await saveFile(sessionId, pathToSave, '');
        addFile(pathToSave, '');
        if (currentUser) {
          sendCodeChange(sessionId, currentUser.id, pathToSave, '');
        }
        setNewItem(null);
        setErrorMsg('');
      } catch (err) {
        if (err.response?.status === 404) {
          setErrorMsg('SESSION EXPIRED: Please start/join a new session.');
          resetSession();
        } else {
          const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to create item';
          setErrorMsg(`SERVER ERROR: ${msg}`);
        }
      }
    }
  };

  const handleDelete = async (path, isFolder) => {
    if (!window.confirm(`Delete ${isFolder ? 'folder' : 'file'} "${path}"?`)) return;
    try {
      await deleteFile(sessionId, path);
      removeFile(path);
    } catch (err) {
      setErrorMsg('Failed to delete item');
    }
  };

  const [expandedPaths, setExpandedPaths] = useState(new Set());

  const toggleFolder = (path) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // ── Ultra-Premium Blueprint Icons ──
  const FileIcon = ({ name, isFolder, isOpen, size = 16 }) => {
    const colorToxic = 'var(--accent-toxic-green)';
    const colorBlue = 'var(--accent-electric-blue)';
    const colorRed = '#e34f26';
    const colorJS = '#f7df1e';

    if (isFolder) {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transition: 'all 0.3s' }}>
          <path d="M20 18H4V7H20V18Z" fill={isOpen ? colorToxic : "none"} fillOpacity="0.1" stroke={isOpen ? colorToxic : "#666"} strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 4L12 7H20V9H4V4H10Z" fill={isOpen ? colorToxic : "#333"} />
          {isOpen && <path d="M4 9L2 19H22L20 9H4Z" fill={colorToxic} fillOpacity="0.2" stroke={colorToxic} strokeWidth="1.5" />}
        </svg>
      );
    }

    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'html':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill={colorRed} fillOpacity="0.8" />
            <path d="M2 12L12 17L22 12" stroke={colorRed} strokeWidth="2" />
            <path d="M2 17L12 22L22 17" stroke={colorRed} strokeWidth="2" />
          </svg>
        );
      case 'css':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 22L3 17V7L12 2L21 7V17L12 22Z" stroke={colorBlue} strokeWidth="2" fill={colorBlue} fillOpacity="0.1" />
            <path d="M12 22V12M12 12L21 7M12 12L3 7" stroke={colorBlue} strokeWidth="1.5" />
            <circle cx="12" cy="12" r="3" fill={colorBlue} fillOpacity="0.4" />
          </svg>
        );
      case 'js':
        return (
          <div style={{ width: size, height: size, background: colorJS, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 12px rgba(247, 223, 30, 0.3)' }}>
            <span style={{ fontSize: '8px', fontWeight: 900, color: '#000', fontFamily: 'var(--font-number)' }}>JS</span>
          </div>
        );
      case 'jsx':
      case 'tsx':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="2.5" fill="#61dafb" />
            <ellipse cx="12" cy="12" rx="10" ry="4" stroke="#61dafb" strokeWidth="1.5" transform="rotate(0 12 12)" strokeOpacity="0.6" />
            <ellipse cx="12" cy="12" rx="10" ry="4" stroke="#61dafb" strokeWidth="1.5" transform="rotate(60 12 12)" />
            <ellipse cx="12" cy="12" rx="10" ry="4" stroke="#61dafb" strokeWidth="1.5" transform="rotate(120 12 12)" />
          </svg>
        );
      case 'json':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fbc02d" strokeWidth="2.5">
            <path d="M7 11c0-2-1-3-3-3m0 0c2 0 3-1 3-3M7 11c0 2 1 3 3 3m0 0c-2 0-3 1-3 3M17 11c0-2 1-3 3-3m0 0c-2 0-3-1-3-3M17 11c0 2-1 3-3 3m0 0c2 0 3 1 3 3" />
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        );
    }
  };

  const buildTree = (filesObj) => {
    const tree = {};
    const hiddenEntries = new Set(['.git', 'node_modules', '.DS_Store']);
    const allPaths = Object.keys(filesObj);
    
    if (expandedPaths.size === 0 && allPaths.length > 0) {
      const initialExpanded = new Set();
      allPaths.forEach(p => {
        const parts = p.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
          cur = cur ? `${cur}/${parts[i]}` : parts[i];
          initialExpanded.add(cur);
        }
      });
      setExpandedPaths(initialExpanded);
    }
    
    allPaths.forEach((path) => {
      if (path.split('/').some(p => hiddenEntries.has(p))) return;
      const parts = path.split('/');
      let current = tree;
      parts.forEach((part, index) => {
        if (!current[part]) current[part] = index === parts.length - 1 ? null : {};
        current = current[part];
      });
    });
    return tree;
  };

  const tree = buildTree(files);

  const FileItem = ({ name, path, isFolder }) => {
    const isActive = activePath === path;
    const activeEditor = fileActivity[path];
    const isAffected = affectedPaths.has(path) || affectedPaths.has(name);
    const [isHovered, setIsHovered] = useState(false);
    
    const isExpanded = expandedPaths.has(path);
    const nameOnly = name.includes('.') ? name.split('.').slice(0, -1).join('.') : name;
    const extension = name.includes('.') ? '.' + name.split('.').pop() : '';

    return (
      <div
        onClick={(e) => { 
          e.stopPropagation(); 
          if (isFolder) toggleFolder(path);
          else openFile(path); 
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`file-shelf-item ${isActive ? 'file-shelf-active' : 'file-shelf-hover'}`}
        style={{
          padding: '8px 12px 8px 10px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '10px', 
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          margin: '1px 8px',
          borderRadius: '4px',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          background: isActive ? 'rgba(193, 255, 114, 0.1)' : 'transparent',
          color: isActive ? 'var(--accent-toxic-green)' : '#ddd',
        }}
      >
        {isFolder && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', opacity: 0.5, flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
        {!isFolder && <div style={{ minWidth: '10px' }} />}
        
        <div style={{ display: 'flex', alignItems: 'center', minWidth: '20px', justifyContent: 'center', flexShrink: 0 }}>
          <FileIcon name={name} isFolder={isFolder} isOpen={isExpanded} size={16} />
        </div>
        
        <span className="font-modern" style={{ 
          fontWeight: isFolder ? 700 : (isActive ? 700 : 500), 
          flex: 1, 
          fontSize: '0.8rem',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'flex', alignItems: 'baseline', gap: '1px'
        }}>
          {isFolder ? name : (
            <>
              {nameOnly}
              <span className="font-tech" style={{ opacity: 0.4, fontSize: '0.65rem' }}>{extension}</span>
            </>
          )}
        </span>
        
        {isAffected && !isFolder && (
          <span title="Affected by code change" style={{
            fontSize: '0.7rem', color: 'var(--accent-crimson)',
            animation: 'shelf-glow-pulse 2s infinite',
            marginRight: '6px'
          }}>⚡</span>
        )}
        
        {userRole === 'owner' && isHovered && (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={(e) => { e.stopPropagation(); handleDelete(path, isFolder); }} style={{ ...inlineActionBtnSty, color: 'var(--accent-crimson)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        )}

        {activeEditor && !isFolder && (
          <div style={{ 
            width: '8px', height: '8px', borderRadius: '50%', background: activeEditor.color,
            boxShadow: `0 0 10px ${activeEditor.color}`, animation: 'hud-pulse 1.5s infinite'
          }} />
        )}
      </div>
    );
  };

  const renderTree = (node, name = '', currentPath = '', depth = 0) => {
    const path = currentPath ? `${currentPath}/${name}` : name;
    if (node === null) return <FileItem key={path} name={name} path={path} isFolder={false} />;
    
    const isExpanded = depth === 0 || expandedPaths.has(path);

    return (
      <div key={path} style={{ 
        marginLeft: depth > 0 ? '12px' : '0',
        borderLeft: depth > 0 ? '1px dashed rgba(255,255,255,0.08)' : 'none',
        paddingLeft: depth > 0 ? '2px' : '0'
      }}>
        {name && <FileItem name={name} path={path} isFolder={true} />}
        {isExpanded && (
          <div style={{ marginLeft: name ? '4px' : '0' }}>
            {newItem && newItem.parent === path && name && (
              <div style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                 <FileIcon name={newItem.name || 'newfile'} isFolder={newItem.type === 'folder'} />
                <input 
                  autoFocus 
                  onKeyDown={handleCreateNew} 
                  onBlur={() => setNewItem(null)}
                  style={{ ...inputStyle, marginBottom: 0, height: '22px', flex: 1, border: 'none', background: '#222', borderRadius: '2px' }}
                  placeholder={newItem.type === 'folder' ? 'Folder...' : 'File...'}
                />
              </div>
            )}
            {Object.entries(node)
              .sort(([aName, aNode], [bName, bNode]) => {
                const aIsFolder = aNode !== null;
                const bIsFolder = bNode !== null;
                if (aIsFolder && !bIsFolder) return -1;
                if (!aIsFolder && bIsFolder) return 1;
                return aName.localeCompare(bName);
              })
              .map(([childName, childNode]) => renderTree(childNode, childName, path, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const sectionLabelSty = { fontSize: '0.6rem', fontWeight: 900, color: '#555', marginBottom: '8px', letterSpacing: '0.1em' };
  const inputStyle = { width: '100%', height: '30px', padding: '0 8px', background: '#1a1a1a', border: '1.5px solid #333', color: '#eee', fontSize: '0.7rem', outline: 'none', marginBottom: '8px', boxSizing: 'border-box' };
  const btnStyle = (p) => ({ width: '100%', height: '32px', border: '1.5px solid #080808', background: p ? '#c1ff72' : '#222', color: p ? '#080808' : '#aaa', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer', marginBottom: '4px', boxShadow: p ? '3px 3px 0 #080808' : 'none' });
  const explorerActionBtnSty = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'background 0.2s, color 0.2s' };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#111', borderRight: '2px solid #080808', width: '100%', userSelect: 'none' }}>
      <input ref={folderInputRef} type="file" webkitdirectory="" mozdirectory="" directory="" style={{ display: 'none' }} onChange={handleFolderUpload} />
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} />

      <div style={{ padding: '8px 16px', fontFamily: 'var(--font-header)', fontSize: '0.7rem', fontWeight: 900, color: '#888', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.05em' }}>
        <span>EXPLORER</span>
        <button onClick={onToggle} title="Collapse Sidebar" style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#666'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!sessionId && (
          <div style={{ padding: '16px' }}>
            <div style={sectionLabelSty}>START DEVELOPMENT</div>
            {!panel && (
              <>
                <button style={btnStyle(true)} onClick={() => setPanel('create')}>✨ CREATE SESSION</button>
                <button style={btnStyle(false)} onClick={() => setPanel('join')}>🔗 JOIN SESSION</button>
                <div style={{ margin: '15px 0', borderTop: '1px solid #222' }} />
                <button style={btnStyle(false)} onClick={() => setNewItem({ type: 'file', parent: '', name: '' })}>📄 NEW FILE</button>
                <button style={btnStyle(false)} onClick={() => setNewItem({ type: 'folder', parent: '', name: '' })}>📁 NEW FOLDER</button>
                <button style={btnStyle(false)} onClick={() => folderInputRef.current?.click()}>📂 ADD PROJECT</button>
                <button style={btnStyle(false)} onClick={() => fileInputRef.current?.click()}>📄 ADD FILES</button>
              </>
            )}
            {newItem && newItem.parent === '' && (
              <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #333', marginTop: '10px' }}>
                <span>{newItem.type === 'folder' ? '📁' : '📄'}</span>
                <input autoFocus onKeyDown={handleCreateNew} onBlur={() => setNewItem(null)} style={{ ...inputStyle, marginBottom: 0, height: '24px', flex: 1 }} placeholder={newItem.type === 'folder' ? 'Folder name...' : 'File name...'} />
              </div>
            )}
            {panel === 'create' && (
              <div>
                <label style={{ fontSize: '0.55rem', color: '#666' }}>YOUR NAME</label>
                <input style={inputStyle} value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter your name" />
                <label style={{ fontSize: '0.55rem', color: '#666' }}>PROJECT NAME</label>
                <input style={inputStyle} value={projName} onChange={e=>setProjName(e.target.value)} />
                <label style={{ fontSize: '0.55rem', color: '#666' }}>PASSWORD (REQUIRED)</label>
                <input style={inputStyle} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="0000" />
                <button style={btnStyle(true)} onClick={()=>handleCreate()}>{isLoading ? 'INIT...' : 'CREATE & START'}</button>
                <button style={{ background: 'none', border: 'none', color: '#555', fontSize: '0.6rem', cursor: 'pointer', width: '100%', marginTop: '5px' }} onClick={()=>setPanel(null)}>← BACK</button>
              </div>
            )}
            {panel === 'join' && (
              <div>
                <label style={{ fontSize: '0.55rem', color: '#666' }}>YOUR NAME</label>
                <input style={inputStyle} value={joinUsername} onChange={e=>setJoinUsername(e.target.value)} placeholder="Enter your name" />
                <label style={{ fontSize: '0.55rem', color: '#666' }}>SESSION ID</label>
                <input style={inputStyle} value={joinId} onChange={e=>setJoinId(e.target.value)} placeholder="XYZ..." />
                <label style={{ fontSize: '0.55rem', color: '#666' }}>PASSWORD</label>
                <input style={inputStyle} type="password" value={joinPwd} onChange={e=>setJoinPwd(e.target.value)} />
                <button style={btnStyle(true)} onClick={handleJoin}>{isLoading ? 'JOINING...' : 'CONNECT'}</button>
                <button style={{ background: 'none', border: 'none', color: '#555', fontSize: '0.6rem', cursor: 'pointer', width: '100%', marginTop: '5px' }} onClick={()=>setPanel(null)}>← BACK</button>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div style={{ color: '#ff3e3e', fontSize: '0.6rem', margin: '10px 16px', padding: '8px', background: 'rgba(255,62,62,0.1)', border: '1px solid #444', fontFamily: 'var(--font-number)', fontWeight: 700 }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {(sessionId || Object.keys(files).length > 0) && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ padding: '8px 16px', ...sectionLabelSty, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>PROJECT FILES</span>
              {userRole === 'owner' && (
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '2px', marginRight: '6px', borderRight: '1px solid #333', paddingRight: '6px' }}>
                    <button onClick={() => setNewItem({ type: 'file', parent: '', name: '' })} title="New File" className="explorer-action-btn" style={explorerActionBtnSty}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                    </button>
                    <button onClick={() => setNewItem({ type: 'folder', parent: '', name: '' })} title="New Folder" className="explorer-action-btn" style={explorerActionBtnSty}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                    </button>
                  </div>
                  <button onClick={() => folderInputRef.current?.click()} title="Upload Folder" className="explorer-action-btn" style={explorerActionBtnSty}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} title="Add Files" className="explorer-action-btn" style={explorerActionBtnSty}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" i1="12" x2="16" y2="12"/></svg>
                  </button>
                </div>
              )}
            </div>
            {newItem && newItem.parent === '' && (
              <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{newItem.type === 'folder' ? '📁' : '📄'}</span>
                <input autoFocus onKeyDown={handleCreateNew} onBlur={() => setNewItem(null)} style={{ ...inputStyle, marginBottom: 0, height: '24px', flex: 1 }} placeholder={newItem.type === 'folder' ? 'Folder name...' : 'File name...'} />
              </div>
            )}
            {Object.keys(files).length === 0 ? (
              userRole === 'owner' ? (
                <div style={{ padding: '20px 16px', color: '#444', textAlign: 'center', fontSize: '0.65rem' }}>
                  <div style={{ marginBottom: '10px' }}>No files yet.</div>
                  <button style={btnStyle(false)} onClick={() => folderInputRef.current?.click()}>📂 UPLOAD PROJECT FOLDER</button>
                  <button style={{ ...btnStyle(false), marginTop: '4px' }} onClick={() => fileInputRef.current?.click()}>📄 ADD INDIVIDUAL FILES</button>
                </div>
              ) : (
                <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center', fontSize: '0.6rem' }}>Waiting for the owner to upload files…</div>
              )
            ) : (
              renderTree(tree)
            )}
            <div style={{ margin: '15px 16px', borderTop: '1px solid #222' }} />
            <div style={{ padding: '0 16px' }}>
              <div style={sectionLabelSty}>SESSION</div>
              <div style={{ fontSize: '0.7rem', color: '#eee', marginBottom: '6px' }}>{sessionName || 'Local Session'}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', marginBottom: '10px', fontSize: '0.55rem', fontWeight: 900, fontFamily: 'var(--font-number)', letterSpacing: '0.08em', background: userRole === 'owner' ? 'rgba(193,255,114,0.15)' : 'rgba(99,102,241,0.15)', color: userRole === 'owner' ? '#c1ff72' : '#818cf8', border: `1px solid ${userRole === 'owner' ? '#c1ff72' : '#818cf8'}` }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: userRole === 'owner' ? '#c1ff72' : '#818cf8' }} />
                {userRole === 'owner' ? 'OWNER' : 'COLLABORATOR'}
              </div>
              <button style={btnStyle(false)} onClick={resetSession}>🚪 EXIT SESSION</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
