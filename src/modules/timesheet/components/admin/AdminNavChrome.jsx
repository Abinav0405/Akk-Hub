import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
    Activity, Calendar, Car, ClipboardList, Clock, FileText, HelpCircle,
    LogOut, MapPin, Menu, Receipt, Users, X,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { cn } from '@/modules/timesheet/lib/utils';
import { paths } from '@/app/paths';
import { registerNativeBackHandler } from '@/core/nativeShell';
import { NativeIconButton, NativeListRow, NativeNavBar } from '@/ui/native/NativeChrome';
import HubSectionStrip from '@/ui/hub/HubSectionStrip';
import LanguageSwitcher from '@/core-i18n';
import { useLanguage } from '@/core-i18n';

export const ADMIN_TAB_TITLES = {
    'time-tracker': 'Time Tracker',
    leaves: 'Leaves',
    'payslip-report': 'Payslip',
    'timesheet-report': 'Timesheet',
    'worker-info': 'Workers',
    sites: 'Sites',
    vehicles: 'Vehicles',
};

const DASH_TABS = [
    { id: 'time-tracker', labelKey: 'admin.timeTracker', icon: Clock, iconClass: 'text-[var(--g-brand)]', tour: 'admin-tab-time-tracker' },
    { id: 'leaves', labelKey: 'admin.leaves', icon: Calendar, iconClass: 'text-[var(--g-ink-2)]', tour: 'admin-tab-leaves', badge: true },
    { id: 'payslip-report', labelKey: 'admin.payslipReport', icon: Receipt, iconClass: 'text-[var(--g-ink-2)]', tour: 'admin-tab-payslip' },
    { id: 'timesheet-report', labelKey: 'admin.timesheet', icon: FileText, iconClass: 'text-[var(--g-ink-2)]', tour: 'admin-tab-timesheet' },
    { id: 'worker-info', labelKey: 'admin.workerInfo', icon: Users, iconClass: 'text-[var(--g-ink-2)]', tour: 'admin-tab-worker-info' },
    { id: 'sites', labelKey: 'admin.sites', icon: MapPin, iconClass: 'text-[var(--g-ink-2)]', tour: 'admin-tab-sites' },
    { id: 'vehicles', labelKey: 'admin.vehicles', icon: Car, iconClass: 'text-[var(--g-ink-2)]' },
];

const APP_DOCK_TABS = [
    { id: 'time-tracker', labelKey: 'admin.tracker', icon: Clock, tour: 'admin-tab-time-tracker' },
    { id: 'leaves', labelKey: 'admin.leaves', icon: Calendar, tour: 'admin-tab-leaves', badge: true },
    { id: 'worker-info', labelKey: 'admin.workers', icon: Users, tour: 'admin-tab-worker-info' },
];

const APP_MORE_TABS = [
    { id: 'payslip-report', labelKey: 'admin.payslip', hintKey: 'admin.payslipHint', icon: Receipt, tour: 'admin-tab-payslip', iconClass: 'akk-tone-brand' },
    { id: 'timesheet-report', labelKey: 'admin.timesheet', hintKey: 'admin.timesheetHint', icon: FileText, tour: 'admin-tab-timesheet', iconClass: 'bg-slate-100 text-slate-700' },
    { id: 'sites', labelKey: 'admin.sites', hintKey: 'admin.sitesHint', icon: MapPin, tour: 'admin-tab-sites', iconClass: 'bg-[var(--g-tone-progress-soft)] text-[var(--g-tone-progress)]' },
    { id: 'vehicles', labelKey: 'admin.vehicles', hintKey: 'admin.vehiclesHint', icon: Car, iconClass: 'bg-slate-100 text-slate-700' },
];

