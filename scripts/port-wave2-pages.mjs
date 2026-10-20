/**
 * Wave 2 SMALL-PAGES mechanical port — Cursor lane.
 * Copies source Pages into modules/<module>/pages with import/storage/nav rewrites.
 * Does not register routes (Claude owns router).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.resolve(__dirname, '..');
const ROOT = path.resolve(HUB, '..');

const PAGE_PATHS = {
  // timesheet
  LegalNotice: '/legal',
  AdminAnnouncements: '/timesheet/admin/announcements',
  AdminForms: '/timesheet/admin/forms',
  AdminFormDetail: '/timesheet/admin/forms/:id',
  WorkerFormFill: '/timesheet/forms/:id',
  WorkerSubmittedForms: '/timesheet/forms',
  WorkerCompanyForms: '/timesheet/company-forms',
  WorkerCompanyFormFill: '/timesheet/company-forms/fill',
  WorkerCompanyFormHistory: '/timesheet/company-forms/history',
  LeaveHistory: '/timesheet/leave/history',
  ShiftHistory: '/timesheet/shifts',
  WorkerTimesheets: '/timesheet/timesheets',
  Analytics: '/timesheet/admin/analytics',
  AttendanceReport: '/timesheet/admin/attendance',
  ManagerTimesheets: '/timesheet/manage',
  AdminCompanyForms: '/timesheet/admin/company-forms',
  WorkerPortal: '/timesheet/clock',
  AdminDashboard: '/timesheet/admin',
  ManagerDashboard: '/timesheet/manage',
  // materials
  RequestHistory: '/materials/history',
  History: '/materials/manage',
  RequestPortal: '/materials/request',
  AdminDashboard_materials: '/materials/admin',
  ManagerDashboard_materials: '/materials/manage',
  // progress
  MySubmissions: '/progress/submissions',
  MyAccount: '/account',
  PhotoVerification: '/verify',
  SubmitProgress: '/progress/submit',
  WorkerPortal_progress: '/progress/submit',
  ManagerDashboard_progress: '/progress/review',
  AdminDashboard_progress: '/progress/admin',
  ExporterDashboard: '/progress/client',
  Home: '/',
  AppHome: '/',
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rewriteCreatePageUrl(src) {
  return src.replace(/createPageUrl\(\s*['"]([^'"]+)['"]\s*\)/g, (_, name) => {
    const lit = PAGE_PATHS[name];
    if (lit) return JSON.stringify(lit);
    return `/* TODO(claude): path for ${name} */ ${JSON.stringify('/' + name)}`;
  });
}

function rewriteStorage(src, module) {
  // localStorage.getItem('key') / setItem / removeItem
  const stores = ['localStorage', 'sessionStorage'];
  let out = src;
  for (const store of stores) {
    out = out.replace(
      new RegExp(`${store}\\.(getItem|setItem|removeItem)\\(\\s*['"]([^'"]+)['"]`, 'g'),
      (match, method, key) => {
        // skip keys already namespaced akk.
        if (key.startsWith('akk.')) return match;
        return `${store}.${method}(storageKey('${module}', '${key}')`;
      },
    );
  }
  return out;
}

function ensureStorageImport(src) {
  if (!src.includes("storageKey(")) return src;
  if (/from\s+['"]@\/core\/storage['"]/.test(src)) return src;
  // insert after first import block line
  if (/^import\b/m.test(src)) {
    return src.replace(/^(import\b[^\n]*\n)/m, `$1import { storageKey } from '@/core/storage';\n`);
  }
  return `import { storageKey } from '@/core/storage';\n${src}`;
}

function transformTimesheet(src) {
  let s = src;
  s = s.replace(/from\s+['"]@\/Components\/ui\/([^'"]+?)(?:\.jsx)?['"]/g, "from '@/ui/$1'");
  s = s.replace(/from\s+['"]@\/supabase['"]/g, "from '@/core/supabase'");
  s = s.replace(/\bimport\s*\{\s*supabase\s*\}\s*from\s*['"]@\/core\/supabase['"]/g,
    "import { supabaseTimesheet as supabase } from '@/core/supabase'");
  s = s.replace(/from\s+['"]@\/lib\/platform['"]/g, "from '@/core/platform'");
  s = s.replace(/from\s+['"]@\/lib\/authSession['"]/g, "from '@/core/authSession'");
  s = s.replace(/from\s+['"]@\/lib\/i18n['"]/g, "from '@/core-i18n'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/timesheet/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/PortalShell['"]/g, "from '@/ui/PortalShell'");
  s = s.replace(/from\s+['"]@\/Components\/native\/([^'"]+)['"]/g, "from '@/ui/native/$1'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g, "from '@/modules/timesheet/components/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/timesheet/hooks/$1'");
  // Prefer named paths over createPageUrl helper when we can resolve
  s = rewriteCreatePageUrl(s);
  // Drop unused createPageUrl import if no longer referenced
  if (!/createPageUrl\s*\(/.test(s)) {
    s = s.replace(/,?\s*createPageUrl\s*,?/g, (m) => {
      // careful: only in import braces — approximate cleanup later
      return m;
    });
    s = s.replace(/import\s*\{\s*createPageUrl\s*,\s*/g, 'import { ');
    s = s.replace(/import\s*\{\s*([^}]*),\s*createPageUrl\s*\}/g, 'import { $1 }');
    s = s.replace(/import\s*\{\s*createPageUrl\s*\}\s*from\s*['"][^'"]+['"];?\n?/g, '');
  }
  s = rewriteStorage(s, 'timesheet');
  s = ensureStorageImport(s);
  if (!s.includes('TODO(claude): shell') && /WorkerPageShell|AdminPageShell|ManagerPageShell/.test(s)) {
    s = `// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell\n${s}`;
  }
  if (/@\/ui\/native\//.test(s)) {
    s = `// TODO(claude): ensure @/ui/native/* chrome/states/confirm exist (or remount Timesheet native chrome)\n${s}`;
  }
  return s;
}

