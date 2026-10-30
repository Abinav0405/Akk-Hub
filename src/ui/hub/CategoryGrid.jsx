/**
 * Home dashboards: one card per category with its first few screens as icons, and
 * "See all" (top-right) opening every screen of that category in a sheet.
 *
 *   <CategoryGrid categories={[
 *       { id: 'materials', title: 'Materials', icon: Boxes, tone: 'materials', badge: 4,
 *         items: [{ id, label, icon, to | onClick, badge, pill, tone, tour }] },
 *   ]} />
 *
 * Items keep their own `data-tour` hooks (the employee tutorial points at them), so items a
 * tutorial needs belong in the first `max` of their category.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/ui/utils';
import Sheet from '@/ui/hub/Sheet';

function CountBadge({ n, className }) {
    if (!n || n <= 0) return null;
    return (
        <span className={cn('g-cat-badge', className)} aria-label={`${n} new`}>
            {n > 99 ? '99+' : n}
        </span>
    );
}

/** One screen as an icon + label. A Link with `to`, else a button. */
export function IconTile({ item, onAfter, size = 'md' }) {
    const Icon = item.icon;
    const body = (
        <>
            <span className="g-icon-tile__icon" data-tone={item.tone}>
                {Icon ? <Icon strokeWidth={1.85} aria-hidden /> : null}
                <CountBadge n={item.badge} />
            </span>
            <span className="g-icon-tile__label">{item.label}</span>
            {item.pill ? <span className="g-icon-tile__pill">{item.pill}</span> : null}
        </>
    );
    const props = {
        className: cn('g-icon-tile', size === 'lg' && 'g-icon-tile--lg', item.danger && 'is-danger'),
        'data-tour': item.tour,
        'aria-label': item.badge > 0 ? `${item.label}, ${item.badge} new` : undefined,
    };
    if (item.to) {
        return (
            <Link
                to={item.to}
                {...props}
                onClick={(e) => {
                    item.onClick?.(e);
                    onAfter?.();
                }}
            >
                {body}
            </Link>
        );
    }
    return (
        <button
            type="button"
            {...props}
            onClick={(e) => {
                onAfter?.();
                item.onClick?.(e);
            }}
        >
            {body}
        </button>
    );
}

export function CategoryCard({ category, max = 4, onSeeAll, className }) {
    const { title, icon: Icon, tone, items, badge, hint, tour } = category;
    const shown = items.slice(0, max);
    const more = items.length > max;
    // Badges on hidden items still count toward the category's badge.
    const hiddenBadges = items.slice(max).reduce((sum, item) => sum + (Number(item.badge) || 0), 0);
    const total = badge ?? hiddenBadges;
    return (
        <section className={cn('g-cat', className)} data-tone={tone} data-tour={tour} aria-label={title}>
            <header className="g-cat__head">
                {Icon ? (
                    <span className="g-cat__icon" data-tone={tone}>
                        <Icon strokeWidth={1.9} aria-hidden />
                    </span>
                ) : null}
                <div className="min-w-0 flex-1">
                    <h3 className="g-cat__title">
                        {title}
                        <CountBadge n={total} className="g-cat-badge--inline" />
                    </h3>
                    {hint ? <p className="g-cat__hint">{hint}</p> : null}
                </div>
                {more ? (
                    <button type="button" className="g-cat__more" onClick={() => onSeeAll?.(category)}>
                        See all <ChevronRight aria-hidden />
                    </button>
                ) : null}
            </header>
            <div className="g-cat__grid">
                {shown.map((item) => (
                    <IconTile key={item.id} item={item} />
                ))}
            </div>
        </section>
    );
}

export default function CategoryGrid({ categories, max = 4, className }) {
    const [open, setOpen] = useState(null);
    const list = (categories || []).filter((c) => c && c.items?.length);
    const current = open ? list.find((c) => c.id === open) : null;
    return (
        <>
            <div className={cn('g-cats', className)}>
                {list.map((category) => (
                    <CategoryCard key={category.id} category={category} max={max} onSeeAll={(c) => setOpen(c.id)} />
                ))}
            </div>
            <Sheet
                open={Boolean(current)}
                onClose={() => setOpen(null)}
                title={current?.title}
                subtitle={current ? `${current.items.length} screens` : undefined}
            >
                {current ? (
                    <div className="g-cat__grid g-cat__grid--sheet">
                        {current.items.map((item) => (
                            <IconTile key={item.id} item={item} onAfter={() => setOpen(null)} />
                        ))}
                    </div>
                ) : null}
            </Sheet>
        </>
    );
}
