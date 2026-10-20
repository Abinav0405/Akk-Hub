/**
 * LEGACY-PAGES lane — mechanical port of big screens + page-only components.
 * Cursor-owned: src/modules/** only. Does not touch app|core|ui|pages.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.resolve(__dirname, '..');
const ROOT = path.resolve(HUB, '..');

const PAGE_PATHS = {
  LegalNotice: '/privacy',
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
  SupervisorDashboard: '/timesheet/site-shifts',
  History: '/timesheet/shifts',
  RequestHistory: '/materials/history',
  RequestPortal: '/materials/request',
  MySubmissions: '/progress/submissions',
  MyAccount: '/account',
  PhotoVerification: '/verify',
  SubmitProgress: '/progress/submit',
  Home: '/',
  AppHome: '/',
  // logins — module-aware overrides applied in rewriteCreatePageUrl
  WorkerLogin: '/login',
  AdminLogin: '/login',
  ManagerLogin: '/login',
  SupervisorLogin: '/login',
  ExporterLogin: '/login',
  WorkerQuickLogin: '/login/quick',
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rewriteCreatePageUrl(src, module) {
  return src.replace(/createPageUrl\(\s*[`'\"]([^`'\"]+)[`'\"]\s*\)/g, (_, raw) => {
    const [name, query] = String(raw).split('?');
    let lit = PAGE_PATHS[name];
    if (module === 'materials' && /^(Worker|Admin|Manager)Login$/.test(name)) {
      lit = '/connect/materials';
    } else if (module === 'progress' && /^(Worker|Admin|Manager|Exporter)Login$/.test(name)) {
      lit = '/connect/progress';
    }
    // Ambiguous History / dashboards by module
    if (name === 'History' && module === 'materials') lit = '/materials/manage';
    if (name === 'AdminDashboard' && module === 'materials') lit = '/materials/admin';
    if (name === 'ManagerDashboard' && module === 'materials') lit = '/materials/manage';
    if (name === 'WorkerPortal' && module === 'progress') lit = '/progress/submit';
    if (name === 'AdminDashboard' && module === 'progress') lit = '/progress/admin';
    if (name === 'ManagerDashboard' && module === 'progress') lit = '/progress/review';
    if (name === 'ExporterDashboard') lit = '/progress/client';
    if (!lit) return `/* TODO(claude): path for ${name} */ ${JSON.stringify('/' + name)}`;
    const full = query ? `${lit}${lit.includes('?') ? '&' : '?'}${query}` : lit;
    return JSON.stringify(full);
  });
}

function rewriteStorage(src, module) {
  const stores = ['localStorage', 'sessionStorage'];
  let out = src;
  for (const store of stores) {
    out = out.replace(
      new RegExp(`${store}\\.(getItem|setItem|removeItem)\\(\\s*['"]([^'"]+)['"]`, 'g'),
      (match, method, key) => {
        if (key.startsWith('akk.')) return match;
        return `${store}.${method}(storageKey('${module}', '${key}')`;
      },
    );
  }
  return out;
}

function ensureStorageImport(src) {
  if (!src.includes('storageKey(')) return src;
  if (/from\s+['"]@\/core\/storage['"]/.test(src)) return src;
  if (/^import\b/m.test(src)) {
    return src.replace(/^(import\b[^\n]*\n)/m, `$1import { storageKey } from '@/core/storage';\n`);
  }
  return `import { storageKey } from '@/core/storage';\n${src}`;
}

function dropCreatePageUrlImport(s) {
  if (/createPageUrl\s*\(/.test(s)) return s;
  s = s.replace(/import\s*\{\s*createPageUrl\s*,\s*/g, 'import { ');
  s = s.replace(/import\s*\{\s*([^}]*),\s*createPageUrl\s*\}/g, 'import { $1 }');
  s = s.replace(/,\s*createPageUrl\s*/g, '');
  s = s.replace(/import\s*\{\s*createPageUrl\s*\}\s*from\s*['"][^'"]+['"];?\n?/g, '');
  return s;
}

function rewriteLoginNavigates(s) {
  s = s.replace(/navigate\(\s*['"]\/worker\/login['"]/g, "navigate('/login'");
  s = s.replace(/navigate\(\s*['"]\/admin\/login['"]/g, "navigate('/login'");
  s = s.replace(/navigate\(\s*['"]\/manager\/login['"]/g, "navigate('/login'");
  s = s.replace(/window\.location\.href\s*=\s*['"]\/worker\/login['"]/g, "window.location.href = '/login'");
  return s;
}

/** Drop AuthGuard wrappers — Timesheet router owns auth (Claude). */
function dropAuthGuard(s) {
  if (!/AuthGuard/.test(s)) return s;
  s = s.replace(/import\s+[^;]*AuthGuard[^;]*;?\n?/g, '');
  // <AuthGuard ...>children</AuthGuard> → children (non-greedy, single level)
  s = s.replace(/<AuthGuard\b[^>]*>\s*/g, '');
  s = s.replace(/\s*<\/AuthGuard>/g, '');
  return s;
}

function transformTimesheet(src) {
  let s = src;
  s = s.replace(/from\s+['"]@\/Components\/ui\/([^'"]+?)(?:\.jsx)?['"]/g, "from '@/ui/$1'");
  s = s.replace(/from\s+['"]@\/supabase['"]/g, "from '@/core/supabase'");
  s = s.replace(/\bimport\s*\{\s*supabase\s*\}\s*from\s*['"]@\/core\/supabase['"]/g,
    "import { supabaseTimesheet as supabase } from '@/core/supabase'");
  s = s.replace(/from\s+['"]@\/lib\/platform['"]/g, "from '@/core/platform'");
  s = s.replace(/from\s+['"]@\/lib\/authSession['"]/g, "from '@/core/auth/timesheetSession'");
  s = s.replace(/from\s+['"]@\/lib\/biometricAuth['"]/g, "from '@/core/auth/biometric'");
  s = s.replace(/from\s+['"]@\/lib\/faceRecognition['"]/g, "from '@/core/auth/faceRecognition'");
  s = s.replace(/from\s+['"]@\/lib\/faceMesh['"]/g, "from '@/core/auth/faceMesh'");
  s = s.replace(/from\s+['"]@\/lib\/workerFaceLogin['"]/g, "from '@/core/auth/workerFaceLogin'");
  s = s.replace(/from\s+['"]@\/lib\/loginCurtain['"]/g, "from '@/core/auth/loginCurtain'");
  s = s.replace(/from\s+['"]@\/lib\/permissionManager['"]/g, "from '@/core/permissions'");
  s = s.replace(/from\s+['"]@\/lib\/firstBootPermissions['"]/g, "from '@/core/permissions'");
  s = s.replace(/from\s+['"]@\/lib\/nativeShell['"]/g, "from '@/core/nativeShell'");
  s = s.replace(/from\s+['"]@\/lib\/i18n['"]/g, "from '@/core-i18n'");
  s = s.replace(/from\s+['"]@\/Components\/LanguageSwitcher['"]/g, "from '@/core-i18n'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/timesheet/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/PortalShell['"]/g, "from '@/ui/PortalShell'");
  s = s.replace(/from\s+['"]@\/Components\/LoginWelcomeOverlay['"]/g, "from '@/ui/LoginWelcomeOverlay'");
  s = s.replace(/from\s+['"]@\/Components\/native\/([^'"]+)['"]/g, "from '@/ui/native/$1'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g, "from '@/modules/timesheet/components/$1'");
  s = s.replace(/from\s+['"]@\/Pages\/([^'"]+)['"]/g, "from '@/modules/timesheet/pages/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/timesheet/hooks/$1'");
  s = s.replace(/import\(['"]@\/Components\/([^'"]+)['"]\)/g, "import('@/modules/timesheet/components/$1')");
  s = s.replace(/import\(['"]@\/lib\/([^'"]+)['"]\)/g, "import('@/modules/timesheet/lib/$1')");
  s = rewriteCreatePageUrl(s, 'timesheet');
  s = dropCreatePageUrlImport(s);
  s = rewriteLoginNavigates(s);
  s = dropAuthGuard(s);
  s = rewriteStorage(s, 'timesheet');
  s = ensureStorageImport(s);
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
  s = s.replace(/from\s+['"]@\/lib\/auth['"]/g, "from '@/core/auth/materialsSession'");
  s = s.replace(/from\s+['"]@\/lib\/nativeBootstrap['"]/g, "from '@/core/nativeShell'");
  s = s.replace(/from\s+['"]@\/lib\/pushNotifications['"]/g, "from '@/core/push'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/materials/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/layout['"]/g, "from '@/ui/layout'");
  s = s.replace(/from\s+['"]@\/Components\/layout\/([^'"]+)['"]/g, "from '@/ui/layout'");
  s = s.replace(/from\s+['"]@\/Components\/mobile\/([^'"]+)['"]/g,
    "from '@/modules/materials/components/mobile/$1'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g,
    "from '@/modules/materials/components/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/materials/hooks/$1'");
  s = rewriteCreatePageUrl(s, 'materials');
  s = dropCreatePageUrlImport(s);
  s = rewriteLoginNavigates(s);
  s = rewriteStorage(s, 'materials');
  s = ensureStorageImport(s);
  return s;
}

function transformProgress(src) {
  let s = src;
  s = s.replace(/from\s+['"]@\/Components\/ui\/([^'"]+?)(?:\.jsx)?['"]/g, "from '@/ui/$1'");
  s = s.replace(/from\s+['"]@\/lib\/platform['"]/g, "from '@/core/platform'");
  s = s.replace(/from\s+['"]@\/lib\/authSession['"]/g, "from '@/core/auth/progress/workerSession'");
  s = s.replace(/from\s+['"]@\/lib\/managerSession['"]/g, "from '@/core/auth/progress/managerSession'");
  s = s.replace(/from\s+['"]@\/lib\/exporterSession['"]/g, "from '@/core/auth/progress/exporterSession'");
  s = s.replace(/from\s+['"]@\/lib\/adminSession['"]/g, "from '@/core/auth/progress/adminSession'");
  s = s.replace(/from\s+['"]@\/lib\/portalAuth['"]/g, "from '@/core/auth/progress/portalAuth'");
  s = s.replace(/from\s+['"]@\/lib\/nativeBack['"]/g, "from '@/core/nativeShell'");
  s = s.replace(/from\s+['"]@\/lib\/nativeBootstrap['"]/g, "from '@/core/nativeShell'");
  s = s.replace(/from\s+['"]@\/lib\/pushNotifications['"]/g, "from '@/core/push'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/progress/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/layout['"]/g, "from '@/ui/layout'");
  s = s.replace(/from\s+['"]@\/Components\/AuthChecking['"]/g, "from '@/ui/AuthChecking'");
  s = s.replace(/from\s+['"]@\/Components\/useRoleGuard['"]/g, "from '@/ui/useRoleGuard'");
  s = s.replace(/from\s+['"]@\/Components\/LoginWelcomeOverlay['"]/g, "from '@/ui/LoginWelcomeOverlay'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g,
    "from '@/modules/progress/components/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/progress/hooks/$1'");
  s = rewriteCreatePageUrl(s, 'progress');
  s = dropCreatePageUrlImport(s);
  s = rewriteLoginNavigates(s);
  s = rewriteStorage(s, 'progress');
  s = ensureStorageImport(s);
  return s;
}

function copyTransformed(from, to, transform) {
  if (!fs.existsSync(from)) return `MISSING ${from}`;
  ensureDir(path.dirname(to));
  const out = transform(fs.readFileSync(from, 'utf8'));
  fs.writeFileSync(to, out, 'utf8');
  return `OK ${path.relative(HUB, to)} (${out.length} chars)`;
}

const report = [];

// --- Pages ---
const pageJobs = [
  {
    module: 'timesheet',
    srcDir: path.join(ROOT, 'AKK-Timesheet-Manager-main', 'src', 'Pages'),
    files: [
      'WorkerPortal.jsx',
      'AdminDashboard.jsx',
      'ManagerDashboard.jsx',
      'SupervisorDashboard.jsx',
      'History.jsx',
    ],
    transform: transformTimesheet,
  },
  {
    module: 'materials',
    srcDir: path.join(ROOT, 'AKK-Material-Tracker-main', 'src', 'Pages'),
    files: ['RequestPortal.jsx', 'AdminDashboard.jsx', 'ManagerDashboard.jsx'],
    transform: transformMaterials,
  },
  {
    module: 'progress',
    srcDir: path.join(ROOT, 'Site progress tracker', 'src', 'Pages'),
    files: [
      'WorkerPortal.jsx',
      'SubmitProgress.jsx',
      'ManagerDashboard.jsx',
      'AdminDashboard.jsx',
      'ExporterDashboard.jsx',
    ],
    transform: transformProgress,
  },
];

for (const job of pageJobs) {
  const destDir = path.join(HUB, 'src', 'modules', job.module, 'pages');
  ensureDir(destDir);
  for (const file of job.files) {
    report.push(
      copyTransformed(
        path.join(job.srcDir, file),
        path.join(destDir, file),
        job.transform,
      ),
    );
  }
}

// --- Timesheet page-only components ---
const tsCompRoot = path.join(ROOT, 'AKK-Timesheet-Manager-main', 'src', 'Components');
const tsCompDest = path.join(HUB, 'src', 'modules', 'timesheet', 'components');
const tsComponents = [
  'AppTour.jsx',
  'DashboardAnalyticsWidget.jsx',
  'ManagerLeavePanel.jsx',
  'PageLoader.jsx',
  'UpdatePrompt.jsx',
  'WorkerNotificationLayout.jsx',
  'biometric/BiometricLoginSettings.jsx',
  'biometric/FaceMatchPrompt.jsx',
  'biometric/BiometricGlyph.jsx',
  'biometric/BiometricPrompt.jsx',
  'worker/WorkerHome.jsx',
  'admin/AdminNavChrome.jsx',
  'admin/AdminEditShiftDialog.jsx',
  'admin/VehiclesTab.jsx',
];
for (const rel of tsComponents) {
  report.push(
    copyTransformed(path.join(tsCompRoot, rel), path.join(tsCompDest, rel), transformTimesheet),
  );
}

// --- Materials page-only components ---
const matCompRoot = path.join(ROOT, 'AKK-Material-Tracker-main', 'src', 'Components');
const matCompDest = path.join(HUB, 'src', 'modules', 'materials', 'components');
for (const rel of ['mobile/NativeAuthScreen.jsx', 'mobile/NativeActionSheet.jsx']) {
  report.push(
    copyTransformed(path.join(matCompRoot, rel), path.join(matCompDest, rel), transformMaterials),
  );
}

// --- Progress page-only components / hooks ---
const progSrc = path.join(ROOT, 'Site progress tracker', 'src');
const progMod = path.join(HUB, 'src', 'modules', 'progress');
report.push(
  copyTransformed(
    path.join(progSrc, 'Components', 'mobile', 'NativeActionRow.jsx'),
    path.join(progMod, 'components', 'mobile', 'NativeActionRow.jsx'),
    transformProgress,
  ),
);
report.push(
  copyTransformed(
    path.join(progSrc, 'hooks', 'useLoginWelcome.jsx'),
    path.join(progMod, 'hooks', 'useLoginWelcome.jsx'),
    transformProgress,
  ),
);

console.log(report.join('\n'));
const ok = report.filter((r) => r.startsWith('OK')).length;
const miss = report.filter((r) => r.startsWith('MISSING')).length;
console.log(`\nDone: ${ok} ok, ${miss} missing`);
