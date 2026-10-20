/**
 * FaceMatchPrompt — the camera face check (server-verified Face ID), following the
 * "AKK Face Login Flow" design:
 *
 *   intro (enroll only) → position ("Move closer") → hold ("Hold still…") →
 *   processing → success ("Welcome, NAME") | failure
 *
 * Dark camera screen: Face ID glyph chip at top centre, title + short status, a dotted ring
 * that fills white clockwise as the scan progresses (green on success, red on failure), and a
 * glass hint pill at the bottom.
 *
 * mode 'verify': compares the live face with the enrolled embedding (face-api.js). After two
 *   matching frames it calls onMatched(liveEmbedding) — the parent sends that to the
 *   server (complete_worker_login_after_face), which re-checks the distance. Throw to signal a
 *   reject; a thrown `{ userMessage }` is shown on the failure screen.
 * mode 'enroll': waits for a few well-posed frames, then calls onEnrolled(embedding).
 * mode 'server': same capture as enroll, but calls onMatched(embedding) and lets the server
 *   decide (one-tap Face ID on a remembered phone — the enrolled face never reaches the phone).
 *
 * After MAX_ATTEMPTS failed attempts only the password action is offered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { BIO_SPRING, FaceIdGlyph } from '@/ui/biometric/BiometricGlyph';
import { FaceWelcomeScreen, RingSvg } from '@/ui/biometric/FaceWelcomeScreen';
import { biometricHaptic } from '@/core/auth/biometric';
import {
    arrayToDescriptor,
    compareFaces,
    descriptorToArray,
    detectFaceWithLandmarks,
    getFacePoseFeedback,
    loadModels,
} from '@/core/auth/faceRecognition';
import { useSheetLayout } from '@/core/platform';
import { requestCameraPermissionWithFallback } from '@/core/permissions';
import { registerNativeBackHandler, setNativeSystemBarsSurface } from '@/core/nativeShell';
import './biometric.css';

/** Same thresholds the server-side check was tuned to (server rejects at ≥ 0.50). */
const MATCH_THRESHOLD = 0.44;
const MATCHES_NEEDED = 2;
const MISMATCH_FRAMES_PER_ATTEMPT = 8;
const GOOD_FRAMES_TO_ENROLL = 4;
const MAX_ATTEMPTS = 3;
const FRAME_MS = 200;
/** Short: the login curtain keeps this same screen up while the portal loads. */
const SUCCESS_HOLD_MS = 600;

const INTRO_POINTS = [
    'Only a face template is stored, never photos',
    'Used only to sign you in to AKK attendance',
    'Password login is always available',
];

/** "Move closer — face too far from camera." → "Move closer" */
function shortHint(message) {
    return String(message || '')
        .split(' — ')[0]
        .replace(/\.+$/, '')
        .trim();
}

function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
}

// ---------------------------------------------------------------------------
// Dotted ring: dim dashes all round, white dashes revealed clockwise from the top.
// ---------------------------------------------------------------------------
function DottedRing({ phase, progress, reduceMotion }) {
    const tone = phase === 'success' ? 'success' : phase === 'failure' ? 'failure' : 'scan';
    const fill = tone === 'scan' ? progress : 1;

    let frameAnim = { x: 0, scale: 1 };
    if (!reduceMotion && phase === 'failure') {
        frameAnim = { x: [0, -14, 12, -9, 6, -3, 0], scale: 1, transition: { duration: 0.45, ease: 'easeOut' } };
    } else if (!reduceMotion && phase === 'success') {
        frameAnim = { x: 0, scale: [1, 1.035, 1], transition: { duration: 0.5, ease: 'easeOut' } };
    }

    return (
        <motion.div className="akk-face__frame" initial={false} animate={frameAnim} aria-hidden="true">
            <RingSvg tone={tone} fill={fill} />
        </motion.div>
    );
}

// Lives in its own file so the app-root login curtain doesn't load the camera code.
export { FaceWelcomeScreen };

