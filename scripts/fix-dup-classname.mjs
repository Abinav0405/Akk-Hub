import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'WorkerPortal.jsx',
  'ManagerDashboard.jsx',
  'SupervisorDashboard.jsx',
  'AdminDashboard.jsx',
].map((f) => path.join(root, 'src/modules/timesheet/pages', f));

/** Find end index of a JSX opening tag starting at `<Button`, respecting braces/quotes. */
function findOpenTagEnd(s, start) {
  let i = start + '<Button'.length;
  let brace = 0;
  let quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote !== '`') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === '{') {
      brace++;
      i++;
      continue;
    }
    if (c === '}') {
      brace--;
      i++;
      continue;
    }
    if (c === '>' && brace === 0) return i;
    if (c === '/' && s[i + 1] === '>' && brace === 0) return i + 1;
    i++;
  }
  return -1;
}

function mergeDupClassNames(attrs) {
  const matches = [...attrs.matchAll(/className="([^"]*)"/g)];
  if (matches.length < 2) return null;
  const merged = matches.map((m) => m[1]).join(' ').replace(/\s+/g, ' ').trim();
  let next = attrs;
  for (const m of matches) next = next.replace(m[0], '');
  next = `${next.trimEnd()} className="${merged}"`;
  return next;
}

for (const p of files) {
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  let out = '';
  let i = 0;
  let fixed = 0;
  while (i < s.length) {
    const idx = s.indexOf('<Button', i);
    if (idx === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, idx);
    const end = findOpenTagEnd(s, idx);
    if (end === -1) {
      out += s.slice(idx);
      break;
    }
    const full = s.slice(idx, end + 1);
    const attrs = full.slice('<Button'.length, -1);
    const merged = mergeDupClassNames(attrs);
    if (merged != null) {
      out += `<Button${merged}>`;
      fixed++;
    } else {
      out += full;
    }
    i = end + 1;
  }
  if (out !== before) {
    fs.writeFileSync(p, out);
    console.log('fixed', path.basename(p), fixed);
  } else {
    console.log('ok', path.basename(p));
  }
}
