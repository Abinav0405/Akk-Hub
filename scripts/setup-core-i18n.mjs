import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(HUB, 'src', 'core-i18n');
fs.mkdirSync(outDir, { recursive: true });

let i18n = fs.readFileSync(path.join(HUB, 'src', 'modules', 'timesheet', 'lib', 'i18n.js'), 'utf8');

// If already a re-export stub, restore from core/i18n.js or fail clearly
if (i18n.includes("from '@/core-i18n'")) {
  i18n = fs.readFileSync(path.join(HUB, 'src', 'core', 'i18n.js'), 'utf8');
  if (!i18n.includes("from 'react'")) {
    throw new Error('No usable i18n source — timesheet stubbed and core/i18n missing body');
  }
  // core version uses bare akk.language — normalize when we rewrite key below
  if (!i18n.includes("import { storageKey }")) {
    i18n = i18n.replace(
      /^import React/,
      "import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';\nimport { storageKey } from '@/core/storage';\n// keep original react import line patched below\nimport React",
    );
    // simpler: prepend storage import if missing
    i18n = `import { storageKey } from '@/core/storage';\n${i18n}`;
  }
}

i18n = i18n.replace(
  /export const LANGUAGE_STORAGE_KEY = [^;]+;/,
  "export const LANGUAGE_STORAGE_KEY = storageKey('hub', 'language');",
);

if (!i18n.includes("import { storageKey }")) {
  i18n = `import { storageKey } from '@/core/storage';\n${i18n}`;
}

const hubTables = {
  en: {
    'hub.brand': 'AKK Hub',
    'hub.tagline': 'Timesheets, materials, and site progress in one place.',
    'hub.nav.home': 'Home',
    'hub.nav.login': 'Sign in',
    'hub.nav.account': 'Account',
    'hub.nav.notifications': 'Notifications',
    'hub.nav.verify': 'Verify photo',
    'hub.nav.timesheet': 'Timesheet',
    'hub.nav.materials': 'Materials',
    'hub.nav.progress': 'Site progress',
    'hub.login.title': 'Sign in to AKK Hub',
    'hub.login.hint': 'Use your work account for the module you need.',
    'hub.account.title': 'My account',
    'hub.account.hint': 'Update your display name or password.',
    'hub.theme.light': 'Light',
    'hub.theme.dark': 'Dark',
    'hub.theme.system': 'System',
  },
  zh: {
    'hub.brand': 'AKK Hub',
    'hub.tagline': '工时、物料与工地进度，一站完成。',
    'hub.nav.home': '首页',
    'hub.nav.login': '登录',
    'hub.nav.account': '账户',
    'hub.nav.notifications': '通知',
    'hub.nav.verify': '核验照片',
    'hub.nav.timesheet': '工时',
    'hub.nav.materials': '物料',
    'hub.nav.progress': '工地进度',
    'hub.login.title': '登录 AKK Hub',
    'hub.login.hint': '使用您需要的模块账号登录。',
    'hub.account.title': '我的账户',
    'hub.account.hint': '更新显示名称或密码。',
    'hub.theme.light': '浅色',
    'hub.theme.dark': '深色',
    'hub.theme.system': '系统',
  },
  ta: {
    'hub.brand': 'AKK Hub',
    'hub.tagline': 'நேர அட்டவணை, பொருட்கள் மற்றும் தள முன்னேற்றம் ஒரே இடத்தில்.',
    'hub.nav.home': 'முகப்பு',
    'hub.nav.login': 'உள்நுழை',
    'hub.nav.account': 'கணக்கு',
    'hub.nav.notifications': 'அறிவிப்புகள்',
    'hub.nav.verify': 'புகைப்படம் சரிபார்',
    'hub.nav.timesheet': 'நேர அட்டவணை',
    'hub.nav.materials': 'பொருட்கள்',
    'hub.nav.progress': 'தள முன்னேற்றம்',
    'hub.login.title': 'AKK Hub-இல் உள்நுழையவும்',
    'hub.login.hint': 'தேவையான தொகுதிக்கான பணி கணக்கைப் பயன்படுத்தவும்.',
    'hub.account.title': 'என் கணக்கு',
    'hub.account.hint': 'காட்சி பெயர் அல்லது கடவுச்சொல்லைப் புதுப்பிக்கவும்.',
    'hub.theme.light': 'வெளிச்சம்',
    'hub.theme.dark': 'இருள்',
    'hub.theme.system': 'கணினி',
  },
  ms: {
    'hub.brand': 'AKK Hub',
    'hub.tagline': 'Timesheet, bahan dan kemajuan tapak dalam satu tempat.',
    'hub.nav.home': 'Laman utama',
    'hub.nav.login': 'Log masuk',
    'hub.nav.account': 'Akaun',
    'hub.nav.notifications': 'Pemberitahuan',
    'hub.nav.verify': 'Sahkan foto',
    'hub.nav.timesheet': 'Timesheet',
    'hub.nav.materials': 'Bahan',
    'hub.nav.progress': 'Kemajuan tapak',
    'hub.login.title': 'Log masuk ke AKK Hub',
    'hub.login.hint': 'Gunakan akaun kerja untuk modul yang anda perlukan.',
    'hub.account.title': 'Akaun saya',
    'hub.account.hint': 'Kemas kini nama paparan atau kata laluan.',
    'hub.theme.light': 'Cerah',
    'hub.theme.dark': 'Gelap',
    'hub.theme.system': 'Sistem',
  },
  hi: {
    'hub.brand': 'AKK Hub',
    'hub.tagline': 'टाइमशीट, सामग्री और साइट प्रगति एक जगह।',
    'hub.nav.home': 'होम',
    'hub.nav.login': 'साइन इन',
    'hub.nav.account': 'खाता',
    'hub.nav.notifications': 'सूचनाएँ',
    'hub.nav.verify': 'फ़ोटो सत्यापित करें',
    'hub.nav.timesheet': 'टाइमशीट',
    'hub.nav.materials': 'सामग्री',
    'hub.nav.progress': 'साइट प्रगति',
    'hub.login.title': 'AKK Hub में साइन इन करें',
    'hub.login.hint': 'जिस मॉड्यूल की आवश्यकता हो उसके कार्य खाते से लॉग इन करें।',
    'hub.account.title': 'मेरा खाता',
    'hub.account.hint': 'प्रदर्शन नाम या पासवर्ड अपडेट करें।',
    'hub.theme.light': 'हल्का',
    'hub.theme.dark': 'गहरा',
    'hub.theme.system': 'सिस्टम',
  },
};

