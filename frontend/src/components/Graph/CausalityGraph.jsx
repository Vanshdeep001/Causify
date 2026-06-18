/* -------------------------------------------------------
 * CausalityGraph.jsx — Smart Context-Aware Graph
 *
 * Renders different graph modes depending on the project:
 *
 *   MODE 1 — "Causality" (single file / error flow)
 *     Uses causalityGraph from the store. Shows error flow,
 *     variable tracing, function calls — the original graph.
 *     Triggered when: ≤1 file, or causalityGraph has data.
 *
 *   MODE 2 — "Simple Dependency" (small project, 2-4 files)
 *     Shows ALL files in a flat grid with all connections.
 *     No zoom levels, no ego-graph — just a clean overview.
 *
 *   MODE 3 — "Layered Dependency" (large project, 5+ files)
 *     Full ego-graph with zoom levels (Overview, Module, File),
 *     breadcrumb navigation, search, risk analysis.
 *
 * ------------------------------------------------------- */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  Handle,
  Position,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import useEditorStore from '../../store/useEditorStore';
import { buildDependencyMap } from '../../utils/dependencyParser';
import { buildLevel1, buildLevel2, buildLevel3, buildEgoGraph } from '../../utils/graphBuilder';

// ═══════════════════════════════════════════════════════════
//  MODE 1: Causality / Error-Flow Graph (original behavior)
// ═══════════════════════════════════════════════════════════

