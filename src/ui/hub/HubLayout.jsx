import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { cn } from '@/ui/utils';
import { Spinner } from '@/ui/hub/primitives';
import AnimatedOutlet from '@/ui/hub/AnimatedOutlet';
import { isNativeApp, useWideLayout } from '@/core/platform';
import { isNavItemActive, navFor } from '@/app/navigation';
import { prefetchRoleScreens } from '@/app/prefetch';
import { useIdentity, ROLE_LABELS, signOutEverywhere } from '@/core/auth/identity';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { useLanguage } from '@/core/i18n';

/** Nav items may carry `labelKey` (core-i18n); fall back to the English `label`. */
function useNavLabel() {
    const { t } = useLanguage();
    return (item) => {
        if (!item.labelKey) return item.label;
        const text = t(item.labelKey);
        return text && text !== item.labelKey ? text : item.label;
    };
}

function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'A';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Floating glass capsule — phones and tablets. */
export function TabBar({ items, className }) {
    const { pathname, search } = useLocation();
    const labelOf = useNavLabel();
    if (!items?.length) return null;
    return (
        <nav className={cn('g-tabbar', className)} aria-label="Main">
            {items.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item, pathname, search);
                return (
                    <Link
                        key={item.id}
                        to={item.to}
                        className={cn('g-tabbar__item', active && 'is-active')}
                        aria-current={active ? 'page' : undefined}
                    >
                        <Icon strokeWidth={1.9} aria-hidden />
                        <span className="g-tabbar__label">{labelOf(item)}</span>
                        {item.badge > 0 ? <span className="g-tabbar__badge">{item.badge > 9 ? '9+' : item.badge}</span> : null}
                    </Link>
                );
            })}
        </nav>
    );
}

/** In-shell placeholder while a screen's code loads (rarely seen: screens are prefetched). */
function ScreenLoading() {
    return (
        <div className="g-main flex justify-center py-20" role="status" aria-label="Loading">
            <Spinner />
        </div>
    );
}

/** Desktop sidebar with module groups. */
export function Sidebar({ groups, identity, onSignOut }) {
    const { pathname, search } = useLocation();
    const labelOf = useNavLabel();
    return (
        <aside className="g-sidebar" aria-label="Main">
            <div className="g-sidebar__brand">
                <img src="/Akk-logo.png" alt="" className="g-topbar__logo" />
                <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold tracking-tight text-[var(--g-ink)]">AKK Hub</p>
                    <p className="truncate text-xs text-[var(--g-muted)]">AKK Engineering Pte. Ltd.</p>
                </div>
            </div>
            <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
                {groups.map((group) => (
                    <div key={group.label} className="g-sidebar__group" data-tone={group.tone}>
                        {/* A lone untitled-module group (Overview → Home) needs no heading. */}
                        {group.tone || group.items.length > 1 ? <p className="g-sidebar__label">{labelOf(group)}</p> : null}
                        {group.items.map((item) => {
                            const Icon = item.icon;
                            const active = isNavItemActive(item, pathname, search);
                            return (
                                <Link
                                    key={item.id}
                                    to={item.to}
                                    className={cn('g-sidebar__link', active && 'is-active')}
                                aria-current={active ? 'page' : undefined}
                                >
                                    <Icon strokeWidth={1.9} aria-hidden />
                                    <span className="truncate">{labelOf(item)}</span>
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>
            <div className="g-sidebar__foot g-card g-card--flat flex items-center gap-3 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--g-brand-soft)] text-sm font-bold text-[var(--g-brand-text)]">
                    {initials(identity?.name)}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--g-ink)]">{identity?.name}</p>
                    <p className="truncate text-xs text-[var(--g-muted)]">{ROLE_LABELS[identity?.role]}</p>
                </div>
                <button type="button" onClick={onSignOut} className="g-icon-btn g-icon-btn--plain" aria-label="Sign out">
                    <LogOut aria-hidden />
                </button>
            </div>
        </aside>
    );
}

/**
 * Signed-in frame: sidebar on desktop, floating tab bar on phones. Each screen renders its
 * own TopBar (so a ported page's own header and back button aren't doubled up).
 */
export default function HubLayout() {
    const identity = useIdentity();
    const wide = useWideLayout();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const nav = navFor(identity?.role);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);

    useEffect(() => {
        return prefetchRoleScreens(identity?.role);
    }, [identity?.role]);

    // Push (Android app): notification taps open screens through the router, and this phone is
    // registered for whoever is signed in (no-op on the website / when push isn't configured).
    useEffect(() => {
        if (!isNativeApp()) return undefined;
        let active = true;
        import('@/core/push').then((push) => {
            if (!active) return;
            push.setPushNavigator((path) => navigate(path));
            if (identity?.role) void push.registerPushDevice(identity);
        });
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity?.role, identity?.id]);

    const handleSignOut = async () => {
        const ok = await confirmAction({
            title: 'Sign out of AKK Hub?',
            message: 'Sign out of AKK Hub? You will be signed out of all modules on this device.',
            confirmLabel: 'Sign out',
            destructive: true,
        });
        if (!ok) return;
        await signOutEverywhere();
        navigate('/', { replace: true });
    };

    return (
        <div className={cn('g-shell', wide && 'g-shell--sidebar')} data-role={identity?.role}>
            {wide ? <Sidebar groups={nav.groups} identity={identity} onSignOut={handleSignOut} /> : null}
            <div className="g-shell__body g-page">
                {/* Screens load inside the shell: the sidebar / tab bar stay put while a
                    screen's code downloads, instead of the whole app swapping to a loader.
                    AnimatedOutlet fades/slides the new view in (tab + module changes). */}
                <Suspense fallback={<ScreenLoading />}>
                    <AnimatedOutlet />
                </Suspense>
            </div>
            {/* Web admin uses hub TabBar + AdminMobileSectionStrip (native keeps AdminAppChrome dock; CSS hides .admin-app-dock in .g-shell). */}
            {wide ? null : <TabBar items={nav.tabs} />}
        </div>
    );
}