function insertAfterInTable(src, tableStart, hubObj) {
  if (src.includes("'hub.brand'")) {
    // already inserted for this file once — only insert missing per table
  }
  const start = src.indexOf(tableStart);
  if (start < 0) throw new Error(`table ${tableStart} missing`);
  const after = src.indexOf("    'common.language':", start);
  if (after < 0) throw new Error(`common.language missing in ${tableStart}`);
  // skip if hub keys already follow this common.language
  const peek = src.slice(after, after + 200);
  if (peek.includes("'hub.brand'")) return src;
  const lineEnd = src.indexOf('\n', after);
  const entry = Object.entries(hubObj)
    .map(([k, v]) => `    '${k}': ${JSON.stringify(v)},`)
    .join('\n');
  return `${src.slice(0, lineEnd + 1)}${entry}\n${src.slice(lineEnd + 1)}`;
}

for (const [lang, table] of Object.entries(hubTables)) {
  i18n = insertAfterInTable(i18n, `const ${lang} = {`, table);
}

fs.writeFileSync(path.join(outDir, 'i18n.js'), i18n, 'utf8');

fs.writeFileSync(
  path.join(outDir, 'index.js'),
  `export * from './i18n';\nexport { default as LanguageSwitcher } from './LanguageSwitcher';\n`,
  'utf8',
);

fs.writeFileSync(
  path.join(outDir, 'LanguageSwitcher.jsx'),
  `import { LANGUAGES, useLanguage } from '@/core-i18n/i18n';
import { cn } from '@/modules/timesheet/lib/utils';

const SCRIPT_FONT = "'Nirmala UI', 'Noto Sans Tamil', 'Noto Sans Devanagari', 'Segoe UI', sans-serif";

export default function LanguageSwitcher({ className }) {
    const { language, setLanguage, t } = useLanguage();

    return (
        <div
            className={cn(
                'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-slate-100 p-0.5 sm:p-1',
                className
            )}
            role="radiogroup"
            aria-label={t('common.language')}
            style={{ fontFamily: SCRIPT_FONT }}
        >
            {LANGUAGES.map((lang) => {
                const active = language === lang.id;
                return (
                    <button
                        key={lang.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setLanguage(lang.id)}
                        className={cn(
                            'shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold leading-none tracking-tight transition-colors sm:px-2.5 sm:text-[13px]',
                            active
                                ? 'bg-[#10233f] text-white shadow-sm'
                                : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                        )}
                    >
                        {lang.label}
                    </button>
                );
            })}
        </div>
    );
}
`,
  'utf8',
);

// Re-export stub from timesheet lib (canonical now core-i18n)
fs.writeFileSync(
  path.join(HUB, 'src', 'modules', 'timesheet', 'lib', 'i18n.js'),
  `// Wave 2 I18N-THEME: canonical location is @/core-i18n\nexport * from '@/core-i18n';\n`,
  'utf8',
);

const zhTitle = (i18n.match(/const zh = \{[\s\S]*?'home\.title': '([^']+)'/) || [])[1];
console.log('wrote', path.join(outDir, 'i18n.js'), 'bytes', Buffer.byteLength(i18n, 'utf8'));
console.log('zh home.title =', zhTitle);
console.log('has hub.brand', i18n.includes("'hub.brand'"));
