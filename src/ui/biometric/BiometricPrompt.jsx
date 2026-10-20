/**
 * BiometricPrompt — full-screen, iOS-style Face ID / fingerprint screen.
 *
 * Presentational only: the parent runs the real biometric call (src/lib/biometricAuth.js)
 * and drives `status` from its result:
 *
 *   idle → scanning → processing → success      (onSuccessShown fires once the check has drawn)
 *                   ↘ failure → (Try Again) → scanning …
 *
 * The system biometric sheet appears on top of this screen while `status` is 'scanning';
 * this screen is the calm frame around it and shows the outcome.
 *
 * Buttons appear only in 'idle' and 'failure'. Pass them as
 *   actions={{ primary, secondary, alternate }}   each { label, onClick }
 * primary = filled button (e.g. "Try Again"), secondary = text button ("Use Password"),
 * alternate = text button for the other biometric ("Use Fingerprint").
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import BiometricGlyph, { BIO_SPRING } from '@/ui/biometric/BiometricGlyph';
import { biometricHaptic, getBiometricCopy } from '@/core/auth/biometric';
import { registerNativeBackHandler } from '@/core/nativeShell';
import './biometric.css';

/** How long the green check stays on screen before the prompt hands back control. */
const SUCCESS_HOLD_MS = 750;

const SPOKEN_STATUS = {
    idle: 'ready',
    scanning: 'scanning',
    processing: 'verifying',
    success: 'success',
    failure: 'not recognized',
};

export default function BiometricPrompt({
    open,
    mode = 'face',
    status = 'idle',
    title,
    message,
    actions = {},
    onCancel,
    onSuccessShown,
    onExitComplete,
}) {
    const reduceMotion = useReducedMotion();
    const copy = getBiometricCopy(mode);
    const primaryRef = useRef(null);
    const dialogRef = useRef(null);
    const successShownRef = useRef(onSuccessShown);
    successShownRef.current = onSuccessShown;

    const heading = title || copy.name;
    const defaultMessage = {
        idle: '',
        scanning: copy.scanning,
        processing: 'Signing you in…',
        success: '',
        failure: copy.failed,
    }[status];
    const subtitle = message ?? defaultMessage;
    const showActions = status === 'idle' || status === 'failure';

    // Haptics and the hand-off after success follow the UI state.
    useEffect(() => {
        if (!open) return undefined;
        if (status === 'failure') {
            biometricHaptic('error');
            return undefined;
        }
        if (status !== 'success') return undefined;
        biometricHaptic('success');
        const t = window.setTimeout(() => successShownRef.current?.(), SUCCESS_HOLD_MS);
        return () => window.clearTimeout(t);
    }, [open, status]);

    // Move focus into the prompt, and onto "Try Again" after a failure.
    useEffect(() => {
        if (!open) return;
        // focusVisible:false — move screen-reader focus without drawing a keyboard ring on touch.
        if (status === 'failure' && primaryRef.current) primaryRef.current.focus({ focusVisible: false });
        else if (status === 'idle' || status === 'scanning') dialogRef.current?.focus();
    }, [open, status]);

    useEffect(() => {
        if (!open || !onCancel) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKey);
        // Android hardware back closes the prompt instead of leaving the page underneath.
        const unregister = registerNativeBackHandler(() => {
            onCancel();
            return true;
        });
        return () => {
            window.removeEventListener('keydown', onKey);
            unregister();
        };
    }, [open, onCancel]);

    const canCancel = onCancel && status !== 'processing' && status !== 'success';

    return createPortal(
        <AnimatePresence onExitComplete={onExitComplete}>
            {open && (
                <motion.div
                    key="akk-bio"
                    ref={dialogRef}
                    className="akk-bio"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="akk-bio-title"
                    aria-describedby="akk-bio-subtitle"
                    tabIndex={-1}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                    {canCancel ? (
                        <button type="button" className="akk-bio__cancel" onClick={onCancel}>
                            Cancel
                        </button>
                    ) : (
                        <span className="akk-bio__cancel" aria-hidden="true" />
                    )}

                    <motion.div
                        className="akk-bio__stage"
                        initial={reduceMotion ? false : { scale: 0.96 }}
                        animate={{ scale: 1 }}
                        exit={reduceMotion ? undefined : { scale: 1.06, transition: { duration: 0.22, ease: 'easeIn' } }}
                        transition={BIO_SPRING}
                    >
                        <BiometricGlyph
                            mode={mode}
                            status={status}
                            label={`${copy.name}, ${SPOKEN_STATUS[status] || status}`}
                        />

                        <h2 id="akk-bio-title" className="akk-bio__title">
                            {heading}
                        </h2>
                        <p id="akk-bio-subtitle" className="akk-bio__subtitle" aria-live="polite">
                            {subtitle}
                        </p>

                        <div className="akk-bio__actions">
                            <AnimatePresence initial={false}>
                                {showActions && (
                                    <motion.div
                                        key="actions"
                                        className="akk-bio__action-list"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {actions.primary && (
                                            <button
                                                ref={primaryRef}
                                                type="button"
                                                className="akk-bio__btn akk-bio__btn--primary"
                                                onClick={actions.primary.onClick}
                                            >
                                                {actions.primary.label}
                                            </button>
                                        )}
                                        {actions.alternate && (
                                            <button type="button" className="akk-bio__link" onClick={actions.alternate.onClick}>
                                                {actions.alternate.label}
                                            </button>
                                        )}
                                        {actions.secondary && (
                                            <button type="button" className="akk-bio__link" onClick={actions.secondary.onClick}>
                                                {actions.secondary.label}
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
