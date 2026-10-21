/**
 * Admin — Timesheet Manager AdminLogin.jsx (same UI and password-reset dialog).
 * Supabase Auth on the Timesheet project.
 * App: Face ID / fingerprint unlock of a credential saved only after a password login.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lock, Mail, Shield } from 'lucide-react';
import { toast } from 'sonner';
import LoginForm from '@/ui/auth/LoginForm';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import BiometricPrompt from '@/ui/biometric/BiometricPrompt';
import { isAppUI, useSheetLayout } from '@/core/platform';
import { useLanguage } from '@/core/i18n';
import {
    consumeSessionExpiredMessage,
    getAdminProfile,
    parseLoginError,
    requestAdminPasswordReset,
    signInAdmin,
} from '@/core/auth/timesheetSession';
import { getBiometricCopy } from '@/core/auth/biometric';
import { usePortalBiometricLogin } from '@/core/auth/usePortalBiometricLogin';
import { finishHubLogin } from '@/pages/login/finishLogin';

export default function AdminLogin() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const appUI = isAppUI();
    const sheetLayout = useSheetLayout();
    const [email, setEmail] = useState(() => getAdminProfile().email || '');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showForgot, setShowForgot] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(true);
    const pendingFinishRef = useRef(null);
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');
    const reportError = (message) => {
        if (appUI) setFormError(message);
        else toast.error(message);
    };

    const completeAdminLogin = useCallback(
        (admin, pw) => {
            finishHubLogin({
                navigate,
                location,
                role: 'admin',
                name: admin.name,
                connect: { id: admin.email, email: admin.email, password: pw },
            });
        },
        [navigate, location],
    );

    const signInWithCreds = useCallback(async ({ loginId, password: pw }) => {
        const result = await signInAdmin({ email: loginId, password: pw });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, admin: result.admin };
    }, []);

    const onUnlocked = useCallback(
        (creds, result) => {
            if (result?.admin) completeAdminLogin(result.admin, creds.password);
        },
        [completeAdminLogin],
    );

    const {
        showBioShortcut,
        savedBioMode,
        BioIcon,
        startBiometricLogin,
        afterPasswordSuccess,
        promptProps,
        bioAttemptsRef,
    } = usePortalBiometricLogin({
        role: 'admin',
        signInWithCreds,
        onUnlocked,
        setNotice,
    });

    useEffect(() => {
        const expired = consumeSessionExpiredMessage();
        if (!expired) return;
        if (appUI) setNotice(expired);
        else toast.info(expired);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const runPendingFinish = () => {
        const fn = pendingFinishRef.current;
        pendingFinishRef.current = null;
        fn?.();
    };
    const dismissSheetThen = (fn) => {
        pendingFinishRef.current = fn;
        if (!sheetLayout || appUI) {
            runPendingFinish();
            return;
        }
        window.setTimeout(() => setSheetOpen(false), 80);
    };
    useEffect(() => {
        if (sheetOpen) return undefined;
        const timer = window.setTimeout(runPendingFinish, 700);
        return () => window.clearTimeout(timer);
    }, [sheetOpen]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setFormError('');
        try {
            if (!email.trim() || !password.trim()) {
                reportError('Please enter both email and password');
                return;
            }
            const result = await signInAdmin({ email, password });
            if (!result.ok) {
                reportError(result.cause ? parseLoginError(result.cause, result.error) : result.error);
                return;
            }
            afterPasswordSuccess({
                loginId: result.admin.email,
                displayName: result.admin.name,
                password,
                finish: () => completeAdminLogin(result.admin, password),
            });
        } catch (error) {
            console.error('Login error:', error);
            reportError(parseLoginError(error));
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        if (!resetEmail.trim()) {
            toast.error('Enter your admin email address');
            return;
        }
        setIsResetting(true);
        try {
            await requestAdminPasswordReset(resetEmail);
            toast.success('Password reset email sent. Check your inbox.');
            setShowForgot(false);
        } catch (error) {
            toast.error(parseLoginError(error, 'Could not send reset email. Try again.'));
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <>
            <LoginForm
                variant={appUI ? 'app' : 'glass'}
                theme="slate"
                title={t('login.admin')}
                description={t('login.adminHint')}
                backTo="/"
                backLabel={appUI ? t('common.back') : t('common.backHome')}
                submitLabel={t('common.logIn')}
                submitIcon={Shield}
                isLoading={isLoading}
                isSubmitDisabled={!email.trim() || !password.trim()}
                onSubmit={handleLogin}
                sheetOpen={sheetOpen}
                onSheetExitComplete={runPendingFinish}
                onRequestClose={() => dismissSheetThen(() => navigate('/'))}
                formError={formError}
                notice={notice}
                fields={[
                    {
                        id: 'email',
                        label: t('login.email'),
                        icon: Mail,
                        type: 'email',
                        value: email,
                        onChange: (e) => {
                            setEmail(e.target.value);
                            if (formError) setFormError('');
                        },
                        placeholder: t('login.emailPlaceholder'),
                        autoFocus: !showBioShortcut,
                        autoComplete: 'username',
                    },
                    {
                        id: 'password',
                        label: t('login.password'),
                        icon: Lock,
                        type: 'password',
                        value: password,
                        onChange: (e) => {
                            setPassword(e.target.value);
                            if (formError) setFormError('');
                        },
                        placeholder: t('login.passwordPlaceholder'),
                        autoComplete: 'current-password',
                    },
                ]}
                footer={
                    <>
                        {showBioShortcut && (
                            <button
                                type="button"
                                onClick={() => {
                                    bioAttemptsRef.current = 0;
                                    void startBiometricLogin(savedBioMode);
                                }}
                                className="mx-auto mb-3 flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium text-[#007aff] active:opacity-60"
                            >
                                <BioIcon className="h-5 w-5" strokeWidth={1.75} />
                                {t('hub.login.bioWith', { name: getBiometricCopy(savedBioMode).name })}
                            </button>
                        )}
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => {
                                    setResetEmail(email);
                                    setShowForgot(true);
                                }}
                                className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900"
                            >
                                {t('hub.login.forgotPassword')}
                            </button>
                        </div>
                    </>
                }
            />

            <BiometricPrompt {...promptProps} />

            <Dialog open={showForgot} onOpenChange={setShowForgot}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('hub.login.resetTitle')}</DialogTitle>
                        <DialogDescription>{t('hub.login.resetHint')}</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                        <Input
                            type="email"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder="Admin email"
                            aria-label="Admin email"
                            autoComplete="email"
                            inputMode="email"
                            required
                        />
                        <Button type="submit" className="w-full bg-slate-800 hover:bg-slate-900" disabled={isResetting}>
                            {isResetting ? t('hub.login.sending') : t('hub.login.sendReset')}
                        </Button>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
