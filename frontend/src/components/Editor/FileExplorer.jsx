/* -------------------------------------------------------
 * FileExplorer.jsx — Sidebar with Session + File Management
 * ------------------------------------------------------- */

import React, { useState, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { createSession, joinSession, uploadProject } from '../../services/api';
import { connectWebSocket } from '../../services/socket';

const FileExplorer = () => {
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

  // UI state
  const [panel, setPanel] = useState(null); // null | 'create' | 'join'
  const [projName, setProjName] = useState('My Project');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('User ' + Math.floor(Math.random() * 1000));
  const [joinId, setJoinId] = useState('');
  const [joinPwd, setJoinPwd] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const addChangeNotification = useEditorStore((s) => s.addChangeNotification);
  const updateRemoteCursor = useEditorStore((s) => s.updateRemoteCursor);

  const initSocket = (sessId, user) => {
    connectWebSocket(sessId, user, {
      onCodeChange: (d) => {
        updateRemoteFile(d.path, d.code, d.userId);
        // Find user info for notification
        const users = useEditorStore.getState().connectedUsers;
        const changer = users.find(u => u.id === d.userId);
        const currentU = useEditorStore.getState().currentUser;
        if (d.userId !== currentU?.id) {
          const fileName = d.path?.split('/').pop() || 'file';
          addChangeNotification({
            username: changer?.username || d.userId,
            color: changer?.color || '#6366f1',
            path: d.path,
            fileName,
          });
        }
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
      onConnected: () => console.log('[Causify] Connected to Collab'),
    });
  };

  const handleCreate = async (uploadedFiles = []) => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const session = await createSession(projName, username, password);
      if (uploadedFiles.length > 0) {
        await uploadProject(session.id, uploadedFiles);
      }
      setSession(session.id, session.name);
      setCurrentUser({ id: session.userId, username, color: '#6366f1' });
      setUserRole('owner');
      if (uploadedFiles.length > 0) {
        setProject(uploadedFiles);
      }
      initSocket(session.id, username);
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
    try {
      const data = await joinSession(joinId, joinPwd);
      setSession(data.id, data.name);
      const uname = 'User ' + Math.floor(Math.random() * 1000);
      setCurrentUser({ id: data.userId, username: uname, color: '#6366f1' });
      setUserRole(data.role || 'collaborator');
      if (data.files) {
        setProject(data.files);
      }
      initSocket(data.id, uname);
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
    const files = Array.from(e.target.files).filter(f => !f.webkitRelativePath.includes('/node_modules/') && f.size < 1024*1024);
    if (files.length > 0) readAndProcess(files);
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files).filter(f => f.size < 1024*1024);
    if (files.length > 0) readAndProcess(files);
  };

  const buildTree = (files) => {
    const tree = {};
    Object.keys(files).forEach((path) => {
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

    return (
      <div
        onClick={(e) => { e.stopPropagation(); if (!isFolder) openFile(path); }}
        style={{
          padding: '6px 12px', cursor: 'pointer', background: isActive ? '#c1ff72' : 'transparent',
          color: isActive ? '#080808' : '#e0e0e0', fontSize: '0.7rem', fontFamily: 'var(--font-number)',
          display: 'flex', alignItems: 'center', gap: '8px', transition: 'background 0.1s',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          borderLeft: isActive ? '3px solid #080808' : '3px solid transparent',
          position: 'relative'
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#222'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        <span>{isFolder ? '📁' : '📄'}</span>
        <span style={{ fontWeight: isActive ? 900 : 500, flex: 1 }}>{name}</span>
        {activeEditor && !isFolder && (
          <span 
            title={`${activeEditor.username} is editing...`}
            style={{ 
              fontSize: '0.8rem', color: activeEditor.color, 
              animation: 'pulse-live 1s infinite',
              display: 'flex', alignItems: 'center'
            }}
          >
            ✎
          </span>
        )}
      </div>
    );
  };

  const renderTree = (node, name = '', currentPath = '') => {
    const path = currentPath ? `${currentPath}/${name}` : name;
    if (node === null) return <FileItem key={path} name={name} path={path} isFolder={false} />;
    return (
      <div key={path} style={{ marginLeft: currentPath ? '12px' : '0' }}>
        {name && <FileItem name={name} path={path} isFolder={true} />}
        <div style={{ marginLeft: name ? '8px' : '0' }}>
          {Object.entries(node)
            .sort(([aName, aNode], [bName, bNode]) => (aNode!==null && bNode===null ? -1 : (aNode===null && bNode!==null ? 1 : aName.localeCompare(bName))))
            .map(([childName, childNode]) => renderTree(childNode, childName, path))}
        </div>
      </div>
    );
  };

  const sectionLabelSty = { fontSize: '0.6rem', fontWeight: 900, color: '#555', marginBottom: '8px', letterSpacing: '0.1em' };
  const inputStyle = { width: '100%', height: '30px', padding: '0 8px', background: '#1a1a1a', border: '1.5px solid #333', color: '#eee', fontSize: '0.7rem', outline: 'none', marginBottom: '8px', boxSizing: 'border-box' };
  const btnStyle = (p) => ({ width: '100%', height: '32px', border: '1.5px solid #080808', background: p ? '#c1ff72' : '#222', color: p ? '#080808' : '#aaa', fontWeight: 900, fontSize: '0.65rem', cursor: 'pointer', marginBottom: '4px', boxShadow: p ? '3px 3px 0 #080808' : 'none' });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#111', borderRight: '2px solid #080808', width: '100%', userSelect: 'none' }}>
      <input ref={folderInputRef} type="file" webkitdirectory="" mozdirectory="" directory="" style={{ display: 'none' }} onChange={handleFolderUpload} />
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} />

      <div style={{ padding: '12px 16px', fontFamily: 'var(--font-header)', fontSize: '0.8rem', fontWeight: 900, color: '#888', borderBottom: '1px solid #222' }}>
        EXPLORER
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Startup Options — Only shown if no session */}
        {!sessionId && (
          <div style={{ padding: '16px' }}>
            <div style={sectionLabelSty}>START DEVELOPMENT</div>
            
            {!panel && (
              <>
                <button style={btnStyle(true)} onClick={() => setPanel('create')}>✨ CREATE SESSION</button>
                <button style={btnStyle(false)} onClick={() => setPanel('join')}>🔗 JOIN SESSION</button>
                <div style={{ margin: '15px 0', borderTop: '1px solid #222' }} />
                <button style={btnStyle(false)} onClick={() => folderInputRef.current?.click()}>📂 ADD PROJECT</button>
                <button style={btnStyle(false)} onClick={() => fileInputRef.current?.click()}>📄 ADD FILES</button>
              </>
            )}

            {panel === 'create' && (
              <div>
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
                <label style={{ fontSize: '0.55rem', color: '#666' }}>SESSION ID</label>
                <input style={inputStyle} value={joinId} onChange={e=>setJoinId(e.target.value)} placeholder="XYZ..." />
                <label style={{ fontSize: '0.55rem', color: '#666' }}>PASSWORD</label>
                <input style={inputStyle} type="password" value={joinPwd} onChange={e=>setJoinPwd(e.target.value)} />
                <button style={btnStyle(true)} onClick={handleJoin}>{isLoading ? 'JOINING...' : 'CONNECT'}</button>
                <button style={{ background: 'none', border: 'none', color: '#555', fontSize: '0.6rem', cursor: 'pointer', width: '100%', marginTop: '5px' }} onClick={()=>setPanel(null)}>← BACK</button>
              </div>
            )}

            {errorMsg && <div style={{ color: '#ff3e3e', fontSize: '0.6rem', marginTop: '10px', padding: '8px', background: 'rgba(255,62,62,0.1)', border: '1px solid #444' }}>{errorMsg}</div>}
          </div>
        )}

        {/* Files Section — Always visible if files exist, or if session is active */}
        {(sessionId || Object.keys(files).length > 0) && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ padding: '8px 16px', ...sectionLabelSty, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>PROJECT FILES</span>
              {userRole === 'owner' && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => folderInputRef.current?.click()} title="Upload Folder" style={{ background: 'none', border: 'none', color: '#c1ff72', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 900 }}>📂</button>
                  <button onClick={() => fileInputRef.current?.click()} title="Add Files" style={{ background: 'none', border: 'none', color: '#c1ff72', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 900 }}>+</button>
                </div>
              )}
            </div>
            
            {Object.keys(files).length === 0 ? (
              userRole === 'owner' ? (
                <div style={{ padding: '20px 16px', color: '#444', textAlign: 'center', fontSize: '0.65rem' }}>
                  <div style={{ marginBottom: '10px' }}>No files yet.</div>
                  <button style={btnStyle(false)} onClick={() => folderInputRef.current?.click()}>📂 UPLOAD PROJECT FOLDER</button>
                  <button style={{ ...btnStyle(false), marginTop: '4px' }} onClick={() => fileInputRef.current?.click()}>📄 ADD INDIVIDUAL FILES</button>
                </div>
              ) : (
                <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center', fontSize: '0.6rem' }}>
                  Waiting for the owner to upload files…
                </div>
              )
            ) : (
              renderTree(tree)
            )}

            <div style={{ margin: '15px 16px', borderTop: '1px solid #222' }} />
            
            <div style={{ padding: '0 16px' }}>
              <div style={sectionLabelSty}>SESSION</div>
              <div style={{ fontSize: '0.7rem', color: '#eee', marginBottom: '6px' }}>{sessionName || 'Local Session'}</div>
              
              {/* Role Badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '3px 10px', marginBottom: '10px',
                fontSize: '0.55rem', fontWeight: 900, fontFamily: 'var(--font-number)',
                letterSpacing: '0.08em',
                background: userRole === 'owner' ? 'rgba(193,255,114,0.15)' : 'rgba(99,102,241,0.15)',
                color: userRole === 'owner' ? '#c1ff72' : '#818cf8',
                border: `1px solid ${userRole === 'owner' ? '#c1ff72' : '#818cf8'}`,
              }}>
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
