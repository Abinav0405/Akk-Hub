/**
 * Clients (Export Only) sign-in — the 4th portal. Same layout as the other portals
 * (website glass sheet / app screen) in the client bronze tone.
 *
 * Clients don't have AKK Timesheet accounts: this signs in to the Site Progress project's
 * Export Only login (core/auth/progress/exporterSession) and opens /progress/client.
 * App: Face ID / fingerprint unlock of a credential saved only after a password login.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Lock, User } from 'lucide-react';
import { toast } from 'sonner';
import LoginForm from '@/ui/auth/LoginForm';
import BiometricPrompt from '@/ui/biometric/BiometricPrompt';
import { isAppUI, useSheetLayout } from '@/core/platform';
import {
    consumeExporterSessionExpiredMessage,
    isExporterAuthenticated,
    signInExporter,
    verifyExporterSession,
} from '@/core/auth/progress/exporterSession';
import { getBiometricCopy } from '@/core/auth/biometric';
import { usePortalBiometricLogin } from '@/core/auth/usePortalBiometricLogin';
import { startLoginCurtain } from '@/core/auth/loginCurtain';
import { paths } from '@/app/paths';

export default function ClientLogin() {
    const navigate = useNavigate();
    const appUI = isAppUI();
    const sheetLayout = useSheetLayout();
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(true);
    const pendingFinishRef = useRef(null);
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');
    const reportError = (message) => {
        if (appUI) setFormError(message);
        else toast.error(message);
    };

    const completeClientLogin = useCallback(
        (profileName) => {
            startLoginCurtain({ variant: 'welcome', name: profileName || name });
            navigate(paths.progress.client, { replace: true });
        },
        [navigate, name],
    );

    const signInWithCreds = useCallback(async ({ loginId, password: pw }) => {
        const result = await signInExporter({ displayName: loginId, password: pw });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, profile: result.profile };
    }, []);

    const onUnlocked = useCallback(
        (_creds, result) => {
            if (result?.profile) completeClientLogin(result.profile.name);
        },
        [completeClientLogin],
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
        role: 'exporter',
        signInWithCreds,
        onUnlocked,
        setNotice,
    });

    // Already signed in as a client on this device → straight to the portal.
    useEffect(() => {
        // Warm the portal screen while the client types.
        const warm = window.setTimeout(() => import('@/pages/client/ClientPortal'), 800);
        const expired = consumeExporterSessionExpiredMessage();
        if (expired) {
            if (appUI) setNotice(expired);
            else toast.info(expired);
        }
        let cancelled = false;
        if (isExporterAuthenticated()) {
            verifyExporterSession().then((session) => {
                if (!cancelled && session) navigate(paths.progress.client, { replace: true });
            });
        }
        return () => {
            cancelled = true;
            window.clearTimeout(warm);
        };
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
        if (isLoading) return;
        setFormError('');
        if (!name.trim() || !password) {
            reportError('Please enter your name and password');
            return;
        }
        setIsLoading(true);
        try {
            const result = await signInExporter({ displayName: name, password });
            if (!result.ok) {
                reportError(result.error || 'Invalid name or password');
                return;
            }
            afterPasswordSuccess({
                loginId: result.profile?.name || name.trim(),
                displayName: result.profile?.name || name.trim(),
                password,
                finish: () => completeClientLogin(result.profile?.name || name),
            });
        } catch (error) {
            console.error('Client login error:', error);
            reportError('Could not reach the server. Check your connection and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <LoginForm
                variant={appUI ? 'app' : 'glass'}
                theme="bronze"
                title="Client portal"
                description="Approved site reports, JSRs and claims from AKK Engineering"
                backTo="/"
                backLabel={appUI ? 'Back' : 'Back to Home'}
                submitLabel="Sign in"
                submitIcon={Building2}
                isLoading={isLoading}
                isSubmitDisabled={!name.trim() || !password}
                onSubmit={handleLogin}
                sheetOpen={sheetOpen}
                onSheetExitComplete={runPendingFinish}
                onRequestClose={() => dismissSheetThen(() => navigate('/'))}
                formError={formError}
                notice={notice}
                fields={[
                    {
                        id: 'clientName',
                        label: 'Name',
                        icon: User,
                        value: name,
                        onChange: (e) => {
                            setName(e.target.value);
                            if (formError) setFormError('');
                        },
                        placeholder: 'The name AKK set up for you',
                        autoFocus: !showBioShortcut,
                        autoComplete: 'username',
                    },
                    {
                        id: 'password',
                        label: 'Password',
                        icon: Lock,
                        type: 'password',
                        value: password,
                        onChange: (e) => {
                            setPassword(e.target.value);
                            if (formError) setFormError('');
                        },
                        placeholder: 'Your password',
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
                                className="mx-auto mb-3 flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold text-[var(--g-brand)] active:opacity-60"
                            >
                                <BioIcon className="h-5 w-5" strokeWidth={1.75} />
                                {`Log in with ${getBiometricCopy(savedBioMode).name}`}
                            </button>
                        )}
                        <p className="text-center text-xs text-slate-500">
                            No account yet? Ask your AKK Engineering contact to set up client access.
                        </p>
                    </>
                }
            />
            <BiometricPrompt {...promptProps} />
        </>
    );
}
