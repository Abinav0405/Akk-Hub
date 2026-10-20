import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { LANGUAGES, useLanguage } from '@/core-i18n/i18n';
import { cn } from '@/modules/timesheet/lib/utils';

const SCRIPT_FONT = "'Nirmala UI', 'Noto Sans Tamil', 'Noto Sans Devanagari', 'Segoe UI', sans-serif";

/**
 * Compact language control — current code + menu.
 * Use variant="onDark" on crimson / dark headers (AppHome).
 */
export default function LanguageSwitcher({ className, variant = 'light' }) {
    const { language, setLanguage, t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState(null);
    const rootRef = useRef(null);
    const menuRef = useRef(null);
    const listId = useId();
    const onDark = variant === 'onDark';
    const current = LANGUAGES.find((lang) => lang.id === language) || LANGUAGES[0];

    useLayoutEffect(() => {
        if (!open || !rootRef.current) {
            setMenuStyle(null);
            return undefined;
        }

        const place = () => {
            const rect = rootRef.current.getBoundingClientRect();
            const width = 168;
            const gap = 6;
            const left = Math.min(
                Math.max(8, rect.right - width),
                window.innerWidth - width - 8
            );
            setMenuStyle({
                position: 'fixed',
                top: rect.bottom + gap,
                left,
                width,
                zIndex: 80,
            });
        };

        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
            const inTrigger = rootRef.current?.contains(event.target);
            const inMenu = menuRef.current?.contains(event.target);
            if (!inTrigger && !inMenu) setOpen(false);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const menu =
        open && menuStyle
            ? createPortal(
                  <ul
                      ref={menuRef}
                      id={listId}
                      role="listbox"
                      aria-label={t('common.language')}
                      className="akk-lang__menu overflow-hidden rounded-2xl bg-white py-1.5 text-slate-900 shadow-[0_18px_40px_-18px_rgb(16_35_63_/_0.55)] ring-1 ring-slate-200/90"
                      style={{ ...menuStyle, fontFamily: SCRIPT_FONT }}
                  >
                      {LANGUAGES.map((lang) => {
                          const active = language === lang.id;
                          return (
                              <li key={lang.id} role="presentation">
                                  <button
                                      type="button"
                                      role="option"
                                      aria-selected={active}
                                      onClick={() => {
                                          setLanguage(lang.id);
                                          setOpen(false);
                                      }}
                                      className={cn(
                                          'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold leading-none transition-colors',
                                          active
                                              ? 'bg-[#a50f2d]/[0.08] text-[#a50f2d]'
                                              : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'
                                      )}
                                  >
                                      <span
                                          className={cn(
                                              'inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 text-[11px] font-bold tracking-wide',
                                              active ? 'bg-[#a50f2d] text-white' : 'bg-slate-100 text-slate-600'
                                          )}
                                      >
                                          {lang.shortLabel}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate">{lang.label}</span>
                                      {active ? (
                                          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
                                      ) : null}
                                  </button>
                              </li>
                          );
                      })}
                  </ul>,
                  document.body
              )
            : null;

    return (
        <div
            ref={rootRef}
            className={cn('akk-lang relative inline-flex shrink-0', className)}
            data-variant={variant}
        >
            <button
                type="button"
                className={cn(
                    'akk-lang__trigger inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold leading-none tracking-wide transition-[background,box-shadow,transform] active:scale-[0.97]',
                    onDark
                        ? 'bg-white text-[#a50f2d] shadow-[0_6px_16px_-10px_rgb(0_0_0_/_0.55)]'
                        : 'bg-slate-100 text-slate-800 ring-1 ring-slate-200/80 hover:bg-white'
                )}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-label={t('common.language')}
                onClick={() => setOpen((value) => !value)}
                style={{ fontFamily: SCRIPT_FONT }}
            >
                <span aria-hidden="true">{current.shortLabel}</span>
                <ChevronDown
                    className={cn(
                        'h-3.5 w-3.5 shrink-0 opacity-70 transition-transform duration-150',
                        open && 'rotate-180'
                    )}
                    aria-hidden
                />
            </button>
            {menu}
        </div>
    );
}
