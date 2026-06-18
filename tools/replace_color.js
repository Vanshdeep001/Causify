const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'frontend', 'src');

const colorMap = [
  { from: /#C7FF5E/g, to: '#8B5CF6' },
  { from: /#c7ff5e/g, to: '#8b5cf6' },
  { from: /199,\s*255,\s*94/g, to: '139, 92, 246' },
  // Let's also handle green-looking status colors if any, but the user explicitly pointed out the green color
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
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated color in: ${fullPath}`);
      }
    }
  }
}

console.log(`Starting color replacement in: ${srcDir}`);
processDir(srcDir);
console.log('Color replacement completed!');
