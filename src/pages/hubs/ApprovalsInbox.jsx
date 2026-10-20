/**
 * Cross-module "Needs your attention" card for managers, supervisors and admins:
 * shifts, leave, material requests and site packages waiting on them, each linking to the
 * screen where they're handled.
 */
import { Link } from 'react-router-dom';
import { Boxes, CalendarDays, ClipboardCheck, ClipboardList, Link2 } from 'lucide-react';
import { useApprovalsInbox } from '@/pages/hubs/useApprovalsInbox';
import { paths } from '@/app/paths';

function InboxItem({ icon: Icon, tone, label, query, to, linkTo }) {
    const linked = !linkTo;
    const value = !linked ? null : query?.isLoading ? null : query?.isError ? '!' : query?.data ?? 0;
    const busy = value > 0;
    return (
        <Link
            to={linked ? to : linkTo}
            className="g-card g-card--flat flex min-h-[92px] flex-col justify-between gap-2 p-3.5 transition-transform active:scale-[0.98]"
            data-tone={tone}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="g-row__icon !h-9 !w-9 !rounded-[11px]">
                    <Icon strokeWidth={1.9} aria-hidden />
                </span>
                {linked ? (
                    value == null ? (
                        <span className="g-skeleton block h-6 w-8" aria-hidden />
                    ) : (
                        <span
                            className={`text-[1.6rem] font-bold leading-none tabular-nums ${busy ? 'text-[var(--g-ink)]' : 'text-[var(--g-faint)]'}`}
                            title={query?.isError ? 'Could not load' : undefined}
                        >
                            {value}
                        </span>
                    )
                ) : (
                    <span className="g-badge" data-tone="brand">
                        <Link2 className="h-3 w-3" aria-hidden /> Link
                    </span>
                )}
            </div>
            <span className="text-[13px] font-semibold leading-tight text-[var(--g-ink-2)]">{label}</span>
        </Link>
    );
}

export default function ApprovalsInbox() {
    const { role, shifts, leave, requests, packages, materials, progress } = useApprovalsInbox();
    if (!role || role === 'worker') return null;

    const items =
        role === 'supervisor'
            ? [{ key: 'shifts', icon: ClipboardCheck, tone: 'timesheet', label: 'Shifts to approve', query: shifts, to: paths.timesheet.siteShifts }]
            : [
                  {
                      key: 'shifts',
                      icon: ClipboardCheck,
                      tone: 'timesheet',
                      label: 'Shifts to approve',
                      query: shifts,
                      to: role === 'admin' ? paths.timesheet.admin : paths.timesheet.manage,
                  },
                  {
                      key: 'leave',
                      icon: CalendarDays,
                      tone: 'timesheet',
                      label: 'Leave requests',
                      query: leave,
                      to: role === 'admin' ? paths.timesheet.admin : paths.timesheet.manage,
                  },
                  {
                      key: 'materials',
                      icon: Boxes,
                      tone: 'materials',
                      label: 'Material requests',
                      query: requests,
                      to: role === 'admin' ? paths.materials.admin : paths.materials.manage,
                      linkTo: materials === 'disconnected' ? paths.connect('materials') : undefined,
                  },
                  {
                      key: 'packages',
                      icon: ClipboardList,
                      tone: 'progress',
                      label: 'Site packages',
                      query: packages,
                      to: role === 'admin' ? paths.progress.admin : paths.progress.review,
                      linkTo: progress === 'disconnected' ? paths.connect('progress') : undefined,
                  },
              ];

    return (
        <section aria-labelledby="inbox-heading" className="mb-1">
            <h2 id="inbox-heading" className="g-section-label !mt-0">
                Needs your attention
            </h2>
            <div className={`grid gap-2.5 ${items.length > 1 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1'}`}>
                {items.map(({ key, ...item }) => (
                    <InboxItem key={key} {...item} />
                ))}
            </div>
        </section>
    );
}
