import React from 'react';

const EmptyEditorState = () => {
  return (
    <div className="empty-editor-state">
      <div className="empty-editor-illustration">📂</div>
      <h3 className="empty-editor-text">NO FILE SELECTED</h3>
      <p className="empty-editor-subtext">
        Select a file from the explorer or upload a new project to start debugging.
      </p>
    </div>
  );
};

export default EmptyEditorState;
