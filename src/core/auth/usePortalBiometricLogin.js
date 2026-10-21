/**
 * Face ID / fingerprint unlock for admin, manager, supervisor, and export-only portals.
 * Mirrors the employee pattern: biometrics only unlock credentials stored after a successful
 * password login. Employee worker biometrics stay on the separate worker Keychain item.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, ScanFace } from 'lucide-react';
import { isNativeApp } from '@/core/platform';
import {
    MAX_BIOMETRIC_ATTEMPTS,
    disablePortalBiometricLogin,
    enablePortalBiometricLogin,
    getBiometricCopy,
    getBiometricErrorMessage,
    getBiometricSupport,
    getPortalBiometricPrefs,
    markPortalBiometricOfferDeclined,
    setPortalBiometricMode,
    shouldOfferPortalBiometric,
    unlockPortalBiometricCredential,
} from '@/core/auth/biometric';

const TERMINAL_BIO_ERRORS = new Set([
    'lockout',
    'lockout_temporary',
    'not_enrolled',
    'passcode_not_set',
    'unavailable',
]);

const BIO_CLOSED = {
    open: false,
    purpose: 'login',
    mode: 'fingerprint',
    status: 'idle',
    message: undefined,
    canRetry: true,
};

/**
 * @param {{
 *   role: 'admin' | 'manager' | 'supervisor' | 'exporter',
 *   signInWithCreds: (creds: { loginId: string, password: string }) => Promise<{ ok: boolean, error?: string } & Record<string, unknown>>,
 *   onUnlocked: (creds: { loginId: string, password: string }, signInResult: Record<string, unknown>) => void,
 *   setNotice?: (message: string) => void,
 * }} opts
 */
