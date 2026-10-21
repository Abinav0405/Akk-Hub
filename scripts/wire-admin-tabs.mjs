/**
 * Wire AdminDashboard.jsx to lazy tab panels + AdminDashProvider.
 * Run after extract-admin-tabs.mjs extract.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'src/modules/timesheet/pages/AdminDashboard.jsx');
const MANIFEST = path.join(ROOT, 'src/modules/timesheet/components/admin/tabs/_manifest.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const keys = [...new Set([...manifest.scopeKeys, ...manifest.topLevelKeys])]
  .filter((k) => k !== 'Fragment' && k !== 'React')
  .sort();

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('AdminDashProvider')) {
  console.log('Already wired — skipping.');
  process.exit(0);
}

// 1) Imports
if (!src.includes("const VehiclesTab = lazy(() => import('@/modules/timesheet/components/admin/VehiclesTab'));")) {
  console.error('VehiclesTab lazy import not found');
  process.exit(1);
}
src = src.replace(
  "const VehiclesTab = lazy(() => import('@/modules/timesheet/components/admin/VehiclesTab'));",
  `const VehiclesTab = lazy(() => import('@/modules/timesheet/components/admin/VehiclesTab'));
const TimeTrackerTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/TimeTrackerTab'));
const LeavesTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/LeavesTab'));
const PayslipReportTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/PayslipReportTab'));
const TimesheetReportTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/TimesheetReportTab'));
const WorkerInfoTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/WorkerInfoTab'));
const SitesTab = lazy(() => import('@/modules/timesheet/components/admin/tabs/SitesTab'));`
);

if (!src.includes("from '@/modules/timesheet/components/admin/AdminDashContext'")) {
  src = src.replace(
    "import { AdminMobileSectionStrip, AdminMorePagesDrawer, ADMIN_TAB_TITLES } from '@/modules/timesheet/components/admin/AdminNavChrome';",
    `import { AdminMobileSectionStrip, AdminMorePagesDrawer, ADMIN_TAB_TITLES } from '@/modules/timesheet/components/admin/AdminNavChrome';
import { AdminDashProvider } from '@/modules/timesheet/components/admin/AdminDashContext';`
  );
}

// 2) Leave pagination state next to shiftLimit
if (!src.includes('leaveLimit')) {
  src = src.replace(
    'const [shiftLimit, setShiftLimit] = useState(SHIFT_PAGE);',
    `const [shiftLimit, setShiftLimit] = useState(SHIFT_PAGE);
    const [leaveLimit, setLeaveLimit] = useState(SHIFT_PAGE);`
  );
  // reset leaveLimit when leave list identity changes — near shiftLimit reset if any
  keys.push('leaveLimit', 'setLeaveLimit');
}

// 3) adminDash bag — insert immediately before the TopBar / main return content that opens Tabs.
// Find a stable anchor: the AdminMobileSectionStrip usage is inside return; insert bag just before
// `return (` of the component is hard. Instead insert right before `{/* Main Dashboard Tabs`.
const dashObject = `            const adminDash = {
${keys.map((k) => `                ${k},`).join('\n')}
            };

`;

// adminDash must be inside the function body, before JSX return. The return starts around line 8400+.
// Place it just before `return (` that contains TopBar with AdminMobileSectionStrip.
const returnAnchor = src.indexOf('<AdminMobileSectionStrip');
if (returnAnchor < 0) {
  console.error('AdminMobileSectionStrip not found');
  process.exit(1);
}
// Walk back to the `return (` that owns this JSX
const returnIdx = src.lastIndexOf('return (', returnAnchor);
if (returnIdx < 0) {
  console.error('return ( not found');
  process.exit(1);
}
src = src.slice(0, returnIdx) + dashObject + src.slice(returnIdx);

// 4) Wrap Tabs in AdminDashProvider — find `<Tabs value={activeDashboardTab}` and closing `</Tabs>` before site QR dialog
const tabsOpen = src.indexOf('<Tabs value={activeDashboardTab}');
if (tabsOpen < 0) {
  console.error('Tabs open not found');
  process.exit(1);
}
src = src.slice(0, tabsOpen) + '<AdminDashProvider value={adminDash}>\n                ' + src.slice(tabsOpen);

const tabsCloseMarker = '\n                </Tabs>\n            </div>';
const tabsClose = src.indexOf(tabsCloseMarker, tabsOpen);
if (tabsClose < 0) {
  console.error('Tabs close not found');
  process.exit(1);
}
src = src.slice(0, tabsClose) + '\n                </Tabs>\n                </AdminDashProvider>' + src.slice(tabsClose + '\n                </Tabs>'.length);

// 5) Replace each TabsContent body with gated lazy mount.
// Strategy: for each tab id, find `<TabsContent value="ID"` and the matching `</TabsContent>`,
// keep dialogs that sit between timesheet-report and worker-info untouched.

function replaceTabsContent(source, value, componentName) {
  const openRe = new RegExp(`<TabsContent value="${value}"([^>]*)>`);
  const m = openRe.exec(source);
  if (!m) {
    console.error('TabsContent not found', value);
    process.exit(1);
  }
  const start = m.index;
  const afterOpen = start + m[0].length;
  // Find matching close — nest depth for TabsContent only at this indentation level is flat
  const closeTag = '</TabsContent>';
  const end = source.indexOf(closeTag, afterOpen);
  if (end < 0) {
    console.error('close not found', value);
    process.exit(1);
  }
  const replacement = `<TabsContent value="${value}"${m[1]}>
                        {activeDashboardTab === '${value}' && (
                            <Suspense fallback={<PageLoader />}>
                                <${componentName} />
                            </Suspense>
                        )}
                    </TabsContent>`;
  return source.slice(0, start) + replacement + source.slice(end + closeTag.length);
}

const tabMap = [
  ['time-tracker', 'TimeTrackerTab'],
  ['leaves', 'LeavesTab'],
  ['payslip-report', 'PayslipReportTab'],
  ['timesheet-report', 'TimesheetReportTab'],
  ['worker-info', 'WorkerInfoTab'],
  ['sites', 'SitesTab'],
];

for (const [id, comp] of tabMap) {
  src = replaceTabsContent(src, id, comp);
}

// Vehicles already gated — leave as-is

fs.writeFileSync(FILE, src);
console.log('Wired AdminDashboard.jsx with', keys.length, 'adminDash keys +', tabMap.length, 'lazy tabs');