function transformMaterials(src) {
  let s = src;
  s = s.replace(/from\s+['"]@\/Components\/ui\/([^'"]+?)(?:\.jsx)?['"]/g, "from '@/ui/$1'");
  s = s.replace(/from\s+['"]@\/Components\/supbase['"]/g, "from '@/core/supabase'");
  s = s.replace(/from\s+['"]@\/Components\/supabase['"]/g, "from '@/core/supabase'");
  s = s.replace(/\bimport\s*\{\s*supabase\s*\}\s*from\s*['"]@\/core\/supabase['"]/g,
    "import { supabaseMaterials as supabase } from '@/core/supabase'");
  s = s.replace(/from\s+['"]@\/lib\/platform['"]/g, "from '@/core/platform'");
  s = s.replace(/from\s+['"]@\/lib\/auth['"]/g, "from '@/core/auth'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/materials/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/layout['"]/g, "from '@/ui/layout'");
  s = s.replace(/from\s+['"]@\/Components\/mobile\/NativeConfirm['"]/g,
    "from '@/modules/materials/components/mobile/NativeConfirm'");
  s = s.replace(/from\s+['"]@\/Components\/mobile\/([^'"]+)['"]/g,
    "from '@/modules/materials/components/mobile/$1'");
  s = s.replace(/from\s+['"]@\/Components\/MaterialForm['"]/g,
    "from '@/modules/materials/components/MaterialForm'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g,
    "from '@/modules/materials/components/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/materials/hooks/$1'");
  s = rewriteCreatePageUrl(s);
  if (!/createPageUrl\s*\(/.test(s)) {
    s = s.replace(/import\s*\{\s*createPageUrl\s*,\s*/g, 'import { ');
    s = s.replace(/import\s*\{\s*([^}]*),\s*createPageUrl\s*\}/g, 'import { $1 }');
    s = s.replace(/import\s*\{\s*createPageUrl\s*\}\s*from\s*['"][^'"]+['"];?\n?/g, '');
  }
  s = rewriteStorage(s, 'materials');
  s = ensureStorageImport(s);
  if (/@\/ui\/layout/.test(s) || /@\/modules\/materials\/hooks\//.test(s)) {
    s = `// TODO(claude): AppShell/PageHeader (@/ui/layout) + materials hooks (useAndroidBackButton, useProgressiveList) may need hub mounts\n${s}`;
  }
  return s;
}

function transformProgress(src) {
  let s = src;
  s = s.replace(/from\s+['"]@\/Components\/ui\/([^'"]+?)(?:\.jsx)?['"]/g, "from '@/ui/$1'");
  s = s.replace(/from\s+['"]@\/lib\/platform['"]/g, "from '@/core/platform'");
  s = s.replace(/from\s+['"]@\/lib\/authSession['"]/g, "from '@/core/authSession'");
  s = s.replace(/from\s+['"]@\/lib\/managerSession['"]/g, "from '@/core/managerSession'");
  s = s.replace(/from\s+['"]@\/lib\/exporterSession['"]/g, "from '@/core/exporterSession'");
  s = s.replace(/from\s+['"]@\/lib\/adminSession['"]/g, "from '@/core/adminSession'");
  s = s.replace(/from\s+['"]@\/lib\/portalAuth['"]/g, "from '@/core/portalAuth'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/progress/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/layout['"]/g, "from '@/ui/layout'");
  s = s.replace(/from\s+['"]@\/Components\/AuthChecking['"]/g, "from '@/ui/AuthChecking'");
  s = s.replace(/from\s+['"]@\/Components\/useRoleGuard['"]/g, "from '@/ui/useRoleGuard'");
  s = s.replace(/from\s+['"]@\/Components\/MyAccountPanel['"]/g,
    "from '@/modules/progress/components/MyAccountPanel'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g,
    "from '@/modules/progress/components/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/progress/hooks/$1'");
  s = rewriteCreatePageUrl(s);
  if (!/createPageUrl\s*\(/.test(s)) {
    s = s.replace(/import\s*\{\s*createPageUrl\s*,\s*/g, 'import { ');
    s = s.replace(/,\s*createPageUrl\s*/g, '');
    s = s.replace(/import\s*\{\s*createPageUrl\s*\}\s*from\s*['"][^'"]+['"];?\n?/g, '');
  }
  s = rewriteStorage(s, 'progress');
  s = ensureStorageImport(s);
  s = `// TODO(claude): wire /account and /verify; provide @/ui/layout, AuthChecking, useRoleGuard; session helpers under @/core/*\n${s}`;
  return s;
}

const JOBS = [
  {
    module: 'timesheet',
    srcDir: path.join(ROOT, 'AKK-Timesheet-Manager-main', 'src', 'Pages'),
    files: [
      'LegalNotice.jsx',
      'AdminAnnouncements.jsx',
      'AdminForms.jsx',
      'AdminFormDetail.jsx',
      'WorkerFormFill.jsx',
      'WorkerSubmittedForms.jsx',
      'WorkerCompanyForms.jsx',
      'WorkerCompanyFormFill.jsx',
      'WorkerCompanyFormHistory.jsx',
      'LeaveHistory.jsx',
      'ShiftHistory.jsx',
      'WorkerTimesheets.jsx',
      'Analytics.jsx',
      'AttendanceReport.jsx',
      'ManagerTimesheets.jsx',
      'AdminCompanyForms.jsx',
    ],
    transform: transformTimesheet,
  },
  {
    module: 'materials',
    srcDir: path.join(ROOT, 'AKK-Material-Tracker-main', 'src', 'Pages'),
    files: ['RequestHistory.jsx', 'History.jsx'],
    transform: transformMaterials,
  },
  {
    module: 'progress',
    srcDir: path.join(ROOT, 'Site progress tracker', 'src', 'Pages'),
    files: ['MySubmissions.jsx', 'MyAccount.jsx', 'PhotoVerification.jsx'],
    transform: transformProgress,
  },
];

const report = [];
for (const job of JOBS) {
  const destDir = path.join(HUB, 'src', 'modules', job.module, 'pages');
  ensureDir(destDir);
  for (const file of job.files) {
    const from = path.join(job.srcDir, file);
    const to = path.join(destDir, file);
    if (!fs.existsSync(from)) {
      report.push(`MISSING ${job.module}/${file}`);
      continue;
    }
    const raw = fs.readFileSync(from, 'utf8');
    const out = job.transform(raw);
    fs.writeFileSync(to, out, 'utf8');
    report.push(`OK ${job.module}/pages/${file} (${out.length} chars)`);
  }
}

console.log(report.join('\n'));
console.log(`\nDone: ${report.filter((r) => r.startsWith('OK')).length} pages`);
