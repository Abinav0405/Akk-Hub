import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isNativeApp } from '@/core/platform';

/** Native app: a tap anywhere dismisses early instead of waiting for the timer. */
const TAP_TO_DISMISS = isNativeApp();

/**
 * Full-screen success moment (Google Wallet–style): animated tick + title/subtitle.
 * AKK palette: green success check, subtle orange ring, Calibri title.
 */
export default function ScanSuccessOverlay({
    open,
    title,
    subtitle,
    onDismiss,
    durationMs = 2200,
}) {
    useEffect(() => {
        if (!open) return;
        const id = window.setTimeout(() => onDismiss?.(), durationMs);
        return () => window.clearTimeout(id);
    }, [open, durationMs, onDismiss]);

    return (
        <AnimatePresence mode="wait">
            {open && (
                <motion.div
                    className="fixed inset-0 z-[300] flex items-center justify-center px-6 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
                    onClick={TAP_TO_DISMISS ? () => onDismiss?.() : undefined}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                    <div
                        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
                        aria-hidden
                    />
                    <motion.div
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        className="akk-overlay-card relative mx-auto w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white px-8 pb-9 pt-10 text-center shadow-2xl shadow-slate-900/15"
                        initial={{ opacity: 0, scale: 0.96, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 6 }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="mb-6 flex justify-center">
                            <div className="relative h-[88px] w-[88px]">
                                {/* Orange accent ring — brand */}
                                <motion.div
                                    className="absolute inset-0 rounded-full border-[3px] border-[#dc6b2f]/35"
                                    initial={{ scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                                />
                                <motion.div
                                    className="absolute inset-[5px] flex items-center justify-center rounded-full bg-[#16a34a] shadow-lg shadow-green-600/25"
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{
                                        duration: 0.42,
                                        ease: [0.22, 1, 0.36, 1],
                                        delay: 0.06,
                                    }}
                                >
                                    <svg
                                        viewBox="0 0 48 48"
                                        className="h-11 w-11"
                                        aria-hidden
                                    >
                                        <motion.path
                                            fill="none"
                                            stroke="#ffffff"
                                            strokeWidth="4"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M12 24.5l8 8 16-16"
                                            initial={{ pathLength: 0, opacity: 1 }}
                                            animate={{ pathLength: 1 }}
                                            transition={{
                                                pathLength: {
                                                    duration: 0.38,
                                                    delay: 0.22,
                                                    ease: [0.22, 1, 0.36, 1],
                                                },
                                            }}
                                        />
                                    </svg>
                                </motion.div>
                            </div>
                        </div>
                        <h2
                            className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl"
                            style={{ fontFamily: 'Calibri, Candara, Segoe UI, sans-serif' }}
                        >
                            {title}
                        </h2>
                        {subtitle ? (
                            <p
                                className="mt-2 text-sm leading-relaxed text-slate-600"
                                style={{ fontFamily: 'Aptos Narrow, Aptos, Segoe UI, sans-serif' }}
                            >
                                {subtitle}
                            </p>
                        ) : null}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
