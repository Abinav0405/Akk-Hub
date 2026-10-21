/**
 * Managers & supervisors — Timesheet Manager ManagerLogin.jsx (same UI: Manager / Supervisor
 * toggle, website glass sheet, app screen). Manager = email + password; supervisor = ID.
 * App: Face ID / fingerprint unlock of a credential saved only after a password login
 * (separate secure-store item per role).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Lock, User, Users } from 'lucide-react';
import { toast } from 'sonner';
import LoginForm from '@/ui/auth/LoginForm';
import ManagementRoleToggle from '@/ui/auth/ManagementRoleToggle';
import BiometricPrompt from '@/ui/biometric/BiometricPrompt';
import { isAppUI, useSheetLayout } from '@/core/platform';
import { useLanguage } from '@/core/i18n';
import {
    consumeSessionExpiredMessage,
    markFreshRoleSession,
    parseLoginError,
    persistRoleSession,
    signInManager,
    signInSupervisor,
} from '@/core/auth/timesheetSession';
import { getBiometricCopy, getPortalBiometricPrefs } from '@/core/auth/biometric';
import { usePortalBiometricLogin } from '@/core/auth/usePortalBiometricLogin';
import { finishHubLogin } from '@/pages/login/finishLogin';

function initialManagementRole(search) {
    const params = new URLSearchParams(search);
    if (params.get('as') === 'supervisor') return 'supervisor';
    // Home quick unlock: prefer the role that already has biometrics enrolled.
    const quick = params.get('quick');
    if (quick === 'face' || quick === 'fingerprint') {
        if (getPortalBiometricPrefs('manager').enabled) return 'manager';
        if (getPortalBiometricPrefs('supervisor').enabled) return 'supervisor';
    }
    return 'manager';
}

export default function ManagementLogin() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const appUI = isAppUI();
    const sheetLayout = useSheetLayout();
    const [role, setRole] = useState(() => initialManagementRole(location.search));
    const [email, setEmail] = useState('');
    const [supervisorId, setSupervisorId] = useState('');
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

    const completeManagerLogin = useCallback(
        (m, pw) => {
            const profile = { managerName: m.name, managerEmail: m.email };
            persistRoleSession('manager', m.session_token, profile);
            markFreshRoleSession('manager', m.session_token, profile);
            finishHubLogin({
                navigate,
                location,
                role: 'manager',
                name: m.name,
                connect: { id: m.email, email: m.email, password: pw },
            });
        },
        [navigate, location],
    );

    const completeSupervisorLogin = useCallback(
        (s, pw) => {
            const profile = { supervisorName: s.name, supervisorId: s.supervisor_id, supervisorSiteId: s.site_id };
            persistRoleSession('supervisor', s.session_token, profile);
            markFreshRoleSession('supervisor', s.session_token, profile);
            finishHubLogin({
                navigate,
                location,
                role: 'supervisor',
                name: s.name,
                connect: { id: s.supervisor_id, password: pw },
            });
        },
        [navigate, location],
    );

    const isManager = role === 'manager';

    const signInWithCreds = useCallback(
        async ({ loginId, password: pw }) => {
            if (role === 'manager') {
                const result = await signInManager({ email: loginId, password: pw });
                if (!result.ok) return { ok: false, error: result.error };
                return { ok: true, manager: result.manager };
            }
            const result = await signInSupervisor({ supervisorId: loginId, password: pw });
            if (!result.ok) return { ok: false, error: result.error };
            return { ok: true, supervisor: result.supervisor };
        },
        [role],
    );

    const onUnlocked = useCallback(
        (creds, result) => {
            if (result?.manager) completeManagerLogin(result.manager, creds.password);
            else if (result?.supervisor) completeSupervisorLogin(result.supervisor, creds.password);
        },
        [completeManagerLogin, completeSupervisorLogin],
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
        role: isManager ? 'manager' : 'supervisor',
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

    const selectRole = (next) => {
        if (next === role) return;
        setRole(next);
        setEmail('');
        setSupervisorId('');
        setPassword('');
        setFormError('');
        const params = new URLSearchParams(location.search);
        params.set('role', 'management');
        if (next === 'supervisor') params.set('as', 'supervisor');
        else params.delete('as');
        window.history.replaceState(window.history.state, '', `${location.pathname}?${params.toString()}`);
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setFormError('');
        try {
            if (isManager) {
                if (!email.trim() || !password.trim()) {
                    reportError('Please enter both Email and Password');
                    return;
                }
                const result = await signInManager({ email, password });
                if (!result.ok) {
                    reportError(result.error);
                    return;
                }
                const m = result.manager;
                afterPasswordSuccess({
                    loginId: m.email,
                    displayName: m.name,
                    password,
                    finish: () => completeManagerLogin(m, password),
                });
                return;
            }
            if (!supervisorId.trim() || !password.trim()) {
                reportError('Please enter both Supervisor ID and Password');
                return;
            }
            const result = await signInSupervisor({ supervisorId, password });
            if (!result.ok) {
                reportError(result.error);
                return;
            }
            const s = result.supervisor;
            afterPasswordSuccess({
                loginId: s.supervisor_id,
                displayName: s.name,
                password,
                finish: () => completeSupervisorLogin(s, password),
            });
        } catch (error) {
            console.error('Login error:', error);
            reportError(parseLoginError(error));
        } finally {
            setIsLoading(false);
        }
    };

    const passwordField = {
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
    };

    return (
        <>
            <LoginForm
                variant={appUI ? 'app' : 'glass'}
                theme="green"
                title={isManager ? t('login.manager') : t('login.supervisor')}
                description={isManager ? t('login.managerHint') : t('login.supervisorHint')}
                backTo="/"
                backLabel={appUI ? t('common.back') : t('common.backHome')}
                submitLabel={t('common.logIn')}
                submitIcon={isManager ? Briefcase : Users}
                isLoading={isLoading}
                isSubmitDisabled={isManager ? !email.trim() || !password.trim() : !supervisorId.trim() || !password.trim()}
                onSubmit={handleLogin}
                sheetOpen={sheetOpen}
                onSheetExitComplete={runPendingFinish}
                onRequestClose={() => dismissSheetThen(() => navigate('/'))}
                formError={formError}
                notice={notice}
                extraContent={<ManagementRoleToggle value={role} onChange={selectRole} />}
                fields={
                    isManager
                        ? [
                              {
                                  id: 'email',
                                  label: t('login.email'),
                                  icon: User,
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
                              passwordField,
                          ]
                        : [
                              {
                                  id: 'supervisorId',
                                  label: t('login.supervisorId'),
                                  icon: User,
                                  value: supervisorId,
                                  onChange: (e) => {
                                      setSupervisorId(e.target.value);
                                      if (formError) setFormError('');
                                  },
                                  placeholder: t('login.supervisorIdPlaceholder'),
                                  autoFocus: !showBioShortcut,
                                  autoComplete: 'username',
                              },
                              passwordField,
                          ]
                }
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
                                {t('hub.login.bioWith', { name: getBiometricCopy(savedBioMode).name })}
                            </button>
                        )}
                        <p className="text-center text-xs text-slate-500">{t('hub.login.forgotContactAdmin')}</p>
                    </>
                }
            />
            <BiometricPrompt {...promptProps} />
        </>
    );
}
