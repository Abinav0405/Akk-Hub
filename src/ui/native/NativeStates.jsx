/**
 * Loading / empty / error states (Timesheet NativeStates API, glass styling, web + native).
 */
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/ui/utils';
import { isNetworkError } from '@/core/auth/timesheetSession';

export function NativeSkeleton({ className, style }) {
    return <span className={cn('g-skeleton block', className)} style={style} aria-hidden />;
}

/** Card-shaped placeholders that mirror list rows, so content does not jump when it arrives. */
export function NativeListSkeleton({ rows = 3, label = 'Loading', className }) {
    return (
        <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
            <span className="sr-only">{label}</span>
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="g-card g-card--flat p-4" aria-hidden>
                    <div className="flex items-center gap-3">
                        <NativeSkeleton className="h-10 w-10 shrink-0 rounded-xl" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <NativeSkeleton className="h-3.5 w-2/5" />
                            <NativeSkeleton className="h-3 w-3/5" />
                        </div>
                    </div>
                    <NativeSkeleton className="mt-4 h-3 w-4/5" />
                </div>
            ))}
        </div>
    );
}

export function NativeEmptyState({ icon: Icon, title, message, action, className }) {
    return (
        <div className={cn('g-empty', className)}>
            {Icon ? (
                <span className="g-empty__icon">
                    <Icon aria-hidden />
                </span>
            ) : null}
            <p className="g-empty__title">{title}</p>
            {message ? <p className="g-empty__text">{message}</p> : null}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    );
}

export function NativeErrorState({ title, message, error, onRetry, retrying = false, className }) {
    const offline = error ? isNetworkError(error) : false;
    const Icon = offline ? WifiOff : AlertTriangle;
    return (
        <div role="alert" className={cn('g-empty', className)} style={{ '--tone': 'var(--g-danger)', '--tone-soft': 'var(--g-danger-soft)' }}>
            <span className="g-empty__icon">
                <Icon aria-hidden />
            </span>
            <p className="g-empty__title">{title || (offline ? 'You’re offline' : 'Couldn’t load this')}</p>
            <p className="g-empty__text">
                {message ||
                    (offline ? 'Check your connection, then try again.' : 'Something went wrong on our side. Please try again.')}
            </p>
            {onRetry ? (
                <button type="button" className="g-btn g-btn--secondary g-btn--sm mt-2" onClick={onRetry} disabled={retrying}>
                    <RefreshCw className={cn(retrying && 'animate-spin')} aria-hidden />
                    {retrying ? 'Retrying…' : 'Try again'}
                </button>
            ) : null}
        </div>
    );
}

export function NativeLoadingScreen({ label = 'Loading…', inline = false }) {
    return (
        <div className={cn('g-loading-screen', inline && 'min-h-[30vh]')} role="status" aria-live="polite">
            {inline ? null : <img src="/Akk-logo.png" alt="" className="g-topbar__logo h-12 w-12" />}
            <span className="flex items-center gap-2">
                <span className="g-spinner inline-block h-4 w-4" aria-hidden />
                {label}
            </span>
        </div>
    );
}

/** Materials / SPT names. */
export const NativeLoading = NativeLoadingScreen;
export const NativeEmpty = NativeEmptyState;
export const NativeError = NativeErrorState;