/** Hub paths — avoid legacy createPageUrl names so links always resolve. */
const APP_MORE_PAGES = [
    { to: paths.timesheet.analytics, labelKey: 'admin.analytics', icon: Activity, className: 'bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]', webClass: 'text-[var(--g-ink)] hover:bg-[var(--g-brand-muted)]', webIcon: 'text-[var(--g-brand)]' },
    { to: paths.timesheet.attendance, labelKey: 'admin.attendance', icon: Calendar, className: 'bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]', webClass: 'text-[var(--g-ink)] hover:bg-[var(--g-brand-muted)]', webIcon: 'text-[var(--g-brand)]' },
    { to: paths.timesheet.announcements, labelKey: 'admin.announcements', icon: FileText, className: 'bg-slate-100 text-slate-800', webClass: 'text-[var(--g-ink)] hover:bg-[var(--g-fill)]', webIcon: 'text-[var(--g-ink-2)]' },
    { to: paths.timesheet.adminForms, labelKey: 'admin.surveyForms', icon: ClipboardList, className: 'bg-slate-100 text-slate-800', webClass: 'text-[var(--g-ink)] hover:bg-[var(--g-fill)]', webIcon: 'text-[var(--g-ink-2)]' },
    { to: paths.timesheet.adminCompanyForms, labelKey: 'admin.companyForms', icon: ClipboardList, className: 'bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]', webClass: 'text-[var(--g-ink)] hover:bg-[var(--g-brand-muted)]', webIcon: 'text-[var(--g-brand)]' },
];

const TAB_TITLE_KEYS = {
    'time-tracker': 'admin.timeTracker',
    leaves: 'admin.leaves',
    'payslip-report': 'admin.payslip',
    'timesheet-report': 'admin.timesheet',
    'worker-info': 'admin.workers',
    sites: 'admin.sites',
    vehicles: 'admin.vehicles',
};

const MORE_TAB_IDS = new Set(APP_MORE_TABS.map((t) => t.id));

