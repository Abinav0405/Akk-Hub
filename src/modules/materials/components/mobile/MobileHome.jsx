// LEGACY-PAGES port — session redirects → /connect/materials or /login
import { useMemo } from 'react';
import { storageKey } from '@/core/storage';
import { Link } from 'react-router-dom';
import { ArrowRight, BriefcaseBusiness, ClipboardList, Shield } from 'lucide-react';
import { createPageUrl } from '@/modules/materials/lib/utils';
import { getWorkerSession } from '@/core/auth/materialsSession';
import NativeActionRow from '@/modules/materials/components/mobile/NativeActionRow';

const PORTALS = [
  {
    to: '/login?role=employee',
    title: 'Request Portal',
    hint: 'Workers · take or return materials',
    icon: ClipboardList,
    tone: 'brand',
  },
  {
    to: '/login?role=management',
    title: 'Manager',
    hint: 'Review requests and manage inventory',
    icon: BriefcaseBusiness,
    tone: 'info',
  },
  {
    to: '/login?role=admin',
    title: 'Admin',
    hint: 'Approve requests, inventory and reports',
    icon: Shield,
    tone: 'slate',
  },
];

/**
 * Where a signed-in person left off. Only a shortcut: every destination
 * re-verifies the session with the server before showing anything.
 */
function useResumeTarget() {
  return useMemo(() => {
    const worker = getWorkerSession();
    if (worker) {
      return {
        to: "/materials/request",
        title: `Continue as ${worker.workerName || worker.workerId}`,
        sub: 'Open your request portal',
        icon: ClipboardList,
        tone: 'brand',
      };
    }
    let staffRole = null;
    try {
      staffRole = sessionStorage.getItem(storageKey('materials', 'staffRole'));
    } catch {
      /* ignore */
    }
    if (staffRole === 'admin' || staffRole === 'manager') {
      let name = '';
      try {
        name = sessionStorage.getItem(storageKey('materials', 'staffName')) || '';
      } catch {
        /* ignore */
      }
      const isAdmin = staffRole === 'admin';
      return {
        to: createPageUrl(isAdmin ? 'AdminDashboard' : 'ManagerDashboard'),
        title: name ? `Continue as ${name}` : `Open ${isAdmin ? 'Admin' : 'Manager'} dashboard`,
        sub: `${isAdmin ? 'Admin' : 'Manager'} dashboard`,
        icon: isAdmin ? Shield : BriefcaseBusiness,
        tone: isAdmin ? 'admin' : 'manager',
      };
    }
    return null;
  }, []);
}

/** Native-app landing screen. The website renders its own Home. */
export default function MobileHome() {
  const resume = useResumeTarget();
  const ResumeIcon = resume?.icon;

  return (
    <div className="n-home">
      <header className="n-home__head">
        <img
          src="/Akk-logo.jpg"
          alt="AKK Engineering"
          className="n-home__logo"
          width={56}
          height={56}
          decoding="async"
        />
        <div className="min-w-0">
          <p className="n-home__company">AKK ENGINEERING</p>
          <p className="n-home__tag">AKK Hub</p>
        </div>
      </header>

      <main className="n-home__main">
        <div className="n-largetitle">
          <h1 className="n-largetitle__text">Materials</h1>
          <p className="n-largetitle__sub">
            Request materials, return them, and keep inventory in sync.
          </p>
        </div>

        {resume ? (
          <section className="n-section n-enter" aria-label="Continue">
            <Link to={resume.to} className="n-resume" data-tone={resume.tone}>
              <span className="n-resume__icon" aria-hidden>
                <ResumeIcon className="h-5 w-5" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="n-resume__title truncate">{resume.title}</span>
                <span className="n-resume__sub">{resume.sub}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
            </Link>
          </section>
        ) : null}

        <section className="n-section n-enter" aria-labelledby="home-portals">
          <h2 id="home-portals" className="n-section__title">
            Choose how you sign in
          </h2>
          <div className="n-group">
            {PORTALS.map((portal) => (
              <NativeActionRow
                key={portal.to}
                to={portal.to}
                icon={portal.icon}
                tone={portal.tone}
                title={portal.title}
                hint={portal.hint}
              />
            ))}
          </div>
        </section>
      </main>

      <footer className="n-home__foot">
        AKK ENGINEERING PTE. LTD.
        <br />
        15 Kaki Bukit Rd 4, #01-50, Singapore 417808
      </footer>
    </div>
  );
}
