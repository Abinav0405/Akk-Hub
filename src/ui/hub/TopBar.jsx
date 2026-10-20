import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/ui/utils';
import { legacyPath } from '@/app/paths';
import { navFor } from '@/app/navigation';
import { useIdentity } from '@/core/auth/identity';
import { useWideLayout } from '@/core/platform';

/**
 * Sticky glass top bar used by every signed-in screen.
 *
 *   <TopBar title="Shifts" eyebrow="Timesheet" backTo="/me" trailing={…} />
 *
 * `backTo` accepts a hub path or an old page name ("WorkerPortal", "AdminDashboard") from
 * ported screens. `onBack` overrides it. Without either, the logo shows instead.
 */
export default function TopBar({
    title,
    eyebrow,
    subtitle,
    backTo,
    onBack,
    backLabel = 'Back',
    leading,
    trailing,
    children,
    className,
}) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const identity = useIdentity();
    const wide = useWideLayout();
    // Screens that are a tab of the bottom bar (or, on desktop, any sidebar entry) are roots:
    // no back arrow.
    const nav = navFor(identity?.role);
    const roots = wide ? [...(nav.tabs || []), ...(nav.groups || []).flatMap((g) => g.items)] : nav.tabs || [];
    const isTabRoot = roots.some((item) => (item.path || item.to.split('?')[0]) === pathname);
    const backHref = backTo && !isTabRoot ? legacyPath(backTo) : null;
    if (isTabRoot) onBack = undefined;

    let lead = leading;
    if (onBack) {
        lead = (
            <button type="button" onClick={onBack} className="g-icon-btn g-icon-btn--plain -ml-2" aria-label={backLabel}>
                <ChevronLeft strokeWidth={2.4} />
            </button>
        );
    } else if (backHref) {
        lead = (
            <Link
                to={backHref}
                onClick={(e) => {
                    // Prefer real history so scroll position is restored, unless we'd leave the app.
                    if (window.history.length > 1 && window.history.state?.idx > 0) {
                        e.preventDefault();
                        navigate(-1);
                    }
                }}
                className="g-icon-btn g-icon-btn--plain -ml-2"
                aria-label={backLabel}
            >
                <ChevronLeft strokeWidth={2.4} />
            </Link>
        );
    } else if (lead === undefined) {
        // Desktop sidebar already brands AKK Hub — skip a second logo in the content top bar.
        lead = wide ? null : <img src="/Akk-logo.png" alt="AKK Engineering" className="g-topbar__logo" />;
    }

    return (
        <header className={cn('g-topbar', className)}>
            <div className="g-topbar__bar">
                {lead}
                <div className="g-topbar__titles">
                    {eyebrow ? <p className="g-topbar__eyebrow">{eyebrow}</p> : null}
                    {title ? <h1 className="g-topbar__title">{title}</h1> : null}
                    {subtitle ? <p className="truncate text-xs text-[var(--g-muted)]">{subtitle}</p> : null}
                </div>
                {trailing ? <div className="g-topbar__trailing">{trailing}</div> : null}
            </div>
            {children ? (
                <div className="mx-auto max-w-[1120px] px-[var(--g-gutter)] pb-2.5 [.g-shell--sidebar_&]:max-w-none [.g-shell--sidebar_&]:px-8">
                    {children}
                </div>
            ) : null}
        </header>
    );
}
