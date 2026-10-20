import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/ui/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import PasswordInput from '@/ui/auth/PasswordInput';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { NativeNavBar } from '@/ui/auth/AkkChrome';
import { motion } from 'framer-motion';
import { useSheetLayout } from '@/core/platform';
import { sheetSpring, easeSoft } from '@/core/platform';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { useLanguage } from '@/core/i18n';

const THEMES = {
    orange: {
        header: 'bg-[#dc6b2f] text-white',
        description: 'text-orange-100',
        inputFocus: 'focus:border-[#dc6b2f] focus:ring-[#dc6b2f]/20',
        button: 'bg-[#dc6b2f] hover:bg-[#c85a23] text-white',
        logoWrap: 'bg-orange-50',
        focusRing: 'focus-visible:ring-[#dc6b2f]/30',
        appShadow: 'shadow-orange-500/20',
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

function AuthBackdrop({ accent = 'amber' }) {
    const orbClass =
        accent === 'green' ? 'home-orb home-orb--emerald'
            : accent === 'slate' ? 'home-orb home-orb--slate'
                : 'home-orb home-orb--amber';
    return (
        <div className="home-backdrop" aria-hidden="true">
            <div className={orbClass} />
            <div className="home-orb home-orb--teal" />
            <div className="home-backdrop__grid" />
        </div>
    );
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
        <form onSubmit={onSubmit} className={cn(app ? 'space-y-4' : glass ? 'space-y-4' : 'space-y-5')}>
            {fields.map((field) => {
                const Icon = field.icon;
                const InputComponent = field.type === 'password' ? PasswordInput : Input;
                return (
                    <div key={field.id} className="space-y-2">
                        <label
                            htmlFor={field.id}
                            className="flex items-center gap-2 text-sm font-medium text-slate-700"
                        >
                            {Icon && <Icon className="h-4 w-4 text-slate-400" />}
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
                                'h-12 text-base transition-colors',
                                glass && 'rounded-xl border-slate-200/90 bg-white/80',
                                glass && t.focusRing,
                                app && 'h-14 rounded-2xl border-slate-200 bg-white text-[16px] shadow-sm',
                                !glass && !app && 'border-slate-200',
                                t.inputFocus
                            )}
                        />
                    </div>
                );
            })}

            {children}

            <Button
                type="submit"
                disabled={isLoading || isSubmitDisabled}
                className={cn(
                    'w-full text-base font-medium',
                    glass && 'h-11 rounded-xl shadow-sm',
                    app && 'mt-2 h-14 rounded-full text-[17px] font-semibold shadow-md',
                    app && t.appShadow,
                    !glass && !app && 'h-12 font-semibold shadow-lg hover:shadow-xl transition-all duration-200',
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

    return (
        <div className="akk-login" data-tone={tone}>
            <NativeNavBar plain backTo={backTo} backLabel={backLabel}>
                <div className="flex max-w-full justify-end overflow-hidden">
                    <LanguageSwitcher />
                </div>
            </NativeNavBar>

            <form id={formId} onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
                <div className="akk-login__scroll">
                    <div className="akk-login__brand">
                        <img src={logoUrl} alt="AKK Engineering" className="akk-login__logo" />
                        <h1 className="akk-login__title">{title}</h1>
                        {description ? <p className="akk-login__subtitle">{description}</p> : null}
                        {stepLabel ? <p className="akk-login__step">{stepLabel}</p> : null}
                    </div>

                    {notice && !formError ? (
                        <div className="akk-banner mb-4" role="status">
                            <Info aria-hidden />
                            <span>{notice}</span>
                        </div>
                    ) : null}

                    {extraContent}

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
                                        <NativePasswordField
                                            {...shared}
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                        />
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
                    <button
                        type="submit"
                        className="akk-cta"
                        data-tone={tone}
                        disabled={isLoading || isSubmitDisabled}
                        aria-busy={isLoading || undefined}
                    >
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
    const exitSent = useRef(false);

    const sheetTransition = sheetSpring;

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
        // The native screen has no sheet to animate out, so continue straight away.
        if (!sheetLayout || app) {
            notifySheetExit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sheetOpen, sheetLayout, app]);

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
        // Website-only glass chrome. Keep header in normal flow (not fixed/absolute
        // `.home-nav`) so it never covers the card; lock the stage to one viewport
        // so the page cannot scroll into empty space below. Native `app` variant is untouched.
        return (
            <div className="home-stage relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden">
                <AuthBackdrop accent={theme === 'green' ? 'green' : theme === 'slate' ? 'slate' : 'amber'} />

                <header className="relative z-50 shrink-0 border-b border-gray-200/50 bg-white/70 px-safe backdrop-blur-md pt-[max(0.65rem,env(safe-area-inset-top,0px))]">
                    <div className="mx-auto flex max-w-5xl justify-end px-1 pb-1">
                        <LanguageSwitcher />
                    </div>
                    <div className="mx-auto flex max-w-5xl flex-col items-center pb-2.5 text-center sm:pb-3">
                        <div className="flex items-center justify-center gap-2.5">
                            <img
                                src={logoUrl}
                                alt="AKK Engineering"
                                className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-0.5 shadow-sm ring-1 ring-black/5 sm:h-9 sm:w-9"
                            />
                            <p className="text-[15px] font-semibold tracking-tight text-slate-900 sm:text-base">
                                AKK ENGINEERING PTE. LTD.
                            </p>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-slate-500 sm:text-xs">
                            15 Kaki Bukit Rd 4, #01-50, Singapore 417808
                        </p>
                    </div>
                </header>

                {sheetLayout ? (
                <motion.button
                    type="button"
                    aria-label="Close login"
                    className={cn('fixed inset-0 z-30 bg-slate-900/25', !sheetOpen && 'pointer-events-none')}
                    tabIndex={-1}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: sheetOpen ? 1 : 0 }}
                    transition={easeSoft}
                    onClick={onRequestClose}
                />
                ) : null}

                {/* Desktop: never scroll the main stage (justify-center + overflow-y
                    auto caused empty-space scrollbars on taller employee/manager cards).
                    Back link is out of flow; card is capped to remaining height. */}
                <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col justify-center overflow-hidden px-safe py-2 max-md:contents">
                    <Link
                        to={backTo}
                        onClick={handleBack}
                        className="absolute left-[max(1rem,env(safe-area-inset-left,0px))] top-2 z-20 hidden items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 md:inline-flex"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {backLabel}
                    </Link>

                    <motion.div
                        initial={sheetLayout ? { y: '100%' } : { opacity: 0, y: 14 }}
                        animate={
                            sheetLayout
                                ? { y: sheetOpen ? 0 : '100%' }
                                : { opacity: 1, y: 0 }
                        }
                        transition={sheetLayout ? sheetTransition : easeSoft}
                        onAnimationComplete={() => {
                            if (sheetLayout && !sheetOpen) notifySheetExit();
                        }}
                        className={cn(
                            // Desktop: no overflow scroll — taller portals (employee/manager toggles)
                            // must fit via compact padding; scrolling here looked like empty void.
                            'w-full min-h-0 max-h-full md:overflow-hidden',
                            'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:flex max-md:max-h-[min(92dvh,100%)] max-md:flex-col max-md:rounded-t-[1.75rem] max-md:border max-md:border-slate-200/80 max-md:bg-white max-md:shadow-[0_-16px_48px_rgb(15_23_42/0.16)] max-md:pb-[max(1rem,env(safe-area-inset-bottom,0px))]'
                        )}
                    >
                        <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 md:hidden" aria-hidden />
                        <div className="px-4 pb-2 md:hidden">
                            <Link
                                to={backTo}
                                onClick={handleBack}
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                {backLabel}
                            </Link>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:overflow-visible">
                        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl max-md:border-0 max-md:bg-transparent max-md:shadow-none md:grid md:grid-cols-[1.15fr_0.85fr]">
                            <div className="px-6 py-3.5 sm:px-7 sm:py-4 lg:px-8 lg:py-5">
                                <div className="mb-3 flex flex-col items-center text-center lg:mb-4 lg:items-start lg:text-left">
                                    <div className={cn('mb-3 flex h-14 w-14 items-center justify-center rounded-3xl sm:h-16 sm:w-16 md:hidden', t.logoWrap)}>
                                        <img
                                            src={logoUrl}
                                            alt=""
                                            className="h-11 w-11 rounded-2xl bg-white object-contain p-0.5 shadow-sm ring-1 ring-black/5 sm:h-12 sm:w-12"
                                        />
                                    </div>
                                    <h1 className="text-[1.45rem] font-semibold tracking-tight text-slate-900 sm:text-[1.65rem]">
                                        {title}
                                    </h1>
                                    {description && (
                                        <p className="mt-1 text-[15px] text-slate-500">{description}</p>
                                    )}
                                    {stepLabel && (
                                        <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                                            {stepLabel}
                                        </p>
                                    )}
                                </div>

                                {extraContent}
                                {fieldBlock}
                                {footer && (
                                    <div className="mt-3 space-y-1 border-t border-slate-200/80 pt-3">
                                        {footer}
                                    </div>
                                )}
                            </div>

                            <div className="relative hidden overflow-hidden border-l border-slate-200/70 md:flex md:flex-col md:items-center md:justify-center md:px-8 md:py-5">
                                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                                    <div className={cn(
                                        '!left-[-6rem] !top-[-8rem] !h-64 !w-64',
                                        theme === 'green' ? 'home-orb home-orb--emerald'
                                            : theme === 'slate' ? 'home-orb home-orb--slate'
                                                : 'home-orb home-orb--amber'
                                    )} />
                                    <div className="home-orb home-orb--teal !bottom-[-8rem] !right-[-6rem] !h-56 !w-56" />
                                </div>
                                <div className="relative z-10 flex flex-col items-center text-center">
                                    <div className={cn('mb-4 flex h-24 w-24 items-center justify-center rounded-3xl', t.logoWrap)}>
                                        <img
                                            src={logoUrl}
                                            alt="AKK Engineering"
                                            className="h-16 w-16 rounded-2xl bg-white object-contain p-1 shadow-sm ring-1 ring-black/5"
                                        />
                                    </div>
                                    <p className="text-[15px] font-semibold tracking-tight text-slate-900">
                                        AKK ENGINEERING PTE. LTD.
                                    </p>
                                    <p className="mt-2 max-w-[14rem] text-sm leading-relaxed text-slate-500">
                                        AKK Hub — timesheets, materials &amp; site progress
                                    </p>
                                    <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
                                        15 Kaki Bukit Rd 4, #01-50
                                        <br />
                                        Singapore 417808
                                    </p>
                                </div>
                            </div>
                        </div>
                        </div>
                    </motion.div>
                </main>

                <footer className="relative z-10 hidden shrink-0 px-safe py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] md:block">
                    <p className="text-center text-[11px] tracking-wide text-slate-400 sm:text-xs">
                        © {new Date().getFullYear()} AKK ENGINEERING PTE. LTD. — AKK Hub
                    </p>
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
