/* -------------------------------------------------------
 * CausalityGraph.jsx — Advanced Causality & Interaction Mapping
 * ------------------------------------------------------- */

import React, { useMemo, useCallback } from 'react';
import { ReactFlow, Controls, Background, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import useEditorStore from '../../store/useEditorStore';

// Custom Node Component for high-impact Neo-Brutalism
const BrutalNode = ({ data }) => {
  const bgColor = (() => {
    switch (data.type) {
      case 'error': return 'var(--accent-crimson)';
      case 'change': return 'var(--accent-electric-blue)';
      case 'variable': return 'var(--accent-toxic-green)';
      case 'function': return 'var(--bg-white)';
      case 'entry': return 'var(--color-black)';
      case 'loop': return '#7c3aed';
      case 'condition': return '#f59e0b';
      case 'output': return '#06b6d4';
      case 'success': return '#10b981';
      case 'class': return '#6366f1';
      case 'thread': return '#ec4899';
      default: return 'var(--bg-white)';
    }
  })();

  const darkTypes = ['error', 'change', 'entry', 'loop', 'condition', 'output', 'success', 'class', 'thread'];
  const textColor = darkTypes.includes(data.type) ? '#fff' : 'var(--color-black)';

  return (
    <div className="brutal-node" style={{ 
      background: bgColor, 
      color: textColor,
      width: '240px',
      padding: '16px',
      border: '4px solid var(--color-black)',
      boxShadow: '8px 8px 0px var(--color-black)'
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#000', width: '10px', height: '10px', borderRadius: 0 }} />
      <div className="node-type-tag" style={{ opacity: 0.8, fontSize: '0.6rem', letterSpacing: '0.1em', marginBottom: '4px' }}>
        {(data.type || 'node').toUpperCase()}
      </div>
      <div className="node-label thick-type" style={{ fontSize: '1.1rem', marginBottom: '8px' }}>{data.label}</div>
      {data.detail && (
        <div className="node-detail" style={{ fontSize: '0.8rem', opacity: 0.9, lineHeight: 1.4 }}>
          {data.detail}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#000', width: '10px', height: '10px', borderRadius: 0 }} />
    </div>
  );
};

const nodeTypes = {
  brutalNode: BrutalNode,
};

const CausalityGraph = () => {
  const causalityGraph = useEditorStore((s) => s.causalityGraph);

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
      // Organic Zig-Zag Layout
      position: n.position || { x: i * 280, y: (i % 2) * 180 + 50 },
    }));

    const es = (causalityGraph.edges || []).map(e => ({
      id: e.id || `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label: e.label,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'var(--color-black)', strokeWidth: 3 },
      labelStyle: { fill: 'var(--color-black)', fontWeight: 900, fontSize: 11 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: 'var(--bg-paper)', fillOpacity: 0.9, stroke: 'var(--color-black)', strokeWidth: 2 }
    }));

    return { nodes: ns, edges: es };
  }, [causalityGraph]);

  if (!causalityGraph || !causalityGraph.nodes || causalityGraph.nodes.length === 0) {
    return (
      <div className="output-placeholder glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div className="tech-label" style={{ marginBottom: '1rem' }}>SYSTEM_IDLE</div>
        <div className="impact-text" style={{ fontSize: '1rem', opacity: 0.5 }}>
          [RUN_CODE] TO GENERATE INTERACTION MAP
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '400px', background: 'var(--bg-creme)', border: 'var(--border-thick)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="light"
        nodesDraggable={true}
        nodesConnectable={false}
      >
        <Background color="#000" gap={40} variant="dots" size={1} opacity={0.3} />
        <Controls />
      </ReactFlow>
    </div>
  );
};

export default CausalityGraph;
