import { LANGUAGES, useLanguage } from '@/core-i18n/i18n';
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
