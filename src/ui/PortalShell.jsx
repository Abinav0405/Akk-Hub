/**
 * Timesheet page shells (PortalShell.jsx API) on the hub chrome.
 *
 * Ported Timesheet screens render <AdminPageShell> / <WorkerPageShell>. Inside the hub these
 * draw the glass TopBar (back button, eyebrow, title, actions) and the content column; the
 * sidebar / tab bar come from HubLayout around them.
 */
import { cn } from '@/ui/utils';
import TopBar from '@/ui/hub/TopBar';
import { glassDialog, glassInput, glassPanel } from '@/ui/glass';
import { easeSoft, sheetSpring } from '@/core/platform';

export { glassPanel, glassDialog, glassInput, easeSoft, sheetSpring };

/** The ambient canvas is global now (body::before) — kept so old imports still render. */
export function PortalBackdrop() {
    return null;
}

export function AdminFieldLabel({ children }) {
    return <label className="text-xs font-semibold uppercase tracking-wide text-[var(--g-muted)]">{children}</label>;
}

const TONES = {
    slate: 'bg-slate-100 text-slate-700',
    sky: 'bg-sky-100 text-sky-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    violet: 'bg-violet-100 text-violet-700',
    teal: 'bg-teal-100 text-teal-700',
    indigo: 'bg-brand-soft text-brand',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-700',
};

export function AdminToneIcon({ icon: Icon, tone = 'indigo', className }) {
    return (
        <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', TONES[tone] || TONES.indigo, className)}>
            <Icon className="h-4 w-4" />
        </span>
    );
}

export function AdminChoiceCard({ icon: Icon, title, subtitle, hint, onClick, tone = 'slate', className, ...props }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'g-card flex min-h-[9.5rem] flex-1 flex-col items-start gap-2 p-4 text-left transition-[box-shadow,transform] duration-200 hover:shadow-float active:scale-[0.99]',
                className,
            )}
            {...props}
        >
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', TONES[tone] || TONES.slate)}>
                <Icon className="h-5 w-5" />
            </span>
            <span className="font-semibold tracking-tight text-[var(--g-ink)]">{title}</span>
            {subtitle ? <span className="text-sm leading-snug text-[var(--g-muted)]">{subtitle}</span> : null}
            {hint ? <span className="text-xs text-[var(--g-faint)]">{hint}</span> : null}
        </button>
    );
}

export function AdminPageShell({
    title,
    subtitle,
    icon: Icon,
    tone = 'indigo',
    actions,
    children,
    maxWidth = 'max-w-7xl',
    backTo = 'AdminDashboard',
    backAriaLabel = 'Back',
    eyebrow = 'Admin',
}) {
    return (
        <>
            <TopBar
                backTo={backTo}
                backLabel={backAriaLabel}
                eyebrow={eyebrow}
                title={title}
                subtitle={subtitle}
                trailing={Icon ? <AdminToneIcon icon={Icon} tone={tone} className="hidden h-10 w-10 rounded-2xl sm:inline-flex" /> : null}
            >
                {actions ? (
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                        {actions}
                    </div>
                ) : null}
            </TopBar>
            <main className={cn('g-main space-y-4', maxWidth)}>{children}</main>
        </>
    );
}

export function WorkerPageShell({ title, subtitle, children, maxWidth = 'max-w-4xl', backTo = 'WorkerPortal', actions }) {
    return (
        <>
            <TopBar backTo={backTo} title={title} subtitle={subtitle} trailing={actions} />
            <main className={cn('g-main', maxWidth)}>{children}</main>
        </>
    );
}

/** Generic hub screen: TopBar + content column. */
export function HubPage({ title, eyebrow, subtitle, backTo, trailing, toolbar, children, narrow = false, className }) {
    return (
        <>
            <TopBar title={title} eyebrow={eyebrow} subtitle={subtitle} backTo={backTo} trailing={trailing}>
                {toolbar}
            </TopBar>
            <main className={cn('g-main', narrow && 'g-main--narrow', className)}>{children}</main>
        </>
    );
}

export default AdminPageShell;
