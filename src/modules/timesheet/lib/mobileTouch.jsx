import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const MOBILE_MQ = '(max-width: 767px)';

export function initMobileTouchScroll() {
    if (typeof window === 'undefined') return () => {};

    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => {
        document.documentElement.classList.toggle('touch-scroll-optimized', mq.matches);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
}

export function useMobileTouchOptimized() {
    const [mobile, setMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches
    );

    useEffect(() => {
        const mq = window.matchMedia(MOBILE_MQ);
        const onChange = () => setMobile(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    return mobile;
}

/** Pause react-query polling while the user is actively touching/scrolling. */
export function usePauseRefetchWhileTouching() {
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        let releaseTimer;
        const pause = () => {
            clearTimeout(releaseTimer);
            setPaused(true);
        };
        const scheduleRelease = () => {
            clearTimeout(releaseTimer);
            releaseTimer = setTimeout(() => setPaused(false), 500);
        };

        window.addEventListener('touchstart', pause, { passive: true });
        window.addEventListener('touchmove', pause, { passive: true });
        window.addEventListener('touchend', scheduleRelease, { passive: true });
        window.addEventListener('touchcancel', scheduleRelease, { passive: true });

        return () => {
            clearTimeout(releaseTimer);
            window.removeEventListener('touchstart', pause);
            window.removeEventListener('touchmove', pause);
            window.removeEventListener('touchend', scheduleRelease);
            window.removeEventListener('touchcancel', scheduleRelease);
        };
    }, []);

    return paused;
}

const springTap = {
    whileHover: { y: -2 },
    whileTap: { scale: 0.99 },
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
};

/** Action card wrapper: spring motion on desktop, plain div on mobile (smoother scroll). */
export function TouchMotionWrap({ children, className }) {
    const mobile = useMobileTouchOptimized();
    if (mobile) {
        return <div className={className}>{children}</div>;
    }
    return (
        <motion.div className={className} {...springTap}>
            {children}
        </motion.div>
    );
}
