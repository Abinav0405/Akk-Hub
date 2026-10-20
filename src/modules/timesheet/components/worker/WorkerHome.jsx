/**
 * Employee home screen — "AKK Employee Home" design (iOS liquid glass, AKK colours).
 *
 *   HomeHeader      glass header: greeting, name, ID, notifications bell, initials avatar
 *   FormsBanner     amber "N forms to complete" banner
 *   ShiftCard       not clocked in / on shift / on break / shift done
 *   ActionTiles     2×2 tiles (Timesheets, Leave request, Payslips, Company forms)
 *   ListGroup       grouped rows (TIME & LEAVE, WORK, ACCOUNT)
 *   AttendanceDock  floating glass dock: "Scan to clock in" or Break + Clock out
 *   NotificationsSheet  bell → payslip/leave/timesheet updates and announcements
 *
 * Presentational only; WorkerPortal owns the data and handlers. Styles: worker-home.css.
 */
import { forwardRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, ClipboardList, Coffee, LogOut, MapPin, ScanLine } from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import './worker-home.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SGT = 'Asia/Singapore';

export function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "08:02" in Singapore time. */
export function sgtTime(value) {
    if (!value) return '—';
    try {
        return new Intl.DateTimeFormat('en-GB', { timeZone: SGT, hour: '2-digit', minute: '2-digit', hour12: false }).format(
            new Date(value),
        );
    } catch {
        return '—';
    }
}

/** Minutes worked on a shift so far (or in total once it has ended), minus breaks. */
export function workedMinutes(shift, breaks, now = new Date()) {
    if (!shift?.entry_time) return 0;
    if (shift.has_left && Number.isFinite(parseFloat(shift.worked_hours)) && parseFloat(shift.worked_hours) > 0) {
        return Math.round(parseFloat(shift.worked_hours) * 60);
    }
    const end = shift.has_left && shift.leave_time ? new Date(shift.leave_time) : now;
    let mins = (end - new Date(shift.entry_time)) / 60000;
    for (const b of breaks || []) {
        if (!b.break_start) continue;
        const bs = new Date(b.break_start);
        const be = b.break_end ? new Date(b.break_end) : end;
        mins -= Math.max(0, (be - bs) / 60000);
    }
    return Math.max(0, Math.floor(mins));
}

export function formatHm(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Re-render every `ms` while mounted (live clock / worked-time counters). Pauses when tab hidden. */
function useNow(ms) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const tick = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            setNow(new Date());
        };
        const id = window.setInterval(tick, ms);
        const onVisibility = () => {
            if (!document.hidden) setNow(new Date());
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [ms]);
    return now;
}

function Badge({ count }) {
    const n = Number(count) || 0;
    if (n <= 0) return null;
    return (
        <span className="wh-badge" aria-hidden="true">
            {n > 9 ? '9+' : n}
        </span>
    );
}

