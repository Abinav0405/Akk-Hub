/**
 * Website only: admins, managers and supervisors are signed out after 60 minutes with no activity, so a
 * shared office / site computer does not stay signed in. Activity in any tab counts (shared through
 * localStorage). The phone app is left alone — the phone's own lock and biometric sign-in cover it.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { isNativeApp } from '@/core/platform';
import { accountKey, useIdentity } from '@/core/auth/identity';
import { signOutWithAnimation } from '@/core/auth/signOutFlow';

const IDLE_MS = 60 * 60_000;
const KEY = 'akk.hub.lastActivity';
const STAFF = ['admin', 'manager', 'supervisor'];

const now = () => Date.now();
const lastActivity = () => {
    try {
        return Number(localStorage.getItem(KEY)) || 0;
    } catch {
        return 0;
    }
};
const touch = () => {
    try {
        localStorage.setItem(KEY, String(now()));
    } catch {
        /* storage blocked — then each tab only counts its own activity */
    }
};

export default function IdleSignOut() {
    const identity = useIdentity();
    const navigate = useNavigate();
    const navRef = useRef(navigate);
    navRef.current = navigate;
    const watched = !isNativeApp() && STAFF.includes(identity?.role);
    const key = watched ? accountKey(identity) : null;
    // Signed out at some point while this page was open → the next sign-in is a fresh one.
    const sawSignedOut = useRef(false);
    if (!key) sawSignedOut.current = true;

    useEffect(() => {
        if (!key) return undefined;
        // A new sign-in starts the clock; reopening the site later on the same sign-in does not.
        let owner = null;
        try {
            owner = localStorage.getItem(`${KEY}.account`);
            localStorage.setItem(`${KEY}.account`, key);
        } catch {
            /* ignore */
        }
        if (owner !== key || !lastActivity() || sawSignedOut.current) touch();
        sawSignedOut.current = false;
        let lastWrite = now();
        let local = 0;
        const onActivity = () => {
            local = now();
            if (local - lastWrite > 15_000) {
                lastWrite = local;
                touch();
            }
        };
        const check = () => {
            const idle = now() - Math.max(local, lastActivity());
            if (idle < IDLE_MS) return;
            toast.message('Signed out after 60 minutes without activity');
            void signOutWithAnimation(navRef.current);
        };
        const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
        const onVis = () => document.visibilityState === 'visible' && check();
        document.addEventListener('visibilitychange', onVis);
        const id = window.setInterval(check, 30_000);
        check();
        return () => {
            events.forEach((e) => window.removeEventListener(e, onActivity));
            document.removeEventListener('visibilitychange', onVis);
            window.clearInterval(id);
        };
    }, [key]);

    return null;
}
