/**
 * Role home for Supervisor / Manager / Admin (employees use pages/employee/EmployeeHome.jsx).
 *
 *   greeting top bar        bell (admin, manager) · account switcher
 *   Needs your attention    live counts across attendance, materials and site work
 *   Finish setting up       only when a one-time module sign-in is still missing
 *   Categories              one card per work area (from app/navigation.js): its first four
 *                           screens as icons, "See all" for the rest; unread badges per device
 *
 * Same layout on phone and desktop (cards reflow 1 → 2 → 3 columns).
 */
import { Link } from 'react-router-dom';
import {
    BarChart3,
    Bell,
    Boxes,
    ClipboardList,
    Clock,
    LayoutGrid,
    Link2,
    Megaphone,
    Settings2,
    Users,
} from 'lucide-react';
import { getSingaporeGreeting } from '@/ui/native/NativeChrome';
import TopBar from '@/ui/hub/TopBar';
import { List, ListRow, SectionLabel } from '@/ui/hub/primitives';
import CategoryGrid from '@/ui/hub/CategoryGrid';
import { AccountSwitchChip } from '@/ui/hub/AccountSwitcher';
import { ROLE_LABELS, useIdentity } from '@/core/auth/identity';
import { MODULE_LABELS, useModuleConnection } from '@/core/auth/bridges';
import { useLanguage } from '@/core/i18n';
import { navFor } from '@/app/navigation';
import { STAFF_AREAS, useBadges, useStaffCounts } from '@/app/badges';
import ApprovalsInbox from '@/pages/hubs/ApprovalsInbox';
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

/** Category look per work area (the nav groups only carry a label and module tone). */
const CATEGORY_LOOK = [
    [/attendance/i, { icon: Clock, tone: 'timesheet' }],
    [/material/i, { icon: Boxes, tone: 'materials' }],
    [/site work|site photos/i, { icon: ClipboardList, tone: 'progress' }],
    [/people/i, { icon: Users, tone: 'people' }],
    [/insight/i, { icon: BarChart3, tone: 'insights' }],
    [/communication|forms/i, { icon: Megaphone, tone: 'comms' }],
    [/setting/i, { icon: Settings2, tone: 'settings' }],
];
const lookFor = (label) => CATEGORY_LOOK.find(([re]) => re.test(label))?.[1] || { icon: LayoutGrid, tone: 'settings' };

/** The badge area a nav item opens (shifts / leave / materials / packages), if any. */
function areaOf(item, role) {
    const [pathname, query = ''] = String(item.to || '').split('?');
    const section = new URLSearchParams(query).get('section');
    return Object.keys(STAFF_AREAS).find((area) => STAFF_AREAS[area].match(pathname, section, role)) || null;
}

export default function RoleHome() {
    const identity = useIdentity();
    const { t } = useLanguage();
    const labelOf = useLabel();
    const role = identity?.role;
    const home = paths.hubs[role];
    const counts = useStaffCounts();
    const badges = useBadges(counts);

    const categories = navFor(role)
        .groups.map((g) => ({ ...g, items: g.items.filter((item) => item.to !== home) }))
        .filter((g) => g.items.length > 0)
        .map((g) => {
            const look = lookFor(g.label);
            const items = g.items.map((item) => {
                const area = areaOf(item, role);
                return {
                    id: item.id,
                    label: labelOf(item),
                    icon: item.icon,
                    to: item.to,
                    tone: look.tone,
                    badge: area ? badges[area] : 0,
                };
            });
            return {
                id: g.label,
                title: labelOf(g),
                icon: look.icon,
                tone: look.tone,
                items,
                badge: items.reduce((sum, item) => sum + (item.badge || 0), 0),
            };
        });

    const firstName = String(identity?.name || '').split(/\s+/)[0];
    const bellCount = Object.values(badges).reduce((a, b) => a + b, 0);

    const subtitle =
        role === 'supervisor' ? t('hub.role.supervisorSub', { site: identity?.siteId || '—' }) : ROLE_LABELS[role];

    return (
        <>
            <TopBar
                eyebrow={getSingaporeGreeting()}
                title={firstName || t('hub.role.welcome')}
                subtitle={subtitle}
                trailing={
                    <>
                        {role === 'admin' || role === 'manager' ? (
                            <Link
                                to={paths.notifications}
                                className="g-icon-btn"
                                aria-label={bellCount ? `${t('hub.role.notifications')}, ${bellCount} new` : t('hub.role.notifications')}
                            >
                                <Bell aria-hidden />
                                {bellCount > 0 ? <span className="g-icon-btn__dot">{bellCount > 9 ? '9+' : bellCount}</span> : null}
                            </Link>
                        ) : null}
                        <AccountSwitchChip />
                    </>
                }
            />
            <main className="g-main g-main--role-home hh" data-role={role || undefined}>
                <ApprovalsInbox badges={badges} />
                {role !== 'supervisor' ? <FinishSetup role={role} /> : null}
                <section aria-labelledby="hh-work" className="hh-work">
                    <h2 id="hh-work" className="g-section-label">
                        Your work
                    </h2>
                    <CategoryGrid categories={categories} />
                </section>
            </main>
        </>
    );
}