export function usePortalBiometricLogin({ role, signInWithCreds, onUnlocked, setNotice }) {
    const nativeApp = isNativeApp();
    const [bioSupport, setBioSupport] = useState(null);
    const [bioEnabled, setBioEnabled] = useState(() => getPortalBiometricPrefs(role).enabled);
    const [bio, setBio] = useState(BIO_CLOSED);
    const bioAttemptsRef = useRef(0);
    const afterBioCloseRef = useRef(null);
    const offerRef = useRef(null);
    const autoStartedRef = useRef(false);
    const roleRef = useRef(role);
    const signInRef = useRef(signInWithCreds);
    const onUnlockedRef = useRef(onUnlocked);
    const setNoticeRef = useRef(setNotice);

    roleRef.current = role;
    signInRef.current = signInWithCreds;
    onUnlockedRef.current = onUnlocked;
    setNoticeRef.current = setNotice;

    // When the management toggle switches role, refresh the enabled flag for that role.
    useEffect(() => {
        setBioEnabled(getPortalBiometricPrefs(role).enabled);
    }, [role]);

    const closeBio = useCallback((then) => {
        afterBioCloseRef.current = then || null;
        setBio((b) => ({ ...b, open: false }));
    }, []);

    const handleBioExitComplete = useCallback(() => {
        const fn = afterBioCloseRef.current;
        afterBioCloseRef.current = null;
        setBio(BIO_CLOSED);
        fn?.();
    }, []);

    const handleBioLoginError = useCallback(
        (err, mode) => {
            const { code } = err || {};
            const copy = getBiometricCopy(mode);
            if (code === 'fallback') return closeBio();
            if (code === 'invalidated') {
                setBioEnabled(false);
                return closeBio(() => setNoticeRef.current?.(getBiometricErrorMessage('invalidated', mode)));
            }
            if (code === 'cancel') {
                setBio((b) => ({
                    ...b,
                    status: 'idle',
                    canRetry: true,
                    message: getBiometricErrorMessage('cancel', mode),
                }));
                return;
            }
            if (code === 'failed') {
                bioAttemptsRef.current += 1;
                const exhausted = bioAttemptsRef.current >= MAX_BIOMETRIC_ATTEMPTS;
                setBio((b) => ({
                    ...b,
                    status: 'failure',
                    canRetry: !exhausted,
                    message: exhausted
                        ? `${copy.name} didn't recognize you. Use your password to log in.`
                        : copy.failed,
                }));
                return;
            }
            setBio((b) => ({
                ...b,
                status: 'failure',
                canRetry: !TERMINAL_BIO_ERRORS.has(code),
                message: getBiometricErrorMessage(code, mode),
            }));
        },
        [closeBio],
    );

    const startBiometricLogin = useCallback(async (mode) => {
        const activeRole = roleRef.current;
        const prefs = getPortalBiometricPrefs(activeRole);
        if (!prefs.enabled) return;
        setBio({ ...BIO_CLOSED, open: true, purpose: 'login', mode, status: 'scanning' });

        let creds;
        try {
            creds = await unlockPortalBiometricCredential({ role: activeRole, mode });
        } catch (err) {
            handleBioLoginError(err, mode);
            return;
        }

        setBio((b) => ({ ...b, status: 'processing' }));
        try {
            const result = await signInRef.current(creds);
            if (!result?.ok) {
                await disablePortalBiometricLogin(activeRole, { keepDeclined: true });
                setBioEnabled(false);
                setBio((b) => ({
                    ...b,
                    status: 'failure',
                    canRetry: false,
                    message:
                        'Your saved login no longer works. Log in with your password to turn biometric login back on.',
                }));
                return;
            }
            bioAttemptsRef.current = 0;
            afterBioCloseRef.current = () => onUnlockedRef.current(creds, result);
            setBio((b) => ({ ...b, status: 'success', message: '' }));
        } catch {
            setBio((b) => ({
                ...b,
                status: 'failure',
                canRetry: true,
                message: 'Could not reach the server. Check your connection and try again.',
            }));
        }
    }, [handleBioLoginError]);

    const finishOffer = useCallback(() => {
        const offer = offerRef.current;
        offerRef.current = null;
        offer?.finish?.();
    }, []);

    const acceptBioOffer = useCallback(async () => {
        const offer = offerRef.current;
        if (!offer) return;
        const mode = bio.mode;
        const activeRole = roleRef.current;
        setBio((b) => ({ ...b, status: 'scanning', message: 'Confirm to turn it on' }));
        try {
            await enablePortalBiometricLogin({
                role: activeRole,
                loginId: offer.loginId,
                displayName: offer.displayName,
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
    }, [bio.mode, finishOffer]);

    const declineBioOffer = useCallback(() => {
        const offer = offerRef.current;
        if (offer) markPortalBiometricOfferDeclined(roleRef.current, offer.loginId);
        closeBio(finishOffer);
    }, [closeBio, finishOffer]);

    /**
     * After a successful password login: offer biometrics once, or run `finish` immediately.
     * @returns {'offer' | 'done'}
     */
    const afterPasswordSuccess = useCallback(
        ({ loginId, displayName, password, finish }) => {
            const prefs = getPortalBiometricPrefs(roleRef.current);
            const alreadyOn = prefs.enabled && prefs.loginId === String(loginId);
            if (bioSupport?.available && !alreadyOn && shouldOfferPortalBiometric(roleRef.current, loginId)) {
                offerRef.current = { loginId: String(loginId), displayName: displayName || '', password, finish };
                setBio({ ...BIO_CLOSED, open: true, purpose: 'enable', mode: bioSupport.primary, status: 'idle' });
                return 'offer';
            }
            finish?.();
            return 'done';
        },
        [bioSupport],
    );

    // Detect support once; auto-start when Home sent ?quick=face|fingerprint and this role is enrolled.
    // Do not re-run on manager↔supervisor toggle — leftover ?quick would otherwise re-prompt.
    useEffect(() => {
        if (!nativeApp) return undefined;
        let cancelled = false;
        getBiometricSupport().then((support) => {
            if (cancelled) return;
            setBioSupport(support);
            const prefs = getPortalBiometricPrefs(roleRef.current);
            if (!prefs.enabled) return;
            if (!support.available) {
                if (support.reason === 'not_enrolled') {
                    setNoticeRef.current?.(getBiometricErrorMessage('not_enrolled', prefs.mode));
                }
                return;
            }
            const quick = new URLSearchParams(window.location.search).get('quick');
            if (quick !== 'face' && quick !== 'fingerprint') return;
            if (autoStartedRef.current) return;
            autoStartedRef.current = true;
            const requested = quick === 'face' ? 'face' : 'fingerprint';
            const mode = support.modes.includes(requested)
                ? requested
                : support.modes.includes(prefs.mode)
                  ? prefs.mode
                  : support.primary;
            void startBiometricLogin(mode);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nativeApp]);

    const otherMode = bio.mode === 'face' ? 'fingerprint' : 'face';
    const canSwitchMode = !!bioSupport?.modes?.includes(otherMode);
    const bioCopy = getBiometricCopy(bio.mode);

    const switchTo = (mode) => {
        if (bio.purpose === 'login') {
            setPortalBiometricMode(roleRef.current, mode);
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
            primary: bio.canRetry
                ? {
                      label: bio.status === 'failure' ? 'Try Again' : bioCopy.useLabel,
                      onClick: acceptBioOffer,
                  }
                : undefined,
            alternate: canSwitchMode
                ? { label: `${getBiometricCopy(otherMode).useLabel} Instead`, onClick: () => switchTo(otherMode) }
                : undefined,
            secondary: { label: 'Not Now', onClick: declineBioOffer },
        };
    } else {
        bioActions = {
            primary: bio.canRetry
                ? { label: 'Try Again', onClick: () => void startBiometricLogin(bio.mode) }
                : undefined,
            alternate:
                canSwitchMode && bio.canRetry
                    ? { label: getBiometricCopy(otherMode).useLabel, onClick: () => switchTo(otherMode) }
                    : undefined,
            secondary: { label: 'Use Password', onClick: () => closeBio() },
        };
    }

    const prefs = getPortalBiometricPrefs(role);
    const savedBioMode = bioSupport?.available
        ? bioSupport.modes.includes(prefs.mode)
            ? prefs.mode
            : bioSupport.primary
        : null;
    const showBioShortcut = nativeApp && bioEnabled && !!savedBioMode;
    const BioIcon = savedBioMode === 'face' ? ScanFace : Fingerprint;

    const promptProps = {
        open: bio.open,
        mode: bio.mode,
        status: bio.status,
        title: bioTitle,
        message: bioMessage,
        actions: bioActions,
        onCancel: bio.purpose === 'enable' ? declineBioOffer : () => closeBio(),
        onSuccessShown: () => {
            const next = afterBioCloseRef.current;
            afterBioCloseRef.current = null;
            next?.();
            closeBio();
        },
        onExitComplete: handleBioExitComplete,
    };

    return {
        bioSupport,
        bioEnabled,
        showBioShortcut,
        savedBioMode,
        BioIcon,
        startBiometricLogin,
        afterPasswordSuccess,
        promptProps,
        bioAttemptsRef,
    };
}
