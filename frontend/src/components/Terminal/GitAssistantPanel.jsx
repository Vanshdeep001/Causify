import React, { useState, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { executeGitCommit } from '../../services/api';

const GitAssistantPanel = () => {
  const suggestion = useEditorStore(s => s.commitSuggestion);
  const setCommitSuggestion = useEditorStore(s => s.setCommitSuggestion);
  const terminalLayoutMode = useEditorStore(s => s.terminalLayoutMode);
  
  const [message, setMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  useEffect(() => {
    if (suggestion && suggestion.message) {
      setMessage(suggestion.message);
      setCommitResult(null); 
    }
  }, [suggestion]);

  if (!suggestion) {
    return (
      <div style={{ 
        height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '20px', color: '#444', fontFamily: 'var(--font-number)', fontSize: '0.7rem', 
        letterSpacing: '0.2em', textTransform: 'uppercase'
      }}>
        <div style={{ width: '40px', height: '1px', background: '#333', marginBottom: '20px' }} />
        <span>Waiting for Intelligence Input</span>
        <div style={{ width: '40px', height: '1px', background: '#333', marginTop: '20px' }} />
      </div>
    );
  }

  const getBadgeColors = (type) => {
    switch(type) {
      case 'fix': return { bg: 'rgba(255, 62, 62, 0.05)', fg: '#ff3e3e', icon: '🐞', label: 'BUG_FIX' };
      case 'feat': return { bg: 'rgba(193, 255, 114, 0.05)', fg: '#c1ff72', icon: '✨', label: 'FEATURE' };
      case 'style': return { bg: 'rgba(129, 140, 248, 0.05)', fg: '#818cf8', icon: '🎨', label: 'UI_STYLE' };
      case 'refactor': return { bg: 'rgba(251, 191, 36, 0.05)', fg: '#fbbf24', icon: '🔧', label: 'REFACTOR' };
      default: return { bg: 'rgba(255,255,255,0.05)', fg: '#fff', icon: '📝', label: 'SYSTEM' };
    }
  };

  const colors = getBadgeColors(suggestion.type);

  const handleCommit = async () => {
    if (!message.trim()) return;
    setIsCommitting(true);
    try {
      const res = await executeGitCommit({ message, files: suggestion.modifiedFiles || [] });
      setCommitResult({ success: true, text: res.message || 'Committed' });
      setTimeout(() => setCommitSuggestion(null), 3000);
    } catch (err) {
      setCommitResult({ success: false, text: err.response?.data?.message || err.message });
    } finally {
      setIsCommitting(false);
    }
  };

  if (commitResult && commitResult.success) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
        <div style={{ textAlign: 'center', animation: 'scale-in 0.3s ease' }}>
          <div style={{ fontFamily: 'var(--font-number)', color: '#c1ff72', fontSize: '1.5rem', fontWeight: 900 }}>EXECUTION_COMPLETE</div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#666', fontSize: '0.8rem', marginTop: '5px' }}>{commitResult.text}</div>
        </div>
      </div>
    );
  }

  const isSplit = terminalLayoutMode === 'split';

  // --- Styled Components ---
  const HudLabel = ({ children }) => (
    <div style={{ 
      fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#666', 
      letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px',
      fontWeight: 900 
    }}>
      {children.replace(/_/g, ' ')}
    </div>
  );

  const PowerLine = () => (
    <div style={{ width: '1px', background: 'linear-gradient(to bottom, transparent, #222, #222, transparent)', margin: '0 40px' }} />
  );

  return (
    <div style={{ 
      height: '100%', display: 'flex', flexDirection: isSplit ? 'column' : 'row',
      padding: '15px 0', position: 'relative', overflow: 'hidden'
    }}>
      
      {/* 1. STATUS ZONE */}
      <div style={{ flex: isSplit ? '0 0 auto' : '0 0 280px', display: 'flex', flexDirection: 'column', padding: '10px' }}>
        <HudLabel>Intelligence Classification</HudLabel>
        
        <div style={{ position: 'relative', padding: '20px', border: `2.5px solid ${colors.fg}`, background: `${colors.bg}` }}>
          {/* Decorative Corner Brackets */}
          <div style={{ position: 'absolute', top: '-1px', left: '-1px', width: '12px', height: '12px', borderTop: `4px solid ${colors.fg}`, borderLeft: `4px solid ${colors.fg}` }} />
          <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '12px', height: '12px', borderBottom: `4px solid ${colors.fg}`, borderRight: `4px solid ${colors.fg}` }} />
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
             <span style={{ fontSize: '1.8rem' }}>{colors.icon}</span>
             <div style={{ fontFamily: 'var(--font-header)', fontSize: '1.5rem', fontWeight: 900, color: colors.fg, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
               {colors.label}
             </div>
          </div>
        </div>

        <div style={{ marginTop: '30px' }}>
          <HudLabel>Confidence Matrix</HudLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ 
                width: suggestion.confidence === 'HIGH' ? '90%' : suggestion.confidence === 'MEDIUM' ? '60%' : '30%', 
                height: '100%', background: colors.fg, boxShadow: `0 0 15px ${colors.fg}`
              }} />
            </div>
            <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.75rem', color: colors.fg, fontWeight: 900 }}>{suggestion.confidence}</span>
          </div>
        </div>
      </div>

      {!isSplit && <PowerLine />}

      {/* 2. ACTION ZONE */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: '#0a0a0a', padding: '25px', border: '1.5px solid #1a1a1a', flex: 1, position: 'relative' }}>
          <HudLabel>Commit Terminal Buffer</HudLabel>
          
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', color: '#c1ff72', fontFamily: 'var(--font-number)', fontSize: '1.1rem', fontWeight: 700 }}>
            <span style={{ marginTop: '4px', opacity: 0.8, color: '#fff' }}>▶</span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
               <div style={{ opacity: 0.3, fontSize: '0.8rem' }}>git commit -m "</div>
               <textarea
                 value={message}
                 onChange={(e) => setMessage(e.target.value)}
                 spellCheck={false}
                 style={{
                   background: 'transparent', border: 'none', outline: 'none',
                   color: '#fff', fontSize: '1.25rem', fontFamily: 'var(--font-header)', 
                   fontWeight: 700, width: '100%', height: '110px', resize: 'none', margin: '8px 0',
                   lineHeight: 1.2, paddingLeft: '20px', borderLeft: '3px solid #222'
                 }}
               />
               <div style={{ opacity: 0.3, fontSize: '0.8rem' }}>"</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
          <button 
            onClick={() => setCommitSuggestion(null)}
            style={{ 
              background: 'transparent', border: 'None', color: '#555', 
              padding: '10px 20px', cursor: 'pointer', fontFamily: 'var(--font-number)', 
              fontSize: '0.75rem', fontWeight: 900, letterSpacing: '0.1em'
            }}
          >
            DISCARD
          </button>
          <button 
            onClick={handleCommit}
            disabled={isCommitting || !message.trim()}
            style={{ 
              background: '#c1ff72', color: '#000', border: 'none', 
              padding: '12px 40px', cursor: 'pointer', fontFamily: 'var(--font-number)', 
              fontSize: '0.85rem', fontWeight: 900,
              boxShadow: '0 0 30px rgba(193, 255, 114, 0.15)',
              opacity: isCommitting ? 0.6 : 1,
              transition: 'transform 0.1s ease',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.96)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {isCommitting ? 'EXECUTING...' : 'CONFIRM COMMIT'}
          </button>
        </div>
      </div>

      {!isSplit && <PowerLine />}

      {/* 3. STAGING ZONE */}
      <div style={{ flex: isSplit ? '0 0 auto' : '0 0 240px', display: 'flex', flexDirection: 'column' }}>
        <HudLabel>Staged Blueprint</HudLabel>
        
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {suggestion.modifiedFiles?.map((file) => (
            <div key={file} style={{ 
              display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 0',
              borderBottom: '1px solid #111'
            }}>
              <div style={{ width: '8px', height: '8px', background: '#c1ff72', borderRadius: '1px', transform: 'rotate(45deg)' }} />
              <span style={{ color: '#fff', fontSize: '1rem', fontFamily: 'var(--font-header)', fontWeight: 700 }}>
                {file}
              </span>
            </div>
          ))}
          
          {suggestion.affectedFiles?.length > 0 && (
            <div style={{ marginTop: '30px' }}>
              <HudLabel>Impact Predictions</HudLabel>
              {suggestion.affectedFiles.map(file => (
                <div key={file} style={{ 
                  color: '#ff3e3e', fontSize: '0.85rem', padding: '6px 0', 
                  fontFamily: 'var(--font-header)', fontWeight: 700 
                }}>
                   {'>'} {file}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      <style>{`
        @keyframes scale-in {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default GitAssistantPanel;
