/**
 * Employee sign-in — Timesheet Manager WorkerLogin, unchanged rules and the same UI:
 * website = glass sheet (bottom sheet on phones, split card on desktop),
 * app = native sign-in screen with the pinned action.
 *
 * Password → (server face check when the account needs it) → session.
 * App: fingerprint / Face ID unlock of the saved credential, and an offer to turn it on after
 * the first password login. The camera face check works on web and in the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Fingerprint, Lock, ScanFace, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { isAppUI, isNativeApp, useSheetLayout } from '@/core/platform';
import LoginForm from '@/ui/auth/LoginForm';
import WorkerTypeToggle from '@/ui/auth/WorkerTypeToggle';
import BiometricPrompt from '@/ui/biometric/BiometricPrompt';
import FaceMatchPrompt from '@/ui/biometric/FaceMatchPrompt';
import { enrollFaceChallenge, faceChallengeFor, verifyFaceChallenge } from '@/core/auth/workerFaceLogin';
import {
    consumeSessionExpiredMessage,
    getLastWorkerId,
    getLastWorkerType,
    markFreshRoleSession,
    parseLoginError,
    persistRoleSession,
    rememberLastWorker,
    signInWorker,
} from '@/core/auth/timesheetSession';
import {
    MAX_BIOMETRIC_ATTEMPTS,
    disableBiometricLogin,
    enableBiometricLogin,
    getBiometricCopy,
    getBiometricErrorMessage,
    getBiometricPrefs,
    getBiometricSupport,
    markBiometricOfferDeclined,
    setBiometricMode,
    shouldOfferBiometric,
    unlockBiometricCredential,
} from '@/core/auth/biometric';
import { finishHubLogin } from '@/pages/login/finishLogin';
import { useLanguage } from '@/core/i18n';

const TERMINAL_BIO_ERRORS = new Set(['lockout', 'lockout_temporary', 'not_enrolled', 'passcode_not_set', 'unavailable']);
const BIO_CLOSED = { open: false, purpose: 'login', mode: 'fingerprint', status: 'idle', message: undefined, canRetry: true };

export default function EmployeeLogin() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useLanguage();
    const nativeApp = isNativeApp();
    const appUI = isAppUI();
    const sheetLayout = useSheetLayout();
    const [sheetOpen, setSheetOpen] = useState(true);
    const pendingFinishRef = useRef(null);
    /** App: errors and notices are inline; website: toasts (Timesheet behaviour). */
    const reportError = (message) => {
        if (appUI) setFormError(message);
        else toast.error(message);
    };

    const [workerType, setWorkerType] = useState(() => {
        const q = new URLSearchParams(location.search).get('type');
        return q === 'local' || q === 'foreign' ? q : getLastWorkerType();
    });
    const [workerId, setWorkerId] = useState(getLastWorkerId);
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');

    // --- biometric (native) ---
    const [bioSupport, setBioSupport] = useState(null);
    const [bioEnabled, setBioEnabled] = useState(() => getBiometricPrefs().enabled);
    const [bio, setBio] = useState(BIO_CLOSED);
    const bioAttemptsRef = useRef(0);
    const afterBioCloseRef = useRef(null);
    const offerRef = useRef(null);
    const autoStartedRef = useRef(false);

    // --- server face check (camera) ---
    const [face, setFace] = useState({ open: false });
    const faceTokenRef = useRef(null);
    const afterFaceCloseRef = useRef(null);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sheetOpen]);

    const finishWorkerLogin = (worker, sessionToken, type = workerType, curtain = 'welcome', pw) => {
        if (!sessionToken) {
            reportError(t('hub.login.incomplete'));
            return;
        }
        const profile = { workerName: worker.employee_name, workerId: worker.employee_id, workerType: type };
        persistRoleSession('worker', sessionToken, profile);
        markFreshRoleSession('worker', sessionToken, profile);
        finishHubLogin({
            navigate,
            location,
            role: 'worker',
            name: worker.employee_name,
            curtain,
            connect: { id: String(worker.employee_id), password: pw },
        });
    };

    /* ---------------- biometric prompt control ---------------- */

    const closeBio = useCallback((then) => {
        afterBioCloseRef.current = then || null;
        setBio((b) => ({ ...b, open: false }));
    }, []);

    const handleBioExitComplete = () => {
        const fn = afterBioCloseRef.current;
        afterBioCloseRef.current = null;
        setBio(BIO_CLOSED);
        fn?.();
    };

    const handleBioLoginError = (err, mode) => {
        const { code } = err || {};
        const copy = getBiometricCopy(mode);
        if (code === 'fallback') return closeBio();
        if (code === 'invalidated') {
            setBioEnabled(false);
            return closeBio(() => setNotice(getBiometricErrorMessage('invalidated', mode)));
        }
        if (code === 'cancel') {
            setBio((b) => ({ ...b, status: 'idle', canRetry: true, message: getBiometricErrorMessage('cancel', mode) }));
            return;
        }
        if (code === 'failed') {
            bioAttemptsRef.current += 1;
            const exhausted = bioAttemptsRef.current >= MAX_BIOMETRIC_ATTEMPTS;
            setBio((b) => ({
                ...b,
                status: 'failure',
                canRetry: !exhausted,
                message: exhausted ? `${copy.name} didn't recognize you. Use your password to log in.` : copy.failed,
            }));
            return;
        }
        setBio((b) => ({
            ...b,
            status: 'failure',
            canRetry: !TERMINAL_BIO_ERRORS.has(code),
            message: getBiometricErrorMessage(code, mode),
        }));
    };

    /** Biometric unlock → stored credential → normal server login. */
    const startBiometricLogin = async (mode) => {
        const prefs = getBiometricPrefs();
        if (!prefs.enabled) return;
        setWorkerId(prefs.workerId);
        setWorkerType(prefs.workerType);
        setFormError('');
        setBio({ ...BIO_CLOSED, open: true, purpose: 'login', mode, status: 'scanning' });

        let creds;
        try {
            creds = await unlockBiometricCredential({ mode });
        } catch (err) {
            handleBioLoginError(err, mode);
            return;
        }

        setBio((b) => ({ ...b, status: 'processing' }));
        try {
            const result = await signInWorker(creds);
            if (!result.ok) {
                await disableBiometricLogin({ keepDeclined: true });
                setBioEnabled(false);
                setBio((b) => ({
                    ...b,
                    status: 'failure',
                    canRetry: false,
                    message: 'Your saved login no longer works. Log in with your password to turn biometric login back on.',
                }));
                return;
            }
            bioAttemptsRef.current = 0;
            afterBioCloseRef.current = () => continueAfterPassword(result.worker, creds.workerType, creds.password);
            setBio((b) => ({ ...b, status: 'success', message: '' }));
        } catch (error) {
            setBio((b) => ({ ...b, status: 'failure', canRetry: true, message: parseLoginError(error) }));
        }
    };

    const acceptBioOffer = async () => {
        const offer = offerRef.current;
        if (!offer) return;
        const mode = bio.mode;
        setBio((b) => ({ ...b, status: 'scanning', message: 'Confirm to turn it on' }));
        try {
            await enableBiometricLogin({
                workerId: offer.worker.employee_id,
                workerType: offer.workerType,
                workerName: offer.worker.employee_name,
                password: offer.password,
                mode,
            });
            setBioEnabled(true);
            afterBioCloseRef.current = finishOffer;
            setBio((b) => ({ ...b, status: 'success', message: `${getBiometricCopy(mode).name} is on` }));
        } catch (err) {
            const code = err?.code;
            setBio((b) => ({
                ...b,
                status: code === 'cancel' ? 'idle' : 'failure',
                canRetry: !TERMINAL_BIO_ERRORS.has(code),
                message: code === 'cancel' ? '' : getBiometricErrorMessage(code, mode),
            }));
        }
    };

    function finishOffer() {
        const offer = offerRef.current;
        offerRef.current = null;
        if (offer) finishWorkerLogin(offer.worker, offer.token, offer.workerType, 'welcome', offer.password);
    }

    const declineBioOffer = () => {
        if (offerRef.current) markBiometricOfferDeclined(offerRef.current.worker.employee_id);
        closeBio(finishOffer);
    };

    // Detect biometrics once; open the prompt straight away when Home's Fingerprint button sent us.
    useEffect(() => {
        if (!nativeApp) return undefined;
        let cancelled = false;
        getBiometricSupport().then((support) => {
            if (cancelled) return;
            setBioSupport(support);
            const prefs = getBiometricPrefs();
            if (!prefs.enabled) return;
            if (!support.available) {
                if (support.reason === 'not_enrolled') setNotice(getBiometricErrorMessage('not_enrolled', prefs.mode));
                return;
            }
            if (new URLSearchParams(window.location.search).get('quick') !== 'fingerprint') return;
            if (autoStartedRef.current) return;
            autoStartedRef.current = true;
            const mode = support.modes.includes(prefs.mode) ? prefs.mode : support.primary;
            void startBiometricLogin(mode);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Full session in hand: offer phone biometrics once, then open the hub. */
    const afterFullLogin = (worker, token, type, pw, curtain = 'welcome') => {
        const prefs = getBiometricPrefs();
        const alreadyOn = prefs.enabled && prefs.workerId === String(worker.employee_id);
        if (bioSupport?.available && !alreadyOn && shouldOfferBiometric(worker.employee_id)) {
            offerRef.current = { worker, token, password: pw, workerType: type };
            setBio({ ...BIO_CLOSED, open: true, purpose: 'enable', mode: bioSupport.primary, status: 'idle' });
            return 'offer';
        }
        finishWorkerLogin(worker, token, type, curtain, pw);
        return 'done';
    };

    /** Password accepted. Accounts with Face ID get a short-lived challenge instead of a session. */
    const continueAfterPassword = (worker, type, pw) => {
        let challenge;
        try {
            challenge = faceChallengeFor(worker, type, pw);
        } catch (error) {
            reportError(error.message);
            return;
        }
        if (!challenge) {
            afterFullLogin(worker, worker.session_token, type, pw);
            return;
        }
        faceTokenRef.current = null;
        setFace({ open: true, ...challenge });
    };

    const closeFace = (then) => {
        afterFaceCloseRef.current = then || null;
        setFace((f) => ({ ...f, open: false }));
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        if (isLoading) return;
        setFormError('');
        if (!workerId.trim() || !password.trim()) {
            reportError(t('hub.login.bothIdPassword'));
            return;
        }
        setIsLoading(true);
        try {
            const result = await signInWorker({ workerId, password, workerType });
            if (!result.ok) {
                reportError(result.error);
                return;
            }
            rememberLastWorker(workerId.trim(), workerType);
            continueAfterPassword(result.worker, workerType, password);
        } catch (error) {
            console.error('Login error:', error);
            reportError(parseLoginError(error));
        } finally {
            setIsLoading(false);
        }
    };

    /* ---------------- prompt copy ---------------- */

    const otherMode = bio.mode === 'face' ? 'fingerprint' : 'face';
    const canSwitchMode = !!bioSupport?.modes?.includes(otherMode);
    const bioCopy = getBiometricCopy(bio.mode);
    const switchTo = (mode) => {
        if (bio.purpose === 'login') {
            setBiometricMode(mode);
            bioAttemptsRef.current = 0;
            void startBiometricLogin(mode);
        } else {
            setBio((b) => ({ ...b, mode, status: 'idle', message: undefined, canRetry: true }));
        }
    };

    let bioTitle;
    let bioMessage = bio.message;
    let bioActions;
    if (bio.purpose === 'enable') {
        bioTitle = bio.status === 'idle' || bio.status === 'failure' ? `Log in with ${bioCopy.name}?` : undefined;
        if (bio.status === 'idle' && !bioMessage) {
            bioMessage = `Skip the password next time. It stays encrypted on this phone and unlocks only with your ${
                bio.mode === 'face' ? 'face' : 'fingerprint'
            }.`;
        }
        bioActions = {
            primary: bio.canRetry ? { label: bio.status === 'failure' ? 'Try Again' : bioCopy.useLabel, onClick: acceptBioOffer } : undefined,
            alternate: canSwitchMode ? { label: `${getBiometricCopy(otherMode).useLabel} Instead`, onClick: () => switchTo(otherMode) } : undefined,
            secondary: { label: 'Not Now', onClick: declineBioOffer },
        };
    } else {
        bioActions = {
            primary: bio.canRetry ? { label: 'Try Again', onClick: () => void startBiometricLogin(bio.mode) } : undefined,
            alternate:
                canSwitchMode && bio.canRetry ? { label: getBiometricCopy(otherMode).useLabel, onClick: () => switchTo(otherMode) } : undefined,
            secondary: { label: 'Use Password', onClick: () => closeBio() },
        };
    }

    const savedBioMode = bioSupport?.available
        ? bioSupport.modes.includes(getBiometricPrefs().mode)
            ? getBiometricPrefs().mode
            : bioSupport.primary
        : null;
    const showBioShortcut = nativeApp && bioEnabled && !!savedBioMode;
    const BioIcon = savedBioMode === 'face' ? ScanFace : Fingerprint;

    return (
        <>
            <LoginForm
                variant={appUI ? 'app' : 'glass'}
                theme="orange"
                title={t('login.workerTitle', {
                    type: workerType === 'local' ? t('worker.local') : t('worker.foreign'),
                })}
                description={t('login.workerHint')}
                backTo="/"
                backLabel={appUI ? t('common.back') : t('common.backHome')}
                submitLabel={t('common.logIn')}
                submitIcon={UserCheck}
                isLoading={isLoading}
                isSubmitDisabled={!workerId.trim() || !password.trim()}
                onSubmit={handleLogin}
                sheetOpen={sheetOpen}
                onSheetExitComplete={runPendingFinish}
                onRequestClose={() => dismissSheetThen(() => navigate('/'))}
                formError={formError}
                notice={notice}
                extraContent={
                    <WorkerTypeToggle
                        value={workerType}
                        onChange={(type) => {
                            setWorkerType(type);
                            setWorkerId('');
                            setPassword('');
                            setFormError('');
                            rememberLastWorker(null, type);
                        }}
                    />
                }
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
                        autoFocus: !bioEnabled,
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
                        <p className="text-center text-xs text-slate-500">{t('hub.login.forgotEmployee')}</p>
                        <p className="mt-1 text-center text-[11px] text-slate-400">{t('hub.login.passwordThenFace')}</p>
                    </>
                }
            />

            <BiometricPrompt
                open={bio.open}
                mode={bio.mode}
                status={bio.status}
                title={bioTitle}
                message={bioMessage}
                actions={bioActions}
                onCancel={bio.purpose === 'enable' ? declineBioOffer : () => closeBio()}
                onSuccessShown={() => {
                    const next = afterBioCloseRef.current;
                    afterBioCloseRef.current = null;
                    next?.();
                    closeBio();
                }}
                onExitComplete={handleBioExitComplete}
            />

            <FaceMatchPrompt
                open={!!face.open}
                mode={face.mode}
                name={face.worker?.employee_name}
                storedEmbedding={face.worker?.face_embedding}
                onMatched={async (embedding) => {
                    faceTokenRef.current = await verifyFaceChallenge(face.challengeId, embedding);
                }}
                onEnrolled={async (embedding) => {
                    faceTokenRef.current = await enrollFaceChallenge(face, embedding);
                }}
                onUsePassword={() => {
                    setPassword('');
                    closeFace();
                }}
                onDone={() => {
                    const { worker, type, password: pw } = face;
                    const next = afterFullLogin(worker, faceTokenRef.current, type, pw, 'face');
                    if (next === 'offer') closeFace();
                }}
                onExitComplete={() => {
                    const fn = afterFaceCloseRef.current;
                    afterFaceCloseRef.current = null;
                    setFace({ open: false });
                    fn?.();
                }}
            />
        </>
    );
}