/** Link when `to` is set, otherwise a button. */
const Pressable = forwardRef(function Pressable({ to, onClick, className, children, ...rest }, ref) {
    if (to) {
        return (
            <Link ref={ref} to={to} onClick={onClick} className={className} {...rest}>
                {children}
            </Link>
        );
    }
    return (
        <button ref={ref} type="button" onClick={onClick} className={className} {...rest}>
            {children}
        </button>
    );
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function HomeHeader({ logoSrc, eyebrow, name, employeeId, bellCount, bellLabel, onBell, onAvatar, compact, tour }) {
    return (
        <header className={cn('wh-header wh-glass', compact && 'is-compact')} data-tour={tour}>
            <div className="wh-header__inner">
                {logoSrc ? <img src={logoSrc} alt="AKK" className="wh-header__logo" /> : null}
                <div className="wh-header__identity" data-tour="worker-identity">
                    <p className="wh-header__eyebrow">{eyebrow}</p>
                    <h1 className="wh-header__name">{name}</h1>
                    <p className="wh-header__id">{employeeId}</p>
                </div>
                <div className="wh-header__actions">
                    <button
                        type="button"
                        className="wh-iconbtn wh-glass-chip"
                        onClick={onBell}
                        aria-label={bellCount > 0 ? `${bellLabel}, ${bellCount} new` : bellLabel}
                    >
                        <Bell aria-hidden="true" />
                        <Badge count={bellCount} />
                    </button>
                    <button type="button" className="wh-avatar" onClick={onAvatar} aria-label="Account">
                        {initialsOf(name)}
                    </button>
                </div>
            </div>
        </header>
    );
}

// ---------------------------------------------------------------------------
// Forms banner
// ---------------------------------------------------------------------------

export function FormsBanner({ forms, to, title }) {
    if (!forms?.length) return null;
    return (
        <Link to={to} className="wh-banner">
            <span className="wh-banner__icon">
                <ClipboardList aria-hidden="true" />
            </span>
            <span className="wh-banner__text">
                <span className="wh-banner__title">{title}</span>
                <span className="wh-banner__sub">{forms.map((f) => f.title).join(', ')}</span>
            </span>
            <ChevronRight className="wh-banner__chevron" aria-hidden="true" />
        </Link>
    );
}

// ---------------------------------------------------------------------------
// Shift card
// ---------------------------------------------------------------------------

/**
 * state: 'loading' | 'not_started' | 'working' | 'on_lunch' | 'completed'
 * copy: translated strings (see WorkerPortal)
 */
export function ShiftCard({ state, shift, breaks, totalBreakMinutes, siteName, copy, extra, tour }) {
    const now = useNow(state === 'working' || state === 'on_lunch' ? 30_000 : 10_000);

    if (state === 'loading') {
        return (
            <section className="wh-card wh-shift" data-tour={tour} aria-busy="true">
                <div className="wh-skel wh-skel--chip" />
                <div className="wh-skel wh-skel--line" />
                <div className="wh-skel wh-skel--line wh-skel--short" />
            </section>
        );
    }

    const onShift = state === 'working' || state === 'on_lunch';
    const tone = state === 'working' ? 'success' : state === 'on_lunch' ? 'warning' : state === 'completed' ? 'done' : 'idle';
    const chip =
        state === 'working' ? copy.onShift : state === 'on_lunch' ? copy.onBreak : state === 'completed' ? copy.shiftDone : copy.notClockedIn;

    let big;
    let caption;
    if (onShift || state === 'completed') {
        big = formatHm(workedMinutes(shift, breaks, now));
        caption = copy.workedToday;
    } else {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: SGT,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        }).formatToParts(now);
        const get = (type) => parts.find((p) => p.type === type)?.value || '';
        big = `${get('hour')}:${get('minute')}`;
        caption = `${get('weekday')}, ${get('day')} ${get('month')} · SGT`;
    }

    const ongoingBreak = (breaks || []).find((b) => b.break_start && !b.break_end);
    let breakValue = copy.notTakenYet;
    if (ongoingBreak) breakValue = `${copy.since} ${sgtTime(ongoingBreak.break_start)}`;
    else if ((breaks || []).length) breakValue = `${breaks.length} · ${formatHm(Math.round(totalBreakMinutes || 0))}`;

    return (
        <section className="wh-card wh-shift" data-tour={tour}>
            <div className="wh-shift__top">
                <div className="wh-shift__left">
                    <span className="wh-chip" data-tone={tone}>
                        <i aria-hidden="true" />
                        {chip}
                    </span>
                    <p className="wh-shift__site">
                        <MapPin aria-hidden="true" />
                        <span>{siteName}</span>
                    </p>
                </div>
                <div className="wh-shift__right">
                    <p className="wh-shift__big">{big}</p>
                    <p className="wh-shift__caption">{caption}</p>
                </div>
            </div>
            <div className="wh-divider" />
            {state === 'not_started' ? (
                <p className="wh-shift__hint">
                    <ScanLine aria-hidden="true" />
                    <span>{copy.scanHint}</span>
                </p>
            ) : (
                <dl className="wh-shift__facts">
                    <div>
                        <dt>{copy.clockedIn}</dt>
                        <dd>{sgtTime(shift?.entry_time)}</dd>
                    </div>
                    {state === 'completed' ? (
                        <div>
                            <dt>{copy.clockedOut}</dt>
                            <dd>{sgtTime(shift?.leave_time)}</dd>
                        </div>
                    ) : (
                        <div>
                            <dt>{copy.break}</dt>
                            <dd>{breakValue}</dd>
                        </div>
                    )}
                </dl>
            )}
            {extra ? <div className="wh-shift__extra">{extra}</div> : null}
        </section>
    );
}

// ---------------------------------------------------------------------------
// Tiles + lists
// ---------------------------------------------------------------------------

/** tiles: [{ key, icon, tone, title, hint, to?, onClick?, badge?, tour? }] */
export function ActionTiles({ tiles, tour, label }) {
    return (
        <nav className="wh-tiles" aria-label={label} data-tour={tour}>
            {tiles.map(({ key, icon: Icon, tone, title, hint, to, onClick, badge, tour: tileTour }) => (
                <Pressable key={key} to={to} onClick={onClick} className="wh-tile" data-tour={tileTour}>
                    <span className="wh-tile__icon" data-tone={tone}>
                        <Icon aria-hidden="true" />
                        <Badge count={badge} />
                    </span>
                    <span className="wh-tile__title">{title}</span>
                    <span className="wh-tile__hint">{hint}</span>
                </Pressable>
            ))}
        </nav>
    );
}

