import { cn } from '@/ui/utils';
import TopBar from '@/ui/hub/TopBar';
import Segmented from '@/ui/hub/Segmented';
import { isNativeApp } from '@/core/platform';

/** Hub web: no portal eyebrow (sidebar/tab already says Site progress). Native keeps it. */
export default function ProgressPortalShell({
    portalLabel,
    groups = [],
    value,
    onChange,
    sectionLabel,
    children,
    className,
}) {
    const items = groups.flatMap((g) => g.items || []);
    const current = items.find((i) => i.id === value);
    const native = isNativeApp();
    const eyebrow =
        native && portalLabel ? String(portalLabel).replace(/\s*-\s*/, ' · ') : null;

    return (
        <>
            <TopBar eyebrow={eyebrow} title={sectionLabel || current?.label || 'Overview'}>
                {items.length > 1 ? (
                    <div
                        data-section-nav
                        className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        <Segmented
                            options={items.map((i) => ({
                                id: i.id,
                                label:
                                    i.badge > 0
                                        ? `${i.label} (${i.badge > 99 ? '99+' : i.badge})`
                                        : i.label,
                                icon: i.icon,
                            }))}
                            value={value}
                            onChange={onChange}
                            ariaLabel="Sections"
                            className="min-w-max [&_.g-segmented__opt]:min-h-11"
                        />
                    </div>
                ) : null}
            </TopBar>
            <main className={cn('g-main max-w-7xl space-y-4', className)}>{children}</main>
        </>
    );
}
