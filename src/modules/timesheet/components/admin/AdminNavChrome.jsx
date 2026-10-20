import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
    Activity, Calendar, Car, ClipboardList, Clock, FileText, HelpCircle,
    LogOut, MapPin, Menu, Receipt, Users, X,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { createPageUrl, cn } from '@/modules/timesheet/lib/utils';
import { registerNativeBackHandler } from '@/core/nativeShell';
import { NativeIconButton, NativeListRow, NativeNavBar } from '@/ui/native/NativeChrome';
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
    { id: 'time-tracker', labelKey: 'admin.timeTracker', icon: Clock, iconClass: 'text-brand', tour: 'admin-tab-time-tracker' },
    { id: 'leaves', labelKey: 'admin.leaves', icon: Calendar, iconClass: 'text-slate-600', tour: 'admin-tab-leaves', badge: true },
    { id: 'payslip-report', labelKey: 'admin.payslipReport', icon: Receipt, iconClass: 'text-slate-600', tour: 'admin-tab-payslip' },
    { id: 'timesheet-report', labelKey: 'admin.timesheet', icon: FileText, iconClass: 'text-slate-600', tour: 'admin-tab-timesheet' },
    { id: 'worker-info', labelKey: 'admin.workerInfo', icon: Users, iconClass: 'text-slate-600', tour: 'admin-tab-worker-info' },
    { id: 'sites', labelKey: 'admin.sites', icon: MapPin, iconClass: 'text-slate-600', tour: 'admin-tab-sites' },
    { id: 'vehicles', labelKey: 'admin.vehicles', icon: Car, iconClass: 'text-slate-600' },
];

const APP_DOCK_TABS = [
    { id: 'time-tracker', labelKey: 'admin.tracker', icon: Clock, tour: 'admin-tab-time-tracker' },
    { id: 'leaves', labelKey: 'admin.leaves', icon: Calendar, tour: 'admin-tab-leaves', badge: true },
    { id: 'worker-info', labelKey: 'admin.workers', icon: Users, tour: 'admin-tab-worker-info' },
];

const APP_MORE_TABS = [
    { id: 'payslip-report', labelKey: 'admin.payslip', hintKey: 'admin.payslipHint', icon: Receipt, tour: 'admin-tab-payslip', tone: 'violet' },
    { id: 'timesheet-report', labelKey: 'admin.timesheet', hintKey: 'admin.timesheetHint', icon: FileText, tour: 'admin-tab-timesheet', tone: 'sky' },
    { id: 'sites', labelKey: 'admin.sites', hintKey: 'admin.sitesHint', icon: MapPin, tour: 'admin-tab-sites', tone: 'emerald' },
    { id: 'vehicles', labelKey: 'admin.vehicles', hintKey: 'admin.vehiclesHint', icon: Car, tone: 'amber' },
];

const APP_MORE_PAGES = [
    { to: 'Analytics', labelKey: 'admin.analytics', icon: Activity, className: 'bg-sky-50 text-sky-800', webClass: 'text-sky-800 hover:bg-sky-50', webIcon: 'text-sky-600' },
    { to: 'AttendanceReport', labelKey: 'admin.attendance', icon: Calendar, className: 'bg-emerald-50 text-emerald-800', webClass: 'text-emerald-800 hover:bg-emerald-50', webIcon: 'text-emerald-600' },
    { to: 'AdminAnnouncements', labelKey: 'admin.announcements', icon: FileText, className: 'bg-violet-50 text-violet-800', webClass: 'text-violet-800 hover:bg-violet-50', webIcon: 'text-violet-600' },
    { to: 'AdminForms', labelKey: 'admin.surveyForms', icon: ClipboardList, className: 'bg-teal-50 text-teal-800', webClass: 'text-teal-800 hover:bg-teal-50', webIcon: 'text-teal-600' },
    { to: 'AdminCompanyForms', labelKey: 'admin.companyForms', icon: ClipboardList, className: 'bg-orange-50 text-orange-800', webClass: 'text-orange-800 hover:bg-orange-50', webIcon: 'text-[#dc6b2f]' },
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

function LeaveBadge({ count }) {
    if (!count) return null;
    return (
        <Badge variant="destructive" className="ml-auto shrink-0 px-2 py-0 text-xs">
            {count}
        </Badge>
    );
}

/** Phone web: horizontal section picker under the hub TopBar (hub TabBar stays the only bottom chrome). */
export function AdminMobileSectionStrip({ activeTab, onTabChange, leaveCount = 0, className }) {
    const { t } = useLanguage();
    return (
        <div
            className={cn('admin-section-strip md:hidden', className)}
            role="tablist"
            aria-label={t('admin.sections')}
            data-tour="admin-tabs"
            data-section-nav
        >
            {DASH_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-tour={tab.tour}
                        className={cn('admin-section-strip__chip', active && 'is-active')}
                        onClick={() => onTabChange(tab.id)}
                    >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span>{t(tab.labelKey)}</span>
                        {tab.badge ? <LeaveBadge count={leaveCount} /> : null}
                    </button>
                );
            })}
        </div>
    );
}

