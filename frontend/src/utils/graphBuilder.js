/* -------------------------------------------------------
 * graphBuilder.js — Dependency Graph Layout Builder
 *
 * Transforms the raw dependency map into React Flow nodes
 * and edges for the 3 zoom levels:
 *   Level 1 — Folder clusters (Overview)
 *   Level 2 — Files in a folder (Module)
 *   Level 3 — Symbols inside a file (File)
 *
 * Also provides ego-graph extraction (2-hop neighborhood).
 * ------------------------------------------------------- */

import { extractSymbols } from './dependencyParser';

// ── Color helpers ────────────────────────────────────────

const RISK_COLORS = {
  low:    { bg: '#1a2e1a', border: '#2ecc40', glow: '0 0 12px rgba(46,204,64,0.3)' },
  medium: { bg: '#2e2a1a', border: '#f5a623', glow: '0 0 12px rgba(245,166,35,0.3)' },
  high:   { bg: '#2e1a1a', border: '#ff3e3e', glow: '0 0 12px rgba(255,62,62,0.4)' },
};

const FOLDER_COLORS = [
  '#2d5bff', '#c1ff72', '#f5a623', '#e056fd', '#00d2d3',
  '#ff6b6b', '#54a0ff', '#feca57', '#48dbfb', '#ff9ff3',
];

const FILE_TYPE_ICONS = {
  js:      '⚡',
  css:     '🎨',
  html:    '📄',
  json:    '📋',
  unknown: '📁',
};

const SYMBOL_ICONS = {
  component: '◆',
  hook:      '⟡',
  function:  'ƒ',
  class:     '◈',
  'default-export': '▸',
};

// ── Risk level from inDegree ─────────────────────────────

const getRiskLevel = (inDegree, maxInDegree) => {
  if (maxInDegree <= 0) return 'low';
  const ratio = inDegree / maxInDegree;
  if (ratio >= 0.6) return 'high';
  if (ratio >= 0.3) return 'medium';
  return 'low';
};

// ── LEVEL 1: Folder Overview ─────────────────────────────

export const buildLevel1 = (depMap) => {
  const { nodes: nodeMap, folders, edges: rawEdges } = depMap;
  if (!folders || folders.size === 0) return { nodes: [], edges: [] };

  const folderArr = [...folders.keys()].sort();
  const folderNodes = [];
  const folderEdgeMap = new Map(); // "folderA->folderB" => count

  // Build folder nodes
  folderArr.forEach((folder, i) => {
    const filesInFolder = folders.get(folder);
    const fileCount = filesInFolder.size;

    // Count total imports received by this folder
    let totalInDegree = 0;
    let hasEntryPoint = false;
    for (const fp of filesInFolder) {
      const n = nodeMap.get(fp);
      if (n) {
        totalInDegree += n.inDegree;
        if (n.isEntryPoint) hasEntryPoint = true;
      }
    }

    const colorIdx = i % FOLDER_COLORS.length;
    const cols = Math.min(4, Math.ceil(Math.sqrt(folderArr.length)));
    const row = Math.floor(i / cols);
    const col = i % cols;

    folderNodes.push({
      id: `folder:${folder}`,
      type: 'folderCluster',
      position: { x: col * 320 + 60, y: row * 220 + 60 },
      data: {
        label: folder === '/' ? '(root)' : folder.split('/').pop() || folder,
        fullPath: folder,
        fileCount,
        totalInDegree,
        hasEntryPoint,
        color: FOLDER_COLORS[colorIdx],
      },
    });
  });

  // Cross-folder edges
  for (const edge of rawEdges) {
    const srcFolder = nodeMap.get(edge.source)?.folder;
    const tgtFolder = nodeMap.get(edge.target)?.folder;
    if (!srcFolder || !tgtFolder || srcFolder === tgtFolder) continue;

    const key = `${srcFolder}->${tgtFolder}`;
    folderEdgeMap.set(key, (folderEdgeMap.get(key) || 0) + 1);
  }

  const folderEdges = [];
  for (const [key, count] of folderEdgeMap) {
    const [src, tgt] = key.split('->');
    folderEdges.push({
      id: `fe:${key}`,
      source: `folder:${src}`,
      target: `folder:${tgt}`,
      label: `${count}`,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#080808', strokeWidth: Math.min(1 + count, 5) },
      labelStyle: { fill: '#080808', fontWeight: 700, fontSize: 10, fontFamily: 'Unbounded, sans-serif' },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: '#f8f6f0', fillOpacity: 0.9, stroke: '#080808', strokeWidth: 2 },
    });
  }

  return { nodes: folderNodes, edges: folderEdges };
};

