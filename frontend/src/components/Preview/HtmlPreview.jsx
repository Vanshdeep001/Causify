/* -------------------------------------------------------
 * HtmlPreview.jsx — Live HTML/CSS/JS Preview Panel
 * Renders the user's project files in a sandboxed iframe.
 * Combines HTML with project CSS and JS files.
 * ------------------------------------------------------- */

import React, { useMemo } from 'react';
import useEditorStore from '../../store/useEditorStore';

const HtmlPreview = () => {
  const files = useEditorStore((s) => s.files);
  const activePath = useEditorStore((s) => s.activePath);

  const previewSrc = useMemo(() => {
    if (!files || Object.keys(files).length === 0) return null;

    // Find the HTML file — prefer the active one, otherwise find index.html or any .html
    let htmlContent = null;
    let htmlPath = null;

    if (activePath && activePath.endsWith('.html') && files[activePath]) {
      htmlContent = files[activePath];
      htmlPath = activePath;
    } else {
      // Search for index.html first, then any .html file
      const paths = Object.keys(files);
      const indexHtml = paths.find(p => p.toLowerCase().endsWith('index.html'));
      const anyHtml = paths.find(p => p.toLowerCase().endsWith('.html'));
      htmlPath = indexHtml || anyHtml;
      htmlContent = htmlPath ? files[htmlPath] : null;
    }

    if (!htmlContent) {
      return null;
    }

    // Gather all CSS files
    const cssFiles = Object.entries(files)
      .filter(([path]) => path.endsWith('.css'))
      .map(([, content]) => content);

    // Gather all JS files (exclude .html and .css)
    const jsFiles = Object.entries(files)
      .filter(([path]) => path.endsWith('.js'))
      .map(([, content]) => content);

    // Inject CSS and JS into the HTML
    let combined = htmlContent;

    // Inject CSS before </head> or at top
    if (cssFiles.length > 0) {
      const cssBlock = cssFiles.map(css => `<style>\n${css}\n</style>`).join('\n');
      if (combined.includes('</head>')) {
        combined = combined.replace('</head>', `${cssBlock}\n</head>`);
      } else if (combined.includes('<head>')) {
        combined = combined.replace('<head>', `<head>\n${cssBlock}`);
      } else {
        combined = cssBlock + '\n' + combined;
      }
    }

    // Inject JS before </body> or at end
    if (jsFiles.length > 0) {
      const jsBlock = jsFiles.map(js => `<script>\n${js}\n</script>`).join('\n');
      if (combined.includes('</body>')) {
        combined = combined.replace('</body>', `${jsBlock}\n</body>`);
      } else {
        combined += '\n' + jsBlock;
      }
    }

    return combined;
  }, [files, activePath]);

  if (!previewSrc) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: '10px', opacity: 0.5,
      }}>
        <span style={{ fontSize: '2rem' }}>🌐</span>
        <span style={{
          fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.7rem',
          color: '#888', letterSpacing: '0.05em',
        }}>
          NO HTML FILE FOUND
        </span>
        <span style={{ fontSize: '0.6rem', color: '#555', maxWidth: '280px', textAlign: 'center', lineHeight: 1.6 }}>
          Upload a project with an .html file to see the live preview here.
        </span>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Preview header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 0', marginBottom: '8px',
        borderBottom: '1px solid #333',
      }}>
        <span style={{ fontSize: '0.8rem' }}>🌐</span>
        <span style={{
          fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.6rem',
          color: '#c1ff72', letterSpacing: '0.05em',
        }}>
          LIVE PREVIEW
        </span>
        <span style={{ fontSize: '0.55rem', color: '#555' }}>
          — {Object.keys(files).filter(p => p.endsWith('.html')).length} HTML, {Object.keys(files).filter(p => p.endsWith('.css')).length} CSS, {Object.keys(files).filter(p => p.endsWith('.js')).length} JS
        </span>
      </div>

      {/* Iframe */}
      <div style={{
        flex: 1, borderRadius: '4px', overflow: 'hidden',
        border: '1px solid #333', background: '#fff',
      }}>
        <iframe
          srcDoc={previewSrc}
          title="HTML Preview"
          sandbox="allow-scripts"
          style={{
            width: '100%', height: '100%', border: 'none',
            background: '#fff',
          }}
        />
      </div>
    </div>
  );
};

export default HtmlPreview;
