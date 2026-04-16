const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const root = path.join(__dirname, '..');
copyDir(path.join(root, 'src', 'public'), path.join(root, 'dist', 'public'));
copyDir(path.join(root, 'src', 'admin'),  path.join(root, 'dist', 'admin'));
console.log('Static files copied to dist/');
