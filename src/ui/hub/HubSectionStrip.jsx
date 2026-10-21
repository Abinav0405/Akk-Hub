/**
 * Shared phone section picker under the hub TopBar (admin / manager / modules).
 * Hub TabBar stays the only bottom chrome — this strip replaces a second dock.
 */
import { Badge } from '@/ui/badge';
import { cn } from '@/ui/utils';

function CountBadge({ count }) {
    if (!count) return null;
    return (
        <Badge variant="destructive" className="ml-0.5 shrink-0 px-2 py-0 text-xs">
            {count}
        </Badge>
    );
}

/**
 * @param {{ id: string, label: string, icon?: import('lucide-react').LucideIcon, badge?: boolean, tour?: string }[]} tabs
 */
export default function HubSectionStrip({
    tabs = [],
    activeId,
    onChange,
    badgeCount = 0,
    ariaLabel = 'Sections',
    className,
    tour,
}) {
    if (!tabs.length) return null;
    return (
        <div
            className={cn('hub-section-strip admin-section-strip', className)}
            role="tablist"
            aria-label={ariaLabel}
            data-tour={tour}
            data-section-nav
        >
            {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeId === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-tour={tab.tour}
                        className={cn('hub-section-strip__chip admin-section-strip__chip', active && 'is-active')}
                        onClick={() => onChange?.(tab.id)}
                    >
                        {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
                        <span>{tab.label}</span>
                        {tab.badge ? <CountBadge count={badgeCount} /> : null}
                    </button>
                );
            })}
        </div>
    );
}
