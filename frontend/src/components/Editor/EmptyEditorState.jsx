import React from 'react';

const EmptyEditorState = () => {
  return (
    <div className="empty-editor-state">
      <h2 className="empty-editor-brand">Welcome to Causify</h2>
      <p className="empty-editor-subtext">
        Select a file from the explorer or upload a project to start
        analyzing how your software behaves.
      </p>
    </div>
  );
};

export default EmptyEditorState;
