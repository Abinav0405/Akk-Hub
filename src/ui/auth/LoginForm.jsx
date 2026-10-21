import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/ui/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import PasswordInput from '@/ui/auth/PasswordInput';
import { AlertCircle, ArrowLeft, ChevronLeft, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useSheetLayout } from '@/core/platform';
import { sheetSpring, easeSoft } from '@/core/platform';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { useLanguage } from '@/core/i18n';

const FROM_HOME_KEY = 'akk-from-home';

/** Website portal themes — crimson brand for employees; portal tones for the rest. */
const THEMES = {
    orange: {
        header: 'bg-[#a50f2d] text-white',
        description: 'text-rose-100',
        inputFocus: 'focus:border-[#a50f2d] focus:ring-[#a50f2d]/20',
        button: 'bg-[#a50f2d] hover:bg-[#8c0d26] text-white',
        logoWrap: 'bg-[#fdf2f4]',
        focusRing: 'focus-visible:ring-[#a50f2d]/30',
        appShadow: 'shadow-rose-500/20',
        waveFill: '#fff8f3',
    },
    slate: {
        header: 'bg-slate-700 text-white',
        description: 'text-slate-200',
        inputFocus: 'focus:border-slate-700 focus:ring-slate-700/20',
        button: 'bg-slate-800 hover:bg-slate-900 text-white',
        logoWrap: 'bg-slate-100',
        focusRing: 'focus-visible:ring-slate-700/30',
        appShadow: 'shadow-slate-700/20',
        waveFill: '#fff8f3',
    },
    green: {
        header: 'bg-emerald-600 text-white',
        description: 'text-emerald-100',
        inputFocus: 'focus:border-emerald-600 focus:ring-emerald-600/20',
        button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        logoWrap: 'bg-emerald-50',
        focusRing: 'focus-visible:ring-emerald-600/30',
        appShadow: 'shadow-emerald-600/20',
        waveFill: '#f0fdf4',
    },
    /* Clients (Export Only) — AKK bronze. */
    bronze: {
        header: 'bg-[#a8651e] text-white',
        description: 'text-amber-100',
        inputFocus: 'focus:border-[#a8651e] focus:ring-[#a8651e]/20',
        button: 'bg-[#a8651e] hover:bg-[#8f541a] text-white',
        logoWrap: 'bg-amber-50',
        focusRing: 'focus-visible:ring-[#a8651e]/30',
        appShadow: 'shadow-amber-700/20',
        waveFill: '#fffaf3',
    },
};

function consumeFromHome() {
    try {
        const v = sessionStorage.getItem(FROM_HOME_KEY);
        sessionStorage.removeItem(FROM_HOME_KEY);
        return v === 'login';
    } catch {
        return false;
    }
}

function LoginFields({
    fields,
    t,
    onSubmit,
    children,
    isLoading,
    isSubmitDisabled,
    submitLabel,
    SubmitIcon,
    glass,
    app,
}) {
    const { t: translate } = useLanguage();
    return (
        <form
            onSubmit={onSubmit}
            className={cn(glass ? 'lx-fields' : app ? 'space-y-4' : 'space-y-5')}
        >
            {fields.map((field) => {
                const Icon = field.icon;
                const InputComponent = field.type === 'password' ? PasswordInput : Input;
                return (
                    <div key={field.id} className={cn(glass ? 'lx-field' : 'space-y-2')}>
                        <label
                            htmlFor={field.id}
                            className={glass ? undefined : 'flex items-center gap-2 text-sm font-medium text-slate-700'}
                        >
                            {Icon && <Icon className={glass ? undefined : 'h-4 w-4 text-slate-400'} aria-hidden />}
                            {field.label}
                        </label>
                        <InputComponent
                            id={field.id}
                            type={field.type === 'password' ? undefined : field.type || 'text'}
                            value={field.value}
                            onChange={field.onChange}
                            required={field.required !== false}
                            placeholder={field.placeholder}
                            autoFocus={field.autoFocus}
                            inputMode={field.inputMode}
                            autoComplete={field.autoComplete}
                            name={field.id}
                            className={cn(
                                glass && 'lx-input h-[46px] rounded-xl border-slate-200/90 bg-white text-[15px]',
                                glass && t.focusRing,
                                app && 'h-14 rounded-2xl border-slate-200 bg-white text-[16px] shadow-sm',
                                !glass && !app && 'h-12 text-base border-slate-200',
                                !glass && t.inputFocus
                            )}
                        />
                    </div>
                );
            })}

            {children}

            {glass ? (
                <button
                    type="submit"
                    disabled={isLoading || isSubmitDisabled}
                    className="lx-submit"
                    aria-busy={isLoading || undefined}
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                            {translate('common.loggingIn')}
                        </>
                    ) : (
                        <>
                            {SubmitIcon && <SubmitIcon className="h-5 w-5" aria-hidden />}
                            {submitLabel}
                        </>
                    )}
                </button>
            ) : (
                <Button
                    type="submit"
                    disabled={isLoading || isSubmitDisabled}
                    className={cn(
                        'w-full text-base font-medium',
                        app && 'mt-2 h-14 rounded-full text-[17px] font-semibold shadow-md',
                        app && t.appShadow,
                        !app && 'h-12 font-semibold shadow-lg hover:shadow-xl transition-all duration-200',
                        t.button
                    )}
                    size="lg"
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            {translate('common.loggingIn')}
                        </>
                    ) : (
                        <>
                            {SubmitIcon && <SubmitIcon className="mr-2 h-5 w-5" />}
                            {submitLabel}
                        </>
                    )}
                </Button>
            )}
        </form>
    );
}

