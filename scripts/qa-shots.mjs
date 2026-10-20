/**
 * Claude 19:58 SCREENSHOTS — real SB on :5190. Creds from .env.qa.local only.
 *
 * LoginForm has a full-screen "Close login" backdrop (aria-label="Close login")
 * that steals getByLabel(/Email|Manager/i). This script never uses getByLabel for
 * credentials — only real input/textarea by placeholder / name / type, with
 * force-click after waiting for the backdrop to clear.
 *
 * Usage: node scripts/qa-shots.mjs [employee|manager|admin|client|all]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa-shots');
const BASE = 'http://localhost:5190';

function loadQa() {
  const env = {};
  const p = path.join(ROOT, '.env.qa.local');
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', path.basename(file));
}

async function setViewport(page, width) {
  await page.setViewportSize({ width, height: width <= 400 ? 812 : 800 });
}

async function clearSession(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
}

/** Wait until Close-login backdrop is gone or no longer intercepts pointer events. */
async function waitBackdropClear(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const close = page.locator('[aria-label="Close login"]');
  for (let i = 0; i < 50; i++) {
    const n = await close.count();
    if (n === 0) return;
    const pe = await close
      .first()
      .evaluate((el) => getComputedStyle(el).pointerEvents)
      .catch(() => 'none');
    const vis = await close.first().isVisible().catch(() => false);
    if (!vis || pe === 'none') return;
    if (i === 3 || i === 12 || i === 25) {
      await close.first().click({ force: true }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Fill a credential field. Never uses getByLabel (hits Close login backdrop).
 */
async function fillCredInput(page, { placeholders = [], types = ['text', 'email'], nameAttrs = [] }, value) {
  await waitBackdropClear(page);

  for (const ph of placeholders) {
    const loc = page.locator(
      `input[placeholder="${ph}"], textarea[placeholder="${ph}"], input[placeholder*="${ph}" i]`,
    );
    if (await loc.count()) {
      const el = loc.first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ force: true });
      await el.fill('');
      await el.fill(value);
      return;
    }
  }

  for (const name of nameAttrs) {
    const loc = page.locator(`input[name="${name}"], input[id="${name}"]`);
    if (await loc.count()) {
      const el = loc.first();
      await el.click({ force: true });
      await el.fill(value);
      return;
    }
  }

  for (const t of types) {
    const loc = page.locator(`input[type="${t}"]:visible`);
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      if (await el.isDisabled().catch(() => true)) continue;
      await el.click({ force: true });
      await el.fill(value);
      return;
    }
  }

  throw new Error(`No cred input for placeholders=${placeholders.join('|')} types=${types.join('|')}`);
}

async function clickLoginSubmit(page, nameRe) {
  await waitBackdropClear(page);
  // Exclude the Close login full-screen button
  const btn = page.locator('button').filter({ hasText: nameRe }).filter({
    hasNot: page.locator('[aria-label="Close login"]'),
  });
  // Prefer role match that is not the backdrop
  const roleBtn = page.getByRole('button', { name: nameRe });
  const count = await roleBtn.count();
  for (let i = 0; i < count; i++) {
    const el = roleBtn.nth(i);
    const label = await el.getAttribute('aria-label').catch(() => '');
    if (label === 'Close login') continue;
    await el.click({ force: true });
    return;
  }
  await btn.first().click({ force: true });
}

async function loginEmployee(page, qa) {
  await page.goto(`${BASE}/login?role=employee`, { waitUntil: 'networkidle' });
  await waitBackdropClear(page);
  await page.getByRole('button', { name: 'Foreign' }).click({ force: true }).catch(() => {});
  await fillCredInput(
    page,
    { placeholders: ['Enter your employee ID'], types: ['text'], nameAttrs: ['employeeId', 'employee_id', 'id'] },
    qa.QA_WORKER_USER,
  );
  await fillCredInput(
    page,
    { placeholders: ['Enter your password', 'Your password'], types: ['password'], nameAttrs: ['password'] },
    qa.QA_WORKER_PASS,
  );
  await clickLoginSubmit(page, /^Log in$/i);
  await page.waitForURL(/\/me/, { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function loginManager(page, qa) {
  await page.goto(`${BASE}/login?role=management`, { waitUntil: 'networkidle' });
  await waitBackdropClear(page);
  await page.getByRole('button', { name: /^Manager$/i }).click({ force: true }).catch(() => {});
  await waitBackdropClear(page);
  await fillCredInput(
    page,
    {
      placeholders: ['Enter your email', 'Login ID', 'Manager email', 'Email'],
      types: ['email', 'text'],
      nameAttrs: ['email', 'login', 'managerEmail'],
    },
    qa.QA_OTHER_ROLES_EMAIL,
  );
  await fillCredInput(
    page,
    { placeholders: ['Enter your password', 'Your password'], types: ['password'], nameAttrs: ['password'] },
    qa.QA_OTHER_ROLES_PASS,
  );
  await clickLoginSubmit(page, /^Log in$/i);
  await page.waitForURL(/\/(manage|me|site)/, { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function loginAdmin(page, qa) {
  await page.goto(`${BASE}/login?role=admin`, { waitUntil: 'networkidle' });
  await waitBackdropClear(page);
  await fillCredInput(
    page,
    { placeholders: ['Enter your email', 'Email'], types: ['email', 'text'], nameAttrs: ['email'] },
    qa.QA_ADMIN_EMAIL,
  );
  await fillCredInput(
    page,
    { placeholders: ['Enter your password', 'Your password'], types: ['password'], nameAttrs: ['password'] },
    qa.QA_ADMIN_PASS,
  );
  await clickLoginSubmit(page, /^Log in$/i);
  await page.waitForURL(/\/admin/, { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function loginClient(page, qa) {
  await page.goto(`${BASE}/progress/client/login`, { waitUntil: 'networkidle' });
  await waitBackdropClear(page);
  await fillCredInput(
    page,
    { placeholders: ['The name AKK set up for you', 'Name'], types: ['text'], nameAttrs: ['name'] },
    qa.QA_EXPORTONLY_USER,
  );
  await fillCredInput(
    page,
    { placeholders: ['Your password', 'Password'], types: ['password'], nameAttrs: ['password'] },
    qa.QA_EXPORTONLY_PASS,
  );
  await clickLoginSubmit(page, /Sign in/i);
  await page.waitForURL(/\/progress\/client/, { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function gotoReady(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
}

async function signOutIfPossible(page) {
  try {
    const btn = page.getByRole('button', { name: /Sign out/i }).first();
    if (await btn.isVisible({ timeout: 1500 })) {
      await btn.click({ force: true });
      const confirm = page.getByRole('button', { name: /^Confirm$/i });
      if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
        await confirm.click({ force: true });
      }
      await page.waitForTimeout(600);
    }
  } catch {
    /* ignore */
  }
  await clearSession(page);
}

async function employeeShots(page, qa) {
  await clearSession(page);
  await loginEmployee(page, qa);

  for (const width of [1366, 375]) {
    await setViewport(page, width);
    await gotoReady(page, '/me');
    await shot(page, `employee-home-${width}`);
    if (width === 1366) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await shot(page, `employee-home-${width}-scroll`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await gotoReady(page, '/timesheet/shifts');
    await shot(page, `employee-shifts-${width}`);
    await gotoReady(page, '/timesheet/leave/history');
    await shot(page, `employee-leave-${width}`);
    await gotoReady(page, '/materials/request');
    await shot(page, `employee-materials-request-${width}`);
    await gotoReady(page, '/progress/submit');
    await shot(page, `employee-submit-${width}`);
    await gotoReady(page, '/account');
    await shot(page, `employee-account-${width}`);
  }

  await setViewport(page, 375);
  await gotoReady(page, '/me?app=1');
  await shot(page, 'employee-home-375-app');
  await gotoReady(page, '/timesheet/shifts?app=1');
  await shot(page, 'employee-shifts-375-app');

  console.log('SHOTS READY: employee');
}

async function managerShots(page, qa) {
  await signOutIfPossible(page);
  await loginManager(page, qa);
  for (const width of [1366, 375]) {
    await setViewport(page, width);
    await gotoReady(page, '/manage');
    await shot(page, `manager-home-${width}`);
    await gotoReady(page, '/timesheet/manage');
    await shot(page, `manager-timesheet-${width}`);
    await gotoReady(page, '/materials/manage');
    await shot(page, `manager-materials-${width}`);
    await gotoReady(page, '/progress/review');
    await shot(page, `manager-review-${width}`);
  }
  console.log('SHOTS READY: manager');
}

async function adminShots(page, qa) {
  await signOutIfPossible(page);
  await loginAdmin(page, qa);
  for (const width of [1366, 375]) {
    await setViewport(page, width);
    await gotoReady(page, '/admin');
    await shot(page, `admin-home-${width}`);
    await gotoReady(page, '/timesheet/admin');
    await shot(page, `admin-timesheet-${width}`);
    await gotoReady(page, '/materials/admin');
    await shot(page, `admin-materials-${width}`);
    await gotoReady(page, '/progress/admin');
    await shot(page, `admin-progress-${width}`);
  }
  console.log('SHOTS READY: admin');
}

async function clientShots(page, qa) {
  await signOutIfPossible(page);
  await loginClient(page, qa);
  for (const width of [1366, 375]) {
    await setViewport(page, width);
    await gotoReady(page, '/progress/client');
    await shot(page, `client-packages-${width}`);
    await gotoReady(page, '/progress/client?tab=reports');
    await shot(page, `client-reports-${width}`);
  }
  await setViewport(page, 375);
  await gotoReady(page, '/progress/client?app=1');
  await shot(page, 'client-packages-375-app');
  console.log('SHOTS READY: client');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const qa = loadQa();
  const only = process.argv[2] || 'all';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    if (only === 'all' || only === 'employee') await employeeShots(page, qa);
    if (only === 'all' || only === 'manager') await managerShots(page, qa);
    if (only === 'all' || only === 'admin') await adminShots(page, qa);
    if (only === 'all' || only === 'client') await clientShots(page, qa);
    const n = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length;
    console.log(`SHOTS READY — ${n} pngs in qa-shots/`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
