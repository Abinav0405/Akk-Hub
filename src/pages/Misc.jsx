/** Small hub screens: notifications placeholder, connect page, not found. */
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BellRing, Compass } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { EmptyState } from '@/ui/hub/primitives';
import ConnectForm from '@/pages/connect/ConnectForm';
import { MODULE_LABELS, moduleRoleFor } from '@/core/auth/bridges';
import { homePathFor, useIdentity } from '@/core/auth/identity';
import { useLanguage } from '@/core/i18n';
import { legacyPath } from '@/app/paths';

export function Notifications() {
    const { t } = useLanguage();
    return (
        <HubPage title={t('hub.misc.notificationsTitle')} eyebrow={t('hub.brand')} narrow>
            <EmptyState icon={BellRing} title={t('hub.misc.notificationsEmpty')}>
                {t('hub.misc.notificationsBody')}
            </EmptyState>
        </HubPage>
    );
}

export function ConnectPage() {
    const { module } = useParams();
    const identity = useIdentity();
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useLanguage();
    const exporterMode = module === 'progress' && new URLSearchParams(location.search).get('as') === 'exporter';
    const moduleRole = moduleRoleFor(identity?.role, module);
    if (!MODULE_LABELS[module] || module === 'timesheet' || (!exporterMode && !moduleRole)) {
        return <Navigate to={homePathFor(identity?.role)} replace />;
    }

    const destination = exporterMode
        ? '/progress/client'
        : module === 'materials'
          ? { worker: '/materials/request', manager: '/materials/manage', admin: '/materials/admin' }[identity?.role]
          : { worker: '/progress/submit', manager: '/progress/review', admin: '/progress/admin' }[identity?.role];
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
