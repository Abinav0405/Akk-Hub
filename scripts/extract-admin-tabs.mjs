/**
 * One-shot helper: analyze / extract Timesheet AdminDashboard tab panels
 * into lazy-loaded modules backed by AdminDashContext.
 *
 * Usage:
 *   node scripts/extract-admin-tabs.mjs analyze
 *   node scripts/extract-admin-tabs.mjs extract
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import parser from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'src/modules/timesheet/pages/AdminDashboard.jsx');
const OUT_DIR = path.join(ROOT, 'src/modules/timesheet/components/admin/tabs');

const TABS = [
  { id: 'time-tracker', name: 'TimeTrackerTab', start: 8541, end: 8989 },
  { id: 'leaves', name: 'LeavesTab', start: 8994, end: 9343 },
  { id: 'payslip-report', name: 'PayslipReportTab', start: 9348, end: 9604 },
  { id: 'timesheet-report', name: 'TimesheetReportTab', start: 9609, end: 9818 },
  { id: 'worker-info', name: 'WorkerInfoTab', start: 9968, end: 10325 },
  { id: 'sites', name: 'SitesTab', start: 10329, end: 10445 },
];

const builtins = new Set([
  'React', 'Fragment', 'Suspense', 'lazy', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
  'console', 'window', 'document', 'navigator', 'JSON', 'Math', 'Date', 'Array', 'Object', 'String',
  'Number', 'Boolean', 'Map', 'Set', 'Promise', 'Error', 'parseInt', 'parseFloat', 'isNaN',
  'undefined', 'NaN', 'Infinity', 'Intl', 'URL', 'Blob', 'File', 'FormData', 'Image',
  'localStorage', 'sessionStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent',
  'structuredClone', 'crypto', 'performance',
]);

const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

const importAst = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
const importBindings = new Map();
const topLevelConsts = new Set();

traverse(importAst, {
  ImportDeclaration(p) {
    for (const s of p.node.specifiers) {
      const local = s.local.name;
      if (s.type === 'ImportDefaultSpecifier') {
        importBindings.set(local, { source: p.node.source.value, type: 'default' });
      } else if (s.type === 'ImportNamespaceSpecifier') {
        importBindings.set(local, { source: p.node.source.value, type: 'namespace' });
      } else {
        importBindings.set(local, {
          source: p.node.source.value,
          type: 'named',
          imported: s.imported?.name || s.local.name,
        });
      }
    }
  },
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    for (const d of p.node.declarations) {
      if (d.id.type === 'Identifier') topLevelConsts.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    if (p.parent.type === 'Program' && p.node.id) topLevelConsts.add(p.node.id.name);
  },
});

function analyze(jsxSrc) {
  // Multi-root tab bodies (e.g. payslip + PayBalancesPanel) need a fragment wrapper.
  const wrapped = `function __T(){ return (<>${jsxSrc}\n</>); }`;
  let ast;
  try {
    ast = parser.parse(wrapped, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    return { error: e.message, free: [] };
  }
  const free = new Set();
  const jsxTags = new Set();
  traverse(ast, {
    JSXIdentifier(p) {
      const name = p.node.name;
      if (/^[A-Z]/.test(name)) jsxTags.add(name);
    },
    Identifier(p) {
      const name = p.node.name;
      if (builtins.has(name)) return;
      if (p.parent.type === 'JSXOpeningElement' || p.parent.type === 'JSXClosingElement') return;
      if (p.parent.type === 'JSXAttribute' && p.parent.name === p.node) return;
      if (p.parent.type === 'MemberExpression' && p.parent.property === p.node && !p.parent.computed) return;
      if (p.parent.type === 'OptionalMemberExpression' && p.parent.property === p.node && !p.parent.computed) return;
      if (p.parent.type === 'ObjectProperty' && p.parent.key === p.node && !p.parent.computed) return;
      if (p.scope.getBinding(name)) return;
      free.add(name);
    },
  });
  for (const t of jsxTags) free.add(t);
  return { free: [...free].sort(), error: null };
}

function dedent(chunk) {
  const ls = chunk.split(/\r?\n/);
  const indents = ls
    .filter((l) => l.trim().length)
    .map((l) => (l.match(/^[ \t]*/)?.[0].length) || 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return ls.map((l) => l.slice(min)).join('\n').trim();
}

