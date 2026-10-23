import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, ClipboardList, Users, BarChart3, FileDown, Palette, FileText, MapPin, SlidersHorizontal } from 'lucide-react';
import { ManagerAccountsSection } from '@/modules/progress/components/StaffAccountsPanel';
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
import { UNIFIED } from '@/core/supabase';

// UNIFIED: Sites → Admin → Sites; worker app access → Admin → Employees.
// Keep `users` for Site-work staff accounts (managers + admins); technicians stripped in UsersAccessPanel.
const ADMIN_SECTIONS = UNIFIED
  ? ['packages', 'exports', 'jsr', 'managers', 'analytics', 'users', 'branding']
  : ['packages', 'exports', 'jsr', 'analytics', 'users', 'sites', 'branding'];

const AnalyticsPanel = lazy(() => import('@/modules/progress/components/AnalyticsPanel'));
const BrandingPanel = lazy(() => import('@/modules/progress/components/BrandingPanel'));
const ProgressSitesPanel = lazy(() => import('@/modules/progress/components/ProgressSitesPanel'));
const CommercialHub = lazy(() => import('@/modules/progress/components/jsr/CommercialHub'));

function PanelFallback({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface,#fff)] py-16 text-[var(--g-muted)]">
      <Loader2 className="h-5 w-5 animate-spin text-[var(--g-brand)]" /> Loading {label}…
    </div>
  );
}

const SECTION_LABELS = {
  packages: 'Packages',
  exports: 'Export queue',
  jsr: 'JSR & billing',
  analytics: 'Analytics',
  users: UNIFIED ? 'Staff accounts' : 'Users & access',
  managers: 'Manager JSR access',
  sites: 'Sites',
  branding: 'Branding',
};

export default function AdminDashboard() {
  const session = useRoleGuard('admin');
  const [tab, setTab] = useHubSection('packages', ADMIN_SECTIONS);
  const [searchParams, setSearchParams] = useSearchParams();
  const [packageBadge, setPackageBadge] = useState(0);
  const [jsrBadge, setJsrBadge] = useState(0);
  const { overlay } = useLoginWelcome({ ready: Boolean(session) });

  // Legacy Branding & settings tab: ?section=branding&tab=sites → Sites under Site work.
  useEffect(() => {
    if (searchParams.get('section') !== 'branding' || searchParams.get('tab') !== 'sites') return;
    const next = new URLSearchParams(searchParams);
    next.set('section', 'sites');
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
          ...(!UNIFIED ? [{ id: 'sites', label: 'Sites', icon: MapPin }] : []),
          { id: 'exports', label: 'Export queue', icon: FileDown },
          { id: 'jsr', label: 'JSR & billing', icon: FileText, badge: jsrBadge },
          { id: 'managers', label: 'Manager JSR access', icon: SlidersHorizontal },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ],
      },
      {
        label: 'People & admin',
        items: [
          { id: 'users', label: UNIFIED ? 'Staff accounts' : 'Users & access', icon: Users },
          { id: 'branding', label: 'Branding', icon: Palette },
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
        portalLabel="Site work"
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
        {tab === 'managers' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Site work manager logins and what each one may do in JSR & billing (create, edit, submit, review, pass out, claims, invoices, catalog,
              deleting package photos). Tap the sliders icon next to a manager. New managers start view-only. Managers never see audit trails.
            </p>
            <ManagerAccountsSection />
          </div>
        ) : null}
        {tab === 'exports' ? <ExportOnlyAdminPanel /> : null}
        {tab === 'analytics' ? (
          <Suspense fallback={<PanelFallback label="analytics" />}>
            <AnalyticsPanel />
          </Suspense>
        ) : null}
        {!UNIFIED && tab === 'sites' ? (
          <Suspense fallback={<PanelFallback label="sites" />}>
            <ProgressSitesPanel />
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
            ...(!UNIFIED
              ? [{ id: 'sites', icon: MapPin, label: 'Sites', active: tab === 'sites', onClick: () => setTab('sites') }]
              : []),
            { id: 'users', icon: Users, label: UNIFIED ? 'Staff' : 'Users', active: tab === 'users', onClick: () => setTab('users') },
            { id: 'jsr', icon: FileText, label: 'JSR', active: tab === 'jsr', onClick: () => setTab('jsr') },
            { id: 'exports', icon: FileDown, label: 'Exports', active: tab === 'exports', onClick: () => setTab('exports') },
            { id: 'branding', icon: Palette, label: 'Brand', active: tab === 'branding', onClick: () => setTab('branding') },
          ]}
        />
      ) : null}
    </>
  );
}
