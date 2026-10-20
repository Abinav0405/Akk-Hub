/**
 * Native-app chrome (rendered only when isNativeApp() is true; styled by src/native/native-app.css).
 */
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/ui/utils';

export function NativeBackButton({ to, onClick, label = 'Back' }) {
    const icon = <ChevronLeft strokeWidth={2.4} aria-hidden />;
    if (to) {
        return (
            <Link to={to} onClick={onClick} className="akk-icon-btn akk-icon-btn--plain" aria-label={label}>
                {icon}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} className="akk-icon-btn akk-icon-btn--plain" aria-label={label}>
            {icon}
        </button>
    );
}

export const NativeIconButton = forwardRef(function NativeIconButton(
    { icon: Icon, label, tone, className, children, ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type="button"
            aria-label={label}
            title={label}
            className={cn('akk-icon-btn', tone && `akk-icon-btn--${tone}`, className)}
            {...props}
        >
            <Icon strokeWidth={2} aria-hidden />
            {children}
        </button>
    );
});

/** Sticky glass navigation bar. Pass `backTo`/`onBack` for a back chevron, or `leading` for anything else. */
export function NativeNavBar({
    title,
    subtitle,
    eyebrow,
    eyebrowTone,
    backTo,
    onBack,
    backLabel = 'Back',
    leading,
    trailing,
    children,
    plain = false,
    className,
    ...rest
}) {
    return (
        <header className={cn('akk-navbar', plain && 'akk-navbar--plain', className)} {...rest}>
            <div className="akk-navbar__bar">
                {backTo || onBack ? <NativeBackButton to={backTo} onClick={onBack} label={backLabel} /> : leading}
                <div className="akk-navbar__titles">
                    {eyebrow ? (
                        <p className="akk-navbar__eyebrow" data-tone={eyebrowTone}>
                            {eyebrow}
                        </p>
                    ) : null}
                    {title ? <h1 className="akk-navbar__title">{title}</h1> : null}
                    {subtitle ? <p className="akk-navbar__subtitle">{subtitle}</p> : null}
                </div>
                {trailing ? <div className="akk-navbar__trailing">{trailing}</div> : null}
            </div>
            {children ? <div className="akk-navbar__accessory">{children}</div> : null}
        </header>
    );
}

/** iOS-style segmented control for filters. `options`: [{ id, label }]. */
export function NativeSegmented({ options, value, onChange, ariaLabel, className }) {
    return (
        <div role="radiogroup" aria-label={ariaLabel} className={cn('akk-segmented', className)}>
            {options.map((option) => {
                const active = option.id === value;
                return (
                    <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className="akk-segmented__item"
                        onClick={() => {
                            if (!active) onChange(option.id);
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export function NativeSectionTitle({ children, action, className }) {
    return (
        <h2 className={cn('akk-section-title', className)}>
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
                <span className={cn('akk-row__icon', iconClass)}>
                    <Icon strokeWidth={1.9} aria-hidden />
                    {badge}
                </span>
            ) : null}
            <span className="min-w-0 flex-1">
                <span className="akk-row__title">{title}</span>
                {hint ? <span className="akk-row__hint">{hint}</span> : null}
            </span>
            {trailing ?? <ChevronRight className="akk-row__chevron" aria-hidden />}
        </>
    );
    if (to) {
        return (
            <Link to={to} onClick={onClick} className={cn('akk-row', className)} {...rest}>
                {body}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} className={cn('akk-row', className)} {...rest}>
            {body}
        </button>
    );
}

/** Morning / afternoon / evening greeting using Singapore wall-clock time. */
export function getSingaporeGreeting(now = new Date()) {
    const hour = Number(
        new Intl.DateTimeFormat('en-SG', { hour: 'numeric', hour12: false, timeZone: 'Asia/Singapore' }).format(now),
    ) % 24;
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}
