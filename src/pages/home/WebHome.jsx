/**
 * Website home — compact signed-out landing (any browser). No tab bar.
 * Four portal cards + Verify a photo. App (Capacitor / ?app=1) uses AppHome.
 *
 * Portal clicks: selection highlight → exit → navigate. Login routes reveal via
 * LoginForm `lx-stage--from-home` (session flag). Verify uses a lighter soft exit.
 * Reduced motion → instant navigate. No fake screens.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Clock, Shield, ShieldCheck, Users } from 'lucide-react';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { paths } from '@/app/paths';
import { prefetchModulePage } from '@/app/modulePage';

/** Phase 1 highlight, then Phase 2 exit — total ≤ ~360ms before navigate. */
const SELECT_MS = 120;
const PORTAL_EXIT_MS = 220;
const VERIFY_EXIT_MS = 140;

const FROM_HOME_KEY = 'akk-from-home';

/** Warm the next route chunk during hover / exit so Suspense doesn’t flash after navigate. */
function prefetchDest(to) {
    if (to === paths.verify || to.startsWith(`${paths.verify}?`)) {
        prefetchModulePage('progress', 'PhotoVerification');
        return;
    }
    if (to.includes('/progress/client/login')) {
        void import('@/pages/login/ClientLogin');
        return;
    }
    void import('@/pages/login/LoginPage');
}

function markFromHome(kind) {
    try {
        sessionStorage.setItem(FROM_HOME_KEY, kind);
    } catch {
        /* private mode / blocked storage */
    }
}

const PORTALS = [
    {
        key: 'employee',
        to: `${paths.login}?role=employee`,
        icon: Clock,
        title: 'Employees',
        hint: 'Clock in, leave, payslips, materials and site photos',
    },
    {
        key: 'manager',
        to: `${paths.login}?role=management`,
        icon: Users,
        title: 'Managers & supervisors',
        hint: 'Approve shifts, leave, material requests and site packages',
        tone: 'manager',
    },
    {
        key: 'admin',
        to: `${paths.login}?role=admin`,
        icon: Shield,
        title: 'Admin',
        hint: 'People, payroll, sites, stock, billing and settings',
        tone: 'admin',
    },
    {
        key: 'client',
        to: paths.progress.clientLogin,
        icon: Building2,
        title: 'Clients',
        tag: 'Export only',
        hint: 'Download approved site reports, review JSRs and claims',
        tone: 'client',
    },
];

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Left-click only; keep modified / middle clicks as normal Link behavior. */
function isPlainLeftClick(e) {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function PortalCard({ to, icon: Icon, title, hint, tag, tone, onNavigate }) {
    return (
        <Link
            to={to}
            className="hx-card"
            data-tone={tone}
            onClick={onNavigate(to)}
            onPointerEnter={() => prefetchDest(to)}
            onFocus={() => prefetchDest(to)}
        >
            <span className="hx-card__icon">
                <Icon strokeWidth={1.85} aria-hidden />
            </span>
            <span className="hx-card__body">
                <span className="hx-card__title">
                    {title}
                    {tag ? <span className="hx-card__tag">{tag}</span> : null}
                </span>
                <span className="hx-card__hint">{hint}</span>
            </span>
            <ChevronRight className="hx-card__go" aria-hidden />
        </Link>
    );
}

export default function WebHome() {
    const navigate = useNavigate();
    const rootRef = useRef(null);
    const leavingRef = useRef(false);
    const timerRef = useRef(0);

    useEffect(() => () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
    }, []);

    const leaveTo = useCallback((to, { soft = false } = {}) => (e) => {
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        if (leavingRef.current) return;

        if (prefersReducedMotion()) {
            navigate(to);
            return;
        }

        leavingRef.current = true;
        prefetchDest(to);

        const card = e.currentTarget;
        if (!soft && card) card.classList.add('is-selected');

        const selectMs = soft ? 0 : SELECT_MS;
        const exitMs = soft ? VERIFY_EXIT_MS : PORTAL_EXIT_MS;
        const root = rootRef.current;

        timerRef.current = window.setTimeout(() => {
            root?.classList.add(soft ? 'is-leaving-soft' : 'is-leaving');
            markFromHome(soft ? 'verify' : 'login');
            timerRef.current = window.setTimeout(() => {
                navigate(to);
            }, exitMs);
        }, selectMs);
    }, [navigate]);

    return (
        <div className="hx" ref={rootRef}>
            <div className="hx-atmos" aria-hidden />

            <header className="hx-nav">
                <div className="hx__wrap hx-nav__bar">
                    <Link to="/" className="hx-brand" aria-label="AKK Hub home">
                        <img src="/Akk-logo.png" alt="" className="hx-brand__mark" />
                        <span className="hx-brand__name">AKK Hub</span>
                    </Link>
                    <div className="hx-nav__end">
                        <LanguageSwitcher />
                    </div>
                </div>
            </header>

            <main className="hx__wrap hx-main">
                <section className="hx-intro hx-in" aria-labelledby="hx-heading">
                    <div className="hx-hero">
                        <img src="/Akk-logo.png" alt="" className="hx-hero__mark" />
                        <div className="hx-hero__text">
                            <h1 id="hx-heading" className="hx-hero__name">
                                AKK Hub
                            </h1>
                            <p className="hx-hero__line">Built for AKK Engineering sites</p>
                        </div>
                    </div>
                    <p className="hx-title">Sign in</p>
                    <p className="hx-lede">
                        Choose your portal to clock in, manage the site, or export client reports.
                    </p>
                </section>

                <nav className="hx-grid hx-in hx-in-1" aria-label="Sign in">
                    {PORTALS.map(({ key, ...p }) => (
                        <PortalCard key={key} {...p} onNavigate={leaveTo} />
                    ))}
                </nav>

                <Link
                    to={paths.verify}
                    className="hx-verify hx-in hx-in-2"
                    onClick={leaveTo(paths.verify, { soft: true })}
                    onPointerEnter={() => prefetchDest(paths.verify)}
                    onFocus={() => prefetchDest(paths.verify)}
                >
                    <span className="hx-verify__icon">
                        <ShieldCheck strokeWidth={1.85} aria-hidden />
                    </span>
                    <span className="hx-verify__body">
                        <span className="hx-verify__title">Verify a photo</span>
                        <span className="hx-verify__hint">Check an AKK site photo is genuine — no login needed</span>
                    </span>
                    <ChevronRight className="hx-verify__go" aria-hidden />
                </Link>
            </main>

            <footer className="hx-foot">
                <div className="hx__wrap hx-foot__row">
                    <span>© {new Date().getFullYear()} AKK ENGINEERING PTE. LTD.</span>
                    <Link to={paths.privacy}>Privacy notice</Link>
                </div>
            </footer>
        </div>
    );
}
