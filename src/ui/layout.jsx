/**
 * Site Progress / Material Tracker layout API (Components/layout/*) on the hub chrome.
 * The hub already draws the sidebar / tab bar, so these are light wrappers.
 */
import { cn } from '@/ui/utils';
import TopBar from '@/ui/hub/TopBar';
import Segmented from '@/ui/hub/Segmented';

export function PortalPageHeader({ title, description, actions, className }) {
    return (
        <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
            <div className="min-w-0">
                <h1 className="text-[1.6rem] font-bold leading-tight tracking-tight text-[var(--g-ink)]">{title}</h1>
                {description ? <p className="mt-1 max-w-2xl text-sm text-[var(--g-muted)]">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    );
}

/** SPT/Materials page frame: `header` slot + content column. */
export function AppShell({ header, children, className, maxWidth = '6xl' }) {
    const max = { '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '5xl': 'max-w-5xl', '6xl': 'max-w-6xl', '7xl': 'max-w-7xl' }[maxWidth] || '';
    return (
        <>
            {header}
            <main className={cn('g-main', max, className)}>{children}</main>
        </>
    );
}

/** SPT/Materials PageHeader → hub TopBar. */
export function PageHeader({ title, description, actions, backTo, onBack, eyebrow, children }) {
    return (
        <TopBar title={title} subtitle={description} eyebrow={eyebrow} backTo={backTo} onBack={onBack} trailing={actions}>
            {children}
        </TopBar>
    );
}

export function PageFooter({ className }) {
    return (
        <footer className={cn('g-company-foot', className)}>
            AKK ENGINEERING PTE. LTD.
            <br />
            15 Kaki Bukit Rd 4, #01-50, Singapore 417808
        </footer>
    );
}

/**
 * SPT admin / manager portal frame inside the hub: glass TopBar (portal + current section),
 * the portal's sections as a scrollable segmented strip under it, and the padded content
 * column. The hub sidebar / tab bar replace SPT's own dark sidebar and bottom nav.
 */
export function PortalShell({ portalLabel, groups = [], value, onChange, sectionLabel, children, className }) {
    const items = groups.flatMap((g) => g.items || []);
    const current = items.find((i) => i.id === value);
    const eyebrow = String(portalLabel || 'Site Progress').replace(/\s*-\s*/, ' · ');
    return (
        <>
            <TopBar eyebrow={eyebrow} title={sectionLabel || current?.label || 'Overview'}>
                {items.length > 1 ? (
                    <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <Segmented
                            options={items.map((i) => ({
                                id: i.id,
                                label: i.badge > 0 ? `${i.label} (${i.badge > 99 ? '99+' : i.badge})` : i.label,
                                icon: i.icon,
                            }))}
                            value={value}
                            onChange={onChange}
                            ariaLabel="Sections"
                            className="min-w-max"
                        />
                    </div>
                ) : null}
            </TopBar>
            <main className={cn('g-main max-w-7xl', className)}>{children}</main>
        </>
    );
}

/** SPT SideTabs → segmented strip (scrolls sideways on phones). */
export function SideTabs({ tabs = [], items, value, onChange, className }) {
    const list = items || tabs;
    return (
        <div className={cn('overflow-x-auto [scrollbar-width:none]', className)}>
            <Segmented
                options={list.map((t) => ({ id: t.id ?? t.value, label: t.label, icon: t.icon }))}
                value={value}
                onChange={onChange}
                ariaLabel="Sections"
                className="min-w-max"
            />
        </div>
    );
}

/**
 * Materials/Progress filter strip. Accepts either legacy `children` or the
 * module API: `search` / `filters` / `actions` (wraps below 640px).
 */
export function FilterToolbar({ children, search, filters, actions, className }) {
    if (search != null || filters != null || actions != null) {
        return (
            <div className={cn('mb-4 space-y-3', className)}>
                {search ? <div className="w-full min-w-0">{search}</div> : null}
                {(filters || actions) ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                        {filters ? (
                            <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>
                        ) : null}
                        {actions ? (
                            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    }
    return <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

export function EmptyState({ title = 'Nothing here', message, description, icon: Icon, action, children, className }) {
    return (
        <div className={cn('g-empty', className)}>
            {Icon ? (
                <span className="g-empty__icon">
                    <Icon aria-hidden />
                </span>
            ) : null}
            <p className="g-empty__title">{title}</p>
            {message || description ? <p className="g-empty__text">{message || description}</p> : null}
            {action}
            {children}
        </div>
    );
}

export function portalHomeHref() {
    return '/';
}

export default AppShell;
