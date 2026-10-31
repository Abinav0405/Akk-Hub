/**
 * Building blocks of the Account page (pages/Account.jsx) — one page for every role; each block
 * decides from the signed-in identity (and the role's own navigation) what it shows.
 *
 *   AccountProfileHeader   photo / initials, name, designation · ID, role badge, status
 *   AccountDetails         read-only details (collapsible)
 *   RoleShortcuts          the role's own screens (from app/navigation.js) with pending counts
 *   ModuleLinkRow          Materials / Site work link status
 *   SignOutButton          confirm → existing sign-out flow
 *
 * Nothing here grants access: shortcuts are links into screens that keep their own route guards
 * (RequireHubRole re-checks the session with the server) and database permission checks.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, CircleCheck, LayoutGrid, Link2, LogOut, Unlink } from 'lucide-react';
import MyPhotoAvatar from '@/ui/MyPhotoAvatar';
import { ListRow } from '@/ui/hub/primitives';
import CategoryGrid from '@/ui/hub/CategoryGrid';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { useLanguage } from '@/core/i18n';
import { ROLE_LABELS } from '@/core/auth/identity';
import { MODULE_LABELS, disconnectModule, useModuleConnection, useWorkerAccess } from '@/core/auth/bridges';
import { signOutWithAnimation } from '@/core/auth/signOutFlow';
import { navFor } from '@/app/navigation';
import { STAFF_AREAS, useStaffCounts } from '@/app/badges';
import { paths } from '@/app/paths';
import { cn } from '@/ui/utils';
import { fmtDate } from '@/features/cards/cardModel';

/** Status pill text / tone from the ID card (when there is one), else the signed-in session. */
export function accountStatus(card, cardStatus) {
    if (card && cardStatus) return cardStatus(card);
    return { tone: 'ok', text: 'Active' };
}

/** `wide`: website layout — bigger, role + status as badges side by side. */
export function AccountProfileHeader({ identity, card, status, wide = false }) {
    const isWorker = identity?.role === 'worker';
    const role = ROLE_LABELS[identity?.role] || identity?.role;
    const designation = card?.designation || (isWorker ? null : role);
    const idLabel =
        isWorker || card?.employee_id
            ? `Employee ID ${card?.employee_id || identity?.id}`
            : identity?.email || (identity?.id ? `ID ${identity.id}` : null);
    const site = identity?.role === 'supervisor' && identity?.siteId ? `Site · ${identity.siteId}` : null;
    return (
        <section className={cn('g-acct-hero', wide && 'g-acct-hero--wide')} data-role={identity?.role}>
            <MyPhotoAvatar name={identity?.name} isWorker={isWorker} size="lg" />
            <div className="min-w-0 flex-1">
                {wide ? null : <span className="g-acct-hero__role">{role}</span>}
                <h2 className="g-acct-hero__name">{identity?.name}</h2>
                {designation && designation !== role ? <p className="g-acct-hero__sub">{designation}</p> : null}
                {site ? <p className="g-acct-hero__sub">{site}</p> : null}
                {idLabel ? <p className="g-acct-hero__sub g-acct-hero__sub--id">{idLabel}</p> : null}
                {wide ? (
                    <div className="g-acct-hero__badges">
                        <span className="g-acct-hero__role">{role}</span>
                        <span className="g-acct-hero__status" data-tone={status.tone}>
                            <i aria-hidden /> {status.text}
                        </span>
                    </div>
                ) : (
                    <span className="g-acct-hero__status" data-tone={status.tone}>
                        <i aria-hidden /> {status.text}
                    </span>
                )}
            </div>
        </section>
    );
}

