import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Loader2, ClipboardList, Users, Palette, FileText } from 'lucide-react';
import ProgressPortalShell from '@/modules/progress/components/ProgressPortalShell';
import PackageReviewBoard from '@/modules/progress/components/PackageReviewBoard';
import WorkerAccountsPanel from '@/modules/progress/components/WorkerAccountsPanel';
import NativeBottomNav from '@/modules/progress/components/mobile/NativeBottomNav';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { isNativeApp } from '@/core/platform';
import { registerPushForCurrentSession } from '@/core/push';
import { useLoginWelcome } from '@/modules/progress/hooks/useLoginWelcome';
import AuthChecking from '@/ui/AuthChecking';
import { prefetchStaffRoutesIdle } from '@/modules/progress/lib/prefetchRoutes';
import { useHubSection } from '@/app/useHubSection';

const MANAGER_SECTIONS = ['packages', 'workers', 'jsr', 'branding'];

const BrandingPanel = lazy(() => import('@/modules/progress/components/BrandingPanel'));
const CommercialHub = lazy(() => import('@/modules/progress/components/jsr/CommercialHub'));

const SECTION_LABELS = {
  packages: 'Packages',
  workers: 'Employees',
  branding: 'Branding & settings',
  jsr: 'JSR & billing',
};

export default function ManagerDashboard() {
  const session = useRoleGuard('manager');
  const [tab, setTab] = useHubSection('packages', MANAGER_SECTIONS);
  const { overlay } = useLoginWelcome({ ready: Boolean(session) });

  useEffect(() => {
    if (session) {
      registerPushForCurrentSession('manager');
      prefetchStaffRoutesIdle();
    }
  }, [session]);

  const groups = useMemo(
    () => [
      {
        label: 'Operations',
        items: [
          { id: 'packages', label: 'Packages', icon: ClipboardList },
          { id: 'jsr', label: 'JSR & billing', icon: FileText },
        ],
      },
      {
        label: 'People & admin',
        items: [
          { id: 'workers', label: 'Employees', icon: Users },
          { id: 'branding', label: 'Branding & settings', icon: Palette },
        ],
      },
    ],
    []
  );

  if (session === undefined) return overlay || <AuthChecking />;
  if (!session) return overlay || <AuthChecking />;


  return (
    <>
      {overlay}
      <ProgressPortalShell
        portalLabel="Site progress"
        roleLabel="Manager"
        session={session}
        groups={groups}
        value={tab}
        onChange={setTab}
        notificationRole="manager"
        sectionLabel={SECTION_LABELS[tab]}
      >
        {tab === 'packages' ? <PackageReviewBoard role="manager" /> : null}
        {tab === 'workers' ? <WorkerAccountsPanel /> : null}
        {tab === 'branding' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading settings…
              </div>
            }
          >
            <BrandingPanel />
          </Suspense>
        ) : null}
        {tab === 'jsr' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading JSR module…
              </div>
            }
          >
            <CommercialHub role="manager" />
          </Suspense>
        ) : null}
      </ProgressPortalShell>
      {isNativeApp() ? (
        <NativeBottomNav
          items={[
            { id: 'packages', icon: ClipboardList, label: 'Packages', active: tab === 'packages', onClick: () => setTab('packages') },
            { id: 'workers', icon: Users, label: 'Employees', active: tab === 'workers', onClick: () => setTab('workers') },
            { id: 'jsr', icon: FileText, label: 'JSR', active: tab === 'jsr', onClick: () => setTab('jsr') },
            { id: 'branding', icon: Palette, label: 'Settings', active: tab === 'branding', onClick: () => setTab('branding') },
          ]}
        />
      ) : null}
    </>
  );
}
