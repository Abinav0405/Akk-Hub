import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppShell, PageHeader } from '@/ui/layout';
import AuthChecking from '@/ui/AuthChecking';
import MyAccountPanel, {
  ACCOUNT_ROLE_META,
  WorkerNativeNav,
} from '@/modules/progress/components/MyAccountPanel';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { useNotifications } from '@/modules/progress/hooks/useNotifications';
import { isNativeApp } from '@/core/platform';
import { isWorkerAuthenticated } from '@/core/auth/progress/workerSession';
import { isManagerAuthenticated } from '@/core/auth/progress/managerSession';
import { isExporterAuthenticated } from '@/core/auth/progress/exporterSession';
import { isAdminAuthenticated } from '@/core/auth/progress/adminSession';
import { activePortalRole } from '@/core/auth/progress/portalAuth';
import { routeSearchParams } from '@/modules/progress/lib/utils';

const ROLES = ['worker', 'manager', 'admin', 'exporter'];

function parseRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLES.includes(role) ? role : null;
}

export function detectAccountRole() {
  const portal = activePortalRole();
  if (portal && ROLES.includes(portal)) return portal;
  if (isWorkerAuthenticated()) return 'worker';
  if (isManagerAuthenticated()) return 'manager';
  if (isExporterAuthenticated()) return 'exporter';
  if (isAdminAuthenticated()) return 'admin';
  return 'worker';
}

export default function MyAccount() {
  const [params] = useSearchParams();
  const native = isNativeApp();
  const role = useMemo(
    () => parseRole(routeSearchParams(params).get('role')) || detectAccountRole(),
    [params]
  );
  const session = useRoleGuard(role);
  const inbox = useNotifications(role === 'worker' && session ? 'worker' : null);
  const meta = ACCOUNT_ROLE_META[role] || ACCOUNT_ROLE_META.worker;

  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (!session) return;
    setUserId(session.employee_code || '');
    setDisplayName(session.display_name || '');
  }, [session]);

  if (session === undefined) return <AuthChecking />;
  if (!session) return <AuthChecking />;

  return (
    <>
      <AppShell
        tabBar={native && role === 'worker'}
        header={
          <PageHeader
            title="My Account"
            description="Update your display name or change your password."
            backTo={meta.portal}
            backLabel="Back"
            variant={meta.variant}
          />
        }
        maxWidth="xl"
      >
        <MyAccountPanel
          role={role}
          userId={userId}
          displayName={displayName}
          onUserIdChange={setUserId}
          onDisplayNameChange={setDisplayName}
        />
      </AppShell>
      {role === 'worker' ? <WorkerNativeNav unread={inbox.unread} /> : null}
    </>
  );
}
