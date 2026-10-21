/**
 * App home (Capacitor, or ?app=1 preview) — a native sign-in screen, not a website.
 * Crimson hero with greeting, the Employee card (site-QR hint, Sign in, Face ID / Fingerprint
 * one-tap), then the other portals (Managers, Admin, Clients) with the same biometric shortcuts,
 * and Verify a photo. No tab bar.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, ChevronRight, Clock, Fingerprint, ScanFace, Shield, ShieldCheck, Users } from 'lucide-react';
import { getBiometricSupport } from '@/core/auth/biometric';
import { isNativeApp } from '@/core/platform';
import { setNativeSystemBarsSurface } from '@/core/nativeShell';
import { getSingaporeGreeting } from '@/ui/native/NativeChrome';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { paths } from '@/app/paths';

function QrHint() {
    const finder = (x, y) => (
        <g key={`${x}-${y}`}>
            <rect x={x} y={y} width="16" height="16" rx="2" />
            <rect x={x + 3} y={y + 3} width="10" height="10" rx="1" fill="#fff" />
            <rect x={x + 5.5} y={y + 5.5} width="5" height="5" rx="0.8" />
        </g>
    );
    const modules = [
        [40, 40], [45, 40], [55, 40],
        [40, 45], [50, 45], [55, 45],
        [45, 50], [50, 50],
        [40, 55], [50, 55], [55, 55],
    ];
    return (
        <svg width="60" height="60" viewBox="0 0 72 72" aria-hidden="true" className="shrink-0">
            <path
                d="M14 4H8a4 4 0 0 0-4 4v6M58 4h6a4 4 0 0 1 4 4v6M68 58v6a4 4 0 0 1-4 4h-6M14 68H8a4 4 0 0 1-4-4v-6"
                fill="none"
                stroke="#a50f2d"
                strokeWidth="2.6"
                strokeLinecap="round"
            />
            <rect x="12" y="12" width="48" height="48" rx="6" fill="#fff" />
            <g fill="#0d1626">
                {finder(18, 18)}
                {finder(38, 18)}
                {finder(18, 38)}
                {modules.map(([x, y]) => (
                    <rect key={`${x}-${y}`} x={x} y={y} width="3.2" height="3.2" rx="0.4" />
                ))}
            </g>
        </svg>
    );
}

function BioQuickLinks({ faceTo, fingerprintTo, hasFingerprint }) {
    return (
        <div className={`hxa-quick ${hasFingerprint ? '' : 'hxa-quick--single'}`}>
            <Link to={faceTo}>
                <ScanFace strokeWidth={1.8} aria-hidden /> Face ID
            </Link>
            {hasFingerprint ? (
                <Link to={fingerprintTo}>
                    <Fingerprint strokeWidth={1.8} aria-hidden /> Fingerprint
                </Link>
            ) : null}
        </div>
    );
}

const OTHER_PORTALS = [
    {
        to: `${paths.login}?role=management`,
        faceTo: `${paths.login}?role=management&quick=face`,
        fingerprintTo: `${paths.login}?role=management&quick=fingerprint`,
        icon: Users,
        tone: 'manager',
        title: 'Managers & supervisors',
        hint: 'Approve shifts, leave, materials and packages',
    },
    {
        to: `${paths.login}?role=admin`,
        faceTo: `${paths.login}?role=admin&quick=face`,
        fingerprintTo: `${paths.login}?role=admin&quick=fingerprint`,
        icon: Shield,
        tone: 'admin',
        title: 'Admin',
        hint: 'People, payroll, sites, stock and billing',
    },
    {
        to: paths.progress.clientLogin,
        faceTo: `${paths.progress.clientLogin}?quick=face`,
        fingerprintTo: `${paths.progress.clientLogin}?quick=fingerprint`,
        icon: Building2,
        tone: 'client',
        title: 'Clients · Export only',
        hint: 'Site reports, JSRs and claims',
    },
];

function PortalRow({ to, icon: Icon, tone, title, hint, faceTo, fingerprintTo, hasFingerprint, showBio }) {
    return (
        <div className="hxa-portal">
            <Link to={to} className="hxa-row" data-tone={tone}>
                <span className="hxa-row__icon">
                    <Icon strokeWidth={1.9} aria-hidden />
                </span>
                <span className="min-w-0">
                    <span className="hxa-row__title block">{title}</span>
                    <span className="hxa-row__hint block">{hint}</span>
                </span>
                <ChevronRight className="hxa-row__chev" aria-hidden />
            </Link>
            {showBio ? (
                <BioQuickLinks faceTo={faceTo} fingerprintTo={fingerprintTo} hasFingerprint={hasFingerprint} />
            ) : null}
        </div>
    );
}

function Row({ to, icon: Icon, tone, title, hint }) {
    return (
        <Link to={to} className="hxa-row" data-tone={tone}>
            <span className="hxa-row__icon">
                <Icon strokeWidth={1.9} aria-hidden />
            </span>
            <span className="min-w-0">
                <span className="hxa-row__title block">{title}</span>
                <span className="hxa-row__hint block">{hint}</span>
            </span>
            <ChevronRight className="hxa-row__chev" aria-hidden />
        </Link>
    );
}

export default function AppHome() {
    const [hasFingerprint, setHasFingerprint] = useState(false);
    const showPortalBio = isNativeApp();

    useEffect(() => {
        setNativeSystemBarsSurface('dark');
        let cancelled = false;
        if (isNativeApp()) {
            getBiometricSupport().then((support) => {
                if (!cancelled) setHasFingerprint(support.modes.includes('fingerprint'));
            });
        }
        return () => {
            cancelled = true;
            setNativeSystemBarsSurface('light');
        };
    }, []);

    return (
        <div className="hxa">
            <header className="hxa-hero">
                <div className="hxa-top">
                    <div className="hxa-mark">
                        <img src="/Akk-logo.png" alt="AKK Engineering" />
                        <div>
                            <p className="hxa-mark__name">AKK Hub</p>
                            <p className="hxa-mark__sub">AKK Engineering</p>
                        </div>
                    </div>
                    <LanguageSwitcher className="hxa-lang" variant="onDark" />
                </div>
                <div className="hxa-greet hxa-in">
                    <p className="hxa-greet__eyebrow">{getSingaporeGreeting()}</p>
                    <h1 className="hxa-greet__title">Ready for site?</h1>
                    <p className="hxa-greet__lede">Sign in to clock in, request materials and send site photos.</p>
                </div>
            </header>

            <main className="hxa-body">
                <section className="hxa-card hxa-in hxa-in-1" aria-labelledby="hxa-employee">
                    <div className="hxa-card__head">
                        <span className="hxa-card__icon">
                            <Clock strokeWidth={1.9} aria-hidden />
                        </span>
                        <div className="min-w-0">
                            <h2 id="hxa-employee" className="hxa-card__title">
                                Employees
                            </h2>
                            <p className="hxa-card__hint">Shifts, leave, payslips, materials, photos</p>
                        </div>
                    </div>
                    <div className="hxa-qr">
                        <QrHint />
                        <p>At your site? Sign in, then scan the site QR to start or end your shift.</p>
                    </div>
                    <Link to={`${paths.login}?role=employee`} className="hxa-cta">
                        Employee sign in <ArrowRight className="h-5 w-5" aria-hidden />
                    </Link>
                    <BioQuickLinks
                        faceTo={`${paths.quickLogin}?method=face`}
                        fingerprintTo={`${paths.quickLogin}?method=fingerprint`}
                        hasFingerprint={hasFingerprint}
                    />
                </section>

                <h2 className="hxa-label">Other portals</h2>
                <nav className="hxa-list hxa-in hxa-in-2" aria-label="Other portals">
                    {OTHER_PORTALS.map((p) => (
                        <PortalRow key={p.to} {...p} hasFingerprint={hasFingerprint} showBio={showPortalBio} />
                    ))}
                </nav>

                <h2 className="hxa-label">No login needed</h2>
                <div className="hxa-list">
                    <Row to={paths.verify} icon={ShieldCheck} title="Verify a photo" hint="Check an AKK site photo is genuine" />
                </div>

                <p className="hxa-foot">
                    AKK ENGINEERING PTE. LTD.
                    <br />
                    15 Kaki Bukit Rd 4, #01-50, Singapore 417808
                </p>
            </main>
        </div>
    );
}