export default function FaceMatchPrompt({
    open,
    mode = 'verify',
    storedEmbedding,
    title,
    name,
    intro,
    successTitle,
    successSubtitle,
    cancelLabel = 'Use Password',
    onMatched,
    onEnrolled,
    onUsePassword,
    onDone,
    onExitComplete,
}) {
    const reduceMotion = useReducedMotion();
    /** Phones and the Android app get full screen; a desktop browser gets a centred card. */
    const fullScreen = useSheetLayout();
    const showIntro = intro ?? mode === 'enroll';

    /** 'intro' | 'position' | 'hold' | 'processing' | 'success' | 'failure' */
    const [phase, setPhase] = useState('position');
    const [hint, setHint] = useState('');
    const [failureText, setFailureText] = useState('');
    const [progress, setProgress] = useState(0);
    const [canRetry, setCanRetry] = useState(true);
    const [cameraLive, setCameraLive] = useState(false);
    const attemptsRef = useRef(0);

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const busyRef = useRef(false); // a detection frame is in flight
    const doneRef = useRef(false); // captured — ignore further frames
    const matchesRef = useRef(0);
    const mismatchRef = useRef(0);
    const goodFramesRef = useRef(0);
    const noFaceFramesRef = useRef(0);
    const runIdRef = useRef(0);
    const doneCbRef = useRef(onDone);
    doneCbRef.current = onDone;
    const cancelRef = useRef(onUsePassword);
    cancelRef.current = onUsePassword;
    const phaseRef = useRef(phase);
    phaseRef.current = phase;

    // ---- camera & detection ---------------------------------------------------------------

    const stopCamera = useCallback(() => {
        runIdRef.current += 1;
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        streamRef.current?.getTracks?.().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        busyRef.current = false;
        setCameraLive(false);
    }, []);

    const fail = useCallback(
        (msg, { countsAsAttempt = true, retry = true } = {}) => {
            stopCamera();
            if (countsAsAttempt) attemptsRef.current += 1;
            const exhausted = attemptsRef.current >= MAX_ATTEMPTS;
            setCanRetry(retry && !exhausted);
            setFailureText(exhausted ? 'Too many tries. Sign in with your password instead.' : msg);
            setPhase('failure');
        },
        [stopCamera],
    );

    /** Face captured: hand the embedding to the parent / server. */
    const finishWith = useCallback(
        async (descriptor) => {
            setPhase('processing');
            setProgress(0.95);
            try {
                const embedding = descriptorToArray(descriptor);
                if (mode === 'enroll') await onEnrolled?.(embedding);
                else await onMatched?.(embedding);
                stopCamera();
                setProgress(1);
                setPhase('success');
            } catch (error) {
                fail(
                    error?.userMessage ||
                        'Make sure your face is clearly visible and well lit, or sign in with your password.',
                );
            }
        },
        [fail, mode, onEnrolled, onMatched, stopCamera],
    );

    const capture = useCallback(
        (descriptor) => {
            doneRef.current = true;
            if (timerRef.current) window.clearInterval(timerRef.current);
            timerRef.current = null;
            void finishWith(descriptor);
        },
        [finishWith],
    );

    const onFrame = useCallback(
        async (runId, stored) => {
            const video = videoRef.current;
            if (!video || busyRef.current || doneRef.current) return;
            if (video.readyState < 2 || !video.videoWidth) return;
            busyRef.current = true;
            try {
                const detection = await detectFaceWithLandmarks(video);
                if (runId !== runIdRef.current || doneRef.current) return;

                if (!detection?.descriptor) {
                    // A single missed frame is common; only reset after a few in a row.
                    noFaceFramesRef.current += 1;
                    if (noFaceFramesRef.current >= 3) {
                        matchesRef.current = 0;
                        goodFramesRef.current = 0;
                        setProgress(0);
                        setPhase('position');
                        setHint('Looking for your face');
                    }
                    return;
                }
                noFaceFramesRef.current = 0;

                const pose = getFacePoseFeedback(detection, video.videoWidth, video.videoHeight);
                if (!pose.ok) {
                    matchesRef.current = 0;
                    goodFramesRef.current = 0;
                    setProgress(0.08);
                    setPhase('position');
                    setHint(shortHint(pose.message));
                    return;
                }

                setPhase('hold');

                if (mode === 'enroll' || mode === 'server') {
                    goodFramesRef.current += 1;
                    setProgress(0.2 + (goodFramesRef.current / GOOD_FRAMES_TO_ENROLL) * 0.55);
                    if (goodFramesRef.current >= GOOD_FRAMES_TO_ENROLL) capture(detection.descriptor);
                    return;
                }

                const distance = compareFaces(detection.descriptor, stored);
                if (distance < MATCH_THRESHOLD) {
                    mismatchRef.current = 0;
                    matchesRef.current += 1;
                    setProgress(0.3 + (matchesRef.current / MATCHES_NEEDED) * 0.45);
                    if (matchesRef.current >= MATCHES_NEEDED) capture(detection.descriptor);
                } else {
                    matchesRef.current = 0;
                    mismatchRef.current += 1;
                    setProgress(0.25);
                    if (mismatchRef.current >= MISMATCH_FRAMES_PER_ATTEMPT) {
                        fail('Make sure your face is clearly visible and well lit, or sign in with your password.');
                    }
                }
            } catch (error) {
                console.error('Face detection error:', error);
            } finally {
                busyRef.current = false;
            }
        },
        [capture, fail, mode],
    );

    const start = useCallback(async () => {
        stopCamera();
        const runId = runIdRef.current;
        doneRef.current = false;
        matchesRef.current = 0;
        mismatchRef.current = 0;
        goodFramesRef.current = 0;
        noFaceFramesRef.current = 0;
        setPhase('position');
        setProgress(0);
        setHint('Starting camera');

        let stored = null;
        if (mode === 'verify') {
            stored = Array.isArray(storedEmbedding) ? arrayToDescriptor(storedEmbedding) : null;
            if (!stored || stored.length !== 128) {
                fail('Your Face ID data is missing. Ask your admin to re-enroll your face.', {
                    countsAsAttempt: false,
                    retry: false,
                });
                return;
            }
        }

        try {
            const [, allowed] = await Promise.all([loadModels(), requestCameraPermissionWithFallback()]);
            if (runId !== runIdRef.current) return;
            if (!allowed) {
                fail('Camera access is needed for Face ID. Allow it in Settings, then try again.', { countsAsAttempt: false });
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 720 }, height: { ideal: 960 }, facingMode: 'user' },
            });
            if (runId !== runIdRef.current || !videoRef.current) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            streamRef.current = stream;
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
            setHint('Looking for your face');
            timerRef.current = window.setInterval(() => void onFrame(runId, stored), FRAME_MS);
        } catch (error) {
            console.error('Face ID camera error:', error);
            fail("Couldn't start the camera. Check permissions and try again.", { countsAsAttempt: false });
        }
    }, [fail, mode, onFrame, stopCamera, storedEmbedding]);

    // Open → intro (enroll) or straight into the camera; always release the camera on close.
    useEffect(() => {
        if (!open) {
            stopCamera();
            return undefined;
        }
        attemptsRef.current = 0;
        setCanRetry(true);
        setFailureText('');
        if (showIntro) {
            setPhase('intro');
            return () => stopCamera();
        }
        const raf = window.requestAnimationFrame(() => void start());
        return () => {
            window.cancelAnimationFrame(raf);
            stopCamera();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // ---- haptics + hand-off after success ---------------------------------------------------

    useEffect(() => {
        if (!open) return undefined;
        if (phase === 'failure') biometricHaptic('error');
        if (phase !== 'success') return undefined;
        biometricHaptic('success');
        const t = window.setTimeout(() => doneCbRef.current?.(), SUCCESS_HOLD_MS);
        return () => window.clearTimeout(t);
    }, [open, phase]);

    // ---- Android: status bar matches the screen; hardware back = Cancel --------------------

    const lightScreen = phase === 'intro';
    useEffect(() => {
        if (!open) return undefined;
        setNativeSystemBarsSurface(lightScreen ? 'light' : 'dark');
        return undefined;
    }, [open, lightScreen]);

    useEffect(() => {
        if (!open) return undefined;
        const unregister = registerNativeBackHandler(() => {
            const p = phaseRef.current;
            if (p !== 'processing' && p !== 'success') cancelRef.current?.();
            return true; // never navigate away underneath the face check
        });
        return () => {
            unregister();
            setNativeSystemBarsSurface('light');
        };
    }, [open]);

    // ---- copy -------------------------------------------------------------------------------

    const firstName = String(name || '').trim().split(/\s+/)[0] || '';
    const faceTitle = title || 'Face ID';
    let heading = faceTitle;
    let subtitle = hint;
    if (phase === 'hold') subtitle = 'Hold still…';
    if (phase === 'processing') subtitle = mode === 'enroll' ? 'Saving your face…' : 'Verifying…';
    if (phase === 'success') {
        heading = successTitle || (firstName ? `Welcome, ${firstName}` : 'Welcome');
        subtitle = successSubtitle ?? 'Signing you in…';
    }
    if (phase === 'failure') {
        heading = 'Face not recognised';
        subtitle = failureText;
    }
    const pill =
        phase === 'position'
            ? 'Hold your phone at eye level'
            : phase === 'hold'
              ? 'Keep your face inside the ring'
              : null;
    const glyphStatus =
        phase === 'processing' ? 'processing' : phase === 'success' ? 'success' : phase === 'failure' ? 'failure' : 'scanning';
    const canCancel = onUsePassword && phase !== 'processing' && phase !== 'success';
    const device = fullScreen ? 'phone' : 'camera';

    // ---- render -----------------------------------------------------------------------------

    const introScreen = (
        <div className="akk-face__intro">
            <div className="akk-face__topbar">
                {onUsePassword && (
                    <button type="button" className="akk-face__cancel akk-face__cancel--light" onClick={onUsePassword}>
                        Not now
                    </button>
                )}
            </div>
            <div className="akk-face__intro-body">
                <motion.div
                    className="akk-face__glyph-chip akk-face__glyph-chip--raised"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={BIO_SPRING}
                >
                    <FaceIdGlyph status="idle" label="Face ID" />
                </motion.div>
                <h2 id="akk-face-title" className="akk-face__intro-title">
                    Set up Face Login
                </h2>
                <p className="akk-face__intro-text">Sign in faster with your face. We keep a secure face template, never your photos.</p>
                <ul className="akk-face__points">
                    {INTRO_POINTS.map((point) => (
                        <li key={point}>
                            <CheckCircle2 aria-hidden="true" />
                            <span>{point}</span>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="akk-face__intro-actions">
                <button type="button" className="akk-face__primary" onClick={() => void start()}>
                    Agree and Continue
                </button>
                {onUsePassword && (
                    <button type="button" className="akk-face__text-btn" onClick={onUsePassword}>
                        {cancelLabel === 'Use Password' ? 'Use password instead' : cancelLabel}
                    </button>
                )}
                <a className="akk-face__privacy" href="/privacy" target="_blank" rel="noopener noreferrer">
                    Read the privacy notice (PDPA)
                </a>
            </div>
        </div>
    );

    const cameraScreen = (
        <>
            <div className="akk-face__stage">
                <video
                    ref={videoRef}
                    className={cameraLive ? 'akk-face__video is-live' : 'akk-face__video'}
                    autoPlay
                    playsInline
                    muted
                    onPlaying={() => setCameraLive(true)}
                />
                <div className="akk-face__shade" aria-hidden="true" />
            </div>

            <div className="akk-face__layout">
                <header className="akk-face__top">
                    <div className="akk-face__topbar">
                        {canCancel && (
                            <button type="button" className="akk-face__cancel" onClick={onUsePassword}>
                                Cancel
                            </button>
                        )}
                    </div>
                    <motion.div
                        className="akk-face__glyph-chip"
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={BIO_SPRING}
                    >
                        <FaceIdGlyph status={glyphStatus} label={`${faceTitle}, ${phase}`} />
                    </motion.div>
                    <h2 id="akk-face-title" className="akk-face__title">
                        {heading}
                    </h2>
                    <p className="akk-face__subtitle" aria-live="polite">
                        {phase === 'failure' || phase === 'success' ? subtitle : subtitle.replace('your phone', `your ${device}`)}
                    </p>
                </header>

                <div className="akk-face__middle">
                    <DottedRing phase={phase} progress={progress} reduceMotion={reduceMotion} />
                </div>

                <footer className="akk-face__bottom">
                    <AnimatePresence mode="wait" initial={false}>
                        {pill && (
                            <motion.div
                                key={pill}
                                className="akk-face__pill"
                                role="status"
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.18 }}
                            >
                                {pill.replace('your phone', `your ${device}`)}
                            </motion.div>
                        )}
                        {phase === 'failure' && (
                            <motion.div
                                key="actions"
                                className="akk-face__actions"
                                initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={BIO_SPRING}
                            >
                                {canRetry && (
                                    <button type="button" className="akk-face__btn" onClick={() => void start()}>
                                        Try Again
                                    </button>
                                )}
                                {onUsePassword && (
                                    <button type="button" className="akk-face__link" onClick={onUsePassword}>
                                        {cancelLabel}
                                    </button>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </footer>
            </div>
        </>
    );

    return createPortal(
        <AnimatePresence onExitComplete={onExitComplete}>
            {open && (
                <motion.div
                    key="akk-face"
                    className={[
                        'akk-face',
                        fullScreen ? '' : 'akk-face--card',
                        lightScreen ? 'akk-face--light' : '',
                    ].join(' ')}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="akk-face-title"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                    <motion.div
                        className="akk-face__panel"
                        initial={reduceMotion ? false : { scale: fullScreen ? 1 : 0.96 }}
                        animate={{ scale: 1 }}
                        exit={reduceMotion ? undefined : { scale: 1.04, transition: { duration: 0.22, ease: 'easeIn' } }}
                        transition={BIO_SPRING}
                    >
                        {phase === 'intro' ? introScreen : cameraScreen}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
