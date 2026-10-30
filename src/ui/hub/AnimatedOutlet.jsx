/**
 * Soft page enter on every in-shell route change (tab bar, sidebar, home ↔ module).
 * Moving between bottom tabs (tap or swipe) slides the new screen in from that side instead.
 * Enter-only CSS — no exit pass, no blur — so Android WebView stays smooth.
 */
import { useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { takeNavDirection } from '@/ui/hub/tabMotion';

const ENTER_CLASS = {
    next: 'g-view-enter g-view-enter--next',
    prev: 'g-view-enter g-view-enter--prev',
};

export default function AnimatedOutlet() {
    const { pathname } = useLocation();
    // Read the direction once per screen (render can run twice in StrictMode).
    const entered = useRef({ pathname: null, className: 'g-view-enter' });
    if (entered.current.pathname !== pathname) {
        entered.current = { pathname, className: ENTER_CLASS[takeNavDirection()] || 'g-view-enter' };
    }
    return (
        <div key={pathname} className={entered.current.className}>
            <Outlet />
        </div>
    );
}
