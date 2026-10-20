/**
 * Cursor Batch 1 helpers: DialogFooter stack + strip console.log (keep console.error).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const FOOTER_CLASS = 'flex-col gap-2 sm:flex-row';
const BTN_WIDTH = 'w-full sm:w-auto';

function stackDialogFooters(src) {
  let s = src;
  s = s.replace(/<DialogFooter>/g, `<DialogFooter className="${FOOTER_CLASS}">`);
  s = s.replace(/<DialogFooter className="([^"]*)">/g, (m, cls) => {
    if (cls.includes('flex-col')) return m;
    return `<DialogFooter className="${FOOTER_CLASS} ${cls.trim()}">`;
  });
  // Full-width buttons directly under DialogFooter (simple pattern)
  s = s.replace(
    /(<DialogFooter className="[^"]*">\s*)((?:(?:\{[^}]*\}|<Button[\s\S]*?<\/Button>|\s)*))/g,
    (m, open, body) => {
      const next = body.replace(/<Button(\s[^>]*?)>/g, (bm, attrs) => {
        if (/className=/.test(attrs)) {
          if (attrs.includes(BTN_WIDTH) || attrs.includes('w-full')) return bm;
          return `<Button${attrs.replace(/className="([^"]*)"/, `className="$1 ${BTN_WIDTH}"`)}>`;
        }
        return `<Button className="${BTN_WIDTH}"${attrs}>`;
      });
      return open + next;
    }
  );
  return s;
}

function stripConsoleLog(src) {
  // Remove whole-line console.log(...); including multi-line args ending with );
  // Keep console.error / console.warn
  let s = src;
  // Single-line
  s = s.replace(/^[ \t]*console\.log\([^;]*\);\s*\r?\n/gm, '');
  // Multi-line console.log( ... );
  s = s.replace(/^[ \t]*console\.log\([\s\S]*?\);\s*\r?\n/gm, '');
  return s;
}

const timesheetPages = [
  'WorkerPortal.jsx',
  'ManagerDashboard.jsx',
  'SupervisorDashboard.jsx',
  'AdminDashboard.jsx',
];

for (const f of timesheetPages) {
  const p = path.join(root, 'src/modules/timesheet/pages', f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = stackDialogFooters(s);
  if (s !== before) {
    fs.writeFileSync(p, s);
    console.log('DialogFooter:', f);
  } else {
    console.log('DialogFooter unchanged:', f);
  }
}

const logFiles = [
  'ManagerDashboard.jsx',
  'AdminDashboard.jsx',
  'WorkerPortal.jsx',
  'History.jsx',
  'SupervisorDashboard.jsx',
];

for (const f of logFiles) {
  const p = path.join(root, 'src/modules/timesheet/pages', f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  const count = (s.match(/console\.log\(/g) || []).length;
  s = stripConsoleLog(s);
  const after = (s.match(/console\.log\(/g) || []).length;
  if (s !== before) {
    fs.writeFileSync(p, s);
    console.log(`console.log ${f}: ${count} -> ${after}`);
  } else {
    console.log(`console.log unchanged ${f} (${count})`);
  }
}
