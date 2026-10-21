import React from 'react';
import { useAdminDash } from '../AdminDashContext';
import { Button } from '@/ui/button';
import { Edit2, Loader2, MapPin, QrCode, Trash2 } from 'lucide-react';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import { cn } from '@/modules/timesheet/lib/utils';
import { glassPanel } from '@/ui/PortalShell';

export default function SitesTab() {
  const {
    allSites,
    isLoadingSites,
    openAddSiteDialog,
    openEditSiteDialog,
    openSiteQrPreview,
    setPendingDeleteSite,
  } = useAdminDash();

  return (
    <>
      <section className={cn(glassPanel, 'p-5 sm:p-6')} data-tour="admin-sites-panel">
                  <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex gap-4">
                                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--g-brand-soft)] via-white to-[var(--g-brand-muted)] shadow-sm ring-1 ring-[var(--g-brand-soft)]">
                                      <MapPin className="h-6 w-6 text-[var(--g-brand)]" />
                                  </div>
                                  <div>
                                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                                  Work sites
                                  {!isLoadingSites && allSites.length > 0 && (
                                      <span className="rounded-full bg-[var(--g-brand-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--g-brand-text)]">
                                          {allSites.length} site{allSites.length !== 1 ? 's' : ''}
                                      </span>
                                  )}
                                  </h2>
                                  <p className="mt-0.5 max-w-xl text-sm text-slate-500">
                                      Locations for shifts and attendance. QR is enough to clock in; GPS is optional for a 350 m geofence.
                                  </p>
                                  </div>
                          </div>
                  <Button className="h-11 rounded-xl bg-[var(--g-brand)] px-5 hover:bg-[var(--g-brand-press)]" onClick={openAddSiteDialog} data-tour="admin-sites-add">
                      Add site
                  </Button>
                  </div>

              {isLoadingSites ? (
                  <div className="flex items-center justify-center py-16">
                      <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
              ) : allSites.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-14 text-center">
                      <MapPin className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                      <h4 className="text-base font-semibold text-slate-800">No sites yet</h4>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Create a site with a QR token. GPS coordinates are optional (QR-only sites skip the geofence).</p>
                  </div>
              ) : (
                  <div className="overflow-x-auto rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface)]">
                      <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
                          <thead>
                              <tr className="border-b border-slate-200 bg-slate-50/90 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  <th className="sticky left-0 z-[3] min-w-[160px] border-b border-r border-slate-200 bg-slate-50/95 px-4 py-3">Site name</th>
                                  <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3">Site ID</th>
                                  <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-right tabular-nums">Latitude</th>
                                  <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-right tabular-nums">Longitude</th>
                                  <th className="min-w-[200px] border-b border-slate-200 px-4 py-3">QR token</th>
                                  <th className="min-w-[220px] whitespace-nowrap border-b border-slate-200 px-4 py-3 text-right">Actions</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                              {allSites.map((site) => (
                                  <tr key={site.id} className="group transition-colors hover:bg-slate-50/90">
                                      <td className="sticky left-0 z-[2] border-r border-slate-100 bg-white px-4 py-3 font-medium text-slate-900 shadow-[4px_0_12px_-6px_rgba(15,23,42,0.08)] group-hover:bg-slate-50/90">
                                          {site.site_name}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{site.id}</td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                                          {site.latitude ?? '—'}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                                          {site.longitude ?? '—'}
                                      </td>
                                      <td className="max-w-[280px] break-all px-4 py-3 font-mono text-xs text-slate-600">
                                          {site.qr_token ?? '—'}
                                      </td>
                                      <td className="w-0 min-w-[220px] align-middle px-3 py-2">
                                          <div className="hidden items-center justify-end gap-1.5 md:flex">
                                                  <Button
                                                      type="button"
                                                      variant="outline"
                                                      size="sm"
                                                      className="h-8 rounded-lg border-slate-200 bg-white text-xs"
                                                      onClick={() => openSiteQrPreview(site)}
                                                      title="View or download QR code"
                                                  >
                                                      <QrCode className="mr-1 h-3.5 w-3.5 shrink-0" />
                                                      QR
                                                  </Button>
                                                  <Button
                                                      type="button"
                                                      variant="outline"
                                                      size="sm"
                                                      className="h-8 rounded-lg border-slate-200 bg-white text-xs"
                                                      onClick={() => openEditSiteDialog(site)}
                                                      title="Edit site"
                                                  >
                                                      <Edit2 className="mr-1 h-3.5 w-3.5 shrink-0" />
                                                      Edit
                                                  </Button>
                                                  <Button
                                                      type="button"
                                                      variant="destructive"
                                                      size="sm"
                                                      className="h-8 rounded-lg text-xs"
                                                      onClick={() => setPendingDeleteSite(site)}
                                                      title="Delete site"
                                                  >
                                                      <Trash2 className="mr-1 h-3.5 w-3.5 shrink-0" />
                                                      Delete
                                                  </Button>
                                          </div>
                                          <div className="flex justify-end md:hidden">
                                              <MoreMenu
                                                  items={[
                                                      { label: 'QR code', icon: <QrCode className="h-4 w-4" />, onClick: () => openSiteQrPreview(site) },
                                                      { label: 'Edit', icon: <Edit2 className="h-4 w-4" />, onClick: () => openEditSiteDialog(site) },
                                                      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setPendingDeleteSite(site) },
                                                  ]}
                                              />
                                          </div>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              )}
      </section>
    </>
  );
}
