import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { signOutWithAnimation } from '@/core/auth/signOutFlow';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/ui/utils';
import { Spinner } from '@/ui/hub/primitives';
import AnimatedOutlet from '@/ui/hub/AnimatedOutlet';
import { isNativeApp, useWideLayout } from '@/core/platform';
import { isNavItemActive, navFor } from '@/app/navigation';
import { prefetchRoleScreens } from '@/app/prefetch';
import { useIdentity, ROLE_LABELS } from '@/core/auth/identity';
import { useWorkerAccess } from '@/core/auth/bridges';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { useLanguage } from '@/core/i18n';
import { setNavDirection, useTabSwipe } from '@/ui/hub/tabMotion';
import ScanButton from '@/ui/hub/ScanButton';
import ScanIntro from '@/ui/hub/ScanIntro';
import { useBadges, useMarkAreasSeen, useMarkWorkerAreasSeen, useNewSinceBadge, useStaffCounts } from '@/app/badges';
import { useMaterialsSummary, useProgressSummary } from '@/pages/employee/useEmployeeModules';

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

/** Index of the bottom tab for the current screen (-1 when the screen is not a tab). */
function activeTabIndex(items, pathname, search) {
    return (items || []).findIndex((item) => isNavItemActive(item, pathname, search));
}

/**
 * Floating glass capsule — phones and tablets. The highlight slides between tabs; employees get
 * the centre Scan button (hold & drag up). `badges` maps tab id → unread count on this device.
 */
export function TabBar({ items, badges = {}, scan = false, className }) {
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const labelOf = useNavLabel();
    if (!items?.length) return null;
    const activeIndex = activeTabIndex(items, pathname, search);
    const split = scan ? Math.ceil(items.length / 2) : -1;

    const renderItem = (item, index) => {
        const Icon = item.icon;
        const active = index === activeIndex;
        const target = item.to;
        const targetPath = String(target || '').split('?')[0];
        const badge = badges[item.id] || item.badge || 0;
        return (
            <Link
                key={item.id}
                to={target}
                className={cn('g-tabbar__item', active && 'is-active')}
                aria-current={active ? 'page' : undefined}
                aria-label={badge > 0 ? `${labelOf(item)}, ${badge} new` : undefined}
                onClick={(e) => {
                    if (!active) {
                        if (activeIndex >= 0) setNavDirection(index > activeIndex ? 'next' : 'prev');
                        return;
                    }
                    // Re-tap an already-highlighted module tab (e.g. Attendance while on
                    // /timesheet/manage?section=leaves or /timesheet/manage/timesheets)
                    // always returns to that tab's root screen — never a no-op.
                    if (!targetPath) return;
                    const onRoot = pathname === targetPath && !search;
                    if (onRoot) return;
                    e.preventDefault();
                    navigate(target);
                }}
            >
                {active ? (
                    <motion.span
                        layoutId="g-tabbar-pill"
                        className="g-tabbar__pill"
                        transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
                        aria-hidden
                    />
                ) : null}
                <Icon strokeWidth={1.9} aria-hidden />
                <span className="g-tabbar__label">{labelOf(item)}</span>
                {badge > 0 ? <span className="g-tabbar__badge">{badge > 9 ? '9+' : badge}</span> : null}
            </Link>
        );
    };

    return (
        <nav className={cn('g-tabbar', scan && 'g-tabbar--scan', className)} aria-label="Main">
            {items.slice(0, split >= 0 ? split : items.length).map((item, i) => renderItem(item, i))}
            {scan ? <ScanButton /> : null}
            {split >= 0 ? items.slice(split).map((item, i) => renderItem(item, split + i)) : null}
        </nav>
    );
}

