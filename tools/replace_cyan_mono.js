const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'frontend', 'src');

const colorMap = [
  { from: /#4DD6FF/g, to: '#B3B3B3' },
  { from: /#4dd6ff/g, to: '#b3b3b3' },
  { from: /'4DD6FF'/g, to: "'B3B3B3'" },
  { from: /"4DD6FF"/g, to: '"B3B3B3"' },
  { from: /77,\s*214,\s*255/g, to: '179, 179, 179' },
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
      // If we are editing index.css, let's adjust the opacity of cyan-dim and cyan-line to make it look even more premium
      if (file === 'index.css') {
        content = content.replace(/rgba\(179,\s*179,\s*179,\s*0\.10\)/g, 'rgba(179, 179, 179, 0.05)');
        content = content.replace(/rgba\(179,\s*179,\s*179,\s*0\.32\)/g, 'rgba(179, 179, 179, 0.15)');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated cyan to monochrome in: ${fullPath}`);
      }
    }
  }
}

console.log(`Starting cyan replacement in: ${srcDir}`);
processDir(srcDir);
console.log('Cyan replacement completed!');