const NATIVE_TONE = { orange: undefined, slate: 'admin', green: 'manage', bronze: 'client' };

function NativePasswordField({ id, className, ...props }) {
    const [visible, setVisible] = useState(false);
    return (
        <div className="relative">
            <Input {...props} id={id} type={visible ? 'text' : 'password'} className={cn(className, 'pr-12')} />
            <button
                type="button"
                className="akk-password-toggle absolute top-1/2 -translate-y-1/2"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                aria-controls={id}
            >
                {visible ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
            </button>
        </div>
    );
}

/**
 * Native app login. Same fields (ids / names / autocomplete) and the same submit handler as the
 * website; adds inline errors, a session notice, a pinned keyboard-aware action and a guard
 * against double submits.
 */
function NativeLoginScreen({
    theme,
    title,
    description,
    backTo,
    backLabel = 'Back to portals',
    logoUrl,
    fields,
    submitLabel,
    isLoading,
    isSubmitDisabled,
    onSubmit,
    footer,
    extraContent,
    stepLabel,
    children,
    formError,
    notice,
}) {
    const tone = NATIVE_TONE[theme];
    const formId = useId();
    const errorId = `${formId}-error`;
    const pendingRef = useRef(false);

    const handleSubmit = (event) => {
        if (isLoading || pendingRef.current) {
            event.preventDefault();
            return;
        }
        pendingRef.current = true;
        Promise.resolve(onSubmit?.(event)).finally(() => {
            pendingRef.current = false;
        });
    };

    const [fromHome] = useState(() => (typeof window !== 'undefined' ? consumeFromHome() : false));

    return (
        <div className={cn('akk-login akk-login--v2', fromHome && 'is-from-home')} data-tone={tone}>
            <header className="akk-login__hero">
                <div className="akk-login__bar">
                    {backTo ? (
                        <Link to={backTo} className="akk-login__back" aria-label={backLabel}>
                            <ChevronLeft className="h-6 w-6" aria-hidden />
                        </Link>
                    ) : (
                        <span />
                    )}
                    <div className="akk-login__lang">
                        <LanguageSwitcher />
                    </div>
                </div>
                <div className="akk-login__brand">
                    <span className="akk-login__badge">
                        <img src={logoUrl} alt="AKK Engineering" className="akk-login__logo" />
                    </span>
                    <h1 className="akk-login__title">{title}</h1>
                    {description ? <p className="akk-login__subtitle">{description}</p> : null}
                    {stepLabel ? <p className="akk-login__step">{stepLabel}</p> : null}
                </div>
            </header>

            <form id={formId} onSubmit={handleSubmit} noValidate className="akk-login__sheet">
                <div className="akk-login__scroll">
                    {notice && !formError ? (
                        <div className="akk-banner mb-4" role="status">
                            <Info aria-hidden />
                            <span>{notice}</span>
                        </div>
                    ) : null}

                    {extraContent ? <div className="akk-login__extra">{extraContent}</div> : null}

                    <div className="akk-login__form">
                        {fields.map((field, index) => {
                            const isPassword = field.type === 'password';
                            const isLast = index === fields.length - 1;
                            const shared = {
                                id: field.id,
                                name: field.id,
                                value: field.value,
                                onChange: field.onChange,
                                required: field.required !== false,
                                placeholder: field.placeholder,
                                autoFocus: field.autoFocus,
                                autoComplete: field.autoComplete,
                                enterKeyHint: isLast ? 'go' : 'next',
                                'aria-invalid': formError ? true : undefined,
                                'aria-describedby': formError ? errorId : undefined,
                            };
                            return (
                                <div key={field.id}>
                                    <label htmlFor={field.id} className="akk-login__label">
                                        {field.label}
                                    </label>
                                    {isPassword ? (
                                        <NativePasswordField {...shared} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                                    ) : (
                                        <Input
                                            {...shared}
                                            type={field.type || 'text'}
                                            inputMode={field.inputMode || (field.type === 'email' ? 'email' : undefined)}
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {children}

                    {formError ? (
                        <div id={errorId} className="akk-banner mt-4" data-tone="danger" role="alert">
                            <AlertCircle aria-hidden />
                            <span>{formError}</span>
                        </div>
                    ) : null}

                    {footer ? <div className="akk-login__footer">{footer}</div> : null}
                </div>

                <div className="akk-login__actions">
                    <button type="submit" className="akk-cta" data-tone={tone} disabled={isLoading || isSubmitDisabled} aria-busy={isLoading || undefined}>
                        {isLoading ? (
                            <>
                                <Loader2 className="akk-delayed-spinner h-5 w-5" aria-hidden />
                                Signing in…
                            </>
                        ) : (
                            submitLabel
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default function LoginForm({
    theme = 'orange',
    variant = 'classic',
    title,
    description,
    backTo = '/',
    backLabel = 'Back to Home',
    logoUrl = '/Akk-logo.png',
    fields = [],
    submitLabel,
    submitIcon: SubmitIcon,
    isLoading = false,
    isSubmitDisabled = false,
    onSubmit,
    footer,
    extraContent,
    stepLabel,
    children,
    sheetOpen = true,
    onSheetExitComplete,
    onRequestClose,
    formError,
    notice,
}) {
    const t = THEMES[theme] || THEMES.orange;
    const glass = variant === 'glass';
    const app = variant === 'app';
    const sheetLayout = useSheetLayout();
    const reduceMotion = useReducedMotion();
    const exitSent = useRef(false);
    const [fromHome] = useState(() => (typeof window !== 'undefined' ? consumeFromHome() : false));

    const sheetTransition = reduceMotion ? { duration: 0 } : sheetSpring;
    const fadeTransition = reduceMotion ? { duration: 0 } : easeSoft;

    const notifySheetExit = () => {
        if (exitSent.current) return;
        exitSent.current = true;
        onSheetExitComplete?.();
    };

    useEffect(() => {
        if (sheetOpen) {
            exitSent.current = false;
            return;
        }
        // Native / reduced-motion: no sheet exit to wait on — continue straight away.
        if (!sheetLayout || app || reduceMotion) {
            notifySheetExit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sheetOpen, sheetLayout, app, reduceMotion]);

    const handleBack = (event) => {
        if (!sheetLayout || !onRequestClose) return;
        event.preventDefault();
        onRequestClose();
    };

    const fieldBlock = (
        <LoginFields
            fields={fields}
            t={t}
            onSubmit={onSubmit}
            isLoading={isLoading}
            isSubmitDisabled={isSubmitDisabled}
            submitLabel={submitLabel}
            SubmitIcon={SubmitIcon}
            glass={glass}
            app={app}
        >
            {children}
        </LoginFields>
    );

    if (app) {
        return (
            <NativeLoginScreen
                theme={theme}
                title={title}
                description={description}
                backTo={backTo}
                backLabel={backLabel}
                logoUrl={logoUrl}
                fields={fields}
                submitLabel={submitLabel}
                isLoading={isLoading}
                isSubmitDisabled={isSubmitDisabled}
                onSubmit={onSubmit}
                footer={footer}
                extraContent={extraContent}
                stepLabel={stepLabel}
                formError={formError}
                notice={notice}
            >
                {children}
            </NativeLoginScreen>
        );
    }

    if (glass) {
        const enterClass = reduceMotion
            ? ''
            : fromHome
              ? 'lx-stage--from-home'
              : 'lx-stage--enter';

        const formColumn = (
            <div className="lx-form">
                <div className="lx-form__mobile-mark md:hidden" aria-hidden>
                    <img src={logoUrl} alt="" />
                </div>
                <div className="lx-form__head">
                    <h1 className="lx-form__title">{title}</h1>
                    {description ? <p className="lx-form__desc">{description}</p> : null}
                    {stepLabel ? <p className="lx-form__step">{stepLabel}</p> : null}
                </div>

                {formError ? (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>{formError}</span>
                    </div>
                ) : null}

                {notice && !formError ? (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700" role="status">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>{notice}</span>
                    </div>
                ) : null}

                {extraContent}
                {fieldBlock}
                {footer ? <div className="lx-footer">{footer}</div> : null}
            </div>
        );

        const brandPanel = (
            <aside className="lx-brand" aria-hidden={false}>
                <div className="lx-brand__glow lx-brand__glow--a" aria-hidden />
                <div className="lx-brand__glow lx-brand__glow--b" aria-hidden />
                <div className="lx-brand__inner">
                    <div className="lx-brand__logo-wrap">
                        <img src={logoUrl} alt="AKK Engineering" className="lx-brand__logo" />
                    </div>
                    <p className="lx-brand__company">AKK ENGINEERING PTE. LTD.</p>
                    <p className="lx-brand__line">
                        AKK Hub — timesheets, materials &amp; site progress
                    </p>
                    <p className="lx-brand__addr">
                        15 Kaki Bukit Rd 4, #01-50
                        <br />
                        Singapore 417808
                    </p>
                </div>
            </aside>
        );

        return (
            <div className={cn('lx-stage', enterClass)} data-theme={theme}>
                <div className="lx-atmos" aria-hidden />

                <header className="lx-nav">
                    <div className="lx-nav__bar">
                        <div className="lx-nav__brand">
                            <img src={logoUrl} alt="" className="lx-nav__mark" />
                            <div className="min-w-0">
                                <p className="lx-nav__name">AKK ENGINEERING PTE. LTD.</p>
                                <p className="lx-nav__meta">15 Kaki Bukit Rd 4, #01-50, Singapore 417808</p>
                            </div>
                        </div>
                        <div className="lx-nav__end">
                            <LanguageSwitcher />
                        </div>
                    </div>
                </header>

                <AnimatePresence>
                    {sheetLayout && sheetOpen ? (
                        <motion.button
                            key="login-sheet-scrim"
                            type="button"
                            aria-label="Close login"
                            className="lx-scrim"
                            tabIndex={-1}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={fadeTransition}
                            onClick={onRequestClose}
                        />
                    ) : null}
                </AnimatePresence>

                <main className={cn('lx-main', sheetLayout && 'max-md:contents')}>
                    <Link to={backTo} onClick={handleBack} className="lx-back">
                        <ArrowLeft className="h-4 w-4" aria-hidden />
                        {backLabel}
                    </Link>

                    {sheetLayout ? (
                        <motion.div
                            initial={reduceMotion ? false : { y: '100%' }}
                            animate={{ y: sheetOpen ? 0 : '100%' }}
                            transition={sheetTransition}
                            onAnimationComplete={() => {
                                if (!sheetOpen) notifySheetExit();
                            }}
                            className={cn(
                                'lx-shell lx-shell--sheet',
                                'fixed inset-x-0 bottom-0 z-40 flex max-h-[min(92dvh,100%)] flex-col md:static md:inset-auto md:z-auto md:max-h-none md:flex-none'
                            )}
                        >
                            <div className="lx-sheet-handle" aria-hidden />
                            <Link to={backTo} onClick={handleBack} className="lx-sheet-back">
                                <ArrowLeft className="h-4 w-4" aria-hidden />
                                {backLabel}
                            </Link>
                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                                {formColumn}
                            </div>
                        </motion.div>
                    ) : (
                        <div className="lx-shell">
                            {formColumn}
                            {brandPanel}
                        </div>
                    )}
                </main>

                <footer className="lx-foot">
                    © {new Date().getFullYear()} AKK ENGINEERING PTE. LTD. — AKK Hub
                </footer>
            </div>
        );
    }

    return (
        <div className="app-shell flex items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md"
            >
                <Link to={backTo}>
                    <Button variant="ghost" className="mb-6 text-slate-600 hover:text-slate-900">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        {backLabel}
                    </Button>
                </Link>

                {extraContent}

                <Card className="border-0 shadow-2xl overflow-hidden">
                    <div className={`${t.header} p-8`}>
                        <div className="flex items-center justify-center mb-6">
                            <div className="w-20 h-20 bg-white/10 rounded-3xl flex items-center justify-center backdrop-blur-sm overflow-hidden">
                                <img
                                    src={logoUrl}
                                    alt="AKK Engineering Logo"
                                    className="h-full w-full object-cover drop-shadow-lg"
                                />
                            </div>
                        </div>
                        <CardHeader className="p-0 text-center">
                            <CardTitle className="text-3xl font-bold mb-2">{title}</CardTitle>
                            <CardDescription className={`${t.description} text-base`}>
                                {description}
                            </CardDescription>
                            {stepLabel && (
                                <p className="mt-3 text-sm font-medium text-white/90">{stepLabel}</p>
                            )}
                        </CardHeader>
                    </div>

                    <CardContent className="p-8">
                        {fieldBlock}
                        {footer && (
                            <div className="mt-6 pt-6 border-t border-slate-200">{footer}</div>
                        )}
                    </CardContent>
                </Card>

                <div className="mt-8 text-center">
                    <p className="text-sm text-slate-600 font-semibold" style={{ fontFamily: 'Calibri, sans-serif' }}>
                        AKK ENGINEERING PTE. LTD.
                    </p>
                    <p className="text-xs text-slate-500 mt-1" style={{ fontFamily: 'Aptos Narrow, Aptos, sans-serif' }}>
                        15 Kaki Bukit Rd 4, #01-50, Singapore 417808
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