const BrutalNode = ({ data }) => {
  // Type-specific accent used for the top edge and tag
  const accent = (() => {
    switch (data.type) {
      case 'error': return '#E5484D';
      case 'change': return '#B3B3B3';
      case 'variable': return '#FFFFFF';
      case 'function': return '#A0A0A0';
      case 'entry': return '#EDEDED';
      case 'loop': return '#9D7BFF';
      case 'condition': return '#FFB224';
      case 'output': return '#B3B3B3';
      case 'success': return '#3DD68C';
      case 'class': return '#8B8DFF';
      case 'thread': return '#F76BB8';
      default: return '#A0A0A0';
    }
  })();

  return (
    <div className="brutal-node" style={{
      background: 'var(--s2)',
      color: 'var(--t1)',
      width: '240px',
      padding: '14px 16px',
      border: '1px solid var(--line-strong)',
      borderTop: `2px solid ${accent}`,
      borderRadius: '8px',
      boxShadow: 'var(--shadow-brutal-sm)'
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#3A3A3A', border: '1px solid #4A4A4A', width: '8px', height: '8px', borderRadius: '50%' }} />
      <div className="node-type-tag" style={{
        fontSize: '0.55rem', letterSpacing: '0.1em', marginBottom: '6px',
        color: accent, background: `${accent}14`, border: `1px solid ${accent}40`,
      }}>
        {(data.type || 'node').toUpperCase()}
      </div>
      <div className="node-label" style={{ fontSize: '0.95rem', fontWeight: 600, fontFamily: 'var(--font-header)', marginBottom: '6px' }}>{data.label}</div>
      {data.detail && (
        <div className="node-detail" style={{ fontSize: '0.74rem', color: 'var(--t2)', lineHeight: 1.45 }}>
          {data.detail}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#3A3A3A', border: '1px solid #4A4A4A', width: '8px', height: '8px', borderRadius: '50%' }} />
    </div>
  );
};

const causalityNodeTypes = { brutalNode: BrutalNode };

const CausalityMode = ({ causalityGraph }) => {
  const { nodes, edges } = useMemo(() => {
    if (!causalityGraph || !causalityGraph.nodes) return { nodes: [], edges: [] };

    const ns = causalityGraph.nodes.map((n, i) => ({
      id: n.id || `n-${i}`,
      type: 'brutalNode',
      data: {
        label: n.label || 'Unknown',
        type: n.type || 'node',
        detail: n.detail || ''
      },
      position: n.position || { x: i * 280, y: (i % 2) * 180 + 50 },
    }));

    const es = (causalityGraph.edges || []).map(e => ({
      id: e.id || `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label: e.label,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#3A3A3A', strokeWidth: 1.5 },
      labelStyle: { fill: '#D4D4D4', fontWeight: 600, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: '#1A1A1A', fillOpacity: 0.95, stroke: '#2E2E2E', strokeWidth: 1 }
    }));

    return { nodes: ns, edges: es };
  }, [causalityGraph]);

  if (!causalityGraph || !causalityGraph.nodes || causalityGraph.nodes.length === 0) {
    return (
      <div className="dep-graph-empty" style={{ gap: '8px' }}>
        <div className="dep-empty-title" style={{ fontSize: '0.8rem', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--t2)', textTransform: 'uppercase' }}>SYSTEM IDLE</div>
        <div className="dep-empty-sub" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: 'var(--t4)', textTransform: 'uppercase' }}>Run code to generate the interaction map</div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '400px', background: 'var(--bg-creme)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={causalityNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="dark"
        nodesDraggable={true}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#242424" gap={40} variant="dots" size={1} />
        <Controls
          position="bottom-left"
          showInteractive={false}
          style={{ background: 'var(--s2)', border: '1px solid var(--line-strong)', borderRadius: '6px', boxShadow: 'var(--shadow-brutal-sm)' }}
        />
      </ReactFlow>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════
//  SHARED: Custom node types for dependency graph
// ═══════════════════════════════════════════════════════════

const FILE_TYPE_ICONS = { js: '⚡', css: '🎨', html: '📄', json: '📋', unknown: '📁' };

const getLanguageColor = (fileType) => {
  const ext = fileType?.toLowerCase();
  switch (ext) {
    case 'html': return '#F06529';
    case 'css': return '#2965F1';
    case 'js': return '#F7DF1E';
    case 'jsx': return '#61DAFB';
    case 'ts': return '#3178C6';
    case 'tsx': return '#61DAFB';
    case 'json': return '#3DD68C';
    case 'py': return '#FFE873';
    case 'java': return '#F89820';
    default: return '#A0A0A0';
  }
};

const FolderClusterNode = ({ data }) => (
  <div className="dep-node dep-folder-node" style={{ borderColor: data.color }}>
    <Handle type="target" position={Position.Top} className="dep-handle" />
    <div className="dep-node-header">
      <span className="dep-node-badge" style={{ background: data.color }}>FOLDER</span>
      {data.hasEntryPoint && <span className="dep-entry-badge">ENTRY</span>}
    </div>
    <div className="dep-node-label">{data.label}</div>
    <div className="dep-node-meta">
      <span>{data.fileCount} file{data.fileCount !== 1 ? 's' : ''}</span>
      <span className="dep-node-sep">•</span>
      <span>{data.totalInDegree} import{data.totalInDegree !== 1 ? 's' : ''}</span>
    </div>
    <Handle type="source" position={Position.Bottom} className="dep-handle" />
  </div>
);

const FileNode = ({ data }) => {
  const riskClass = `dep-risk-${data.risk || 'low'}`;
  const langColor = getLanguageColor(data.fileType);

  return (
    <div
      className={`dep-node dep-file-node ${riskClass} ${data.isExternal ? 'dep-external' : ''} ${data.isCenter ? 'dep-center-node' : ''} ${data.isImpact ? 'dep-impact-node' : ''} ${data.isDependency ? 'dep-dependency-node' : ''}`}
      style={{
        borderTop: data.isCenter ? '2px solid var(--lime)' : `2px solid ${langColor}`,
        boxShadow: data.isCenter ? 'var(--shadow-brutal)' : `0 4px 12px ${langColor}12`,
      }}
    >
      <Handle type="target" position={Position.Top} className="dep-handle" />
      <div className="dep-node-header">
        <span className="dep-file-icon" style={{ color: langColor }}>{data.icon}</span>
        <span className="dep-node-badge dep-type-badge" style={{ background: `${langColor}1a`, color: langColor, border: `1px solid ${langColor}40` }}>
          {data.fileType?.toUpperCase()}
        </span>
        {data.isEntryPoint && <span className="dep-entry-badge">ENTRY</span>}
        {data.risk === 'high' && <span className="dep-risk-badge">HIGH RISK</span>}
      </div>
      <div className="dep-node-label">{data.label}</div>
      {data.folder && <div className="dep-node-folder">{data.folder}</div>}
      <div className="dep-node-meta">
        <span title="Files importing this">↓{data.inDegree}</span>
        <span className="dep-node-sep">•</span>
        <span title="Files this imports">↑{data.outDegree}</span>
        {data.hopLevel !== undefined && (
          <>
            <span className="dep-node-sep">•</span>
            <span className="dep-hop-label" style={{ color: data.isCenter ? 'var(--lime)' : 'var(--cyan)' }}>
              {data.hopLevel === 0 ? 'CENTER' : `HOP ${data.hopLevel}`}
            </span>
          </>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="dep-handle" />
    </div>
  );
};

const SymbolNode = ({ data }) => (
  <div className={`dep-node dep-symbol-node ${data.exported ? 'dep-exported' : 'dep-internal'}`}>
    <Handle type="target" position={Position.Top} className="dep-handle" />
    <div className="dep-node-header">
      <span className="dep-symbol-icon">{data.icon}</span>
      <span className="dep-node-badge dep-sym-badge">{data.symbolType?.toUpperCase()}</span>
      {data.exported && <span className="dep-export-badge">EXPORT</span>}
    </div>
    <div className="dep-node-label">{data.label}</div>
    <Handle type="source" position={Position.Bottom} className="dep-handle" />
  </div>
);

const depNodeTypes = {
  folderCluster: FolderClusterNode,
  fileNode: FileNode,
  symbolNode: SymbolNode,
};



// ═══════════════════════════════════════════════════════════
//  MODE 3: Layered Dependency Graph (5+ files)
// ═══════════════════════════════════════════════════════════

const LayeredDepMode = ({ depMap, files, activePath }) => {
  const [zoomLevel, setZoomLevel] = useState(0);
  const [focusFolder, setFocusFolder] = useState(null);
  const [focusFile, setFocusFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const prevActivePathRef = useRef(activePath);
  const graphInstanceRef = useRef(null);

  useEffect(() => {
    if (!depMap) { setNodes([]); setEdges([]); return; }

    let result = { nodes: [], edges: [] };
    if (zoomLevel === 0) {
      const center = focusFile || activePath;
      if (center && depMap.nodes.has(center)) {
        result = buildEgoGraph(depMap, center);
      } else {
        result = buildLevel1(depMap);
      }
    } else if (zoomLevel === 1) {
      result = buildLevel1(depMap);
    } else if (zoomLevel === 2 && focusFolder) {
      result = buildLevel2(depMap, focusFolder);
    } else if (zoomLevel === 3 && focusFile) {
      result = buildLevel3(depMap, focusFile, files[focusFile] || '');
    }

    setNodes(result.nodes);
    setEdges(result.edges);
    setTimeout(() => {
      if (graphInstanceRef.current) graphInstanceRef.current.fitView({ padding: 0.15, duration: 400 });
    }, 100);
  }, [depMap, zoomLevel, focusFolder, focusFile, activePath]);

  useEffect(() => {
    if (activePath !== prevActivePathRef.current) {
      prevActivePathRef.current = activePath;
      if (zoomLevel === 0 && activePath) setFocusFile(activePath);
    }
  }, [activePath, zoomLevel]);

  const onNodeClick = useCallback((_, node) => {
    if (node.type === 'folderCluster') {
      setFocusFolder(node.data.fullPath);
      setZoomLevel(2);
    } else if (node.type === 'fileNode' && !node.data.isCenter) {
      if (zoomLevel === 0) { setFocusFile(node.data.fullPath); }
      else { setFocusFile(node.data.fullPath); setZoomLevel(3); }
    } else if (node.type === 'fileNode' && node.data.isCenter && zoomLevel === 0) {
      setFocusFile(node.data.fullPath);
      setZoomLevel(3);
    }
  }, [zoomLevel]);

  const goToOverview = () => { setZoomLevel(1); setFocusFolder(null); setFocusFile(null); };
  const goToEgo = () => { setZoomLevel(0); setFocusFile(activePath); setFocusFolder(null); };
  const goToFolder = (folder) => { setZoomLevel(2); setFocusFolder(folder); setFocusFile(null); };

  const searchResults = useMemo(() => {
    if (!searchQuery || !depMap) return [];
    const q = searchQuery.toLowerCase();
    const results = [];
    for (const [path, node] of depMap.nodes) {
      if (node.fileName.toLowerCase().includes(q) || path.toLowerCase().includes(q)) {
        results.push({ path, fileName: node.fileName, folder: node.folder });
      }
    }
    return results.slice(0, 10);
  }, [searchQuery, depMap]);

  const focusSearchResult = (path) => {
    setSearchOpen(false);
    setSearchQuery('');
    setFocusFile(path);
    setZoomLevel(0);
  };

  const levelLabels = { 0: 'EGO GRAPH', 1: 'OVERVIEW', 2: 'MODULE', 3: 'FILE' };

  return (
    <div className="dep-graph-container">
      <div className="dep-top-bar">
        <div className="dep-breadcrumb">
          <button className={`dep-crumb ${zoomLevel === 0 ? 'dep-crumb-active' : ''}`} onClick={goToEgo} title="Ego-graph centered on active file">◎ EGO</button>
          <span className="dep-crumb-sep">/</span>
          <button className={`dep-crumb ${zoomLevel === 1 ? 'dep-crumb-active' : ''}`} onClick={goToOverview}>PROJECT</button>
          {focusFolder && (
            <>
              <span className="dep-crumb-sep">/</span>
              <button className={`dep-crumb ${zoomLevel === 2 ? 'dep-crumb-active' : ''}`} onClick={() => goToFolder(focusFolder)}>
                {focusFolder === '/' ? '(root)' : focusFolder.split('/').pop()}
              </button>
            </>
          )}
          {focusFile && zoomLevel === 3 && (
            <>
              <span className="dep-crumb-sep">/</span>
              <span className="dep-crumb dep-crumb-active dep-crumb-file">{focusFile.split('/').pop()}</span>
            </>
          )}
        </div>

        <div className="dep-controls">
          <div className="dep-level-badge">{levelLabels[zoomLevel]}</div>

          <div className="dep-search-wrap">
            <button className="dep-search-toggle" onClick={() => setSearchOpen(!searchOpen)} title="Search files">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            {searchOpen && (
              <div className="dep-search-dropdown">
                <input className="dep-search-input" placeholder="Search files..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                {searchResults.length > 0 && (
                  <div className="dep-search-results no-scrollbar">
                    {searchResults.map((r) => (
                      <button key={r.path} className="dep-search-result" onClick={() => focusSearchResult(r.path)}>
                        <span className="dep-search-file">{r.fileName}</span>
                        <span className="dep-search-path">{r.folder}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="dep-stats">
            <span>{depMap.nodes.size} files</span>
            <span className="dep-node-sep">•</span>
            <span>{depMap.edges.length} deps</span>
          </div>
        </div>
      </div>

      <div className="dep-flow-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onInit={(instance) => { graphInstanceRef.current = instance; }}
          nodeTypes={depNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          colorMode="dark"
          nodesDraggable={true}
          nodesConnectable={false}
          minZoom={0.1}
          maxZoom={2.5}
          defaultEdgeOptions={{ animated: false }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#242424" gap={40} variant="dots" size={1} />
          <Controls
            position="bottom-left"
            showInteractive={false}
            style={{ background: 'var(--s2)', border: '1px solid var(--line-strong)', borderRadius: '6px', boxShadow: 'var(--shadow-brutal-sm)' }}
          />
          <MiniMap
            position="bottom-right"
            nodeColor={(n) =>
              n.type === 'folderCluster' ? (n.data.color || '#B3B3B3') :
              n.data?.risk === 'high' ? '#E5484D' :
              n.data?.risk === 'medium' ? '#FFB224' :
              n.data?.isCenter ? '#FFFFFF' : '#3A3A3A'
            }
            maskColor="rgba(0,0,0,0.5)"
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--line-strong)',
              borderRadius: '6px',
              boxShadow: 'var(--shadow-brutal-sm)',
            }}
          />
        </ReactFlow>
      </div>

      <div className="dep-legend">
        <div className="dep-legend-item"><span className="dep-legend-dot" style={{ background: '#FFFFFF' }} /><span>Active / Center</span></div>
        <div className="dep-legend-item"><span className="dep-legend-dot" style={{ background: '#3DD68C' }} /><span>Low Risk</span></div>
        <div className="dep-legend-item"><span className="dep-legend-dot" style={{ background: '#FFB224' }} /><span>Medium Risk</span></div>
        <div className="dep-legend-item"><span className="dep-legend-dot" style={{ background: '#E5484D' }} /><span>High Risk</span></div>
        <div className="dep-legend-item"><span className="dep-legend-dot" style={{ background: '#B3B3B3' }} /><span>Dependency</span></div>
        <div className="dep-legend-item"><span className="dep-legend-dot dep-legend-dot-outline" /><span>External</span></div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT — Smart Mode Router
// ═══════════════════════════════════════════════════════════

const CausalityGraph = () => {
  const files = useEditorStore((s) => s.files);
  const activePath = useEditorStore((s) => s.activePath);
  const causalityGraph = useEditorStore((s) => s.causalityGraph);

  // Build dependency map for multi-file projects
  const depMap = useMemo(() => {
    if (!files || Object.keys(files).length <= 1) return null;
    return buildDependencyMap(files);
  }, [files]);

  const fileCount = files ? Object.keys(files).length : 0;
  const hasDepMap = depMap && depMap.nodes.size > 0;

  // ── Decide which mode to render ──
  //
  //   Multi-file (2+ files) → ALWAYS layered dependency graph (never overridden by execution data)
  //   Single file (0-1 files) → Causality mode (error flow / implementation from execution)

  // Multi-file project → full layered dependency graph (takes priority)
  if (fileCount >= 2 && hasDepMap) {
    return <LayeredDepMode depMap={depMap} files={files} activePath={activePath} />;
  }

  // Multi-file but no deps detected yet
  if (fileCount >= 2) {
    return (
      <div className="dep-graph-empty" style={{ gap: '16px' }}>
        <div className="dep-empty-icon" style={{ opacity: 0.5, animation: 'none' }}>
          <svg viewBox="0 0 24 24" width="60" height="60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="18" r="3" />
            <line x1="9" y1="9" x2="15" y2="15" strokeDasharray="3 3" opacity="0.4" />
          </svg>
        </div>
        <div className="dep-empty-title" style={{ fontSize: '0.8rem', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--t2)', textTransform: 'uppercase' }}>NO DEPENDENCIES DETECTED</div>
        <div className="dep-empty-sub" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: 'var(--t4)', textTransform: 'uppercase' }}>Add import/require statements to see the graph</div>
      </div>
    );
  }

  // Single file mode: show causality / error flow graph (original behavior)
  return <CausalityMode causalityGraph={causalityGraph} />;
};

export default CausalityGraph;
