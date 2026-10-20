/**
 * Soft page enter on every in-shell route change (tab bar, sidebar, home ↔ module).
 * Enter-only CSS — no exit pass, no blur — so Android WebView stays smooth.
 */
import { Outlet, useLocation } from 'react-router-dom';

export default function AnimatedOutlet() {
    const { pathname } = useLocation();
    return (
        <div key={pathname} className="g-view-enter">
            <Outlet />
        </div>
    );
}
