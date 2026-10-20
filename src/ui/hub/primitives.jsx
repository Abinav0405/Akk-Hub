/**
 * Small glass building blocks for hub screens (styles in ui/styles/glass.css).
 */
import { forwardRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, Eye, EyeOff, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/ui/utils';

export function Heading({ eyebrow, title, lede, actions, className }) {
    return (
        <div className={cn('g-heading flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
            <div className="min-w-0">
                {eyebrow ? <p className="g-heading__eyebrow">{eyebrow}</p> : null}
                {title ? <h2 className="g-heading__title">{title}</h2> : null}
                {lede ? <p className="g-heading__lede">{lede}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
    );
}

export function SectionLabel({ children, action, className }) {
    return (
        <div className={cn('g-section-label flex items-center justify-between gap-2', className)}>
            <span>{children}</span>
            {action ? <span className="normal-case tracking-normal">{action}</span> : null}
        </div>
    );
}

/** Grouped list container. */
export function List({ children, className, ...rest }) {
    return (
        <div className={cn('g-list', className)} {...rest}>
            {children}
        </div>
    );
}

/** One row of a grouped list — a Link when `to` is set, otherwise a button (or a div with `as="div"`). */
export function ListRow({ icon: Icon, tone, title, hint, to, href, onClick, trailing, badge, as, className, ...rest }) {
    const body = (
        <>
            {Icon ? (
                <span className="g-row__icon" data-tone={tone}>
                    <Icon strokeWidth={1.9} aria-hidden />
                </span>
            ) : null}
            <span className="g-row__body">
                <span className="g-row__title block">{title}</span>
                {hint ? <span className="g-row__hint block">{hint}</span> : null}
            </span>
            {badge}
            {trailing === undefined ? <ChevronRight className="g-row__chev" aria-hidden /> : trailing}
        </>
    );
    const cls = cn('g-row', className);
    if (to) {
        return (
            <Link to={to} onClick={onClick} className={cls} data-tone={tone} {...rest}>
                {body}
            </Link>
        );
    }
    if (href) {
        return (
            <a href={href} onClick={onClick} className={cls} data-tone={tone} {...rest}>
                {body}
            </a>
        );
    }
    if (as === 'div') {
        return (
            <div className={cls} data-tone={tone} {...rest}>
                {body}
            </div>
        );
    }
    return (
        <button type="button" onClick={onClick} className={cls} data-tone={tone} {...rest}>
            {body}
        </button>
    );
}

/** Launcher tile for a module / action. */
export function Tile({ icon: Icon, tone, title, hint, to, onClick, badge, className, style }) {
    const inner = (
        <>
            <span className="g-tile__icon">
                <Icon strokeWidth={1.9} aria-hidden />
            </span>
            {badge ? <span className="g-tile__badge">{badge}</span> : null}
            <span className="g-tile__title">{title}</span>
            {hint ? <span className="g-tile__hint">{hint}</span> : null}
        </>
    );
    if (to) {
        return (
            <Link to={to} className={cn('g-tile', className)} data-tone={tone} onClick={onClick} style={style}>
                {inner}
            </Link>
        );
    }
    return (
        <button type="button" className={cn('g-tile', className)} data-tone={tone} onClick={onClick} style={style}>
            {inner}
        </button>
    );
}

export function Stat({ value, label, tone }) {
    return (
        <div className="g-stat" data-tone={tone}>
            <div className="g-stat__value">{value}</div>
            <div className="g-stat__label">{label}</div>
        </div>
    );
}

const BANNER_ICON = { danger: AlertCircle, warning: TriangleAlert, success: CheckCircle2, info: Info };

export function Banner({ tone = 'info', children, className, role }) {
    const Icon = BANNER_ICON[tone] || Info;
    return (
        <div className={cn('g-banner', className)} data-tone={tone} role={role || (tone === 'danger' ? 'alert' : 'status')}>
            <Icon aria-hidden />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

export function EmptyState({ icon: Icon, tone, title, children, action, className }) {
    return (
        <div className={cn('g-empty', className)} data-tone={tone}>
            {Icon ? (
                <span className="g-empty__icon">
                    <Icon aria-hidden />
                </span>
            ) : null}
            <p className="g-empty__title">{title}</p>
            {children ? <div className="g-empty__text">{children}</div> : null}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    );
}

/** Text field with a label (glass style). Pass `error` to mark it invalid. */
export const Field = forwardRef(function Field({ id, label, hint, error, className, inputClassName, ...props }, ref) {
    return (
        <div className={cn('g-field', className)}>
            {label ? (
                <label htmlFor={id} className="g-label">
                    {label}
                </label>
            ) : null}
            <input
                ref={ref}
                id={id}
                name={props.name || id}
                className={cn('g-input', inputClassName)}
                aria-invalid={error ? true : undefined}
                {...props}
            />
            {hint ? <p className="px-1 text-xs text-[var(--g-muted)]">{hint}</p> : null}
        </div>
    );
});

export const PasswordField = forwardRef(function PasswordField({ id, label, error, className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
        <div className={cn('g-field', className)}>
            {label ? (
                <label htmlFor={id} className="g-label">
                    {label}
                </label>
            ) : null}
            <div className="g-input-wrap">
                <input
                    ref={ref}
                    id={id}
                    name={props.name || id}
                    type={visible ? 'text' : 'password'}
                    className="g-input"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={error ? true : undefined}
                    {...props}
                />
                <button
                    type="button"
                    className="g-input-wrap__btn"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? 'Hide password' : 'Show password'}
                    aria-pressed={visible}
                    aria-controls={id}
                >
                    {visible ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                </button>
            </div>
        </div>
    );
});

export function Spinner({ className }) {
    return <span className={cn('g-spinner inline-block', className)} aria-hidden />;
}

export function LoadingScreen({ label = 'Loading…' }) {
    return (
        <div className="g-loading-screen" role="status" aria-live="polite">
            <Spinner />
            <span>{label}</span>
        </div>
    );
}
