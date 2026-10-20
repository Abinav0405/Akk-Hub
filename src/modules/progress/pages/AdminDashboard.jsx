import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Loader2, ClipboardList, Users, BarChart3, FileDown, Palette, FileText } from 'lucide-react';
import ProgressPortalShell from '@/modules/progress/components/ProgressPortalShell';
import PackageReviewBoard from '@/modules/progress/components/PackageReviewBoard';
import UsersAccessPanel from '@/modules/progress/components/UsersAccessPanel';
import ExportOnlyAdminPanel from '@/modules/progress/components/ExportOnlyAdminPanel';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { isNativeApp } from '@/core/platform';
import NativeBottomNav from '@/modules/progress/components/mobile/NativeBottomNav';
import { registerPushForCurrentSession } from '@/core/push';
import { useLoginWelcome } from '@/modules/progress/hooks/useLoginWelcome';
import AuthChecking from '@/ui/AuthChecking';
import { prefetchStaffRoutesIdle } from '@/modules/progress/lib/prefetchRoutes';
import { listAllPackages } from '@/modules/progress/lib/staffPackages';
import { listJsrs } from '@/modules/progress/lib/jsr';
import { useHubSection } from '@/app/useHubSection';

const ADMIN_SECTIONS = ['packages', 'exports', 'jsr', 'analytics', 'users', 'branding'];

const AnalyticsPanel = lazy(() => import('@/modules/progress/components/AnalyticsPanel'));
const BrandingPanel = lazy(() => import('@/modules/progress/components/BrandingPanel'));
const CommercialHub = lazy(() => import('@/modules/progress/components/jsr/CommercialHub'));

function PanelFallback({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading {label}…
    </div>
  );
}

const SECTION_LABELS = {
  packages: 'Packages',
  exports: 'Export queue',
  jsr: 'JSR & billing',
  analytics: 'Analytics',
  users: 'Users & access',
  branding: 'Branding & settings',
};

export default function AdminDashboard() {
  const session = useRoleGuard('admin');
  const [tab, setTab] = useHubSection('packages', ADMIN_SECTIONS);
  const [packageBadge, setPackageBadge] = useState(0);
  const [jsrBadge, setJsrBadge] = useState(0);
  const { overlay } = useLoginWelcome({ ready: Boolean(session) });

  useEffect(() => {
    if (session) {
      registerPushForCurrentSession('admin');
      prefetchStaffRoutesIdle();
    }
  }, [session]);

  // Soft badge counts from existing list data (not_sent packages / awaiting-review JSRs).
  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    listAllPackages()
      .then((rows) => {
        if (cancelled) return;
        const n = (rows || []).filter((p) => p.approval_status === 'approved' && !p.sent_to_export).length;
        setPackageBadge(n);
      })
      .catch(() => {});
    listJsrs()
      .then((rows) => {
        if (cancelled) return;
        const n = (rows || []).filter((r) => ['draft', 'submitted', 'rejected'].includes(r.status)).length;
        setJsrBadge(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, tab]);

  const groups = useMemo(
    () => [
      {
        label: 'Operations',
        items: [
          { id: 'packages', label: 'Packages', icon: ClipboardList, badge: packageBadge },
          { id: 'exports', label: 'Export queue', icon: FileDown },
          { id: 'jsr', label: 'JSR & billing', icon: FileText, badge: jsrBadge },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ],
      },
      {
        label: 'People & admin',
        items: [
          { id: 'users', label: 'Users & access', icon: Users },
          { id: 'branding', label: 'Branding & settings', icon: Palette },
        ],
      },
    ],
    [packageBadge, jsrBadge]
  );

  // Never return a blank shell — useRoleGuard redirects to /connect/progress when denied;
  // stale progress flags can leave session null for a beat while ModuleGate still mounts us.
  if (session === undefined) return overlay || <AuthChecking />;
  if (!session) return overlay || <AuthChecking />;


  return (
    <>
      {overlay}
      <ProgressPortalShell
        portalLabel="Site progress"
        roleLabel="Administrator"
        session={session}
        groups={groups}
        value={tab}
        onChange={setTab}
        notificationRole="admin"
        sectionLabel={SECTION_LABELS[tab]}
      >
        {tab === 'packages' ? <PackageReviewBoard role="admin" /> : null}
        {tab === 'users' ? <UsersAccessPanel /> : null}
        {tab === 'exports' ? <ExportOnlyAdminPanel /> : null}
        {tab === 'analytics' ? (
          <Suspense fallback={<PanelFallback label="analytics" />}>
            <AnalyticsPanel />
          </Suspense>
        ) : null}
        {tab === 'branding' ? (
          <Suspense fallback={<PanelFallback label="branding" />}>
            <BrandingPanel />
          </Suspense>
        ) : null}
        {tab === 'jsr' ? (
          <Suspense fallback={<PanelFallback label="JSR module" />}>
            <CommercialHub role="admin" />
          </Suspense>
        ) : null}
      </ProgressPortalShell>
      {isNativeApp() ? (
        <NativeBottomNav
          items={[
            { id: 'packages', icon: ClipboardList, label: 'Packages', active: tab === 'packages', onClick: () => setTab('packages') },
            { id: 'users', icon: Users, label: 'Users', active: tab === 'users', onClick: () => setTab('users') },
            { id: 'jsr', icon: FileText, label: 'JSR', active: tab === 'jsr', onClick: () => setTab('jsr') },
            { id: 'exports', icon: FileDown, label: 'Exports', active: tab === 'exports', onClick: () => setTab('exports') },
            { id: 'analytics', icon: BarChart3, label: 'Stats', active: tab === 'analytics', onClick: () => setTab('analytics') },
            { id: 'branding', icon: Palette, label: 'Brand', active: tab === 'branding', onClick: () => setTab('branding') },
          ]}
        />
      ) : null}
    </>
  );
}
