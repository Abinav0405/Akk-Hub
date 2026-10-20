/**
 * Site Progress role guard (SPT Components/useRoleGuard.js API).
 *
 * Returns `undefined` while checking, `null` when redirecting, or the session row
 * `{ display_name, employee_code, user_id?, jsr_permissions? }` when ready.
 *
 * Hub change: a missing / expired Site Progress session sends the user to
 * /connect/progress (sign in to that module once) instead of the old SPT login pages.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { storageKey } from '@/core/storage';
import {
    consumeWorkerSessionExpiredMessage,
    isWorkerAuthenticated,
    verifyWorkerSession,
} from '@/core/auth/progress/workerSession';
import { isAdminAuthenticated, verifyAdminSession } from '@/core/auth/progress/adminSession';
import {
    consumeManagerSessionExpiredMessage,
    getStoredManagerJsrPerms,
    isManagerAuthenticated,
    verifyManagerSession,
} from '@/core/auth/progress/managerSession';
import {
    consumeExporterSessionExpiredMessage,
    isExporterAuthenticated,
    verifyExporterSession,
} from '@/core/auth/progress/exporterSession';
import { refreshModuleConnections, sanitizeProgressLink } from '@/core/auth/bridges';
import { getIdentity } from '@/core/auth/identity';

const CONNECT_PATH = '/connect/progress';
/** Standalone Export Only login — clients have no hub Timesheet identity. */
const EXPORTER_LOGIN_PATH = '/progress/client/login';

function toastExpired(consume) {
    const message = consume?.();
    if (message) toast.error(message);
}

function afterProgressDeny() {
    try {
        sanitizeProgressLink(getIdentity()?.role);
        refreshModuleConnections();
    } catch {
        /* ignore */
    }
}

function readStorage(key) {
    const k = storageKey('progress', key);
    try {
        return localStorage.getItem(k) || sessionStorage.getItem(k) || '';
    } catch {
        return '';
    }
}

function peekMappedSession(role) {
    try {
        if (role === 'worker') {
            if (!isWorkerAuthenticated()) return null;
            return {
                user_id: readStorage('workerId') || 'local',
                display_name: readStorage('workerName') || 'Employee/Technician',
                employee_code: readStorage('workerId') || '',
            };
        }
        if (role === 'admin') {
            if (!isAdminAuthenticated()) return null;
            return { display_name: readStorage('adminName') || 'Admin', employee_code: readStorage('adminEmail') || '' };
        }
        if (role === 'exporter') {
            if (!isExporterAuthenticated()) return null;
            const name = readStorage('exporterName') || 'Export Only';
            return { display_name: name, employee_code: name };
        }
        if (!isManagerAuthenticated()) return null;
        return {
            display_name: readStorage('managerName') || 'Manager',
            employee_code: readStorage('managerLoginId') || '',
            jsr_permissions: getStoredManagerJsrPerms(),
        };
    } catch {
        return null;
    }
}

function sameSession(a, b) {
    if (!a || !b) return false;
    return (
        a.display_name === b.display_name &&
        a.employee_code === b.employee_code &&
        JSON.stringify(a.jsr_permissions ?? null) === JSON.stringify(b.jsr_permissions ?? null)
    );
}

export function useRoleGuard(role) {
    const navigate = useNavigate();
    const location = useLocation();
    const [session, setSessionState] = useState(() => peekMappedSession(role) ?? undefined);
    const setSession = (next) => setSessionState((prev) => (sameSession(prev, next) ? prev : next));

    useEffect(() => {
        let cancelled = false;
        const deny = (consume) => {
            if (cancelled) return;
            toastExpired(consume);
            setSessionState(null);
            if (role === 'exporter') {
                navigate(EXPORTER_LOGIN_PATH, { replace: true, state: { from: location.pathname } });
                return;
            }
            afterProgressDeny();
            navigate(`${CONNECT_PATH}?as=${role}`, { replace: true, state: { from: location.pathname } });
        };

        const local = peekMappedSession(role);
        if (local) setSession(local);

        (async () => {
            if (role === 'worker') {
                if (!isWorkerAuthenticated()) return deny(consumeWorkerSessionExpiredMessage);
                const row = await verifyWorkerSession();
                if (cancelled) return;
                if (!row) return deny(consumeWorkerSessionExpiredMessage);
                setSession(row);
                return;
            }
            if (role === 'admin') {
                const admin = await verifyAdminSession();
                if (cancelled) return;
                if (!admin) return deny();
                setSession({ display_name: admin.name, employee_code: admin.email });
                return;
            }
            if (role === 'exporter') {
                if (!isExporterAuthenticated()) return deny(consumeExporterSessionExpiredMessage);
                const exporter = await verifyExporterSession();
                if (cancelled) return;
                if (!exporter) return deny(consumeExporterSessionExpiredMessage);
                setSession({ display_name: exporter.display_name, employee_code: exporter.display_name });
                return;
            }
            if (!isManagerAuthenticated()) return deny(consumeManagerSessionExpiredMessage);
            const manager = await verifyManagerSession();
            if (cancelled) return;
            if (!manager) return deny(consumeManagerSessionExpiredMessage);
            setSession({
                display_name: manager.display_name,
                employee_code: manager.login_id,
                jsr_permissions: manager.jsr_permissions,
            });
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role, navigate]);

    return session;
}

export default useRoleGuard;