function useNavLock(open, className) {
    useEffect(() => {
        if (!open) return undefined;
        document.documentElement.classList.add(className);
        const onKeyDown = (e) => {
            if (e.key === 'Escape') document.dispatchEvent(new CustomEvent('akk-admin-nav-close'));
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.documentElement.classList.remove(className);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [open, className]);
}

/** Close overlays when the route changes (sidebar / tab / Link navigation). Skip the mount run. */
function useCloseOnNavigate(close) {
    const { pathname, search } = useLocation();
    const prev = useRef(`${pathname}${search}`);
    useEffect(() => {
        const key = `${pathname}${search}`;
        if (prev.current === key) return;
        prev.current = key;
        close();
    }, [pathname, search, close]);
}

function LeaveBadge({ count }) {
    if (!count) return null;
    return (
        <Badge variant="destructive" className="ml-auto shrink-0 px-2 py-0 text-xs">
            {count}
        </Badge>
    );
}

/** Phone: horizontal section picker under the hub TopBar (hub TabBar stays the only bottom chrome). */
export function AdminMobileSectionStrip({ activeTab, onTabChange, leaveCount = 0, className }) {
    const { t } = useLanguage();
    return (
        <HubSectionStrip
            className={cn('lg:hidden', className)}
            ariaLabel={t('admin.sections')}
            tour="admin-tabs"
            activeId={activeTab}
            onChange={onTabChange}
            badgeCount={leaveCount}
            tabs={DASH_TABS.map((tab) => ({
                id: tab.id,
                label: t(tab.labelKey),
                icon: tab.icon,
                badge: tab.badge,
                tour: tab.tour,
            }))}
        />
    );
}

/** Manager dashboard sections — same strip language as admin. */
const MANAGER_STRIP_TABS = [
    { id: 'time-tracker', labelKey: 'admin.timeTracker', icon: Clock, tour: 'manager-tab-time-tracker' },
    { id: 'leaves', labelKey: 'admin.leaves', icon: Calendar, tour: 'manager-tab-leaves', badge: true },
    { id: 'company-forms', labelKey: 'admin.companyForms', icon: ClipboardList, tour: 'manager-tab-forms' },
    { id: 'timesheets', labelKey: 'admin.timesheet', icon: FileText, tour: 'manager-tab-timesheets' },
];

export const MANAGER_TAB_TITLES = {
    'time-tracker': 'Time Tracker',
    leaves: 'Leaves',
    'company-forms': 'Company Forms',
    timesheets: 'Timesheets',
};

export function ManagerMobileSectionStrip({ activeTab, onTabChange, leaveCount = 0, className }) {
    const { t } = useLanguage();
    return (
        <HubSectionStrip
            className={cn('lg:hidden', className)}
            ariaLabel={t('admin.sections')}
            tour="manager-tabs"
            activeId={activeTab}
            onChange={onTabChange}
            badgeCount={leaveCount}
            tabs={MANAGER_STRIP_TABS.map((tab) => ({
                id: tab.id,
                label: t(tab.labelKey),
                icon: tab.icon,
                badge: tab.badge,
                tour: tab.tour,
            }))}
        />
    );
}

/** Extra admin routes (analytics, forms, …) — drawer only; main sections use AdminMobileSectionStrip. */
export function AdminMorePagesDrawer({ onTutorial, onLogout }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    useNavLock(open, 'mobile-nav-open');
    useCloseOnNavigate(close);

    useEffect(() => {
        const onClose = () => setOpen(false);
        document.addEventListener('akk-admin-nav-close', onClose);
        const mq = window.matchMedia('(min-width: 1024px)');
        const onViewportChange = () => {
            if (mq.matches) setOpen(false);
        };
        mq.addEventListener('change', onViewportChange);
        return () => {
            document.removeEventListener('akk-admin-nav-close', onClose);
            mq.removeEventListener('change', onViewportChange);
        };
    }, []);

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-[var(--g-ink-2)] hover:bg-[var(--g-brand-soft)] hover:text-[var(--g-brand)] lg:hidden"
                aria-label={t('admin.pages')}
                aria-expanded={open}
                aria-controls="admin-more-pages-panel"
                onClick={() => setOpen(true)}
            >
                <Menu className="h-5 w-5" />
            </Button>
            {/* Mount only while open — avoids a permanent off-screen (or stuck) overlay costing paint. */}
            {open
                ? createPortal(
                    <div className="fixed inset-0 z-[100] lg:hidden" role="presentation">
                        <button
                            type="button"
                            aria-label={t('admin.closeMenu')}
                            className="admin-nav-backdrop absolute inset-0 bg-slate-900/45 opacity-100"
                            onClick={close}
                        />
                        <nav
                            id="admin-more-pages-panel"
                            className="dashboard-mobile-nav admin-nav-drawer is-open absolute left-0 top-0 z-[101] flex w-[min(20rem,88vw)] flex-col border-r border-[var(--g-hairline)] bg-[var(--g-surface)] pt-[env(safe-area-inset-top,0px)] shadow-xl"
                            aria-label={t('admin.pages')}
                            style={{ touchAction: 'pan-y' }}
                        >
                            <div className="admin-nav-drawer__head flex items-center justify-between border-b border-[var(--g-hairline)] px-4 py-3">
                                <span className="text-sm font-semibold tracking-tight text-[var(--g-ink)]">{t('admin.pages')}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 shrink-0"
                                    aria-label={t('admin.closeMenu')}
                                    onClick={close}
                                >
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                            <div className="nested-touch-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
                                {APP_MORE_PAGES.map((page) => {
                                    const Icon = page.icon;
                                    return (
                                        <Link
                                            key={page.to}
                                            to={page.to}
                                            className={cn(
                                                'flex h-auto min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                                                page.webClass
                                            )}
                                            onClick={close}
                                        >
                                            <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]', page.className)}>
                                                <Icon className="h-4 w-4" aria-hidden />
                                            </span>
                                            {t(page.labelKey)}
                                        </Link>
                                    );
                                })}
                            </div>
                            <div className="dashboard-mobile-nav-footer mt-auto shrink-0 border-t border-[var(--g-hairline)] p-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal text-[var(--g-ink-2)] hover:bg-[var(--g-fill)]"
                                    onClick={() => {
                                        close();
                                        onTutorial?.();
                                    }}
                                >
                                    <HelpCircle className="h-5 w-5 shrink-0 text-[var(--g-brand)]" />
                                    <span className="text-sm font-medium">{t('common.tutorial')}</span>
                                </Button>
                                {typeof onLogout === 'function' ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="mt-1 h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal text-red-600 hover:bg-red-50 hover:text-red-700"
                                        onClick={() => {
                                            close();
                                            onLogout();
                                        }}
                                    >
                                        <LogOut className="h-5 w-5 shrink-0" />
                                        <span className="text-sm font-medium">{t('common.logout')}</span>
                                    </Button>
                                ) : null}
                            </div>
                        </nav>
                    </div>,
                    document.body
                )
                : null}
        </>
    );
}

