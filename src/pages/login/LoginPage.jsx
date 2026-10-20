/**
 * /login — one portal per page, like Timesheet Manager (the portal is picked on Home):
 *   ?role=employee (default) | management | admin
 *   ?type=foreign|local · ?as=supervisor · ?quick=fingerprint (app)
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useIdentity, homePathFor } from '@/core/auth/identity';
import { prefetchPortalHome } from '@/app/prefetch';
import EmployeeLogin from '@/pages/login/EmployeeLogin';
import ManagementLogin from '@/pages/login/ManagementLogin';
import AdminLogin from '@/pages/login/AdminLogin';

const TAB_FOR_ROLE = { worker: 'employee', supervisor: 'management', manager: 'management', admin: 'admin' };

export default function LoginPage() {
    const location = useLocation();
    const identity = useIdentity();
    // A fresh sign-in navigates on its own (under the login curtain); only bounce users who
    // were already signed in when the page opened.
    const [wasSignedIn] = useState(() => !!identity);

    const q = new URLSearchParams(location.search).get('role');
    // Coming back from an expired session: reopen that person's portal.
    const fromState = location.state?.from ? TAB_FOR_ROLE[window.localStorage.getItem('akk.hub.lastRole')] : null;
    const role = q || fromState || 'employee';

    useEffect(() => prefetchPortalHome(role), [role]);

    if (wasSignedIn && identity) return <Navigate to={homePathFor(identity.role)} replace />;
    if (role === 'admin') return <AdminLogin />;
    if (role === 'management') return <ManagementLogin />;
    return <EmployeeLogin />;
}
