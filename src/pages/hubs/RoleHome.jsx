/**
 * Role home for Supervisor / Manager / Admin (employees use pages/employee/EmployeeHome.jsx).
 *
 *   greeting top bar
 *   Needs your attention — live counts across attendance, materials and site work
 *   Finish setting up    — only when a one-time module sign-in is still missing
 *   Your work            — one card per work area (from app/navigation.js), its main screens
 *
 * Same layout on phone and desktop (cards reflow 1 → 2 → 3 columns).
 */
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, Link2 } from 'lucide-react';
import { getSingaporeGreeting } from '@/ui/native/NativeChrome';
import TopBar from '@/ui/hub/TopBar';
import { List, ListRow, SectionLabel } from '@/ui/hub/primitives';
import { ROLE_LABELS, useIdentity } from '@/core/auth/identity';
import { MODULE_LABELS, useModuleConnection } from '@/core/auth/bridges';
import { useLanguage } from '@/core/i18n';
import { navFor } from '@/app/navigation';
import ApprovalsInbox from '@/pages/hubs/ApprovalsInbox';
import { useApprovalsInbox } from '@/pages/hubs/useApprovalsInbox';
import { paths } from '@/app/paths';

const NEEDS_SETUP = (status) => status !== 'unavailable' && status !== 'connected' && status !== 'not-configured';

/** Only shown when something still needs a one-time sign-in on this device (full status: Account). */
function FinishSetup({ role }) {
    const { t } = useLanguage();
    const materials = useModuleConnection(role, 'materials');
    const progress = useModuleConnection(role, 'progress');
    const pending = [
        ['materials', materials],
        ['progress', progress],
    ].filter(([, status]) => NEEDS_SETUP(status));
    if (!pending.length) return null;
    return (
        <section>
            <SectionLabel>Finish setting up</SectionLabel>
            <List className="g-list--compact">
                {pending.map(([module]) => (
                    <ListRow
                        key={module}
                        to={paths.connect(module)}
                        icon={Link2}
                        tone={module}
                        title={MODULE_LABELS[module]}
                        hint={t('hub.role.signInOnce')}
                    />
                ))}
            </List>
        </section>
    );
}

function useLabel() {
    const { t } = useLanguage();
    return (item) => {
        if (!item.labelKey) return item.label;
        const text = t(item.labelKey);
        return text && text !== item.labelKey ? text : item.label;
    };
}

function countOf(query) {
    if (query?.isLoading || query?.isError || query?.data == null) return 0;
    return Number(query.data) || 0;
}

/** Pending total for a work-area card (0 → no badge). */
function areaPending(group, inbox) {
    if (!inbox || !group.tone) return 0;
    if (group.tone === 'timesheet') return countOf(inbox.shifts) + countOf(inbox.leave);
    if (group.tone === 'materials') return countOf(inbox.requests);
    if (group.tone === 'progress') return countOf(inbox.packages);
    return 0;
}

/** One work area: its name and its main screens. */
function AreaCard({ group, labelOf, pending }) {
    const Icon = group.items[0]?.icon;
    return (
        <section className="hh-area g-card g-card--flat" data-tone={group.tone}>
            <header className="hh-area__head">
                {Icon ? (
                    <span className="g-row__icon hh-area__icon">
                        <Icon strokeWidth={1.9} aria-hidden />
                    </span>
                ) : null}
                <h3 className="hh-area__title">{labelOf(group)}</h3>
                {pending > 0 ? (
                    <span className="g-badge ml-auto" data-tone="brand">
                        {pending}
                    </span>
                ) : null}
            </header>
            <nav className="hh-area__links" aria-label={labelOf(group)}>
                {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                        <Link key={item.id} to={item.to} className="hh-area__link">
                            <ItemIcon aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{labelOf(item)}</span>
                            <ChevronRight className="hh-area__chev" aria-hidden />
                        </Link>
                    );
                })}
            </nav>
        </section>
    );
}

export default function RoleHome() {
    const identity = useIdentity();
    const { t } = useLanguage();
    const labelOf = useLabel();
    const inbox = useApprovalsInbox();
    const role = identity?.role;
    const home = paths.hubs[role];
    // Work areas = the sidebar's groups minus Home; "More" / Settings go last.
    const areas = navFor(role)
        .groups.map((g) => ({ ...g, items: g.items.filter((item) => item.to !== home) }))
        .filter((g) => g.items.length > 0);
    const firstName = String(identity?.name || '').split(/\s+/)[0];

    const subtitle =
        role === 'supervisor' ? t('hub.role.supervisorSub', { site: identity?.siteId || '—' }) : ROLE_LABELS[role];

    return (
        <>
            <TopBar
                eyebrow={getSingaporeGreeting()}
                title={firstName || t('hub.role.welcome')}
                subtitle={subtitle}
                trailing={
                    role === 'admin' ? (
                        <Link to={paths.notifications} className="g-icon-btn" aria-label={t('hub.role.notifications')}>
                            <Bell aria-hidden />
                        </Link>
                    ) : null
                }
            />
            <main className="g-main g-main--role-home hh" data-role={role || undefined}>
                <ApprovalsInbox />
                {role !== 'supervisor' ? <FinishSetup role={role} /> : null}
                <section aria-labelledby="hh-work" className="hh-work">
                    <h2 id="hh-work" className="g-section-label">
                        Your work
                    </h2>
                    <div className="hh-areas">
                        {areas.map((group) => (
                            <AreaCard
                                key={group.label}
                                group={group}
                                labelOf={labelOf}
                                pending={areaPending(group, inbox)}
                            />
                        ))}
                    </div>
                </section>
            </main>
        </>
    );
}
