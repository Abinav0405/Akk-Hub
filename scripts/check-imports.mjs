/**
 * Lists every unresolved local import in src/ (alias @/ → src/, and relative paths) plus
 * named imports that the target file doesn't export. Faster than one-error-per-build.
 *
 *   node scripts/check-imports.mjs            → all files
 *   node scripts/check-imports.mjs modules    → only paths containing "modules"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const filter = process.argv[2] || '';
const EXTS = ['', '.js', '.jsx', '.mjs', '.json', '/index.js', '/index.jsx'];

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.(jsx?|mjs)$/.test(e.name) ? [p] : [];
    });
}

function resolve(from, spec) {
    let base;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
    else if (spec.startsWith('/src/')) base = path.join(ROOT, spec);
    else return 'external';
    for (const ext of EXTS) {
        const p = base + ext;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    if (/\.(css|png|jpe?g|svg|webp)$/.test(spec) && fs.existsSync(base)) return base;
    return null;
}

const exportCache = new Map();
function exportsOf(file) {
    if (exportCache.has(file)) return exportCache.get(file);
    const src = fs.readFileSync(file, 'utf8');
    const names = new Set();
    let star = false;
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
            const parts = s.split(/\s+as\s+/);
            names.add((parts[1] || parts[0]).trim());
        });
    }
    if (/export\s+default/.test(src)) names.add('default');
    for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
        const target = resolve(file, m[1]);
        if (target && target !== 'external') exportsOf(target).names.forEach((n) => n !== 'default' && names.add(n));
        else star = true;
    }
    const result = { names, star };
    exportCache.set(file, result);
    return result;
}

const problems = [];
for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (filter && !rel.includes(filter)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // Only real import/export-from forms — never span `export const … = { … }` until a later `from`.
    const re =
        /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]|export\s+(\*(?:\s+as\s+[A-Za-z0-9_$]+)?\s+|\{[^}]*\}\s*)from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
    for (const m of src.matchAll(re)) {
        const spec = m[2] || m[4] || m[5] || m[6];
        const target = resolve(file, spec);
        if (target === 'external') continue;
        if (!target) {
            problems.push(`${rel}: cannot resolve '${spec}'`);
            continue;
        }
        const clause = m[1] || m[3];
        if (!clause || !/\.(jsx?|mjs)$/.test(target)) continue;
        const named = clause.match(/\{([^}]*)\}/);
        if (!named) continue;
        const { names, star } = exportsOf(target);
        if (star) continue;
        named[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
            const name = s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
            if (name && !names.has(name)) problems.push(`${rel}: '${name}' is not exported by ${path.relative(ROOT, target).replace(/\\/g, '/')}`);
        });
    }
}

if (problems.length) {
    console.log(problems.join('\n'));
    console.log(`\n${problems.length} problem(s)`);
    process.exitCode = 1;
} else {
    console.log('All local imports resolve.');
}
