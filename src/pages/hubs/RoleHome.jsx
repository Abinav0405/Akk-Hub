/**
 * Role home — the merged landing screen for each portal (Employee / Supervisor / Manager /
 * Admin). Greeting, the most-used actions from all three modules as tiles, the full list by
 * module, and the status of the Material Tracker / Site Progress connections.
 *
 * Managers / supervisors / admins see a cross-module "Needs your attention" inbox first.
 * (Employees use the merged Employee home, pages/employee/EmployeeHome.jsx.)
 */
import { Link } from 'react-router-dom';
import { Bell, Link2, ShieldCheck } from 'lucide-react';
import { getSingaporeGreeting } from '@/ui/native/NativeChrome';
import TopBar from '@/ui/hub/TopBar';
import { List, ListRow, SectionLabel, Tile } from '@/ui/hub/primitives';
import { ROLE_LABELS, useIdentity } from '@/core/auth/identity';
import { MODULE_LABELS, useModuleConnection } from '@/core/auth/bridges';
import { useLanguage } from '@/core/i18n';
import { navFor } from '@/app/navigation';
import { HOME_TILES } from '@/pages/hubs/homeConfig';
import ApprovalsInbox from '@/pages/hubs/ApprovalsInbox';
import { paths } from '@/app/paths';
import { useWideLayout } from '@/core/platform';

const NEEDS_SETUP = (status) => status !== 'unavailable' && status !== 'connected' && status !== 'not-configured';

/**
 * One product: which back-end a feature lives in is plumbing, so the home only mentions it
 * when something still needs a one-time sign-in on this device. (Full status: Account.)
 */
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

const HUB_HOME = {
    worker: paths.hubs.worker,
    supervisor: paths.hubs.supervisor,
    manager: paths.hubs.manager,
    admin: paths.hubs.admin,
};

export default function RoleHome() {
    const identity = useIdentity();
    const { t } = useLanguage();
    const wide = useWideLayout();
    const role = identity?.role;
    const allTiles = HOME_TILES[role] || [];
    const tileCap = role === 'admin' || role === 'manager' ? 4 : allTiles.length;
    const tiles = wide ? [] : allTiles.slice(0, tileCap);
    const tilePaths = new Set(allTiles.map((tile) => tile.to));
    const groups = navFor(role)
        .groups.filter((g) => g.tone)
        .map((g) => ({
            ...g,
            items: g.items.filter((item) => !tilePaths.has(item.to) && item.to !== HUB_HOME[role]),
        }))
        .filter((g) => g.items.length > 0);
    const firstName = String(identity?.name || '').split(/\s+/)[0];

    const resolveLabel = (item) => {
        if (!item.labelKey) return item.label;
        const text = t(item.labelKey);
        return text && text !== item.labelKey ? text : item.label;
    };

    const subtitle =
        role === 'worker'
            ? t('hub.role.workerSub', {
                  id: identity.id,
                  type: identity.workerType === 'local' ? t('hub.role.local') : t('hub.role.foreign'),
              })
            : role === 'supervisor'
              ? t('hub.role.supervisorSub', { site: identity.siteId || '—' })
              : ROLE_LABELS[role];

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
            <main className="g-main g-main--role-home">
                <ApprovalsInbox />

                {tiles.length ? (
                    <>
                        <SectionLabel>Quick actions</SectionLabel>
                        <div className="g-tiles g-tiles--compact">
                            {tiles.map((tile, i) => {
                                const title = tile.titleKey ? (() => {
                                    const text = t(tile.titleKey);
                                    return text && text !== tile.titleKey ? text : tile.title;
                                })() : tile.title;
                                const hint = tile.hintKey ? (() => {
                                    const text = t(tile.hintKey);
                                    return text && text !== tile.hintKey ? text : tile.hint;
                                })() : tile.hint;
                                const { titleKey: _tk, hintKey: _hk, ...rest } = tile;
                                return (
                                    <Tile
                                        key={tile.to}
                                        {...rest}
                                        title={title}
                                        hint={hint}
                                        className={`g-rise g-rise-${Math.min(i + 1, 4)}`}
                                    />
                                );
                            })}
                        </div>
                    </>
                ) : null}

                {!wide && groups.length ? (
                    groups.map((group) => (
                        <section key={group.label}>
                            <SectionLabel>{resolveLabel(group)}</SectionLabel>
                            <List className="g-list--compact">
                                {group.items.map((item) => (
                                    <ListRow key={item.id} to={item.to} icon={item.icon} tone={group.tone} title={resolveLabel(item)} />
                                ))}
                            </List>
                        </section>
                    ))
                ) : null}

                {role !== 'supervisor' ? <FinishSetup role={role} /> : null}

                {!wide ? (
                    <>
                        <SectionLabel>{t('hub.role.tools')}</SectionLabel>
                        <List className="g-list--compact">
                            <ListRow to={paths.verify} icon={ShieldCheck} tone="bronze" title={t('hub.role.verify')} hint={t('hub.role.verifyHint')} />
                        </List>
                    </>
                ) : null}
            </main>
        </>
    );
}
