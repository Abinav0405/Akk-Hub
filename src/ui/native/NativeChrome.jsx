/**
 * Timesheet "native chrome" API on the hub glass design (web + native).
 */
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/ui/utils';
import TopBar from '@/ui/hub/TopBar';
import Segmented from '@/ui/hub/Segmented';

export function NativeBackButton({ to, onClick, label = 'Back' }) {
    const icon = <ChevronLeft strokeWidth={2.4} aria-hidden />;
    if (to) {
        return (
            <Link to={to} onClick={onClick} className="g-icon-btn g-icon-btn--plain -ml-2" aria-label={label}>
                {icon}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} className="g-icon-btn g-icon-btn--plain -ml-2" aria-label={label}>
            {icon}
        </button>
    );
}

export const NativeIconButton = forwardRef(function NativeIconButton(
    { icon: Icon, label, tone, className, children, ...props },
    ref,
) {
    return (
        <button ref={ref} type="button" aria-label={label} title={label} className={cn('g-icon-btn', className)} data-tone={tone} {...props}>
            {Icon ? <Icon strokeWidth={2} aria-hidden /> : null}
            {children}
        </button>
    );
});

/** Sticky glass navigation bar (maps to the hub TopBar). `left` / `right` are the Materials names. */
export function NativeNavBar({
    title,
    subtitle,
    eyebrow,
    backTo,
    onBack,
    backLabel = 'Back',
    leading,
    left,
    trailing,
    right,
    children,
    className,
}) {
    return (
        <TopBar
            title={title}
            subtitle={subtitle}
            eyebrow={eyebrow}
            backTo={backTo}
            onBack={onBack}
            backLabel={backLabel}
            leading={leading ?? left ?? (backTo || onBack ? undefined : null)}
            trailing={trailing ?? right}
            className={className}
        >
            {children}
        </TopBar>
    );
}

/** Segmented control. `options`: [{ id, label }]. */
export function NativeSegmented({ options, value, onChange, ariaLabel, className }) {
    return <Segmented options={options} value={value} onChange={onChange} ariaLabel={ariaLabel} className={className} />;
}

export function NativeSectionTitle({ children, action, className }) {
    return (
        <h2 className={cn('g-section-label flex items-center justify-between gap-2', className)}>
            <span>{children}</span>
            {action ? <span className="normal-case tracking-normal">{action}</span> : null}
        </h2>
    );
}

/** One row of a grouped list. Renders a Link when `to` is set, otherwise a button. */
export function NativeListRow({ icon: Icon, iconClass, title, hint, to, onClick, badge, trailing, className, ...rest }) {
    const body = (
        <>
            {Icon ? (
                <span className={cn('g-row__icon', iconClass)}>
                    <Icon strokeWidth={1.9} aria-hidden />
                    {badge}
                </span>
            ) : null}
            <span className="g-row__body">
                <span className="g-row__title block">{title}</span>
                {hint ? <span className="g-row__hint block">{hint}</span> : null}
            </span>
            {trailing ?? <ChevronRight className="g-row__chev" aria-hidden />}
        </>
    );
    if (to) {
        return (
            <Link to={to} onClick={onClick} className={cn('g-row', className)} {...rest}>
                {body}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} className={cn('g-row', className)} {...rest}>
            {body}
        </button>
    );
}

/** Morning / afternoon / evening greeting using Singapore wall-clock time. */
export function getSingaporeGreeting(now = new Date()) {
    const hour =
        Number(new Intl.DateTimeFormat('en-SG', { hour: 'numeric', hour12: false, timeZone: 'Asia/Singapore' }).format(now)) %
        24;
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}
