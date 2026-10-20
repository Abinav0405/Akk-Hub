import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'src', 'modules');

const files = [
  'timesheet/pages/AdminFormDetail.jsx',
  'timesheet/pages/AdminForms.jsx',
  'timesheet/pages/Analytics.jsx',
  'timesheet/pages/AttendanceReport.jsx',
  'timesheet/pages/LeaveHistory.jsx',
  'timesheet/pages/ManagerTimesheets.jsx',
  'timesheet/pages/ShiftHistory.jsx',
  'timesheet/pages/WorkerCompanyForms.jsx',
  'timesheet/pages/WorkerFormFill.jsx',
  'timesheet/pages/WorkerSubmittedForms.jsx',
  'timesheet/pages/WorkerTimesheets.jsx',
];

const pairs = [
  ['â€¦', '…'],
  ['â€”', '—'],
  ['â€“', '–'],
  ['Â·', '·'],
  ['â€™', "'"],
  ['â€œ', '"'],
  ['â€\u009d', '"'],
];

let changed = 0;
for (const rel of files) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  for (const [bad, good] of pairs) s = s.split(bad).join(good);
  if (s !== before) {
    fs.writeFileSync(p, s, 'utf8');
    changed += 1;
    console.log('fixed', rel);
  } else {
    console.log('unchanged', rel);
  }
}
console.log('files_changed', changed);
