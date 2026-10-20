/**
 * App only — one-tap login from Home's Face ID / Fingerprint buttons
 * (ported from Timesheet WorkerQuickLogin.jsx).
 *
 * /login/quick?method=face
 *   Phone remembered → camera face scan → server matches it against the remembered
 *   employee's enrolled face (face_device_login) → hub. No password typed.
 * /login/quick?method=fingerprint
 *   Fingerprint saved → /login opens the fingerprint prompt (unlocks the saved ID + password).
 * Nothing saved yet → setup: Foreign/Local, ID, password → server face check → remember this
 *   phone (+ save the fingerprint) → hub. Next time it's one tap.
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Fingerprint, Lock, ScanFace, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { isAppUI, isNativeApp } from '@/core/platform';
import LoginForm from '@/ui/auth/LoginForm';
import WorkerTypeToggle from '@/ui/auth/WorkerTypeToggle';
import { NativeNavBar } from '@/ui/auth/AkkChrome';
import { NativeLoadingScreen } from '@/ui/native/NativeStates';
import FaceMatchPrompt from '@/ui/biometric/FaceMatchPrompt';
import {
    faceDeviceLogin,
    getLastWorkerType,
    markFreshRoleSession,
    parseLoginError,
    persistRoleSession,
    registerLoginDevice,
    rememberLastWorker,
    revokeLoginDevice,
    signInWorker,
} from '@/core/auth/timesheetSession';
import {
    clearFaceLoginDevice,
    disableBiometricLogin,
    enableBiometricLogin,
    getBiometricErrorMessage,
    getBiometricPrefs,
    getBiometricSupport,
    getFaceLoginDevicePrefs,
    getFaceLoginDeviceToken,
    saveFaceLoginDevice,
} from '@/core/auth/biometric';
import { enrollFaceChallenge, faceChallengeFor, verifyFaceChallenge } from '@/core/auth/workerFaceLogin';
import { finishHubLogin } from '@/pages/login/finishLogin';
import { useLanguage } from '@/core/i18n';

function faceDeviceError(error) {
    const msg = String(error?.message || '');
    if (msg.includes('device_not_recognized'))
        return { code: 'forgotten', text: 'This phone is no longer remembered. Sign in with your password to set up Face ID again.' };
    if (msg.includes('face_not_enabled'))
        return { code: 'disabled', text: "Face ID isn't turned on for your account. Ask your admin, or use your password." };
    if (msg.includes('worker_inactive'))
        return { code: 'inactive', text: 'This account is no longer active. Contact your supervisor or admin.' };
    return { code: 'other', text: parseLoginError(error, 'Face ID not recognized') };
}

export default function QuickLogin() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useLanguage();
    const method = new URLSearchParams(location.search).get('method') === 'fingerprint' ? 'fingerprint' : 'face';
    const copy =
        method === 'face'
            ? { setupTitle: t('hub.login.quick.faceSetupTitle'), setupHint: t('hub.login.quick.faceSetupHint') }
            : { setupTitle: t('hub.login.quick.fpSetupTitle'), setupHint: t('hub.login.quick.fpSetupHint') };

    const [screen, setScreen] = useState('checking'); // 'checking' | 'remembered' | 'setup'
    const [remembered, setRemembered] = useState(null);
    const deviceTokenRef = useRef(null);
    const [face, setFace] = useState({ open: false });
    const loginRef = useRef(null);
    const afterFaceCloseRef = useRef(null);

    const [workerType, setWorkerType] = useState(getLastWorkerType());
    const [workerId, setWorkerId] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');

    useEffect(() => {
        if (!isNativeApp()) {
            // App preview in a browser: no secure store to read — show the setup screen.
            setScreen('setup');
            return undefined;
        }
        let cancelled = false;
        (async () => {
            if (method === 'fingerprint') {
                const support = await getBiometricSupport();
                const prefs = getBiometricPrefs();
                if (cancelled) return;
                if (prefs.enabled && support.available) {
                    navigate(`/login?role=employee&type=${prefs.workerType}&quick=fingerprint`, { replace: true });
                    return;
                }
                if (!support.modes.includes('fingerprint')) {
                    setNotice(t('hub.login.quick.noFingerprint'));
                }
                setScreen('setup');
                return;
            }
            const prefs = getFaceLoginDevicePrefs();
            const token = await getFaceLoginDeviceToken();
            if (cancelled) return;
            if (prefs && token) {
                deviceTokenRef.current = token;
                setRemembered(prefs);
                setScreen('remembered');
                setFace({ open: true, mode: 'server' });
            } else {
                setScreen('setup');
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const finishLogin = (curtain = 'face') => {
        const login = loginRef.current;
        if (!login?.token) return;
        const profile = { workerName: login.worker.employee_name, workerId: login.worker.employee_id, workerType: login.type };
        persistRoleSession('worker', login.token, profile);
        markFreshRoleSession('worker', login.token, profile);
        finishHubLogin({
            navigate,
            location,
            role: 'worker',
            name: login.worker.employee_name,
            curtain,
            connect: login.password ? { id: String(login.worker.employee_id), password: login.password } : undefined,
        });
    };

    const goToPassword = (id, type) => {
        rememberLastWorker(id, type);
        navigate(`/login?role=employee&type=${type || workerType}`, { replace: true });
    };

    const closeFace = (then) => {
        afterFaceCloseRef.current = then || null;
        setFace((f) => ({ ...f, open: false }));
    };

    const handleServerFace = async (embedding) => {
        let result;
        try {
            result = await faceDeviceLogin(deviceTokenRef.current, embedding);
        } catch (error) {
            const { code, text } = faceDeviceError(error);
            if (code === 'forgotten' || code === 'inactive') {
                await clearFaceLoginDevice();
                setRemembered(null);
            }
            throw { userMessage: text };
        }
        if (!result?.session_token) throw { userMessage: 'Face ID not recognized' };
        loginRef.current = {
            worker: { employee_id: result.employee_id, employee_name: result.employee_name },
            token: result.session_token,
            type: result.worker_type,
        };
    };

    const forgetThisPhone = async () => {
        await revokeLoginDevice(deviceTokenRef.current);
        await clearFaceLoginDevice();
        await disableBiometricLogin();
        deviceTokenRef.current = null;
        setRemembered(null);
        setFace({ open: false });
        setScreen('setup');
    };

    const rememberThisPhone = async () => {
        const { worker, token, type, password: pw } = loginRef.current;
        const previous = getFaceLoginDevicePrefs();
        if (previous && previous.workerId !== String(worker.employee_id)) {
            await revokeLoginDevice(await getFaceLoginDeviceToken());
            await clearFaceLoginDevice();
        }
        const bio = getBiometricPrefs();
        if (bio.enabled && bio.workerId !== String(worker.employee_id)) await disableBiometricLogin();

        try {
            const deviceToken = await registerLoginDevice(token, `${Capacitor.getPlatform()} app`);
            if (deviceToken) {
                await saveFaceLoginDevice({
                    token: deviceToken,
                    workerId: worker.employee_id,
                    workerType: type,
                    workerName: worker.employee_name,
                });
            }
        } catch (error) {
            console.error('Could not remember this phone for Face ID:', error);
            if (method === 'face') toast.error("Signed in, but this phone couldn't be remembered for Face ID. Try again later.");
        }

        if (method === 'fingerprint') {
            try {
                await enableBiometricLogin({
                    workerId: worker.employee_id,
                    workerType: type,
                    workerName: worker.employee_name,
                    password: pw,
                    mode: 'fingerprint',
                });
            } catch (error) {
                toast.error(getBiometricErrorMessage(error?.code, 'fingerprint'));
            }
        }
    };

    const handleSetupSubmit = async (e) => {
        e.preventDefault();
        setFormError('');
        if (!workerId.trim() || !password) {
            setFormError(t('hub.login.bothIdPassword'));
            return;
        }
        setIsLoading(true);
        try {
            const result = await signInWorker({ workerId, password, workerType });
            if (!result.ok) {
                setFormError(result.error);
                return;
            }
            rememberLastWorker(workerId.trim(), workerType);
            const worker = result.worker;
            let challenge;
            try {
                challenge = faceChallengeFor(worker, workerType, password);
            } catch (error) {
                setFormError(error.message);
                return;
            }
            if (!challenge) {
                loginRef.current = { worker, token: worker.session_token, type: workerType, password };
                if (method === 'face') toast.info("Face ID isn't turned on for your account, so this phone can't sign you in with your face.");
                else await rememberThisPhone();
                finishLogin('welcome');
                return;
            }
            loginRef.current = { worker, token: null, type: workerType, password };
            setFace({ open: true, ...challenge });
        } catch (error) {
            setFormError(parseLoginError(error));
        } finally {
            setIsLoading(false);
        }
    };

    // The browser app-preview can show these screens; website visitors can't use them (they
    // need the phone's secure store), so they get the normal sign-in.
    if (!isAppUI()) return <Navigate to="/login?role=employee" replace />;

    const facePrompt = (
        <FaceMatchPrompt
            open={!!face.open}
            mode={face.mode || 'server'}
            name={face.mode === 'server' ? remembered?.workerName : face.worker?.employee_name}
            storedEmbedding={face.worker?.face_embedding}
            onMatched={
                face.mode === 'server'
                    ? handleServerFace
                    : async (embedding) => {
                          loginRef.current.token = await verifyFaceChallenge(face.challengeId, embedding);
                      }
            }
            onEnrolled={async (embedding) => {
                loginRef.current.token = await enrollFaceChallenge(face, embedding);
            }}
            onUsePassword={() =>
                closeFace(() => {
                    if (face.mode === 'server') goToPassword(remembered?.workerId, remembered?.workerType);
                    else setPassword('');
                })
            }
            onDone={async () => {
                if (face.mode !== 'server') await rememberThisPhone();
                finishLogin('face');
            }}
            onExitComplete={() => {
                const fn = afterFaceCloseRef.current;
                afterFaceCloseRef.current = null;
                fn?.();
            }}
        />
    );

    if (screen === 'checking') return <NativeLoadingScreen label={t('hub.login.gettingReady')} />;

    if (screen === 'remembered' && remembered) {
        return (
            <div className="akk-login akk-quick">
                <NativeNavBar plain backTo="/" backLabel={t('common.back')} />
                <div className="akk-quick__body">
                    <span className="akk-quick__glyph" aria-hidden="true">
                        <ScanFace strokeWidth={1.6} />
                    </span>
                    <p className="akk-quick__eyebrow">Welcome back</p>
                    <h1 className="akk-quick__name">
                        {remembered.workerName || t('hub.login.quick.employeeN', { id: remembered.workerId })}
                    </h1>
                    <p className="akk-quick__meta">
                        ID {remembered.workerId} · {remembered.workerType === 'local' ? 'Local' : 'Foreign'} employee
                    </p>
                    <div className="akk-quick__actions">
                        <button type="button" className="akk-cta" onClick={() => setFace({ open: true, mode: 'server' })}>
                            <ScanFace className="h-5 w-5" aria-hidden /> {t('hub.login.quick.signInFace')}
                        </button>
                        <button
                            type="button"
                            className="akk-home-btn"
                            onClick={() => goToPassword(remembered.workerId, remembered.workerType)}
                        >
                            <Lock className="h-4 w-4" aria-hidden /> {t('hub.login.usePassword')}
                        </button>
                        <button type="button" className="akk-quick__link" onClick={forgetThisPhone}>
                            {t('hub.login.quick.notYou', { name: remembered.workerName?.split(' ')[0] || t('hub.login.quick.you') })}
                        </button>
                    </div>
                </div>
                {facePrompt}
            </div>
        );
    }

    return (
        <>
            <LoginForm
                variant="app"
                theme="orange"
                title={copy.setupTitle}
                description={copy.setupHint}
                backTo="/"
                backLabel={t('common.back')}
                submitLabel={t('hub.login.continue')}
                submitIcon={method === 'face' ? ScanFace : Fingerprint}
                isLoading={isLoading}
                isSubmitDisabled={!workerId.trim() || !password}
                onSubmit={handleSetupSubmit}
                formError={formError}
                notice={notice}
                extraContent={<WorkerTypeToggle value={workerType} onChange={setWorkerType} />}
                fields={[
                    {
                        id: 'workerId',
                        label: t('login.employeeId'),
                        icon: UserCheck,
                        value: workerId,
                        onChange: (e) => {
                            setWorkerId(e.target.value);
                            if (formError) setFormError('');
                        },
                        placeholder: t('login.employeeIdPlaceholder'),
                        autoFocus: true,
                        inputMode: 'text',
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
                    <p className="text-center text-xs text-slate-500">
                        {method === 'face' ? t('hub.login.quick.faceNext') : t('hub.login.quick.fpNext')}
                    </p>
                }
            />
            {facePrompt}
        </>
    );
}
