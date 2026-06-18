const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'frontend', 'src');

const colorMap = [
  { from: /#8B5CF6/g, to: '#FFFFFF' },
  { from: /#8b5cf6/g, to: '#ffffff' },
  { from: /139,\s*92,\s*246/g, to: '255, 255, 255' },
];

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDir(fullPath);
    } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.css') || file.endsWith('.html'))) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;
      for (const map of colorMap) {
        if (map.from.test(content)) {
          content = content.replace(map.from, map.to);
          changed = true;
        }
      }
      // If we are editing index.css, let's adjust the opacity of lime-dim and lime-line to make it look even more premium
      if (file === 'index.css') {
        content = content.replace(/rgba\(255,\s*255,\s*255,\s*0\.12\)/g, 'rgba(255, 255, 255, 0.06)');
        content = content.replace(/rgba\(255,\s*255,\s*255,\s*0\.35\)/g, 'rgba(255, 255, 255, 0.15)');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated color to monochrome in: ${fullPath}`);
      }
    }
  }
}

console.log(`Starting monochrome color replacement in: ${srcDir}`);
processDir(srcDir);
console.log('Monochrome color replacement completed!');