function buildImportBlock(names) {
  const bySource = new Map();
  const topLevel = [];
  for (const n of names) {
    if (importBindings.has(n)) {
      const info = importBindings.get(n);
      if (!bySource.has(info.source)) bySource.set(info.source, []);
      bySource.get(info.source).push({ local: n, ...info });
    } else if (topLevelConsts.has(n)) {
      topLevel.push(n);
    }
  }
  const linesOut = ["import React from 'react';", "import { useAdminDash } from '../AdminDashContext';"];
  for (const [source, specs] of bySource) {
    const def = specs.find((s) => s.type === 'default');
    const named = specs.filter((s) => s.type === 'named');
    const ns = specs.find((s) => s.type === 'namespace');
    if (ns) {
      linesOut.push(`import * as ${ns.local} from '${source}';`);
      continue;
    }
    const parts = [];
    if (def) parts.push(def.local);
    if (named.length) {
      const inner = named
        .map((s) => (s.imported === s.local ? s.local : `${s.imported} as ${s.local}`))
        .join(', ');
      parts.push(`{ ${inner} }`);
    }
    if (parts.length) linesOut.push(`import ${parts.join(', ')} from '${source}';`);
  }
  if (topLevel.length) {
    // Pull module-level consts from AdminDashboard via context (SHIFT_PAGE etc.)
    // They will be on the dash bag; no extra import.
  }
  return { importBlock: linesOut.join('\n'), topLevel };
}

const mode = process.argv[2] || 'analyze';

if (mode === 'analyze') {
  for (const tab of TABS) {
    const chunk = lines.slice(tab.start - 1, tab.end).join('\n');
    console.log(`\n=== ${tab.name} lines ${tab.start}-${tab.end} chars ${chunk.length}`);
    const result = analyze(chunk);
    if (result.error) {
      console.log('PARSE ERROR', result.error);
      console.log(chunk.slice(0, 200));
      continue;
    }
    const fromImport = result.free.filter((n) => importBindings.has(n));
    const fromTop = result.free.filter((n) => topLevelConsts.has(n) && !importBindings.has(n));
    const fromScope = result.free.filter((n) => !importBindings.has(n) && !topLevelConsts.has(n));
    console.log('import', fromImport.length, fromImport.join(', '));
    console.log('toplevel', fromTop.length, fromTop.join(', '));
    console.log('scope', fromScope.length, fromScope.join(', '));
  }
  process.exit(0);
}

if (mode === 'extract') {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const allScope = new Set();
  const allTop = new Set();
  const tabMeta = [];

  for (const tab of TABS) {
    const raw = lines.slice(tab.start - 1, tab.end).join('\n');
    const chunk = dedent(raw);
    const result = analyze(raw);
    if (result.error) {
      console.error('PARSE ERROR', tab.name, result.error);
      process.exit(1);
    }
    const fromImport = result.free.filter((n) => importBindings.has(n));
    const fromTop = result.free.filter((n) => topLevelConsts.has(n) && !importBindings.has(n));
    const fromScope = result.free.filter((n) => !importBindings.has(n) && !topLevelConsts.has(n));
    fromScope.forEach((n) => allScope.add(n));
    fromTop.forEach((n) => allTop.add(n));

    // Prefer local imports for module-level helpers when possible; rest via context.
    const scopeOnly = fromScope.filter((n) => n !== 'Fragment' && n !== 'React');
    const { importBlock } = buildImportBlock([...fromImport, ...fromTop.filter((n) => importBindings.has(n))]);
    const destructure = [...scopeOnly, ...fromTop].sort();
    const indented = chunk.split('\n').map((l) => (l ? `      ${l}` : '')).join('\n');
    const body = `export default function ${tab.name}() {
  const {
${destructure.map((n) => `    ${n},`).join('\n')}
  } = useAdminDash();

  return (
    <>
${indented}
    </>
  );
}
`;
    const fileSrc = `${importBlock}\n\n${body}`;
    const outPath = path.join(OUT_DIR, `${tab.name}.jsx`);
    fs.writeFileSync(outPath, fileSrc);
    console.log('Wrote', outPath, 'scope', destructure.length, 'imports', fromImport.length);
    tabMeta.push({ ...tab, destructure, fromImport });
  }

  // Context file
  const ctxPath = path.join(ROOT, 'src/modules/timesheet/components/admin/AdminDashContext.jsx');
  fs.writeFileSync(
    ctxPath,
    `import { createContext, useContext } from 'react';

const AdminDashContext = createContext(null);

export function AdminDashProvider({ value, children }) {
  return <AdminDashContext.Provider value={value}>{children}</AdminDashContext.Provider>;
}

export function useAdminDash() {
  const value = useContext(AdminDashContext);
  if (!value) {
    throw new Error('useAdminDash must be used within AdminDashProvider');
  }
  return value;
}
`
  );
  console.log('Wrote', ctxPath);

  // Manifest for wiring parent
  const manifest = {
    scopeKeys: [...allScope].sort(),
    topLevelKeys: [...allTop].sort(),
    tabs: tabMeta.map((t) => ({ id: t.id, name: t.name, keys: t.destructure })),
  };
  fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Scope keys:', manifest.scopeKeys.length, 'toplevel:', manifest.topLevelKeys.length);
  process.exit(0);
}

console.error('Unknown mode', mode);
process.exit(1);