/** Website phone hamburger. Owns its own open state so the huge dashboard does not re-render. */
export function AdminWebsiteMobileNav({
    activeTab,
    onTabChange,
    leaveCount = 0,
    onTutorial,
    onLogout,
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    useNavLock(open, 'mobile-nav-open');
    useCloseOnNavigate(close);

    useEffect(() => {
        const onClose = () => setOpen(false);
        document.addEventListener('akk-admin-nav-close', onClose);
        const mq = window.matchMedia('(min-width: 1024px)');
        const onViewportChange = () => {
            if (mq.matches) setOpen(false);
        };
        mq.addEventListener('change', onViewportChange);
        return () => {
            document.removeEventListener('akk-admin-nav-close', onClose);
            mq.removeEventListener('change', onViewportChange);
        };
    }, []);

    const pickTab = (id) => {
        onTabChange(id);
        close();
    };

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-[var(--g-ink-2)] hover:bg-[var(--g-brand-soft)] hover:text-[var(--g-brand)] lg:hidden"
                aria-label={t('admin.openMenu')}
                aria-expanded={open}
                aria-controls="admin-mobile-nav-panel"
                data-tour="admin-mobile-nav-trigger"
                onClick={() => setOpen(true)}
            >
                <Menu className="h-5 w-5" />
            </Button>

            {open
                ? createPortal(
                    <div className="fixed inset-0 z-[100] lg:hidden" role="presentation">
                        <button
                            type="button"
                            aria-label={t('admin.closeMenu')}
                            className="admin-nav-backdrop absolute inset-0 bg-slate-900/45 opacity-100"
                            onClick={close}
                        />
                        <nav
                            id="admin-mobile-nav-panel"
                            className="dashboard-mobile-nav admin-nav-drawer is-open absolute left-0 top-0 z-[101] flex w-[min(20rem,88vw)] flex-col border-r border-[var(--g-hairline)] bg-[var(--g-surface)] pt-[env(safe-area-inset-top,0px)] shadow-xl"
                            aria-label={t('admin.pages')}
                            data-tour="admin-mobile-nav-panel"
                            style={{ touchAction: 'pan-y' }}
                        >
                            <div className="admin-nav-drawer__head flex items-center justify-between border-b border-[var(--g-hairline)] px-4 py-3">
                                <span className="text-sm font-semibold tracking-tight text-[var(--g-ink)]">{t('admin.pages')}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 shrink-0"
                                    aria-label={t('admin.closeMenu')}
                                    onClick={close}
                                >
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                            <div className="nested-touch-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
                                {DASH_TABS.map((tab) => {
                                    const Icon = tab.icon;
                                    const active = activeTab === tab.id;
                                    return (
                                        <Button
                                            key={tab.id}
                                            type="button"
                                            variant={active ? 'secondary' : 'ghost'}
                                            className={cn(
                                                'relative h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal',
                                                active && 'bg-[var(--g-brand-soft)] text-[var(--g-brand-text)] hover:bg-[var(--g-brand-soft)]'
                                            )}
                                            data-tour={tab.tour}
                                            onClick={() => pickTab(tab.id)}
                                        >
                                            <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-[var(--g-brand)]' : tab.iconClass)} />
                                            <span className={cn('text-sm font-medium', active ? 'text-[var(--g-brand-text)]' : 'text-[var(--g-ink)]')}>{t(tab.labelKey)}</span>
                                            {tab.badge ? <LeaveBadge count={leaveCount} /> : null}
                                        </Button>
                                    );
                                })}
                            </div>
                            <div className="dashboard-mobile-nav-footer mt-auto shrink-0 border-t border-[var(--g-hairline)] p-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal text-[var(--g-ink-2)] hover:bg-[var(--g-fill)]"
                                    onClick={() => {
                                        onTabChange('time-tracker');
                                        close();
                                        onTutorial?.();
                                    }}
                                >
                                    <HelpCircle className="h-5 w-5 shrink-0 text-[var(--g-brand)]" />
                                    <span className="text-sm font-medium">{t('common.tutorial')}</span>
                                </Button>
                                {APP_MORE_PAGES.map((page) => {
                                    const Icon = page.icon;
                                    return (
                                        <Link
                                            key={page.to}
                                            to={page.to}
                                            className={cn(
                                                'flex h-auto min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                                                page.webClass
                                            )}
                                            onClick={close}
                                        >
                                            <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]', page.className)}>
                                                <Icon className="h-4 w-4" aria-hidden />
                                            </span>
                                            {t(page.labelKey)}
                                        </Link>
                                    );
                                })}
                                {typeof onLogout === 'function' ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="mt-1 h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal text-red-600 hover:bg-red-50 hover:text-red-700"
                                        onClick={() => {
                                            close();
                                            onLogout();
                                        }}
                                    >
                                        <LogOut className="h-5 w-5 shrink-0" />
                                        <span className="text-sm font-medium">{t('common.logout')}</span>
                                    </Button>
                                ) : null}
                            </div>
                        </nav>
                    </div>,
                    document.body
                )
                : null}
        </>
    );
}

