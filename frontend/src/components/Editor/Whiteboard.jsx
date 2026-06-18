/* -------------------------------------------------------
 * Whiteboard.jsx — Infinite Collaborative Whiteboard
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { getWhiteboard, saveWhiteboard } from '../../services/api';
import { sendWhiteboardUpdate, sendCursorPosition } from '../../services/socket';
import LinkToCodeModal from '../Modals/LinkToCodeModal';

const TOOL_LIST = [
  { id: 'select', label: 'Select & Move', icon: 'M5 3l14 9-7 2 4 5-2 1-4-5-5 2V3z' },
  { id: 'pen', label: 'Freehand Pen', icon: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' },
  { id: 'rect', label: 'Rectangle', icon: 'M3 3h18v18H3z' },
  { id: 'ellipse', label: 'Ellipse', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z' },
  { id: 'arrow', label: 'Connector Arrow', icon: 'M5 12h14M12 5l7 7-7 7' },
  { id: 'text', label: 'Text Box', icon: 'M4 7V4h16v3M9 20h6M12 4v16' },
  { id: 'sticky', label: 'Sticky Note', icon: 'M3 3h12l6 6v12H3V3z M15 3v6h6' },
  { id: 'eraser', label: 'Eraser', icon: 'M20 20H7L3 16c-.78-.78-.78-2.05 0-2.83l9.17-9.17c.78-.78 2.05-.78 2.83 0l5 5c.78.78.78 2.05 0 2.83L12.83 20H20' }
];

const STICKY_COLORS = [
  { id: 'yellow', bg: '#fef08a', text: '#854d0e', label: 'Yellow' },
  { id: 'orange', bg: '#fed7aa', text: '#9a3412', label: 'Orange' },
  { id: 'pink', bg: '#fbcfe8', text: '#9d174d', label: 'Pink' },
  { id: 'blue', bg: '#bfdbfe', text: '#1e40af', label: 'Blue' },
  { id: 'green', bg: '#bbf7d0', text: '#166534', label: 'Green' }
];

const getIndicatorCoords = (el) => {
  switch (el.type) {
    case 'rect':
      return {
        x: el.width < 0 ? el.x + el.width : el.x,
        y: (el.height < 0 ? el.y + el.height : el.y) - 26
      };
    case 'ellipse':
      return {
        x: el.cx - el.rx,
        y: el.cy - el.ry - 26
      };
    case 'arrow':
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2) - 26
      };
    case 'pen':
      if (el.points && el.points.length > 0) {
        let minX = el.points[0].x;
        let minY = el.points[0].y;
        el.points.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
        });
        return { x: minX, y: minY - 26 };
      }
      return { x: 0, y: 0 };
    case 'text':
      return {
        x: el.x,
        y: el.y - 41
      };
    case 'sticky':
      return {
        x: el.x,
        y: el.y - 26
      };
    default:
      return { x: el.x || 0, y: (el.y || 0) - 26 };
  }
};

const Whiteboard = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const currentUser = useEditorStore((s) => s.currentUser);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const rawWhiteboardElements = useEditorStore((s) => s.whiteboardElements);
  const whiteboardElements = Array.isArray(rawWhiteboardElements) ? rawWhiteboardElements : [];
  const setWhiteboardElements = useEditorStore((s) => s.setWhiteboardElements);
  const whiteboardCursors = useEditorStore((s) => s.whiteboardCursors);
  const updateWhiteboardCursor = useEditorStore((s) => s.updateWhiteboardCursor);
  const removeWhiteboardCursor = useEditorStore((s) => s.removeWhiteboardCursor);
  const setActiveView = useEditorStore((s) => s.setActiveView);
  const openFile = useEditorStore((s) => s.openFile);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);

  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#6366f1'); // Default pen color
  const [stickyColor, setStickyColor] = useState('yellow'); // Default sticky color

  // Transform state from Zustand store
  const pan = useEditorStore((s) => s.whiteboardPan);
  const zoom = useEditorStore((s) => s.whiteboardZoom);
  const setPan = useEditorStore((s) => s.setWhiteboardPan);
  const setZoom = useEditorStore((s) => s.setWhiteboardZoom);

  // Interaction variables
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedElementId, setDraggedElementId] = useState(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [editingElementId, setEditingElementId] = useState(null);
  const [hoveredElementId, setHoveredElementId] = useState(null);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, elementId }
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkElementId, setLinkElementId] = useState(null);

  // Refs
  const svgRef = useRef(null);
  const startPanRef = useRef({ x: 0, y: 0 });
  const saveTimeoutRef = useRef(null);

  // ── 1. Fetch Board State from Backend ──
  useEffect(() => {
    if (sessionId) {
      getWhiteboard(sessionId)
        .then((data) => {
          if (Array.isArray(data)) {
            setWhiteboardElements(data);
          } else {
            setWhiteboardElements([]);
          }
        })
        .catch((err) => console.error('[Whiteboard] Load failed:', err));
    }
  }, [sessionId, setWhiteboardElements]);

  // ── 2. WebSocket Listener for Remote Updates ──
  useEffect(() => {
    const handleRemoteUpdate = (event) => {
      // Differentiate event types
      const { type, element, elementId, userId } = event;
      if (userId === currentUser?.id) return; // Skip our own echoed actions

      if (type === 'add' || type === 'update') {
        if (editingElementId === element.id || draggedElementId === element.id) return; // Ignore if editing/dragging
        setWhiteboardElements((prev) => {
          const exists = prev.some((el) => el.id === element.id);
          if (exists) {
            return prev.map((el) => (el.id === element.id ? element : el));
          } else {
            return [...prev, element];
          }
        });
      } else if (type === 'delete') {
        setWhiteboardElements((prev) => prev.filter((el) => el.id !== elementId));
      } else if (type === 'clear') {
        setWhiteboardElements([]);
      }
    };

    // Store callbacks in window or register to socket hook.
    // We will inject the listener inside App.jsx's WebSocket callback wrapper by setting a global reference,
    // or registering a listener that our WebSocket code calls.
    window.onWhiteboardSocketMessage = handleRemoteUpdate;

    return () => {
      window.onWhiteboardSocketMessage = null;
    };
  }, [currentUser, editingElementId, draggedElementId, setWhiteboardElements]);

  // ── 3. Handle Remote Cursors ──
  useEffect(() => {
    const handleRemoteCursor = (event) => {
      if (event.userId === currentUser?.id) return;
      if (event.onWhiteboard) {
        updateWhiteboardCursor(event.userId, event);
      }
    };

    window.onWhiteboardCursorMessage = handleRemoteCursor;
    return () => {
      window.onWhiteboardCursorMessage = null;
    };
  }, [currentUser, updateWhiteboardCursor]);

  // ── 4. Save Whiteboard State with Debouncing ──
  const triggerAutosave = useCallback((elements) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (sessionId) {
        saveWhiteboard(sessionId, JSON.stringify(elements))
          .then(() => console.log('[Whiteboard] Auto-saved'))
          .catch((err) => console.error('[Whiteboard] Save failed:', err));
      }
    }, 1500); // 1.5s debounce
  }, [sessionId]);

  // Update elements locally and sync/autosave
  const updateElementsAndSync = useCallback((newElements, updateType, element, targetId) => {
    setWhiteboardElements(newElements);
    triggerAutosave(newElements);

    // Publish WebSocket sync update
    if (sessionId && currentUser) {
      sendWhiteboardUpdate(sessionId, {
        type: updateType,
        element: element,
        elementId: targetId,
        userId: currentUser.id,
      });
    }
  }, [sessionId, currentUser, setWhiteboardElements, triggerAutosave]);

  // ── 5. Coordinate conversion ──
  const getCanvasCoords = (clientX, clientY) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - pan.x) / zoom;
    const y = (clientY - rect.top - pan.y) / zoom;
    return { x, y };
  };

  // ── 6. Panning / Mouse Wheel Zooming ──
  const handleWheel = (e) => {
    e.preventDefault();
    if (!svgRef.current) return;

    const zoomFactor = 1.1;
    let nextZoom = zoom;

    if (e.deltaY < 0) {
      nextZoom = Math.min(zoom * zoomFactor, 8); // Max zoom 8x
    } else {
      nextZoom = Math.max(zoom / zoomFactor, 0.15); // Min zoom 15%
    }

    // Zoom relative to pointer coordinates
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const dx = mouseX - pan.x;
    const dy = mouseY - pan.y;

    const nextPan = {
      x: mouseX - dx * (nextZoom / zoom),
      y: mouseY - dy * (nextZoom / zoom)
    };

    setZoom(nextZoom);
    setPan(nextPan);
  };

  // ── 7. Pointer down / move / up state machine ──
  const handlePointerDown = (e) => {
    // Exit edit mode if clicking anywhere outside the active box
    if (editingElementId) {
      setEditingElementId(null);
    }

    // Left click on canvas can pan if space is pressed, or if select tool is on empty space, or if middle mouse button (button 1)
    const isMiddleClick = e.button === 1;
    const isRightClick = e.button === 2;
    const isSpacePan = activeTool === 'select' && e.shiftKey; // Simple Shift-click shortcut as alternative

    if (isMiddleClick || isRightClick || isSpacePan || (activeTool === 'select' && e.target === svgRef.current)) {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setContextMenu(null);
      return;
    }

    setContextMenu(null);

    const coords = getCanvasCoords(e.clientX, e.clientY);

    // Freehand Pen
    if (activeTool === 'pen') {
      setIsDrawing(true);
      const newPen = {
        id: `pen-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type: 'pen',
        points: [coords],
        color: activeColor,
        thickness: 3,
        createdBy: currentUser?.username || 'Collaborator',
        createdColor: currentUser?.color || '#6366f1'
      };
      setCurrentElement(newPen);
      return;
    }

    // Rectangle
    if (activeTool === 'rect') {
      setIsDrawing(true);
      const newRect = {
        id: `rect-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type: 'rect',
        x: coords.x,
        y: coords.y,
        width: 10,
        height: 10,
        color: activeColor,
        fill: false,
        createdBy: currentUser?.username || 'Collaborator',
        createdColor: currentUser?.color || '#6366f1'
      };
      setCurrentElement(newRect);
      return;
    }

    // Ellipse
    if (activeTool === 'ellipse') {
      setIsDrawing(true);
      const newEllipse = {
        id: `ellipse-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type: 'ellipse',
        cx: coords.x,
        cy: coords.y,
        rx: 5,
        ry: 5,
        color: activeColor,
        fill: false,
        createdBy: currentUser?.username || 'Collaborator',
        createdColor: currentUser?.color || '#6366f1'
      };
      setCurrentElement(newEllipse);
      return;
    }

    // Arrow
    if (activeTool === 'arrow') {
      setIsDrawing(true);
      const newArrow = {
        id: `arrow-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type: 'arrow',
        x1: coords.x,
        y1: coords.y,
        x2: coords.x + 5,
        y2: coords.y + 5,
        color: activeColor,
        createdBy: currentUser?.username || 'Collaborator',
        createdColor: currentUser?.color || '#6366f1'
      };
      setCurrentElement(newArrow);
      return;
    }

    // Text box click-to-place
    if (activeTool === 'text') {
      const newId = `text-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const newText = {
        id: newId,
        type: 'text',
        x: coords.x,
        y: coords.y,
        text: '', // Start empty for placeholder to work
        color: '#1e293b', // Default to dark slate
        createdBy: currentUser?.username || 'Collaborator',
        createdColor: currentUser?.color || '#6366f1'
      };
      const updated = [...whiteboardElements, newText];
      updateElementsAndSync(updated, 'add', newText);
      setEditingElementId(newId);
      setActiveTool('select');
      return;
    }

    // Sticky Note click-to-place
    if (activeTool === 'sticky') {
      const newId = `sticky-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const col = STICKY_COLORS.find(c => c.id === stickyColor) || STICKY_COLORS[0];
      const newSticky = {
        id: newId,
        type: 'sticky',
        x: coords.x - 75, // Center note on pointer
        y: coords.y - 75,
        width: 150,
        height: 150,
        text: '', // Start empty for placeholder to work
        bgColor: col.bg,
        textColor: col.text,
        createdBy: currentUser?.username || 'Collaborator',
        createdColor: currentUser?.color || '#6366f1'
      };
      const updated = [...whiteboardElements, newSticky];
      updateElementsAndSync(updated, 'add', newSticky);
      setEditingElementId(newId);
      setActiveTool('select');
      return;
    }
  };

  const handlePointerMove = (e) => {
    // 1. Handle Panning
    if (isPanning) {
      setPan({
        x: e.clientX - startPanRef.current.x,
        y: e.clientY - startPanRef.current.y
      });
      return;
    }

    const coords = getCanvasCoords(e.clientX, e.clientY);

    // Send pointer position to other users
    if (sessionId && currentUser) {
      sendCursorPosition(sessionId, currentUser.id, {
        x: coords.x,
        y: coords.y,
        onWhiteboard: true,
        username: currentUser.username,
        color: currentUser.color || '#6366f1'
      });
    }

    // 2. Handle Drawing
    if (isDrawing && currentElement) {
      let updated = { ...currentElement };
      if (currentElement.type === 'pen') {
        updated.points = [...currentElement.points, coords];
      } else if (currentElement.type === 'rect') {
        updated.width = coords.x - currentElement.x;
        updated.height = coords.y - currentElement.y;
      } else if (currentElement.type === 'ellipse') {
        updated.rx = Math.abs(coords.x - currentElement.cx);
        updated.ry = Math.abs(coords.y - currentElement.cy);
      } else if (currentElement.type === 'arrow') {
        updated.x2 = coords.x;
        updated.y2 = coords.y;
      }
      setCurrentElement(updated);
      return;
    }

    // 3. Handle Dragging/Moving elements
    if (isDragging && draggedElementId) {
      const dx = coords.x - dragStart.x;
      const dy = coords.y - dragStart.y;
      setDragStart(coords);

      setWhiteboardElements((prev) =>
        prev.map((el) => {
          if (el.id !== draggedElementId) return el;
          let moved = { ...el };
          if (el.type === 'pen') {
            moved.points = el.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
          } else if (el.type === 'rect' || el.type === 'text' || el.type === 'sticky') {
            moved.x = el.x + dx;
            moved.y = el.y + dy;
          } else if (el.type === 'ellipse') {
            moved.cx = el.cx + dx;
            moved.cy = el.cy + dy;
          } else if (el.type === 'arrow') {
            moved.x1 = el.x1 + dx;
            moved.y1 = el.y1 + dy;
            moved.x2 = el.x2 + dx;
            moved.y2 = el.y2 + dy;
          }
          return moved;
        })
      );
    }
  };

  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing && currentElement) {
      // Only keep pen drawings with multiple points, rect/ellipse with some dimension, etc.
      let valid = true;
      if (currentElement.type === 'pen' && currentElement.points.length < 2) valid = false;
      if (currentElement.type === 'rect' && Math.abs(currentElement.width) < 5 && Math.abs(currentElement.height) < 5) valid = false;

      if (valid) {
        // Correct negative width/height for rectangle
        let el = { ...currentElement };
        if (el.type === 'rect') {
          if (el.width < 0) {
            el.x = el.x + el.width;
            el.width = Math.abs(el.width);
          }
          if (el.height < 0) {
            el.y = el.y + el.height;
            el.height = Math.abs(el.height);
          }
        }

        const updated = [...whiteboardElements, el];
        updateElementsAndSync(updated, 'add', el);
      }
      setIsDrawing(false);
      setCurrentElement(null);
      return;
    }

    if (isDragging && draggedElementId) {
      const finalElement = whiteboardElements.find((el) => el.id === draggedElementId);
      if (finalElement) {
        const updatedElement = {
          ...finalElement,
          updatedBy: currentUser?.username || 'Collaborator',
          updatedColor: currentUser?.color || '#6366f1'
        };
        const updatedList = whiteboardElements.map(el => el.id === draggedElementId ? updatedElement : el);
        // Sync final position with backend/web socket
        updateElementsAndSync(updatedList, 'update', updatedElement);
      }
      setIsDragging(false);
      setDraggedElementId(null);
    }
  };

  // ── 8. Drag and Drop Start ──
  const startDragElement = (e, elementId) => {
    if (activeTool !== 'select' || editingElementId === elementId) return;
    e.stopPropagation();
    const coords = getCanvasCoords(e.clientX, e.clientY);
    setIsDragging(true);
    setDraggedElementId(elementId);
    setDragStart(coords);
  };

  // ── 9. Element double clicks (Inline Edit / Deep Link Navigation) ──
  const handleElementDoubleClick = (e, element) => {
    e.stopPropagation();
    if (activeTool !== 'select') return;

    // Trigger Code Link navigation if exists
    if (element.codeLink) {
      navigateToCode(element.codeLink);
      return;
    }

    // Otherwise, edit text/sticky note
    if (element.type === 'text' || element.type === 'sticky') {
      setEditingElementId(element.id);
    }
  };

  const navigateToCode = (link) => {
    setActiveView('code');
    if (link.linkType === 'file' || link.linkType === 'fileRange') {
      if (link.filePath) {
        openFile(link.filePath);
        if (link.linkType === 'fileRange' && link.startLine) {
          setTimeout(() => {
            if (window.monaco) {
              const editors = window.monaco.editor.getEditors();
              if (editors.length > 0) {
                const ed = editors[0];
                const startLine = link.startLine;
                const endLine = link.endLine || startLine;
                ed.revealLineInCenter(startLine);
                ed.setSelection(new window.monaco.Range(
                  startLine, 1, endLine,
                  ed.getModel()?.getLineMaxColumn(endLine) || 1
                ));
                ed.focus();
              }
            }
          }, 350);
        }
      }
    } else if (link.linkType === 'graphNode') {
      // Focus causality graph tab in terminal
      setTerminalActiveTab('graph');
      useEditorStore.setState({ isTerminalOpen: true });
    }
  };

  // Save text changes
  const saveTextChanges = (elementId, value) => {
    const updated = whiteboardElements.map((el) => {
      if (el.id !== elementId) return el;
      return {
        ...el,
        text: value,
        updatedBy: currentUser?.username || 'Collaborator',
        updatedColor: currentUser?.color || '#6366f1'
      };
    });
    const editedEl = updated.find(el => el.id === elementId);
    updateElementsAndSync(updated, 'update', editedEl);
  };

  // ── 10. Eraser handler ──
  const handleEraserClick = (e, elementId) => {
    e.stopPropagation();
    if (activeTool !== 'eraser') return;

    const updated = whiteboardElements.filter((el) => el.id !== elementId);
    updateElementsAndSync(updated, 'delete', null, elementId);
  };

  // ── 11. Right-click context menus ──
  const handleElementContextMenu = (e, elementId) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeTool !== 'select') return;

    const rect = svgRef.current.getBoundingClientRect();
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      elementId: elementId
    });
  };

  const handleOpenLinkModal = () => {
    if (!contextMenu) return;
    setLinkElementId(contextMenu.elementId);
    setLinkModalOpen(true);
    setContextMenu(null);
  };

  const handleSaveLink = (linkData) => {
    const updated = whiteboardElements.map((el) => {
      if (el.id !== linkElementId) return el;
      return {
        ...el,
        codeLink: linkData,
        updatedBy: currentUser?.username || 'Collaborator',
        updatedColor: currentUser?.color || '#6366f1'
      };
    });
    const editedEl = updated.find(el => el.id === linkElementId);
    updateElementsAndSync(updated, 'update', editedEl);
    setLinkModalOpen(false);
    setLinkElementId(null);
  };

  const handleRemoveLink = () => {
    if (!contextMenu) return;
    const elId = contextMenu.elementId;
    const updated = whiteboardElements.map((el) => {
      if (el.id !== elId) return el;
      const copy = {
        ...el,
        updatedBy: currentUser?.username || 'Collaborator',
        updatedColor: currentUser?.color || '#6366f1'
      };
      delete copy.codeLink;
      return copy;
    });
    const editedEl = updated.find(el => el.id === elId);
    updateElementsAndSync(updated, 'update', editedEl);
    setContextMenu(null);
  };

  const handleDeleteElement = () => {
    if (!contextMenu) return;
    const elId = contextMenu.elementId;
    const updated = whiteboardElements.filter((el) => el.id !== elId);
    updateElementsAndSync(updated, 'delete', null, elId);
    setContextMenu(null);
  };

  const clearBoard = () => {
    if (window.confirm('Are you sure you want to clear the entire whiteboard?')) {
      updateElementsAndSync([], 'clear');
    }
  };

  // Render connector line svg path
  const renderArrowPath = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return '';

    // Offset arrowhead slightly
    const arrowSize = 8;
    const ux = dx / len;
    const uy = dy / len;
    const ax = x2 - ux * arrowSize;
    const ay = y2 - uy * arrowSize;

    return `M ${x1} ${y1} L ${ax} ${ay}`;
  };


  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: '#FFFFFF', // Clean white collaborative space
      overflow: 'hidden',
    }}>
      
      {/* ── FLOATING WHITEBOARD TOOLBAR ── */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 12px',
        background: 'rgba(15, 17, 23, 0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        zIndex: 100,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        
        {/* Left: Tools */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {TOOL_LIST.map((tool) => (
            <button
              key={tool.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTool(tool.id);
                setEditingElementId(null);
              }}
              title={tool.label}
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: activeTool === tool.id ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: activeTool === tool.id ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={e => { 
                if (activeTool !== tool.id) {
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                }
              }}
              onMouseLeave={e => { 
                if (activeTool !== tool.id) {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.55)';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={tool.icon} />
              </svg>
            </button>
          ))}
        </div>

        {/* Center: Colors & Settings */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {activeTool === 'sticky' && (
            <>
              <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.08)' }} />
              <div style={{ display: 'flex', gap: '4px', background: 'rgba(255, 255, 255, 0.04)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                {STICKY_COLORS.map(col => (
                  <button
                    key={col.id}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStickyColor(col.id);
                    }}
                    title={col.label}
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '5px',
                      background: col.bg,
                      border: stickyColor === col.id ? '2px solid #FFFFFF' : 'none',
                      cursor: 'pointer',
                      transform: stickyColor === col.id ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 0.15s ease',
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {['pen', 'rect', 'ellipse', 'arrow'].includes(activeTool) && (
            <>
              <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.08)' }} />
              <div style={{ display: 'flex', gap: '4px', background: 'rgba(255, 255, 255, 0.04)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                {['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#1e293b'].map(color => (
                  <button
                    key={color}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveColor(color);
                    }}
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: color,
                      border: activeColor === color ? '2px solid #FFFFFF' : 'none',
                      cursor: 'pointer',
                      transform: activeColor === color ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 0.15s ease',
                    }}
                  />
                ))}
              </div>
            </>
          )}

          <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* Zoom controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: "var(--font-number)", fontSize: '10px', color: 'rgba(255, 255, 255, 0.5)' }}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setZoom(z => Math.max(z - 0.1, 0.15));
              }}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', fontSize: '12px', padding: '0 4px' }}
              onMouseEnter={e => e.currentTarget.style.color = '#FFF'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)'}
            >
              -
            </button>
            <span style={{ minWidth: '36px', textAlign: 'center', fontWeight: 600 }}>{Math.round(zoom * 100)}%</span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setZoom(z => Math.min(z + 0.1, 8));
              }}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', fontSize: '12px', padding: '0 4px' }}
              onMouseEnter={e => e.currentTarget.style.color = '#FFF'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)'}
            >
              +
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPan({ x: 0, y: 0 });
                setZoom(1);
              }}
              title="Reset Zoom/Pan"
              style={{
                marginLeft: '4px',
                padding: '3px 8px',
                borderRadius: '6px',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'rgba(255, 255, 255, 0.8)',
                cursor: 'pointer',
                fontSize: '9px',
                fontFamily: "var(--font-header)",
                fontWeight: 700,
                letterSpacing: '0.04em',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.color = '#FFF'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'; }}
            >
              RESET
            </button>
          </div>
        </div>

        <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.08)' }} />

        {/* Right: Actions */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span 
            title="Auto-sync active"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 8px #10b981',
              animation: 'hud-pulse 2s infinite',
            }}
          />
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              clearBoard();
            }}
            title="Clear entire whiteboard"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.45)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>

      </div>

      {/* ── CANVAS DRAWING AREA ── */}
      <div
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, overflow: 'hidden' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          style={{
            cursor: isPanning ? 'grabbing' : activeTool === 'select' ? 'default' : 'crosshair',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {/* Blueprint grid background */}
          <defs>
            <pattern id="whiteboard-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0, 0, 0, 0.04)" strokeWidth="1"/>
            </pattern>
            {/* Arrow marker definition */}
            <marker id="arrow-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={activeColor} />
            </marker>
          </defs>

          {/* Grid Layer */}
          <rect
            x="-10000"
            y="-10000"
            width="20000"
            height="20000"
            fill="url(#whiteboard-grid)"
            transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
          />

          {/* Elements Group */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {whiteboardElements.map((el) => {
              const hasLink = !!el.codeLink;
              const isHovered = hoveredElementId === el.id;

              return (
                <g
                  key={el.id}
                  onClick={(e) => handleEraserClick(e, el.id)}
                  onPointerDown={(e) => startDragElement(e, el.id)}
                  onDoubleClick={(e) => handleElementDoubleClick(e, el)}
                  onContextMenu={(e) => handleElementContextMenu(e, el.id)}
                  onMouseEnter={() => setHoveredElementId(el.id)}
                  onMouseLeave={() => setHoveredElementId(null)}
                  style={{ cursor: activeTool === 'select' ? 'move' : 'inherit' }}
                >
                  
                  {/* --- PEN/FREEHAND STROKE --- */}
                  {el.type === 'pen' && el.points && el.points.length > 0 && (
                    <polyline
                      fill="none"
                      stroke={el.color && el.color.toLowerCase() !== '#ffffff' ? el.color : '#1e293b'}
                      strokeWidth={el.thickness || 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={el.points.map(p => `${p.x},${p.y}`).join(' ')}
                    />
                  )}

                  {/* --- RECTANGLE --- */}
                  {el.type === 'rect' && (
                    <g>
                      <rect
                        x={el.width < 0 ? el.x + el.width : el.x}
                        y={el.height < 0 ? el.y + el.height : el.y}
                        width={Math.abs(el.width)}
                        height={Math.abs(el.height)}
                        fill={el.fill ? 'rgba(99, 102, 241, 0.12)' : 'none'}
                        stroke={el.color && el.color.toLowerCase() !== '#ffffff' ? el.color : '#1e293b'}
                        strokeWidth="2.5"
                        rx="4"
                      />
                      {/* Code link badge overlay */}
                      {hasLink && (
                        <circle
                          cx={(el.width < 0 ? el.x + el.width : el.x) + Math.abs(el.width) - 10}
                          cy={(el.height < 0 ? el.y + el.height : el.y) + 10}
                          r="8"
                          fill="var(--lime)"
                          title={`Linked to: ${el.codeLink.filePath || el.codeLink.graphNodeId}`}
                          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}
                        />
                      )}
                    </g>
                  )}

                  {/* --- ELLIPSE --- */}
                  {el.type === 'ellipse' && (
                    <g>
                      <ellipse
                        cx={el.cx}
                        cy={el.cy}
                        rx={el.rx}
                        ry={el.ry}
                        fill={el.fill ? 'rgba(99, 102, 241, 0.12)' : 'none'}
                        stroke={el.color && el.color.toLowerCase() !== '#ffffff' ? el.color : '#1e293b'}
                        strokeWidth="2.5"
                      />
                      {/* Code link badge */}
                      {hasLink && (
                        <circle
                          cx={el.cx + el.rx - 8}
                          cy={el.cy - el.ry + 8}
                          r="8"
                          fill="var(--lime)"
                          title={`Linked to: ${el.codeLink.filePath || el.codeLink.graphNodeId}`}
                          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}
                        />
                      )}
                    </g>
                  )}

                  {/* --- ARROW / CONNECTOR LINE --- */}
                  {el.type === 'arrow' && (
                    <path
                      d={renderArrowPath(el.x1, el.y1, el.x2, el.y2)}
                      stroke={el.color && el.color.toLowerCase() !== '#ffffff' ? el.color : '#1e293b'}
                      strokeWidth="2.5"
                      markerEnd="url(#arrow-head)"
                    />
                  )}

                  {/* --- TEXT BOX --- */}
                  {el.type === 'text' && (
                    <foreignObject
                      x={el.x}
                      y={el.y - 15}
                      width="250"
                      height="80"
                    >
                      {editingElementId === el.id ? (
                        <textarea
                          defaultValue={el.text}
                          placeholder="Double click to edit"
                          autoFocus
                          onBlur={(e) => saveTextChanges(el.id, e.target.value)}
                          style={{
                            width: '100%',
                            height: '100%',
                            background: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            color: '#1e293b',
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '13px',
                            padding: '4px',
                            outline: 'none',
                            resize: 'none',
                          }}
                        />
                      ) : (
                        <div style={{
                          color: el.text ? (el.color && el.color.toLowerCase() !== '#ffffff' ? el.color : '#1e293b') : 'rgba(30, 41, 59, 0.4)',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '13px',
                          fontWeight: el.text ? 500 : 400,
                          fontStyle: el.text ? 'normal' : 'italic',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}>
                          <span>{el.text || 'Double click to edit'}</span>
                          {hasLink && (
                            <span
                              title={`Linked to: ${el.codeLink.filePath || el.codeLink.graphNodeId}`}
                              style={{
                                display: 'inline-flex',
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: 'var(--lime)',
                                boxShadow: '0 0 6px var(--lime)',
                              }}
                            />
                          )}
                        </div>
                      )}
                    </foreignObject>
                  )}

                  {/* --- STICKY NOTE --- */}
                  {el.type === 'sticky' && (
                    <foreignObject
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          background: el.bgColor || '#fef08a',
                          boxShadow: '0 6px 16px rgba(0, 0, 0, 0.4)',
                          borderRadius: '8px',
                          padding: '12px',
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        {/* Linked status header banner */}
                        {hasLink && (
                          <div style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: 'rgba(18, 18, 18, 0.85)',
                            color: 'var(--lime)',
                            fontSize: '8px',
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                            borderRadius: '4px',
                            padding: '2px 6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            border: '1px solid rgba(199,255,94,0.3)',
                          }}>
                            LINKED
                          </div>
                        )}

                        {editingElementId === el.id ? (
                          <textarea
                            defaultValue={el.text}
                            placeholder="Double click to edit"
                            autoFocus
                            onBlur={(e) => saveTextChanges(el.id, e.target.value)}
                            style={{
                              width: '100%',
                              height: '100%',
                              background: 'transparent',
                              border: 'none',
                              color: el.textColor || '#1e293b',
                              fontFamily: "'Space Grotesk', sans-serif",
                              fontSize: '12px',
                              fontWeight: 500,
                              outline: 'none',
                              resize: 'none',
                            }}
                          />
                        ) : (
                          <div style={{
                            color: el.text ? (el.textColor || '#1e293b') : 'rgba(30, 41, 59, 0.4)',
                            fontFamily: "'Space Grotesk', sans-serif",
                            fontSize: '12px',
                            fontWeight: el.text ? 600 : 400,
                            fontStyle: el.text ? 'normal' : 'italic',
                            whiteSpace: 'pre-wrap',
                            flex: 1,
                            overflow: 'auto',
                          }}>
                            {el.text || 'Double click to edit'}
                          </div>
                        )}
                      </div>
                    </foreignObject>
                  )}

                  {/* Collaborator indicator badge */}
                  {isHovered && (el.createdBy || el.updatedBy) && (() => {
                    const coords = getIndicatorCoords(el);
                    const name = el.updatedBy || el.createdBy;
                    const color = el.updatedColor || el.createdColor || '#6366f1';
                    const actionText = el.updatedBy ? 'edited' : 'drawn';
                    
                    return (
                      <foreignObject
                        x={coords.x}
                        y={coords.y}
                        width="180"
                        height="26"
                        style={{ pointerEvents: 'none' }}
                      >
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '3px 8px',
                          background: 'rgba(15, 17, 23, 0.82)',
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                          border: `1px solid ${color}`,
                          borderRadius: '6px',
                          color: '#FFFFFF',
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontSize: '9px',
                          fontWeight: 700,
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                          animation: 'fadeIn 0.15s ease-out',
                        }}>
                          <span style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background: color,
                            boxShadow: `0 0 6px ${color}`,
                          }} />
                          <span>{name}</span>
                          <span style={{ color: 'rgba(255, 255, 255, 0.45)', fontWeight: 500, fontSize: '8px' }}>
                            ({actionText})
                          </span>
                        </div>
                      </foreignObject>
                    );
                  })()}

                </g>
              );
            })}

            {/* Render drawing active element preview */}
            {isDrawing && currentElement && (
              <g style={{ opacity: 0.75 }}>
                {currentElement.type === 'pen' && currentElement.points && currentElement.points.length > 0 && (
                  <polyline
                    fill="none"
                    stroke={currentElement.color && currentElement.color !== '#ffffff' ? currentElement.color : '#1e293b'}
                    strokeWidth="3"
                    points={currentElement.points.map(p => `${p.x},${p.y}`).join(' ')}
                  />
                )}
                {currentElement.type === 'rect' && (
                  <rect
                    x={currentElement.width < 0 ? currentElement.x + currentElement.width : currentElement.x}
                    y={currentElement.height < 0 ? currentElement.y + currentElement.height : currentElement.y}
                    width={Math.abs(currentElement.width)}
                    height={Math.abs(currentElement.height)}
                    fill="none"
                    stroke={currentElement.color && currentElement.color !== '#ffffff' ? currentElement.color : '#1e293b'}
                    strokeWidth="2.5"
                  />
                )}
                {currentElement.type === 'ellipse' && (
                  <ellipse
                    cx={currentElement.cx}
                    cy={currentElement.cy}
                    rx={currentElement.rx}
                    ry={currentElement.ry}
                    fill="none"
                    stroke={currentElement.color && currentElement.color !== '#ffffff' ? currentElement.color : '#1e293b'}
                    strokeWidth="2.5"
                  />
                )}
                {currentElement.type === 'arrow' && (
                  <path
                    d={renderArrowPath(currentElement.x1, currentElement.y1, currentElement.x2, currentElement.y2)}
                    stroke={currentElement.color && currentElement.color !== '#ffffff' ? currentElement.color : '#1e293b'}
                    strokeWidth="2.5"
                    markerEnd="url(#arrow-head)"
                  />
                )}
              </g>
            )}

            {/* ── PRESENCE CURSORS LAYER ── */}
            {Object.values(whiteboardCursors).map((cur) => {
              // Ignore old cursor values
              if (Date.now() - cur.timestamp > 10000) return null;

              return (
                <g key={cur.userId} transform={`translate(${cur.x}, ${cur.y})`}>
                  {/* Cursor Mouse Arrow Icon */}
                  <path
                    d="M0 0 L12 4 L7 6 L5 11 Z"
                    fill={cur.color || '#6366f1'}
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />
                  {/* Name tag */}
                  <g transform="translate(14, 10)">
                    <rect
                      x="0"
                      y="0"
                      width={cur.username.length * 7 + 12}
                      height="18"
                      fill="rgba(15, 17, 23, 0.9)"
                      stroke={cur.color || '#6366f1'}
                      strokeWidth="1"
                      rx="4"
                    />
                    <text
                      x="6"
                      y="12"
                      fill="#FFFFFF"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize="9px"
                      fontWeight="bold"
                    >
                      {cur.username}
                    </text>
                  </g>
                </g>
              );
            })}

          </g>
        </svg>

        {/* ── CUSTOM RIGHT-CLICK CONTEXT MENU ── */}
        {contextMenu && (
          <div
            style={{
              position: 'absolute',
              top: `${contextMenu.y}px`,
              left: `${contextMenu.x}px`,
              background: '#16171B',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '6px 0',
              zIndex: 100,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              minWidth: '150px',
            }}
          >
            <button
              onClick={handleOpenLinkModal}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'var(--t1)',
                padding: '8px 16px',
                textAlign: 'left',
                fontSize: '11px',
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {whiteboardElements.find(el => el.id === contextMenu.elementId)?.codeLink ? 'Edit Link...' : 'Link to Code...'}
            </button>
            {whiteboardElements.find(el => el.id === contextMenu.elementId)?.codeLink && (
              <button
                onClick={handleRemoveLink}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--crimson)',
                  padding: '8px 16px',
                  textAlign: 'left',
                  fontSize: '11px',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Remove Code Link
              </button>
            )}
            <div style={{ height: '1px', background: 'var(--line)', margin: '4px 0' }} />
            <button
              onClick={handleDeleteElement}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#EF4444',
                padding: '8px 16px',
                textAlign: 'left',
                fontSize: '11px',
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              Delete Element
            </button>
          </div>
        )}

      </div>

      {/* ── CODE LINK MODAL ── */}
      <LinkToCodeModal
        isOpen={linkModalOpen}
        onClose={() => { setLinkModalOpen(false); setLinkElementId(null); }}
        onSave={handleSaveLink}
        initialData={whiteboardElements.find(el => el.id === linkElementId)?.codeLink}
      />

    </div>
  );
};

export default Whiteboard;
