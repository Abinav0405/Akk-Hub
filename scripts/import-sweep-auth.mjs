/**
 * Import sweep (Claude NEEDS order #2): tidy auth import paths inside modules only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const files = walk(root);
const log = [];

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;
  const rel = path.relative(root, file).split(path.sep).join('/');
  const isProgress = rel.startsWith('progress/');
  const isMaterials = rel.startsWith('materials/');
  const isTimesheet = rel.startsWith('timesheet/');

  if (isMaterials) {
    src = src.replace(/from\s+['"]@\/core\/auth['"]/g, "from '@/core/auth/materialsSession'");
  }
  if (isProgress) {
    src = src.replace(/from\s+['"]@\/core\/authSession['"]/g, "from '@/core/auth/progress/workerSession'");
    src = src.replace(/from\s+['"]@\/core\/auth\/timesheetSession['"]/g, "from '@/core/auth/progress/workerSession'");
    src = src.replace(/from\s+['"]@\/core\/managerSession['"]/g, "from '@/core/auth/progress/managerSession'");
    src = src.replace(/from\s+['"]@\/core\/exporterSession['"]/g, "from '@/core/auth/progress/exporterSession'");
    src = src.replace(/from\s+['"]@\/core\/adminSession['"]/g, "from '@/core/auth/progress/adminSession'");
    src = src.replace(/from\s+['"]@\/core\/portalAuth['"]/g, "from '@/core/auth/progress/portalAuth'");
  }
  if (isTimesheet) {
    src = src.replace(/from\s+['"]@\/core\/authSession['"]/g, "from '@/core/auth/timesheetSession'");
  }

  if (src !== orig) {
    fs.writeFileSync(file, src);
    log.push(rel);
  }
}

console.log(`Updated ${log.length} files`);
console.log(log.join('\n'));
