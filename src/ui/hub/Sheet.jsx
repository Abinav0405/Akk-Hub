/**
 * Glass bottom sheet (phones) / centred panel (desktop) for short pickers: "See all" on the
 * home dashboards, the account switcher.
 *
 *   <Sheet open={open} onClose={…} title="Materials" subtitle="All screens">…</Sheet>
 *
 * Drag the grabber (or the sheet) down to close; Android back and Esc close it too.
 * Transform / opacity only, so it stays smooth in the Android WebView.
 */
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { registerNativeBackHandler } from '@/core/nativeShell';
import { cn } from '@/ui/utils';

export default function Sheet({ open, onClose, title, subtitle, children, footer, className }) {
    const titleId = useId();
    const reduced = useReducedMotion();

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => e.key === 'Escape' && onClose?.();
        document.addEventListener('keydown', onKey);
        const offBack = registerNativeBackHandler(() => {
            onClose?.();
            return true;
        });
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            offBack();
            document.body.style.overflow = prevOverflow;
        };
    }, [open, onClose]);

    if (typeof document === 'undefined') return null;
    return createPortal(
        <AnimatePresence>
            {open ? (
                <div className="g-sheet-root" key="sheet">
                    <motion.button
                        type="button"
                        aria-label="Close"
                        className="g-sheet-scrim"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                    />
                    <motion.section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={title ? titleId : undefined}
                        className={cn('g-sheet', className)}
                        initial={reduced ? { opacity: 0 } : { y: '100%' }}
                        animate={reduced ? { opacity: 1 } : { y: 0 }}
                        exit={reduced ? { opacity: 0 } : { y: '100%' }}
                        transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.9 }}
                        drag={reduced ? false : 'y'}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.6 }}
                        dragSnapToOrigin
                        onDragEnd={(_, info) => {
                            if (info.offset.y > 110 || info.velocity.y > 650) onClose?.();
                        }}
                    >
                        <span className="g-sheet__grabber" aria-hidden />
                        {title ? (
                            <header className="g-sheet__head">
                                <div className="min-w-0 flex-1">
                                    <h2 id={titleId} className="g-sheet__title">
                                        {title}
                                    </h2>
                                    {subtitle ? <p className="g-sheet__subtitle">{subtitle}</p> : null}
                                </div>
                                <button type="button" className="g-icon-btn g-icon-btn--plain" onClick={onClose} aria-label="Close">
                                    <X aria-hidden />
                                </button>
                            </header>
                        ) : null}
                        {/* Scrolling content must not start a drag-to-close. */}
                        <div className="g-sheet__body" onPointerDownCapture={(e) => e.stopPropagation()}>
                            {children}
                        </div>
                        {footer ? <footer className="g-sheet__foot">{footer}</footer> : null}
                    </motion.section>
                </div>
            ) : null}
        </AnimatePresence>,
        document.body,
    );
}
