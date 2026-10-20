import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent } from '@/ui/tabs';
import { cn } from '@/modules/progress/lib/utils';
import { loadJsrLookups } from '@/modules/progress/lib/jsr';
import { verifyManagerSession } from '@/core/auth/progress/managerSession';
import {
  JSR_PERM_MIGRATION_HINT,
  jsrCan,
  jsrPermsForRole,
  lookupsHaveJsrPermissions,
  managerHasJsrModule,
} from '@/modules/progress/lib/jsrPermissions';
import JsrPanel from '@/modules/progress/components/jsr/JsrPanel';
import ClaimPanel from '@/modules/progress/components/jsr/ClaimPanel';
import InvoicePanel from '@/modules/progress/components/jsr/InvoicePanel';
import CatalogPanel from '@/modules/progress/components/jsr/CatalogPanel';
import CompaniesPanel from '@/modules/progress/components/jsr/CompaniesPanel';
import ClientPortalPanel from '@/modules/progress/components/jsr/ClientPortalPanel';

const HUB_TABS = [
  { id: 'jsrs', label: 'JSRs', perm: 'view_jsrs' },
  { id: 'claims', label: 'Claims', perm: 'view_claims' },
  { id: 'invoices', label: 'Invoices', perm: 'view_invoices' },
  { id: 'catalog', label: 'Catalog', perm: 'catalog' },
  { id: 'companies', label: 'Companies', perm: 'companies' },
];

export default function CommercialHub({ role }) {
  const isExporter = role === 'exporter';
  const [tab, setTab] = useState(isExporter ? 'client' : 'jsrs');
  const [lookups, setLookups] = useState(null);
  const [sessionPerms, setSessionPerms] = useState(null);
  const warnedMissing = useRef(false);

  const refreshLookups = () => {
    if (isExporter) return;
    loadJsrLookups()
      .then(async (data) => {
        let fromSession = null;
        if (role === 'manager' && !lookupsHaveJsrPermissions(data)) {
          try {
            const row = await verifyManagerSession();
            fromSession = row?.jsr_permissions ?? null;
          } catch {
            fromSession = null;
          }
          if (!fromSession && !warnedMissing.current) {
            warnedMissing.current = true;
            toast.error(JSR_PERM_MIGRATION_HINT);
          }
        }
        setSessionPerms(fromSession);
        setLookups(data && typeof data === 'object' && !Array.isArray(data)
          ? data
          : { companies: [], contracts: [], schedule_groups: [], catalog: [], settings: {} });
      })
      .catch((e) => {
        toast.error(e.message || 'Could not load JSR catalogs');
        setLookups({ companies: [], contracts: [], schedule_groups: [], catalog: [], settings: {} });
      });
  };

  useEffect(refreshLookups, [isExporter, role]);

  if (isExporter) return <ClientPortalPanel />;

  if (!lookups) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading JSR module…
      </div>
    );
  }

  const perms = jsrPermsForRole(role, lookups, sessionPerms);
  const visibleTabs = HUB_TABS.filter((t) => jsrCan(role, perms, t.perm));
  const firstTab = visibleTabs[0]?.id || null;
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : firstTab;

  if (!firstTab || !managerHasJsrModule(role, perms)) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {role === 'manager' && !lookupsHaveJsrPermissions(lookups) && !sessionPerms
          ? JSR_PERM_MIGRATION_HINT
          : 'You are not allowed to use the JSR module. Ask an admin to grant access.'}
      </p>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="space-y-4">
      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
          {visibleTabs.map((t) => {
            const selected = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(t.id)}
                className={cn(
                  'shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
                  selected
                    ? 'border-brand text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {visibleTabs.some((t) => t.id === 'jsrs') ? (
        <TabsContent value="jsrs" className="mt-0">
          <JsrPanel role={role} lookups={lookups} perms={perms} />
        </TabsContent>
      ) : null}
      {visibleTabs.some((t) => t.id === 'claims') ? (
        <TabsContent value="claims" className="mt-0">
          <ClaimPanel role={role} lookups={lookups} perms={perms} />
        </TabsContent>
      ) : null}
      {visibleTabs.some((t) => t.id === 'invoices') ? (
        <TabsContent value="invoices" className="mt-0">
          <InvoicePanel role={role} perms={perms} />
        </TabsContent>
      ) : null}
      {visibleTabs.some((t) => t.id === 'catalog') ? (
        <TabsContent value="catalog" className="mt-0">
          <CatalogPanel lookups={lookups} onChanged={refreshLookups} />
        </TabsContent>
      ) : null}
      {visibleTabs.some((t) => t.id === 'companies') ? (
        <TabsContent value="companies" className="mt-0">
          <CompaniesPanel lookups={lookups} onChanged={refreshLookups} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
