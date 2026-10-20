/**
 * Clients (Export Only) portal — /progress/client. Standalone (no hub sidebar / tab bar):
 * clients have no Timesheet identity, only the Site Progress exporter session.
 *
 *   glass top bar (logo · "Client portal" · company name · sign out)
 *   Packages | Reports | Account segmented control
 *   content column → the Site Progress screens for role "exporter"
 *
 * Account is inline because the hub /account route needs a staff sign-in.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, FileText, LogOut, UserRound } from 'lucide-react';
import TopBar from '@/ui/hub/TopBar';
import Segmented from '@/ui/hub/Segmented';
import { LoadingScreen } from '@/ui/hub/primitives';
import { PageFooter } from '@/ui/layout';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { signOutExporter } from '@/core/auth/progress/exporterSession';
import { endLoginCurtain } from '@/core/auth/loginCurtain';
import { isAppUI } from '@/core/platform';
import { paths } from '@/app/paths';
import PackageReviewBoard from '@/modules/progress/components/PackageReviewBoard';
import ClientPortalPanel from '@/modules/progress/components/jsr/ClientPortalPanel';
import MyAccountPanel from '@/modules/progress/components/MyAccountPanel';

const TABS = [
    { id: 'packages', label: 'Packages', icon: ClipboardList },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'account', label: 'Account', icon: UserRound },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function ClientPortal() {
    const session = useRoleGuard('exporter');
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const tab = TAB_IDS.includes(params.get('tab')) ? params.get('tab') : 'packages';
    const [userId, setUserId] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [signingOut, setSigningOut] = useState(false);

    useEffect(() => {
        // Outside the hub guards, so lower the login curtain here once the session is known.
        if (session === undefined) return undefined;
        const t = window.setTimeout(endLoginCurtain, session ? 300 : 0);
        if (session) {
            setUserId(session.employee_code || '');
            setDisplayName(session.display_name || '');
        }
        return () => window.clearTimeout(t);
    }, [session]);

    const setTab = (id) => {
        const next = new URLSearchParams(params);
        if (id === 'packages') next.delete('tab');
        else next.set('tab', id);
        setParams(next, { replace: true });
        window.scrollTo({ top: 0 });
    };

    const handleSignOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        await signOutExporter();
        navigate(paths.progress.clientLogin, { replace: true });
    };

    if (session === undefined) return <LoadingScreen label="Opening client portal…" />;
    if (!session) return null;

    const name = session.display_name || 'Client';

    return (
        <div className="g-page" data-portal="client">
            <TopBar
                leading={<img src="/Akk-logo.png" alt="AKK Engineering" className="g-topbar__logo" />}
                eyebrow="Client portal"
                title={name}
                trailing={
                    <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className={isAppUI() ? 'g-icon-btn' : 'g-btn g-btn--secondary g-btn--sm'}
                        aria-label="Sign out"
                    >
                        <LogOut aria-hidden />
                        {isAppUI() ? null : <span>Sign out</span>}
                    </button>
                }
            >
                <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="Client portal sections" className="w-full sm:w-auto" />
            </TopBar>

            <main className="g-main max-w-6xl">
                {tab === 'packages' ? <PackageReviewBoard role="exporter" /> : null}
                {tab === 'reports' ? <ClientPortalPanel /> : null}
                {tab === 'account' ? (
                    <div className="mx-auto max-w-xl">
                        <MyAccountPanel
                            role="exporter"
                            userId={userId}
                            displayName={displayName}
                            onUserIdChange={setUserId}
                            onDisplayNameChange={setDisplayName}
                        />
                    </div>
                ) : null}
            </main>

            <PageFooter />
        </div>
    );
}