/** Unread counts per bottom tab for this role (opening a tab's screens clears them). */
function useTabBadges(role) {
    const staffCounts = useStaffCounts();
    const staff = useBadges(staffCounts);
    useMarkAreasSeen(staffCounts);
    const materials = useMaterialsSummary();
    const progress = useProgressSummary();
    const worker = role === 'worker';
    const totals = useMemo(
        () => ({
            'w-materials': worker ? materials.data?.decided ?? null : null,
            'w-site': worker ? progress.data?.reviewed ?? null : null,
        }),
        [worker, materials.data?.decided, progress.data?.reviewed],
    );
    const workerMaterials = useNewSinceBadge('w-materials', totals['w-materials']);
    const workerSite = useNewSinceBadge('w-site', totals['w-site']);
    useMarkWorkerAreasSeen(totals);
    if (worker) return { materials: workerMaterials, site: workerSite };
    if (role === 'supervisor') return { shifts: staff.shifts };
    return {
        time: (staff.shifts || 0) + (staff.leave || 0),
        materials: staff.materials,
        site: staff.packages,
    };
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
            <div className="g-sidebar__foot flex items-center gap-3 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--g-brand-soft)] text-sm font-bold text-[var(--g-brand-text)]">
                    {initials(identity?.name)}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--g-ink)]">{identity?.name}</p>
                    <p className="truncate text-xs text-[var(--g-muted)]">{ROLE_LABELS[identity?.role]}</p>
                </div>
                {/* Keep Sign out inside the rail foot — not a viewport-fixed FAB over content. */}
                <button
                    type="button"
                    onClick={onSignOut}
                    className="g-icon-btn g-icon-btn--plain shrink-0"
                    aria-label="Sign out"
                    title="Sign out"
                >
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
    const { pathname, search } = useLocation();
    const workerAccess = useWorkerAccess();
    const nav = navFor(identity?.role, workerAccess);
    const bodyRef = useRef(null);
    const tabBadges = useTabBadges(identity?.role);
    const tabIndex = activeTabIndex(nav.tabs, pathname, search);
    const goToTab = useCallback(
        (index, dir) => {
            const tab = nav.tabs[index];
            if (!tab) return;
            setNavDirection(dir);
            navigate(tab.to);
        },
        [nav.tabs, navigate],
    );
    // Phones: swipe left / right on a tab's screen to move to the neighbouring tab.
    useTabSwipe(bodyRef, { enabled: !wide, index: tabIndex, count: nav.tabs.length, onGo: goToTab });

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);

    useEffect(() => {
        return prefetchRoleScreens(identity?.role);
    }, [identity?.role]);

    // One backend: refresh which areas this worker may open (admins can change it any time).
    useEffect(() => {
        if (identity?.role !== 'worker') return;
        import('@/core/auth/bridges').then((m) => m.linkHubWorker()).catch(() => {});
    }, [identity?.role, identity?.id]);

    // Push (Android app): notification taps open screens through the router, and this phone is
    // registered for whoever is signed in (no-op on the website / when push isn't configured).
    useEffect(() => {
        if (!isNativeApp()) return undefined;
        let active = true;
        import('@/core/push').then((push) => {
            if (!active) return;
            push.setPushRole(identity?.role);
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
        await signOutWithAnimation(navigate);
    };

    return (
        <div className={cn('g-shell', wide && 'g-shell--sidebar')} data-role={identity?.role}>
            {wide ? <Sidebar groups={nav.groups} identity={identity} onSignOut={handleSignOut} /> : null}
            <div ref={bodyRef} className="g-shell__body g-page">
                {/* Screens load inside the shell: the sidebar / tab bar stay put while a
                    screen's code downloads, instead of the whole app swapping to a loader.
                    AnimatedOutlet fades/slides the new view in (tab + module changes). */}
                <Suspense fallback={<ScreenLoading />}>
                    <AnimatedOutlet />
                </Suspense>
            </div>
            {/* Web admin uses hub TabBar + AdminMobileSectionStrip (native keeps AdminAppChrome dock; CSS hides .admin-app-dock in .g-shell). */}
            {wide ? null : <TabBar items={nav.tabs} badges={tabBadges} scan={identity?.role === 'worker'} />}
            {!wide && identity?.role === 'worker' ? <ScanIntro /> : null}
        </div>
    );
}
