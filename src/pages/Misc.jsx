/** Small hub screens: notifications inbox, connect page, not found. */
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BellRing, Boxes, CalendarDays, ClipboardCheck, ClipboardList, Compass } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { EmptyState, List, ListRow, SectionLabel } from '@/ui/hub/primitives';
import { useModuleConnection } from '@/core/auth/bridges';
import { useNotifications } from '@/modules/progress/hooks/useNotifications';
import { formatDateTime } from '@/modules/progress/lib/dates';
import { notificationTarget } from '@/core/notificationLinks';
import { useBadges, useStaffCounts } from '@/app/badges';
import { sectionHref } from '@/app/useHubSection';
import { paths } from '@/app/paths';
import ConnectForm from '@/pages/connect/ConnectForm';
import { MODULE_LABELS, moduleRoleFor } from '@/core/auth/bridges';
import { homePathFor, useIdentity } from '@/core/auth/identity';
import { useLanguage } from '@/core/i18n';
import { legacyPath } from '@/app/paths';

/**
 * Staff inbox: what is waiting (new since this device last looked) and Site work alerts. Every
 * row opens the exact screen — a package opens that package.
 */
export function Notifications() {
    const { t } = useLanguage();
    const identity = useIdentity();
    const navigate = useNavigate();
    const role = identity?.role;
    const staff = role === 'manager' || role === 'admin';
    const progress = useModuleConnection(role, 'progress');
    const inbox = useNotifications(staff && progress === 'connected' ? role : null, { toastOnArrival: false });
    const counts = useStaffCounts();
    const fresh = useBadges(counts);
    const home = role === 'admin' ? paths.timesheet.admin : paths.timesheet.manage;
    const waiting = [
        { key: 'shifts', icon: ClipboardCheck, tone: 'timesheet', title: 'Shifts & on site', to: role === 'supervisor' ? paths.timesheet.siteShifts : home },
        staff && { key: 'leave', icon: CalendarDays, tone: 'timesheet', title: 'Leave requests', to: sectionHref(home, 'leaves') },
        staff && { key: 'materials', icon: Boxes, tone: 'materials', title: 'Material requests', to: role === 'admin' ? paths.materials.admin : paths.materials.manage },
        staff && { key: 'packages', icon: ClipboardList, tone: 'progress', title: 'Site packages', to: role === 'admin' ? paths.progress.admin : paths.progress.review },
    ].filter((row) => row && counts[row.key] > 0);

    const open = (item) => {
        const to = notificationTarget({ path: item.path, title: item.title, body: item.body, packageId: item.packageId, role, module: 'progress' });
        if (to) navigate(to);
    };

    return (
        <HubPage title={t('hub.misc.notificationsTitle')} eyebrow={t('hub.brand')} narrow>
            {waiting.length ? (
                <>
                    <SectionLabel>Waiting for you</SectionLabel>
                    <List>
                        {waiting.map((row) => (
                            <ListRow
                                key={row.key}
                                to={row.to}
                                icon={row.icon}
                                tone={row.tone}
                                title={row.title}
                                hint={`${counts[row.key]} waiting${fresh[row.key] ? ' · new' : ''}`}
                                badge={fresh[row.key] ? <span className="g-tabbar__badge !static">{fresh[row.key]}</span> : null}
                            />
                        ))}
                    </List>
                </>
            ) : null}
            {inbox.items.length ? (
                <>
                    <SectionLabel action={inbox.unread ? <button type="button" className="text-[var(--g-brand-text)]" onClick={() => inbox.markRead()}>Mark all read</button> : null}>
                        Site work
                    </SectionLabel>
                    <List>
                        {inbox.items.map((item) => (
                            <ListRow
                                key={item.id}
                                icon={ClipboardList}
                                tone="progress"
                                title={item.title}
                                hint={`${item.body || ''}${item.body ? ' · ' : ''}${formatDateTime(item.createdAt, { seconds: false })}`}
                                className={item.readAt ? undefined : 'bg-[var(--g-brand-muted)]'}
                                onClick={() => {
                                    if (!item.readAt) inbox.markRead([item.id]).catch(() => {});
                                    open(item);
                                }}
                            />
                        ))}
                    </List>
                </>
            ) : null}
            {!waiting.length && !inbox.items.length ? (
                <EmptyState icon={BellRing} title="You're all caught up">
                    New approvals and Site work alerts show up here. Tap one to open it.
                </EmptyState>
            ) : null}
        </HubPage>
    );
}

export function ConnectPage() {
    const { module } = useParams();
    const identity = useIdentity();
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useLanguage();
    const asParam = new URLSearchParams(location.search).get('as');
    const exporterMode = module === 'progress' && asParam === 'exporter';
    // useRoleGuard sends ?as=admin|manager|worker on deny — always allow that reconnect,
    // even if hub role mapping briefly looks empty (was bouncing to blank /admin).
    const reconnectAs =
        module === 'progress' && ['worker', 'manager', 'admin'].includes(asParam) ? asParam : null;
    const moduleRole = moduleRoleFor(identity?.role, module);
    if (!MODULE_LABELS[module] || module === 'timesheet' || (!exporterMode && !moduleRole && !reconnectAs)) {
        return <Navigate to={homePathFor(identity?.role)} replace />;
    }

    const effectiveRole = reconnectAs || moduleRole || identity?.role;
    const destination = exporterMode
        ? '/progress/client'
        : module === 'materials'
          ? { worker: '/materials/request', manager: '/materials/manage', admin: '/materials/admin' }[identity?.role]
          : { worker: '/progress/submit', manager: '/progress/review', admin: '/progress/admin' }[effectiveRole];
    return (
        <HubPage
            title={t('hub.misc.connectTitle', { module: MODULE_LABELS[module] })}
            eyebrow={t('hub.misc.connectEyebrow')}
            backTo={homePathFor(identity?.role)}
            narrow
        >
            <ConnectForm module={module} onConnected={() => navigate(destination || homePathFor(identity?.role), { replace: true })} />
        </HubPage>
    );
}

/** Unknown path: try old page names from the three apps (/WorkerPortal, /Home…), else 404. */
export function NotFound() {
    const { pathname, search } = useLocation();
    const identity = useIdentity();
    const { t } = useLanguage();
    const name = pathname.replace(/^\/+/, '').split('/')[0];
    if (name && !pathname.slice(1).includes('/')) {
        const target = legacyPath(name);
        if (target !== `/${name}`) return <Navigate to={`${target}${search}`} replace />;
    }
    const home = identity ? homePathFor(identity.role) : '/';
    return (
        <HubPage title={t('hub.misc.notFound')} backTo={home} narrow>
            <EmptyState icon={Compass} title={t('hub.misc.notFoundTitle')} action={<Link to={home} className="g-btn g-btn--primary g-btn--sm">{t('hub.misc.goHome')}</Link>}>
                {pathname}
            </EmptyState>
        </HubPage>
    );
}
