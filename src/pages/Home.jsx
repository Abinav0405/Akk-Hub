/**
 * Home — two different screens, like Timesheet Manager:
 *   - website (any browser, phone or desktop): WebHome — product landing, 4 portals (no tab bar)
 *   - app (Capacitor, or ?app=1 preview):      AppHome — native sign-in screen
 * Signed-in users go straight to their role home.
 */
import { Navigate } from 'react-router-dom';
import { isAppUI } from '@/core/platform';
import { homePathFor, useIdentity } from '@/core/auth/identity';
import WebHome from '@/pages/home/WebHome';
import AppHome from '@/pages/home/AppHome';

export default function Home() {
    const identity = useIdentity();
    if (identity) return <Navigate to={homePathFor(identity.role)} replace />;
    return isAppUI() ? <AppHome /> : <WebHome />;
}