/** Extra admin routes (analytics, forms, …) — drawer only; main sections use AdminMobileSectionStrip. */
export function AdminMorePagesDrawer({ onTutorial, onLogout }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    useNavLock(open, 'mobile-nav-open');

    useEffect(() => {
        const onClose = () => setOpen(false);
        document.addEventListener('akk-admin-nav-close', onClose);
        const mq = window.matchMedia('(min-width: 768px)');
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
                className="h-9 w-9 rounded-full text-slate-600 hover:bg-slate-100 md:hidden"
                aria-label={t('admin.pages')}
                aria-expanded={open}
                aria-controls="admin-more-pages-panel"
                onClick={() => setOpen(true)}
            >
                <Menu className="h-5 w-5" />
            </Button>
            {createPortal(
                <div
                    className={cn(
                        'fixed inset-0 z-[100] md:hidden',
                        open ? 'pointer-events-auto' : 'pointer-events-none'
                    )}
                    aria-hidden={!open}
                >
                    <button
                        type="button"
                        aria-label={t('admin.closeMenu')}
                        className={cn(
                            'admin-nav-backdrop absolute inset-0 bg-black/50',
                            open ? 'opacity-100' : 'opacity-0'
                        )}
                        onClick={close}
                    />
                    <nav
                        id="admin-more-pages-panel"
                        className={cn(
                            'dashboard-mobile-nav admin-nav-drawer absolute left-0 top-0 z-[101] flex w-[min(20rem,88vw)] flex-col border-r border-slate-200 bg-white pt-[env(safe-area-inset-top,0px)] shadow-xl',
                            open ? 'is-open' : ''
                        )}
                        aria-label={t('admin.pages')}
                        style={{ touchAction: 'pan-y' }}
                    >
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <span className="text-sm font-semibold text-slate-800">{t('admin.pages')}</span>
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
                        <div className="nested-touch-scroll flex flex-1 flex-col gap-1 overflow-y-auto p-2">
                            {APP_MORE_PAGES.map((page) => {
                                const Icon = page.icon;
                                return (
                                    <Link
                                        key={page.to}
                                        to={createPageUrl(page.to)}
                                        className={cn(
                                            'flex h-auto min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                                            page.webClass
                                        )}
                                        onClick={close}
                                    >
                                        <Icon className={cn('h-5 w-5 shrink-0', page.webIcon)} />
                                        {t(page.labelKey)}
                                    </Link>
                                );
                            })}
                        </div>
                        <div className="dashboard-mobile-nav-footer mt-auto shrink-0 border-t border-slate-200 p-2">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal text-amber-900 hover:bg-amber-50"
                                onClick={() => {
                                    close();
                                    onTutorial();
                                }}
                            >
                                <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
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
            )}
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

    useEffect(() => {
        const onClose = () => setOpen(false);
        document.addEventListener('akk-admin-nav-close', onClose);
        const mq = window.matchMedia('(min-width: 768px)');
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
                className="h-9 w-9 rounded-full text-slate-600 hover:bg-slate-100 md:hidden"
                aria-label={t('admin.openMenu')}
                aria-expanded={open}
                aria-controls="admin-mobile-nav-panel"
                data-tour="admin-mobile-nav-trigger"
                onClick={() => setOpen(true)}
            >
                <Menu className="h-5 w-5" />
            </Button>

            {createPortal(
            <div
                className={cn(
                    'fixed inset-0 z-[100] md:hidden',
                    open ? 'pointer-events-auto' : 'pointer-events-none'
                )}
                aria-hidden={!open}
            >
                <button
                    type="button"
                    aria-label={t('admin.closeMenu')}
                    className={cn(
                        'admin-nav-backdrop absolute inset-0 bg-black/50',
                        open ? 'opacity-100' : 'opacity-0'
                    )}
                    onClick={close}
                />
                <nav
                    id="admin-mobile-nav-panel"
                    className={cn(
                        'dashboard-mobile-nav admin-nav-drawer absolute left-0 top-0 z-[101] flex w-[min(20rem,88vw)] flex-col border-r border-slate-200 bg-white pt-[env(safe-area-inset-top,0px)] shadow-xl',
                        open ? 'is-open' : ''
                    )}
                    aria-label={t('admin.pages')}
                    data-tour="admin-mobile-nav-panel"
                    style={{ touchAction: 'pan-y' }}
                >
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <span className="text-sm font-semibold text-slate-800">{t('admin.pages')}</span>
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
                    <div className="nested-touch-scroll flex flex-1 flex-col gap-1 overflow-y-auto p-2">
                        {DASH_TABS.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <Button
                                    key={tab.id}
                                    type="button"
                                    variant={activeTab === tab.id ? 'secondary' : 'ghost'}
                                    className="relative h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal"
                                    data-tour={tab.tour}
                                    onClick={() => pickTab(tab.id)}
                                >
                                    <Icon className={cn('h-5 w-5 shrink-0', tab.iconClass)} />
                                    <span className="text-sm font-medium text-slate-800">{t(tab.labelKey)}</span>
                                    {tab.badge ? <LeaveBadge count={leaveCount} /> : null}
                                </Button>
                            );
                        })}
                    </div>
                    <div className="dashboard-mobile-nav-footer mt-auto shrink-0 border-t border-slate-200 p-2">
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto min-h-11 w-full justify-start gap-3 px-3 py-2.5 text-left font-normal text-amber-900 hover:bg-amber-50"
                            onClick={() => {
                                onTabChange('time-tracker');
                                close();
                                onTutorial();
                            }}
                        >
                            <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
                            <span className="text-sm font-medium">{t('common.tutorial')}</span>
                        </Button>
                        {APP_MORE_PAGES.map((page) => {
                            const Icon = page.icon;
                            return (
                                <Link
                                    key={page.to}
                                    to={createPageUrl(page.to)}
                                    className={cn(
                                        'flex h-auto min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                                        page.webClass
                                    )}
                                    onClick={close}
                                >
                                    <Icon className={cn('h-5 w-5 shrink-0', page.webIcon)} />
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
            )}
        </>
    );
}

/** Android-only admin chrome: glass nav bar, bottom tab bar and a CSS "More" sheet. */
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

    useEffect(() => {
        const onClose = () => setMoreOpen(false);
        document.addEventListener('akk-admin-nav-close', onClose);
        return () => document.removeEventListener('akk-admin-nav-close', onClose);
    }, []);

    // Android back: close the More sheet, then return to the first tab before leaving the app.
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
                trailing={typeof onLogout === 'function' ? <NativeIconButton icon={LogOut} label={t('common.logOut')} tone="danger" onClick={onLogout} /> : null}
            />
            <div className="flex justify-end border-b border-slate-200/70 bg-white px-3 py-2">
                <LanguageSwitcher />
            </div>

            {createPortal(
            <div
                className={cn(
                    'fixed inset-0 z-[100]',
                    moreOpen ? 'pointer-events-auto' : 'pointer-events-none'
                )}
                aria-hidden={!moreOpen}
            >
                <button
                    type="button"
                    aria-label={t('admin.closeMenu')}
                    tabIndex={moreOpen ? 0 : -1}
                    className={cn(
                        'admin-nav-backdrop absolute inset-0 bg-slate-900/40',
                        moreOpen ? 'opacity-100' : 'opacity-0'
                    )}
                    onClick={closeMore}
                />
                <nav
                    className={cn(
                        'admin-app-sheet akk-sheet absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,42rem)] flex-col',
                        moreOpen ? 'is-open' : ''
                    )}
                    aria-label="Admin pages"
                    role="dialog"
                    aria-modal={moreOpen}
                    style={{ touchAction: 'pan-y' }}
                >
                    <div className="akk-sheet__grabber" aria-hidden="true" />
                    <div className="flex items-center justify-between px-5 pb-1 pt-3">
                        <p className="text-[17px] font-semibold tracking-tight text-slate-900">{t('admin.menu')}</p>
                        <NativeIconButton icon={X} label={t('admin.closeMenu')} onClick={closeMore} tabIndex={moreOpen ? 0 : -1} />
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
                                        iconClass={active ? 'akk-tone-brand' : 'bg-slate-100 text-slate-700'}
                                        title={t(tab.labelKey)}
                                        hint={t(tab.hintKey)}
                                        data-tour={tab.tour}
                                        aria-current={active ? 'page' : undefined}
                                        tabIndex={moreOpen ? 0 : -1}
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
                                    to={createPageUrl(page.to)}
                                    tabIndex={moreOpen ? 0 : -1}
                                    onClick={closeMore}
                                />
                            ))}
                            <NativeListRow
                                icon={HelpCircle}
                                iconClass="bg-amber-100 text-amber-800"
                                title={t('common.tutorial')}
                                hint={t('admin.tutorialHint')}
                                tabIndex={moreOpen ? 0 : -1}
                                onClick={() => {
                                    onTabChange('time-tracker');
                                    closeMore();
                                    onTutorial();
                                }}
                            />
                        </div>
                    </div>
                </nav>
            </div>,
            document.body
            )}

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
