/**
 * Route guards.
 *
 *   <RequireHubRole roles={['worker']}> — signed in to the hub (Timesheet session), verified with
 *     the server on each navigation; wrong role → that role's home; offline (native) → retry.
 *   <ModuleGate module="materials"> — the hub user also has a Material Tracker / Site Progress
 *     session; otherwise shows the inline Connect card instead of bouncing to an old login page.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PlugZap, ServerOff } from 'lucide-react';
import { homePathFor, useIdentity, verifyIdentity } from '@/core/auth/identity';
import { endLoginCurtain } from '@/core/auth/loginCurtain';
import { MODULE_LABELS, sanitizeProgressLink, useModuleConnection } from '@/core/auth/bridges';
import { NativeErrorState } from '@/ui/native/NativeStates';
import { HubPage } from '@/ui/PortalShell';
import { EmptyState } from '@/ui/hub/primitives';
import ConnectForm from '@/pages/connect/ConnectForm';

/**
 * Optimistic guard: a stored hub session renders the screen immediately; the server check
 * runs in the background (shared + cached, see core/auth/verifyCache.js) and only bounces
 * to /login if the server says the session is gone. Data itself is protected server-side by
 * the session token, so painting first never exposes anything.
 */
export function RequireHubRole({ roles, children }) {
    const identity = useIdentity();
    const location = useLocation();
    const [status, setStatus] = useState(identity ? 'ok' : 'denied');
    const [retry, setRetry] = useState(0);
    const roleOk = identity && (!roles || roles.includes(identity.role));

    useEffect(() => {
        let active = true;
        if (!identity) {
            setStatus('denied');
            return undefined;
        }
        if (!roleOk) return undefined;
        verifyIdentity().then((result) => {
            if (active) setStatus(result);
        });
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, identity?.role, identity?.id, retry]);

    // Lower the login curtain once the first protected screen has painted.
    useEffect(() => {
        const t = window.setTimeout(endLoginCurtain, status === 'ok' ? 450 : 0);
        return () => window.clearTimeout(t);
    }, [status]);

    if (!identity || status === 'denied') {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }
    if (!roleOk) return <Navigate to={homePathFor(identity.role)} replace />;
    if (status === 'offline') {
        return (
            <>
                <div className="g-main !pb-0">
                    <NativeErrorState
                        title="Can’t reach the server"
                        message="You’re still signed in. Check your connection, then try again."
                        onRetry={() => setRetry((n) => n + 1)}
                        className="g-card !py-6"
                    />
                </div>
                {children}
            </>
        );
    }
    return children;
}

export function ModuleGate({ module, children }) {
    const identity = useIdentity();
    const status = useModuleConnection(identity?.role, module);
    const label = MODULE_LABELS[module];
    // Optimistic pass-through after a successful ConnectForm submit so we don't flash the
    // form again while staff markers / sb-auth catch up (role hop / first link).
    const [justConnected, setJustConnected] = useState(false);

    useEffect(() => {
        setJustConnected(false);
    }, [module, identity?.role, identity?.id]);

    // Drop stale Progress worker/admin flag combos before paint (avoid blank AdminDashboard flash).
    useLayoutEffect(() => {
        if (module === 'progress' && identity?.role) sanitizeProgressLink(identity.role);
    }, [module, identity?.role, identity?.id]);

    if (status === 'connected' || justConnected) return children;

    if (status === 'not-configured') {
        return (
            <HubPage title={label} backTo={homePathFor(identity?.role)} narrow>
                <EmptyState icon={ServerOff} tone={module} title={`${label} isn’t set up on this build`}>
                    <p className="min-h-11 text-sm text-[var(--g-muted)]">
                        Add the {label} Supabase URL and anon key to <code>.env</code> (see <code>.env.example</code>) and restart. No mock fallback.
                    </p>
                </EmptyState>
            </HubPage>
        );
    }
    if (status === 'unavailable') {
        return (
            <HubPage title={label} backTo={homePathFor(identity?.role)} narrow>
                <EmptyState icon={PlugZap} tone={module} title={`${label} isn’t part of your role yet`}>
                    Ask an admin if you need access.
                </EmptyState>
            </HubPage>
        );
    }
    return (
        <HubPage title={`Connect ${label}`} eyebrow="One-time step" backTo={homePathFor(identity?.role)} narrow>
            <ConnectForm module={module} onConnected={() => setJustConnected(true)} />
        </HubPage>
    );
}