// ── LEVEL 2: Module (Files in a folder) ──────────────────

export const buildLevel2 = (depMap, folderPath) => {
  const { nodes: nodeMap, folders, edges: rawEdges } = depMap;
  const filesInFolder = folders.get(folderPath);
  if (!filesInFolder) return { nodes: [], edges: [] };

  // Max inDegree for risk scaling
  let maxInDegree = 0;
  for (const fp of filesInFolder) {
    const n = nodeMap.get(fp);
    if (n && n.inDegree > maxInDegree) maxInDegree = n.inDegree;
  }

  // Also include files from other folders that directly connect
  const connectedExternal = new Set();
  for (const fp of filesInFolder) {
    const n = nodeMap.get(fp);
    if (!n) continue;
    for (const imp of n.imports) {
      if (!filesInFolder.has(imp)) connectedExternal.add(imp);
    }
    for (const impBy of n.importedBy) {
      if (!filesInFolder.has(impBy)) connectedExternal.add(impBy);
    }
  }

  const fileNodes = [];
  const filesArr = [...filesInFolder];
  const allRelevant = [...filesArr, ...connectedExternal];

  // Layout: internal files in a grid, external files on the periphery
  filesArr.forEach((fp, i) => {
    const n = nodeMap.get(fp);
    if (!n) return;
    const risk = getRiskLevel(n.inDegree, maxInDegree);
    const riskStyle = RISK_COLORS[risk];
    const cols = Math.min(4, Math.ceil(Math.sqrt(filesArr.length)));
    const row = Math.floor(i / cols);
    const col = i % cols;

    fileNodes.push({
      id: `file:${fp}`,
      type: 'fileNode',
      position: { x: col * 280 + 60, y: row * 150 + 60 },
      data: {
        label: n.fileName,
        fullPath: fp,
        fileType: n.fileType,
        icon: FILE_TYPE_ICONS[n.fileType] || '📁',
        inDegree: n.inDegree,
        outDegree: n.imports.size,
        risk,
        riskStyle,
        isEntryPoint: n.isEntryPoint,
        isExternal: false,
      },
    });
  });

  // External connected nodes (dimmed)
  [...connectedExternal].forEach((fp, i) => {
    const n = nodeMap.get(fp);
    if (!n) return;
    const angle = (2 * Math.PI * i) / connectedExternal.size;
    const radius = 380;
    const centerX = 300;
    const centerY = 200;

    fileNodes.push({
      id: `file:${fp}`,
      type: 'fileNode',
      position: {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      },
      data: {
        label: n.fileName,
        fullPath: fp,
        fileType: n.fileType,
        icon: FILE_TYPE_ICONS[n.fileType] || '📁',
        inDegree: n.inDegree,
        outDegree: n.imports.size,
        risk: 'low',
        riskStyle: RISK_COLORS.low,
        isEntryPoint: n.isEntryPoint,
        isExternal: true,
      },
    });
  });

  // Edges between relevant files
  const fileEdges = [];
  const edgeSet = new Set();
  const relevantSet = new Set(allRelevant);

  for (const edge of rawEdges) {
    if (relevantSet.has(edge.source) && relevantSet.has(edge.target)) {
      const edgeKey = `${edge.source}->${edge.target}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);

      const isInternal = filesInFolder.has(edge.source) && filesInFolder.has(edge.target);
      fileEdges.push({
        id: `fe2:${edgeKey}`,
        source: `file:${edge.source}`,
        target: `file:${edge.target}`,
        type: 'smoothstep',
        animated: isInternal,
        style: {
          stroke: isInternal ? '#080808' : '#aaa',
          strokeWidth: isInternal ? 3 : 1.5,
          strokeDasharray: isInternal ? 'none' : '5,5',
        },
        markerEnd: { type: 'arrowclosed', color: isInternal ? '#080808' : '#aaa' },
      });
    }
  }

  return { nodes: fileNodes, edges: fileEdges };
};

// ── LEVEL 3: File Internals (Symbols) ────────────────────

export const buildLevel3 = (depMap, filePath, fileContent) => {
  const { nodes: nodeMap, edges: rawEdges } = depMap;
  const node = nodeMap.get(filePath);
  if (!node) return { nodes: [], edges: [] };

  const symbols = extractSymbols(fileContent || '', filePath);
  const symbolNodes = [];
  const symbolEdges = [];

  // Center: the file itself
  symbolNodes.push({
    id: `file:${filePath}`,
    type: 'fileNode',
    position: { x: 400, y: 40 },
    data: {
      label: node.fileName,
      fullPath: filePath,
      fileType: node.fileType,
      icon: FILE_TYPE_ICONS[node.fileType] || '📁',
      inDegree: node.inDegree,
      outDegree: node.imports.size,
      risk: 'low',
      riskStyle: RISK_COLORS.low,
      isEntryPoint: node.isEntryPoint,
      isExternal: false,
      isCenterFile: true,
    },
  });

  // Symbols inside the file
  symbols.forEach((sym, i) => {
    const cols = Math.min(4, Math.ceil(Math.sqrt(symbols.length)));
    const row = Math.floor(i / cols);
    const col = i % cols;

    symbolNodes.push({
      id: `sym:${filePath}:${sym.name}`,
      type: 'symbolNode',
      position: { x: col * 220 + 160, y: row * 120 + 180 },
      data: {
        label: sym.name,
        symbolType: sym.type,
        icon: SYMBOL_ICONS[sym.type] || 'ƒ',
        exported: sym.exported,
      },
    });

    symbolEdges.push({
      id: `se:${filePath}:${sym.name}`,
      source: `file:${filePath}`,
      target: `sym:${filePath}:${sym.name}`,
      type: 'smoothstep',
      style: { stroke: sym.exported ? '#080808' : '#bbb', strokeWidth: 2 },
      animated: sym.exported,
    });
  });

  // Outward impact: files that import this file
  const importedByArr = [...node.importedBy];
  importedByArr.forEach((impBy, i) => {
    const impByNode = nodeMap.get(impBy);
    if (!impByNode) return;
    const angle = (Math.PI * (i + 1)) / (importedByArr.length + 1) - Math.PI / 2;
    const radius = 350;

    symbolNodes.push({
      id: `impact:${impBy}`,
      type: 'fileNode',
      position: {
        x: 400 + radius * Math.cos(angle) + 200,
        y: 250 + radius * Math.sin(angle),
      },
      data: {
        label: impByNode.fileName,
        fullPath: impBy,
        fileType: impByNode.fileType,
        icon: FILE_TYPE_ICONS[impByNode.fileType] || '📁',
        inDegree: impByNode.inDegree,
        outDegree: impByNode.imports.size,
        risk: 'low',
        riskStyle: RISK_COLORS.low,
        isEntryPoint: impByNode.isEntryPoint,
        isExternal: true,
        isImpact: true,
      },
    });

    symbolEdges.push({
      id: `ie:${filePath}->${impBy}`,
      source: `file:${filePath}`,
      target: `impact:${impBy}`,
      type: 'smoothstep',
      label: 'impacts',
      animated: true,
      style: { stroke: '#ff3e3e', strokeWidth: 2.5, strokeDasharray: '6,3' },
      labelStyle: { fill: '#ff3e3e', fontWeight: 700, fontSize: 9, fontFamily: 'Unbounded, sans-serif' },
      labelBgPadding: [3, 2],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: '#fff5f5', fillOpacity: 0.95, stroke: '#ff3e3e', strokeWidth: 1 },
    });
  });

  // Files this file imports (dependencies)
  const importsArr = [...node.imports];
  importsArr.forEach((imp, i) => {
    const impNode = nodeMap.get(imp);
    if (!impNode) return;
    const angle = (Math.PI * (i + 1)) / (importsArr.length + 1) + Math.PI / 2;
    const radius = 350;

    // Skip if already added as impact
    if (symbolNodes.find(n => n.id === `impact:${imp}`)) return;

    symbolNodes.push({
      id: `dep:${imp}`,
      type: 'fileNode',
      position: {
        x: 400 + radius * Math.cos(angle) - 200,
        y: 250 + radius * Math.sin(angle),
      },
      data: {
        label: impNode.fileName,
        fullPath: imp,
        fileType: impNode.fileType,
        icon: FILE_TYPE_ICONS[impNode.fileType] || '📁',
        inDegree: impNode.inDegree,
        outDegree: impNode.imports.size,
        risk: 'low',
        riskStyle: RISK_COLORS.low,
        isEntryPoint: impNode.isEntryPoint,
        isExternal: true,
        isDependency: true,
      },
    });

    symbolEdges.push({
      id: `de:${filePath}->${imp}`,
      source: `file:${filePath}`,
      target: `dep:${imp}`,
      type: 'smoothstep',
      label: 'imports',
      style: { stroke: '#2d5bff', strokeWidth: 2.5 },
      labelStyle: { fill: '#2d5bff', fontWeight: 700, fontSize: 9, fontFamily: 'Unbounded, sans-serif' },
      labelBgPadding: [3, 2],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: '#f0f4ff', fillOpacity: 0.95, stroke: '#2d5bff', strokeWidth: 1 },
    });
  });

  return { nodes: symbolNodes, edges: symbolEdges };
};

// ── EGO-GRAPH: Hierarchical 3-row layout ─────────────────

/**
 * Build an ego-graph centered on `centerPath`.
 *
 * Layout (top → bottom):
 *   Row 0  — Files that IMPORT this file (dependents/impact)
 *   Row 1  — ★ CENTER FILE ★
 *   Row 2  — Files this file IMPORTS (dependencies)
 *
 * Each row is capped at MAX_PER_ROW nodes.
 * Only edges that touch the center are shown — no cross-edges
 * between peripheral nodes — keeping the graph clean.
 */
const MAX_PER_ROW = 8;
const NODE_W = 240;  // approximate node width + gap
const ROW_GAP = 200; // vertical gap between rows

export const buildEgoGraph = (depMap, centerPath) => {
  const { nodes: nodeMap } = depMap;
  const centerNode = nodeMap.get(centerPath);
  if (!centerNode) return { nodes: [], edges: [] };

  // ── Separate dependents (importedBy) and dependencies (imports) ──
  const dependents  = [...centerNode.importedBy].filter(p => nodeMap.has(p));
  const dependencies = [...centerNode.imports].filter(p => nodeMap.has(p));

  // Cap to avoid overcrowding
  const shownDependents   = dependents.slice(0, MAX_PER_ROW);
  const hiddenDependents  = dependents.length - shownDependents.length;
  const shownDependencies = dependencies.slice(0, MAX_PER_ROW);
  const hiddenDeps        = dependencies.length - shownDependencies.length;

  // Collect all shown paths for risk calculation
  const allShown = [centerPath, ...shownDependents, ...shownDependencies];
  let maxInDegree = 0;
  for (const p of allShown) {
    const n = nodeMap.get(p);
    if (n && n.inDegree > maxInDegree) maxInDegree = n.inDegree;
  }

  const egoNodes = [];
  const egoEdges = [];

  // ── Helper to create a file node ──
  const makeNode = (fp, hopLevel, isCenter = false) => {
    const n = nodeMap.get(fp);
    if (!n) return null;
    const risk = getRiskLevel(n.inDegree, maxInDegree);
    return {
      id: `file:${fp}`,
      type: 'fileNode',
      data: {
        label: n.fileName,
        fullPath: fp,
        fileType: n.fileType,
        icon: FILE_TYPE_ICONS[n.fileType] || '📁',
        inDegree: n.inDegree,
        outDegree: n.imports.size,
        risk,
        riskStyle: RISK_COLORS[risk],
        isEntryPoint: n.isEntryPoint,
        isExternal: !isCenter,
        hopLevel,
        isCenter,
        folder: n.folder,
        isImpact: hopLevel === 1 && !isCenter && centerNode.importedBy.has(fp),
        isDependency: hopLevel === 1 && !isCenter && centerNode.imports.has(fp),
      },
    };
  };

  // ── Helper to position a row of nodes centered horizontally ──
  const layoutRow = (items, rowY) => {
    const totalW = items.length * NODE_W;
    const startX = Math.max(60, (800 - totalW) / 2);
    items.forEach((fp, i) => {
      const node = makeNode(fp, 1);
      if (!node) return;
      node.position = { x: startX + i * NODE_W, y: rowY };
      egoNodes.push(node);
    });
  };

  // ── Row 0: Dependents (who imports this file) — top ──
  const row0Y = 40;
  layoutRow(shownDependents, row0Y);

  // Overflow indicator for dependents
  if (hiddenDependents > 0) {
    egoNodes.push({
      id: 'overflow:dependents',
      type: 'fileNode',
      position: { x: 60 + shownDependents.length * NODE_W, y: row0Y },
      data: {
        label: `+${hiddenDependents} more`,
        fullPath: '',
        fileType: 'unknown',
        icon: '···',
        inDegree: 0,
        outDegree: 0,
        risk: 'low',
        riskStyle: RISK_COLORS.low,
        isExternal: true,
        hopLevel: 1,
        isCenter: false,
        isOverflow: true,
      },
    });
  }

  // ── Row 1: Center file — middle ──
  const row1Y = shownDependents.length > 0 ? row0Y + ROW_GAP : 80;
  const centerFileNode = makeNode(centerPath, 0, true);
  const totalTopW = Math.max(shownDependents.length, shownDependencies.length) * NODE_W;
  centerFileNode.position = { x: Math.max(60, (800 - NODE_W) / 2), y: row1Y };
  egoNodes.push(centerFileNode);

  // ── Row 2: Dependencies (what this file imports) — bottom ──
  const row2Y = row1Y + ROW_GAP;
  layoutRow(shownDependencies, row2Y);

  // Overflow indicator for dependencies
  if (hiddenDeps > 0) {
    egoNodes.push({
      id: 'overflow:dependencies',
      type: 'fileNode',
      position: { x: 60 + shownDependencies.length * NODE_W, y: row2Y },
      data: {
        label: `+${hiddenDeps} more`,
        fullPath: '',
        fileType: 'unknown',
        icon: '···',
        inDegree: 0,
        outDegree: 0,
        risk: 'low',
        riskStyle: RISK_COLORS.low,
        isExternal: true,
        hopLevel: 1,
        isCenter: false,
        isOverflow: true,
      },
    });
  }

  // ── Edges: ONLY center ↔ direct neighbors ──
  // Dependents → Center (arrows pointing down)
  for (const fp of shownDependents) {
    egoEdges.push({
      id: `ego:${fp}->${centerPath}`,
      source: `file:${fp}`,
      target: `file:${centerPath}`,
      type: 'smoothstep',
      animated: true,
      label: 'imports',
      style: { stroke: '#ff3e3e', strokeWidth: 2.5 },
      labelStyle: { fill: '#ff3e3e', fontWeight: 700, fontSize: 9, fontFamily: 'Unbounded, sans-serif' },
      labelBgPadding: [3, 2],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: '#fff5f5', fillOpacity: 0.95, stroke: '#ff3e3e', strokeWidth: 1 },
      markerEnd: { type: 'arrowclosed', color: '#ff3e3e' },
    });
  }

  // Center → Dependencies (arrows pointing down)
  for (const fp of shownDependencies) {
    egoEdges.push({
      id: `ego:${centerPath}->${fp}`,
      source: `file:${centerPath}`,
      target: `file:${fp}`,
      type: 'smoothstep',
      animated: true,
      label: 'imports',
      style: { stroke: '#2d5bff', strokeWidth: 2.5 },
      labelStyle: { fill: '#2d5bff', fontWeight: 700, fontSize: 9, fontFamily: 'Unbounded, sans-serif' },
      labelBgPadding: [3, 2],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: '#f0f4ff', fillOpacity: 0.95, stroke: '#2d5bff', strokeWidth: 1 },
      markerEnd: { type: 'arrowclosed', color: '#2d5bff' },
    });
  }

  return { nodes: egoNodes, edges: egoEdges };
};

export default { buildLevel1, buildLevel2, buildLevel3, buildEgoGraph };