/** rows: [{ key, icon, title, to?, onClick?, badge?, pill?, danger?, tour?, trailing?, chevron? }] */
export function ListGroup({ label, rows, id }) {
    const visible = rows.filter(Boolean);
    if (!visible.length) return null;
    return (
        <section className="wh-group" id={id} aria-label={label}>
            <h2 className="wh-group__label">{label}</h2>
            <div className="wh-card wh-list">
                {visible.map(({ key, icon: Icon, title, to, onClick, badge, pill, danger, tour, trailing, chevron = true }) =>
                    trailing ? (
                        <div key={key} className="wh-row wh-row--static">
                            <Icon className="wh-row__icon" aria-hidden="true" />
                            <span className="wh-row__title">{title}</span>
                            {trailing}
                        </div>
                    ) : (
                        <Pressable
                            key={key}
                            to={to}
                            onClick={onClick}
                            className={cn('wh-row', danger && 'is-danger')}
                            data-tour={tour}
                        >
                            <span className="wh-row__iconwrap">
                                <Icon className="wh-row__icon" aria-hidden="true" />
                                <Badge count={badge} />
                            </span>
                            <span className="wh-row__title">{title}</span>
                            {pill ? <span className="wh-row__pill">{pill}</span> : null}
                            {chevron && !danger ? <ChevronRight className="wh-row__chevron" aria-hidden="true" /> : null}
                        </Pressable>
                    ),
                )}
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Attendance dock
// ---------------------------------------------------------------------------

export function AttendanceDock({
    loading,
    canClockIn,
    hasBreakTarget,
    onBreak,
    canClockOut,
    onClockIn,
    onBreakScan,
    onClockOut,
    copy,
}) {
    const onShift = hasBreakTarget || canClockOut;
    return (
        <nav
            className="wh-dock wh-glass akk-hide-on-kb"
            aria-label={copy.attendance}
            aria-busy={loading || undefined}
            data-tour="worker-attendance"
        >
            {onShift ? (
                <div className="wh-dock__row">
                    <button
                        type="button"
                        className={cn('wh-dock__btn', onBreak ? 'is-amber' : 'is-light')}
                        onClick={onBreakScan}
                        disabled={loading || !hasBreakTarget}
                        aria-pressed={onBreak}
                        data-tour="worker-break"
                    >
                        <Coffee aria-hidden="true" />
                        {onBreak ? copy.endBreak : copy.break}
                    </button>
                    <button
                        type="button"
                        className="wh-dock__btn is-navy"
                        onClick={onClockOut}
                        disabled={loading || !canClockOut}
                        data-tour="worker-clock-out"
                    >
                        <LogOut aria-hidden="true" />
                        {copy.clockOut}
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className="wh-dock__btn is-brand is-wide"
                    onClick={onClockIn}
                    disabled={loading || !canClockIn}
                    data-tour="worker-clock-in"
                >
                    <ScanLine aria-hidden="true" />
                    {copy.scanToClockIn}
                </button>
            )}
        </nav>
    );
}

// ---------------------------------------------------------------------------
// Notifications sheet content (rendered inside the app's Dialog)
// ---------------------------------------------------------------------------

/** updates: [{ key, icon, tone, title, hint, onClick }]; announcements: [{ id, title, body, image_url }] */
export function NotificationsList({ updates, announcements, emptyText, announcementsLabel }) {
    if (!updates.length && !announcements.length) {
        return <p className="wh-notes__empty">{emptyText}</p>;
    }
    return (
        <div className="wh-notes">
            {updates.length ? (
                <div className="wh-card wh-list">
                    {updates.map(({ key, icon: Icon, tone, title, hint, onClick }) => (
                        <button key={key} type="button" className="wh-row wh-row--tall" onClick={onClick}>
                            <span className="wh-tile__icon wh-tile__icon--sm" data-tone={tone}>
                                <Icon aria-hidden="true" />
                            </span>
                            <span className="wh-row__text">
                                <span className="wh-row__title">{title}</span>
                                {hint ? <span className="wh-row__hint">{hint}</span> : null}
                            </span>
                            <ChevronRight className="wh-row__chevron" aria-hidden="true" />
                        </button>
                    ))}
                </div>
            ) : null}
            {announcements.length ? (
                <>
                    <h3 className="wh-group__label">{announcementsLabel}</h3>
                    {announcements.map((a) => (
                        <article key={a.id} className="wh-card wh-note">
                            <p className="wh-note__title">{a.title}</p>
                            {a.body ? <p className="wh-note__body">{a.body}</p> : null}
                            {a.image_url ? <img src={a.image_url} alt="" className="wh-note__img" loading="lazy" /> : null}
                        </article>
                    ))}
                </>
            ) : null}
        </div>
    );
}