/**
 * Standalone Android admin chrome (header + optional More sheet).
 * In the hub shell the dock is CSS-hidden — prefer TopBar + AdminMobileSectionStrip +
 * AdminMorePagesDrawer so section switching and More pages stay reachable.
 */
export function AdminAppChrome({
    activeTab,
    onTabChange,
    leaveCount = 0,
    onTutorial,
    onLogout,
    logoUrl,
}) {
    const { t } = useLanguage();
    const [moreOpen, setMoreOpen] = useState(false);
    const closeMore = useCallback(() => setMoreOpen(false), []);
    const moreActive = MORE_TAB_IDS.has(activeTab);

    useNavLock(moreOpen, 'admin-app-sheet-open');
    useCloseOnNavigate(closeMore);

    useEffect(() => {
        const onClose = () => setMoreOpen(false);
        document.addEventListener('akk-admin-nav-close', onClose);
        return () => document.removeEventListener('akk-admin-nav-close', onClose);
    }, []);

    const backStateRef = useRef({ moreOpen, activeTab, onTabChange });
    backStateRef.current = { moreOpen, activeTab, onTabChange };
    useEffect(() => registerNativeBackHandler(() => {
        const state = backStateRef.current;
        if (state.moreOpen) {
            setMoreOpen(false);
            return true;
        }
        if (state.activeTab && state.activeTab !== 'time-tracker') {
            state.onTabChange('time-tracker');
            return true;
        }
        return false;
    }), []);

    const pickTab = (id) => {
        onTabChange(id);
        closeMore();
    };

    const leaveBadge = leaveCount > 0 ? (
        <span className="akk-tabbar__badge" aria-hidden>{leaveCount > 99 ? '99+' : leaveCount}</span>
    ) : null;

    return (
        <>
            <NativeNavBar
                className="admin-app-header"
                data-tour="admin-header"
                leading={logoUrl ? <img src={logoUrl} alt="" className="akk-navbar__logo" /> : null}
                eyebrow={t('role.admin')}
                eyebrowTone="admin"
                title={t(TAB_TITLE_KEYS[activeTab] || 'admin.dashboard')}
                trailing={(
                    <div className="flex items-center gap-1">
                        {/* Hub CSS hides the dock — keep More reachable from the header. */}
                        <NativeIconButton
                            icon={Menu}
                            label={t('admin.menu')}
                            onClick={() => setMoreOpen(true)}
                            aria-expanded={moreOpen}
                            aria-haspopup="dialog"
                        />
                        {typeof onLogout === 'function' ? (
                            <NativeIconButton icon={LogOut} label={t('common.logOut')} tone="danger" onClick={onLogout} />
                        ) : null}
                    </div>
                )}
            />
            <div className="flex justify-end border-b border-slate-200/70 bg-white px-3 py-2">
                <LanguageSwitcher />
            </div>

            {moreOpen
                ? createPortal(
                    <div className="fixed inset-0 z-[100]" role="presentation">
                        <button
                            type="button"
                            aria-label={t('admin.closeMenu')}
                            className="admin-nav-backdrop absolute inset-0 bg-slate-900/40 opacity-100"
                            onClick={closeMore}
                        />
                        <nav
                            className="admin-app-sheet akk-sheet is-open absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,42rem)] flex-col"
                            aria-label="Admin pages"
                            role="dialog"
                            aria-modal="true"
                            style={{ touchAction: 'pan-y' }}
                        >
                            <div className="akk-sheet__grabber" aria-hidden="true" />
                            <div className="flex items-center justify-between px-5 pb-1 pt-3">
                                <p className="text-[17px] font-semibold tracking-tight text-slate-900">{t('admin.menu')}</p>
                                <NativeIconButton icon={X} label={t('admin.closeMenu')} onClick={closeMore} />
                            </div>
                            <div className="nested-touch-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1.25rem+var(--akk-safe-bottom,0px))]">
                                <div className="mb-3 flex justify-end">
                                    <LanguageSwitcher />
                                </div>
                                <h3 className="akk-section-title">{t('admin.sections')}</h3>
                                <div className="akk-group">
                                    {APP_MORE_TABS.map((tab) => {
                                        const active = activeTab === tab.id;
                                        return (
                                            <NativeListRow
                                                key={tab.id}
                                                icon={tab.icon}
                                                iconClass={active ? 'akk-tone-brand' : (tab.iconClass || 'bg-slate-100 text-slate-700')}
                                                title={t(tab.labelKey)}
                                                hint={t(tab.hintKey)}
                                                data-tour={tab.tour}
                                                aria-current={active ? 'page' : undefined}
                                                onClick={() => pickTab(tab.id)}
                                                trailing={active ? <span className="akk-pill" data-tone="brand">{t('admin.open')}</span> : undefined}
                                            />
                                        );
                                    })}
                                </div>
                                <h3 className="akk-section-title">{t('admin.pages')}</h3>
                                <div className="akk-group">
                                    {APP_MORE_PAGES.map((page) => (
                                        <NativeListRow
                                            key={page.to}
                                            icon={page.icon}
                                            iconClass={page.className}
                                            title={t(page.labelKey)}
                                            to={page.to}
                                            onClick={closeMore}
                                        />
                                    ))}
                                    <NativeListRow
                                        icon={HelpCircle}
                                        iconClass="bg-amber-100 text-amber-800"
                                        title={t('common.tutorial')}
                                        hint={t('admin.tutorialHint')}
                                        onClick={() => {
                                            onTabChange('time-tracker');
                                            closeMore();
                                            onTutorial?.();
                                        }}
                                    />
                                </div>
                            </div>
                        </nav>
                    </div>,
                    document.body
                )
                : null}

            <nav className="admin-app-dock akk-tabbar akk-hide-on-kb" aria-label="Admin sections" data-tour="admin-tabs">
                <div className="akk-tabbar__grid">
                    {APP_DOCK_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                data-tour={tab.tour}
                                data-active={active}
                                aria-current={active ? 'page' : undefined}
                                aria-label={tab.badge && leaveCount > 0 ? `${t(tab.labelKey)}, ${leaveCount}` : undefined}
                                onClick={() => pickTab(tab.id)}
                                className="akk-tabbar__item"
                            >
                                <Icon strokeWidth={active ? 2.2 : 1.9} aria-hidden />
                                {t(tab.labelKey)}
                                {tab.badge ? leaveBadge : null}
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        onClick={() => setMoreOpen(true)}
                        data-active={moreActive || moreOpen}
                        aria-expanded={moreOpen}
                        aria-haspopup="dialog"
                        className="akk-tabbar__item"
                    >
                        <Menu strokeWidth={moreActive || moreOpen ? 2.2 : 1.9} aria-hidden />
                        {moreActive ? t(TAB_TITLE_KEYS[activeTab] || 'admin.more') : t('admin.more')}
                    </button>
                </div>
            </nav>
        </>
    );
}
