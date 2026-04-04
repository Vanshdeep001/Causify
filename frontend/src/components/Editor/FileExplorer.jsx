/* -------------------------------------------------------
 * FileExplorer.jsx — Sidebar with Session + File Management
 * ------------------------------------------------------- */

import React, { useState, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { createSession, joinSession, uploadProject, saveFile, deleteFile } from '../../services/api';
import { connectWebSocket, sendCodeChange } from '../../services/socket';

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

  const addChangeNotification = useEditorStore((s) => s.addChangeNotification);
  const updateRemoteCursor = useEditorStore((s) => s.updateRemoteCursor);

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
          updateRemoteCursor(d.userId, d);
        }
      },
      onRevert: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        // Notify if we are the user whose change was reverted
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
          if (sessionId) {
            uploadProject(sessionId, projectFiles).then(() => setProject(projectFiles));
          } else {
            handleCreate(projectFiles);
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
        // Broadcast to collaborators so they see the new file
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

  // ── File Icons ──
  const FileIcon = ({ name, isFolder, isOpen }) => {
    if (isFolder) {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill={isOpen ? "rgba(193,255,114,0.4)" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: isOpen ? '#c1ff72' : '#888' }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      );
    }
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'html':
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e34f26" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>;
      case 'css':
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1572b6" strokeWidth="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 10 12 12.5 16.5 10"/><polyline points="7.5 15 12 17.5 16.5 15"/><line x1="12" y1="22" x2="12" y2="12.5"/></svg>;
      case 'js':
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="#f7df1e" stroke="#000" strokeWidth="1"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><text x="12" y="17" fontSize="11" fontWeight="900" textAnchor="middle" fill="#000" fontFamily="Arial">JS</text></svg>;
      case 'jsx':
      case 'tsx':
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#61dafb" strokeWidth="2"><circle cx="12" cy="12" r="2"/><path d="M12 7c3.97 0 7.18 2.24 7.18 5s-3.21 5-7.18 5c-3.97 0-7.18-2.24-7.18-5s3.21-5 7.18-5z" transform="rotate(0 12 12)"/><path d="M12 7c3.97 0 7.18 2.24 7.18 5s-3.21 5-7.18 5c-3.97 0-7.18-2.24-7.18-5s3.21-5 7.18-5z" transform="rotate(60 12 12)"/><path d="M12 7c3.97 0 7.18 2.24 7.18 5s-3.21 5-7.18 5c-3.97 0-7.18-2.24-7.18-5s3.21-5 7.18-5z" transform="rotate(120 12 12)"/></svg>;
      case 'json':
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbc02d" strokeWidth="2.5"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"/><path d="M16 19h6"/><path d="M19 16v6"/></svg>;
      default:
        return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>;
    }
  };

  const buildTree = (filesObj) => {
    const tree = {};
    const hiddenEntries = new Set(['.git', 'node_modules', '.DS_Store']);
    const allPaths = Object.keys(filesObj);
    
    // Auto-expand all folders on initial load if expandedPaths is empty
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
      // Filter out hidden entries
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

    return (
      <div
        onClick={(e) => { 
          e.stopPropagation(); 
          if (isFolder) togglePath(path);
          else openFile(path); 
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          padding: '6px 12px 6px 8px', cursor: 'pointer',
          background: isActive ? 'rgba(193,255,114,0.12)' : 'transparent',
          color: isActive ? '#c1ff72' : '#e0e0e0', 
          fontSize: '0.85rem', 
          fontFamily: 'var(--font-body)',
          display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.15s ease',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          borderLeft: isActive ? '3px solid #c1ff72' : '3px solid transparent',
          position: 'relative',
          opacity: isHovered || isActive ? 1 : 0.9,
          borderRadius: '4px',
          margin: '2px 6px'
        }}
      >
        {isFolder && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.1s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', opacity: 0.6, flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
        {!isFolder && <div style={{ minWidth: '12px' }} />}
        
        <div style={{ display: 'flex', alignItems: 'center', minWidth: '22px', justifyContent: 'center', flexShrink: 0 }}>
          <FileIcon name={name} isFolder={isFolder} isOpen={isExpanded} size={16} />
        </div>
        
        <span style={{ 
          fontWeight: isActive ? 700 : 500, 
          flex: 1, 
          letterSpacing: '-0.015em',
          color: isActive ? '#c1ff72' : isAffected ? '#ff3e3e' : '#fff',
          overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{name}</span>
        
        {isAffected && !isFolder && (
          <span title="Affected by a cross-file change" style={{
            fontSize: '0.75rem', color: '#ff3e3e',
            animation: 'impact-icon-pulse 1.5s ease-in-out infinite',
            marginRight: '6px'
          }}>⚡</span>
        )}
        
        {userRole === 'owner' && (
          <div style={{ 
            display: 'flex', gap: '4px', opacity: isHovered ? 1 : 0, 
            pointerEvents: isHovered ? 'auto' : 'none', transition: 'opacity 0.1s' 
          }}>
            {isFolder && (
              <>
                <button onClick={(e) => { e.stopPropagation(); setNewItem({ type: 'file', parent: path, name: '' }); }} title="New File" style={inlineActionBtnSty}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setNewItem({ type: 'folder', parent: path, name: '' }); }} title="New Folder" style={inlineActionBtnSty}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                </button>
              </>
            )}
            <button onClick={(e) => { e.stopPropagation(); handleDelete(path, isFolder); }} title="Delete" style={{ ...inlineActionBtnSty, color: '#ff3e3e' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        )}

        {activeEditor && !isFolder && (
          <span title={`${activeEditor.username} is editing...`} style={{ 
            fontSize: '0.75rem', color: activeEditor.color, fontWeight: 900,
            textShadow: '0 0 8px currentColor'
          }}>✎</span>
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
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
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