/** Read-only account details, collapsed by default (Card details on the ID card has the rest). */
/** `wide`: website — open by default, two columns of label / value. */
export function AccountDetails({ identity, card, wide = false }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(wide);
    const isWorker = identity?.role === 'worker';
    const rows = [
        ['Name', identity?.name],
        ['Role', ROLE_LABELS[identity?.role]],
        card?.designation ? ['Designation', card.designation] : null,
        isWorker || card?.employee_id ? ['Employee ID', card?.employee_id || identity?.id] : null,
        !isWorker && identity?.email ? ['Sign-in email', identity.email] : null,
        !isWorker && !identity?.email && identity?.id ? ['Sign-in ID', identity.id] : null,
        isWorker ? ['Employment type', identity?.workerType === 'local' ? t('hub.account.local') : t('hub.account.foreign')] : null,
        identity?.role === 'supervisor' && identity?.siteId ? ['Assigned site', identity.siteId] : null,
    ].filter((row) => row && row[1]);
    return (
        <div className={cn('g-acct-details', wide && 'g-acct-details--wide')}>
            <button type="button" className="g-acct-details__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                <span>
                    <span className="block text-[15px] font-semibold text-[var(--g-ink)]">Account details</span>
                    <span className="block text-[12.5px] text-[var(--g-muted)]">{rows.length} items · read only</span>
                </span>
                <ChevronDown className={cn('g-acct-details__chev', open && 'is-open')} aria-hidden />
            </button>
            <div className="g-acct-details__body" data-open={open ? 'true' : 'false'}>
                <div>
                    <dl>
                        {rows.map(([label, value]) => (
                            <div key={label} className="g-acct-details__row">
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>
        </div>
    );
}

/**
 * The role's own screens, picked from its navigation (so a role only ever sees what its menu
 * already offers it). Ordered by usefulness from the Account page.
 */
const SHORTCUTS = {
    admin: { title: 'Administration', hint: 'People, access and settings', ids: ['people', 'mmanagers', 'madmins', 'sites', 'tsites', 'pjsrperm', 'paccess', 'tvehicles', 'pbranding', 'tannounce', 'idscan', 'notifications'] },
    manager: { title: 'Your team', hint: 'Approvals and workforce', ids: ['tshifts', 'tleave', 'mmanage', 'mstock', 'ppackages', 'deploy', 'ttimesheets', 'pworkers', 'tcforms', 'pjsr', 'idscan'] },
    supervisor: { title: 'Your site', hint: 'Crew and site shifts', ids: ['shifts', 'crew', 'idscan'] },
    worker: { title: 'My work', hint: 'Your own records', ids: ['deploy', 'myinfo', 'shifts', 'leave', 'timesheets', 'psubs', 'mhist', 'cforms'] },
};

function areaOf(item, role) {
    const [pathname, query = ''] = String(item.to || '').split('?');
    const section = new URLSearchParams(query).get('section');
    return Object.keys(STAFF_AREAS).find((area) => STAFF_AREAS[area].match(pathname, section, role)) || null;
}

export function RoleShortcuts({ role, max = 4, className }) {
    const { t } = useLanguage();
    const access = useWorkerAccess();
    const counts = useStaffCounts();
    const config = SHORTCUTS[role];
    if (!config) return null;
    const all = navFor(role, access).groups.flatMap((g) => g.items);
    const items = config.ids
        .map((id) => all.find((item) => item.id === id))
        .filter(Boolean)
        .map((item) => {
            const area = role === 'worker' ? null : areaOf(item, role);
            const pending = area ? counts[area] : 0;
            const label = item.labelKey && t(item.labelKey) !== item.labelKey ? t(item.labelKey) : item.label;
            return {
                id: item.id,
                label,
                icon: item.icon,
                to: item.to,
                tone: role === 'admin' ? 'settings' : role === 'worker' ? 'timesheet' : 'brand',
                pill: pending > 0 ? `${pending} waiting` : undefined,
            };
        });
    if (!items.length) return null;
    return (
        <CategoryGrid
            max={max}
            className={cn('g-acct-shortcuts', className)}
            categories={[{ id: 'shortcuts', title: config.title, hint: config.hint, icon: LayoutGrid, tone: 'brand', items }]}
        />
    );
}

export function ModuleLinkRow({ role, module }) {
    const { t } = useLanguage();
    const status = useModuleConnection(role, module);
    if (status === 'unavailable') return null;
    if (status === 'connected') {
        return (
            <ListRow
                icon={CircleCheck}
                tone={module}
                title={MODULE_LABELS[module]}
                hint={t('hub.account.linkedHint')}
                onClick={async () => {
                    const ok = await confirmAction({
                        title: t('hub.account.unlinkTitle', { module: MODULE_LABELS[module] }),
                        message: t('hub.account.unlinkMsg', { module: MODULE_LABELS[module] }),
                        confirmLabel: t('hub.account.unlink'),
                        destructive: true,
                    });
                    if (ok) await disconnectModule(module);
                }}
                trailing={<Unlink className="g-row__chev" aria-hidden />}
            />
        );
    }
    return (
        <ListRow
            to={status === 'not-configured' ? undefined : paths.connect(module)}
            as={status === 'not-configured' ? 'div' : undefined}
            icon={Link2}
            tone={module}
            title={MODULE_LABELS[module]}
            hint={status === 'not-configured' ? t('hub.account.notConfigured') : t('hub.account.notLinked')}
        />
    );
}

export function SignOutButton() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const signOut = async () => {
        const ok = await confirmAction({
            title: t('hub.account.signOutTitle'),
            message: t('hub.account.signOutMsg'),
            confirmLabel: t('hub.account.signOut'),
            destructive: true,
        });
        if (!ok) return;
        await signOutWithAnimation(navigate);
    };
    return (
        <button type="button" className="g-acct-signout" onClick={signOut}>
            <LogOut aria-hidden /> {t('hub.account.signOut')}
        </button>
    );
}

/** Website side column: who is signed in, at a glance (real session + ID card data only). */
export function IdentitySummary({ identity, card, status }) {
    const materials = useModuleConnection(identity?.role, 'materials');
    const progress = useModuleConnection(identity?.role, 'progress');
    const isWorker = identity?.role === 'worker';
    const linked = [materials, progress].filter((s) => s === 'connected').length;
    const offered = [materials, progress].filter((s) => s !== 'unavailable' && s !== 'not-configured').length;
    const validUntil = card?.valid_until ? fmtDate(card.valid_until) : null;
    const rows = [
        ['Status', <span key="s" className="g-acct-pill" data-tone={status.tone === 'ok' ? undefined : 'warn'}>{status.text}</span>],
        ['Role', ROLE_LABELS[identity?.role]],
        isWorker || card?.employee_id ? ['Employee ID', card?.employee_id || identity?.id] : null,
        !isWorker ? ['Signed in as', identity?.email || identity?.id] : null,
        identity?.role === 'supervisor' && identity?.siteId ? ['Site', identity.siteId] : null,
        validUntil && validUntil !== '—' ? ['ID card valid until', validUntil] : null,
        identity?.role !== 'supervisor' && offered ? ['Linked modules', `${linked} of ${offered}`] : null,
    ].filter((row) => row && row[1]);
    return (
        <section className="g-panel" aria-labelledby="acct-summary">
            <header className="g-panel__head">
                <h3 id="acct-summary" className="g-panel__title">
                    Identity
                </h3>
                <p className="g-panel__sub">This sign-in on this browser</p>
            </header>
            <dl className="g-summary">
                {rows.map(([label, value]) => (
                    <div key={label} className="g-summary__row">
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

/** A titled panel (website layout). */
export function Panel({ title, sub, children, className, id }) {
    return (
        <section className={cn('g-panel', className)} aria-labelledby={id}>
            {title ? (
                <header className="g-panel__head">
                    <h3 id={id} className="g-panel__title">
                        {title}
                    </h3>
                    {sub ? <p className="g-panel__sub">{sub}</p> : null}
                </header>
            ) : null}
            {children}
        </section>
    );
}
