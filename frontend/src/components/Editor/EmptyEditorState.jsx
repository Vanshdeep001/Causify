import React from 'react';

const EmptyEditorState = ({ sidebarCollapsed = false }) => {
  return (
    <div className={`empty-editor-state${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <div className="ees-header">
        <h2 className="empty-editor-brand">Welcome to Causify</h2>
      </div>

      <div className="ees-index">
        <ul className="ees-list">
          <li className="ees-entry" style={{ '--i': 0 }}>
            <span className="ees-entry-num" aria-hidden="true">01</span>

            <span className="ees-entry-main">
              <span className="ees-entry-title">
                Open a <em>File</em>
              </span>
              <span className="ees-entry-desc">
                Pick a source file from the explorer
              </span>
            </span>

            <span className="ees-entry-ico" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
            <span className="ees-entry-go" aria-hidden="true">&rarr;</span>
          </li>

          <li className="ees-entry" style={{ '--i': 1 }}>
            <span className="ees-entry-num" aria-hidden="true">02</span>

            <span className="ees-entry-main">
              <span className="ees-entry-title">
                Import a <em>Project</em>
              </span>
              <span className="ees-entry-desc">
                Clone or load an entire repository
              </span>
            </span>

            <span className="ees-entry-ico" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="ees-entry-go" aria-hidden="true">&rarr;</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default EmptyEditorState;
