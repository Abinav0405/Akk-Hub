import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB = path.join(ROOT, 'Akk Hub');
const SRC = path.join(ROOT, 'AKK-Material-Tracker-main', 'src');

function transform(src) {
  let s = src;
  s = s.replace(/from\s+['"]@\/Components\/ui\/([^'"]+?)(?:\.jsx)?['"]/g, "from '@/ui/$1'");
  s = s.replace(/from\s+['"]@\/lib\/platform['"]/g, "from '@/core/platform'");
  s = s.replace(/from\s+['"]@\/lib\/([^'"]+)['"]/g, "from '@/modules/materials/lib/$1'");
  s = s.replace(/from\s+['"]@\/Components\/mobile\/([^'"]+)['"]/g, "from '@/modules/materials/components/mobile/$1'");
  s = s.replace(/from\s+['"]@\/Components\/([^'"]+)['"]/g, "from '@/modules/materials/components/$1'");
  s = s.replace(/from\s+['"]@\/hooks\/([^'"]+)['"]/g, "from '@/modules/materials/hooks/$1'");
  return s;
}

const mobileFiles = ['NativeBottomNav.jsx', 'NativeNavBar.jsx', 'NativeStates.jsx'];
const hooks = ['useAndroidBackButton.js', 'useProgressiveList.js', 'useDelayedFlag.js', 'useSheetDismiss.js'];

const mobileDir = path.join(HUB, 'src', 'modules', 'materials', 'components', 'mobile');
const hooksDir = path.join(HUB, 'src', 'modules', 'materials', 'hooks');
fs.mkdirSync(mobileDir, { recursive: true });
fs.mkdirSync(hooksDir, { recursive: true });

for (const f of mobileFiles) {
  const from = path.join(SRC, 'Components', 'mobile', f);
  const to = path.join(mobileDir, f);
  fs.writeFileSync(to, transform(fs.readFileSync(from, 'utf8')), 'utf8');
  console.log('mobile', f);
}

for (const f of hooks) {
  const from = path.join(SRC, 'hooks', f);
  const to = path.join(hooksDir, f);
  fs.writeFileSync(to, transform(fs.readFileSync(from, 'utf8')), 'utf8');
  console.log('hook', f);
}
