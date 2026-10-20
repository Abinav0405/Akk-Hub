/**
 * Managers & supervisors — Timesheet Manager ManagerLogin.jsx (same UI: Manager / Supervisor
 * toggle, website glass sheet, app screen). Manager = email + password; supervisor = ID.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Lock, User, Users } from 'lucide-react';
import { toast } from 'sonner';
import LoginForm from '@/ui/auth/LoginForm';
import ManagementRoleToggle from '@/ui/auth/ManagementRoleToggle';
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
import { finishHubLogin } from '@/pages/login/finishLogin';

export default function ManagementLogin() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const appUI = isAppUI();
    const sheetLayout = useSheetLayout();
    const [role, setRole] = useState(() =>
        new URLSearchParams(location.search).get('as') === 'supervisor' ? 'supervisor' : 'manager',
    );
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

    const isManager = role === 'manager';

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
                const profile = { managerName: m.name, managerEmail: m.email };
                persistRoleSession('manager', m.session_token, profile);
                markFreshRoleSession('manager', m.session_token, profile);
                finishHubLogin({ navigate, location, role: 'manager', name: m.name, connect: { id: m.email, email: m.email, password } });
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
            const profile = { supervisorName: s.name, supervisorId: s.supervisor_id, supervisorSiteId: s.site_id };
            persistRoleSession('supervisor', s.session_token, profile);
            markFreshRoleSession('supervisor', s.session_token, profile);
            finishHubLogin({ navigate, location, role: 'supervisor', name: s.name });
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
                              autoFocus: true,
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
                              autoFocus: true,
                              autoComplete: 'username',
                          },
                          passwordField,
                      ]
            }
            footer={<p className="text-center text-xs text-slate-500">{t('hub.login.forgotContactAdmin')}</p>}
        />
    );
}
