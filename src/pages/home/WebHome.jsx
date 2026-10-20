/**
 * Website home — product landing for any browser (phone or desktop). No tab bar.
 *   nav · hero with the "Sign in to…" glass panel (4 portals) · the three systems ·
 *   Verify-a-photo band · footer.
 * The app (Capacitor / ?app=1) uses AppHome instead.
 */
import { Link } from 'react-router-dom';
import {
    ArrowRight,
    BadgeCheck,
    Boxes,
    Building2,
    Camera,
    Check,
    ChevronRight,
    Clock,
    QrCode,
    Shield,
    ShieldCheck,
    Smartphone,
    Users,
} from 'lucide-react';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { paths } from '@/app/paths';

const PORTALS = [
    {
        key: 'employee',
        to: `${paths.login}?role=employee`,
        icon: Clock,
        title: 'Employees',
        hint: 'Clock in, leave, payslips, materials and site photos',
        primary: true,
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

const SYSTEMS = [
    {
        key: 'timesheet',
        icon: Clock,
        name: 'Attendance',
        text: 'Attendance that proves itself — no paper, no guesswork.',
        points: ['Clock in and out by site QR with a GPS check', 'Leave requests, balances and approvals', 'Payslips with CPF / SINDA worked out'],
    },
    {
        key: 'materials',
        tone: 'materials',
        icon: Boxes,
        name: 'Materials',
        text: 'Every item taken and returned, with a reference number.',
        points: ['Take and return requests from the phone', 'Partial returns tracked to the piece', 'Stock, sites and requesters in one place'],
    },
    {
        key: 'progress',
        tone: 'progress',
        icon: Camera,
        name: 'Site work',
        text: 'Before, during and after photos that become the report.',
        points: ['Stamped photos with time, place and GPS', 'Review, approve and print site packages', 'JSRs, claims and invoices for clients'],
    },
];

function PortalRow({ to, icon: Icon, title, hint, tag, tone, primary, delay }) {
    return (
        <Link to={to} className={`hx-portal ${primary ? 'hx-portal--primary' : ''} hx-in hx-in-${delay}`} data-tone={tone}>
            <span className="hx-portal__icon">
                <Icon strokeWidth={1.9} aria-hidden />
            </span>
            <span className="hx-portal__body">
                <span className="hx-portal__title">
                    {title}
                    {tag ? <span className="hx-portal__tag">{tag}</span> : null}
                </span>
                <span className="hx-portal__hint block">{hint}</span>
            </span>
            <ChevronRight className="hx-portal__go" aria-hidden />
        </Link>
    );
}

export default function WebHome() {
    return (
        <div className="hx">
            <div className="hx__ambient" aria-hidden="true" />

            <header className="hx-nav">
                <div className="hx__wrap hx-nav__bar">
                    <Link to="/" className="hx-brand" aria-label="AKK Hub home">
                        <img src="/Akk-logo.png" alt="" className="hx-brand__mark" />
                        <span>
                            <span className="hx-brand__name block">AKK Hub</span>
                            <span className="hx-brand__sub block">AKK Engineering</span>
                        </span>
                    </Link>
                    <nav className="hx-nav__links" aria-label="Site">
                        <a href="#systems" className="hx-nav__link">
                            What’s inside
                        </a>
                        <Link to={paths.verify} className="hx-nav__link">
                            <ShieldCheck className="h-4 w-4" aria-hidden /> Verify a photo
                        </Link>
                    </nav>
                    <div className="hx-nav__end">
                        <div className="hx-nav__lang">
                            <LanguageSwitcher />
                        </div>
                        <Link to={`${paths.login}?role=employee`} className="hx-btn hx-btn--primary hx-btn--sm">
                            Sign in
                        </Link>
                    </div>
                </div>
            </header>

            <main className="relative z-[1] flex-1">
                <section className="hx__wrap hx-hero">
                    <div className="hx-in">
                        <span className="hx-eyebrow">
                            <span className="hx-eyebrow__dot" aria-hidden /> AKK Engineering Pte. Ltd.
                        </span>
                        <h1 className="hx-title">
                            Every site, every shift — <em>one sign-in.</em>
                        </h1>
                        <p className="hx-lede">
                            One app for the whole team. Clock in at the site,
                            request what you need, and send photos that turn into the client’s report.
                        </p>
                        <div className="hx-actions">
                            <Link to={`${paths.login}?role=employee`} className="hx-btn hx-btn--primary">
                                Employee sign in <ArrowRight aria-hidden />
                            </Link>
                            <Link to={paths.verify} className="hx-btn hx-btn--ghost">
                                <ShieldCheck aria-hidden /> Verify a photo
                            </Link>
                        </div>
                        <div className="hx-proof">
                            <span>
                                <QrCode aria-hidden /> QR + GPS clock-in
                            </span>
                            <span>
                                <BadgeCheck aria-hidden /> Tamper-evident photos
                            </span>
                            <span>
                                <Check aria-hidden /> Approvals in one inbox
                            </span>
                        </div>
                        <div className="hx-lang-m">
                            <LanguageSwitcher />
                        </div>
                    </div>

                    <div className="hx-panel hx-in hx-in-1" aria-labelledby="hx-signin">
                        <div className="hx-panel__head">
                            <h2 id="hx-signin" className="hx-panel__title">
                                Sign in to…
                            </h2>
                            <span className="hx-panel__hint">Pick your portal</span>
                        </div>
                        <div className="hx-portals">
                            {PORTALS.map(({ key, ...p }, i) => (
                                <PortalRow key={key} {...p} delay={Math.min(i + 1, 3)} />
                            ))}
                        </div>
                        <p className="hx-panel__foot">
                            <Smartphone aria-hidden />
                            On your phone? The AKK Hub app adds Face ID and fingerprint sign-in.
                        </p>
                    </div>
                </section>

                <section id="systems" className="hx__wrap hx-section" aria-labelledby="hx-systems-title">
                    <p className="hx-section__eyebrow">What’s inside</p>
                    <h2 id="hx-systems-title" className="hx-section__title">
                        One app for the whole job — from clock-in to client report.
                    </h2>
                    <div className="hx-systems">
                        {SYSTEMS.map(({ key, tone, icon: Icon, name, text, points }) => (
                            <article key={key} className="hx-system" data-tone={tone}>
                                <span className="hx-system__icon">
                                    <Icon strokeWidth={1.9} aria-hidden />
                                </span>
                                <h3 className="hx-system__name">{name}</h3>
                                <p className="hx-system__text">{text}</p>
                                <ul className="hx-system__list">
                                    {points.map((point) => (
                                        <li key={point}>
                                            <Check aria-hidden />
                                            <span>{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="hx__wrap pb-12" aria-labelledby="hx-verify-title">
                    <div className="hx-verify">
                        <span className="hx-verify__icon">
                            <ShieldCheck aria-hidden />
                        </span>
                        <div>
                            <h2 id="hx-verify-title" className="hx-verify__title">
                                Got an AKK site photo? Check it’s genuine.
                            </h2>
                            <p className="hx-verify__text">
                                Upload one photo or a whole set. We read the code stamped on each photo and compare it with the
                                original. No login needed.
                            </p>
                        </div>
                        <Link to={paths.verify} className="hx-btn hx-btn--light">
                            Verify photos <ArrowRight aria-hidden />
                        </Link>
                    </div>
                </section>
            </main>

            <footer className="hx-foot">
                <div className="hx__wrap hx-foot__row">
                    <span>
                        © {new Date().getFullYear()} AKK ENGINEERING PTE. LTD. · 15 Kaki Bukit Rd 4, #01-50, Singapore 417808
                    </span>
                    <Link to={paths.privacy}>Privacy notice</Link>
                </div>
            </footer>
        </div>
    );
}
