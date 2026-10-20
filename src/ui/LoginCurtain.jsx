/**
 * Renders the login curtain (core/auth/loginCurtain.js). Mounted once at the app root so it
 * survives the route change from the sign-in screen to the role home underneath.
 *
 * Closing never depends on an animation finishing: the moment the curtain ends it stops taking
 * taps (pointer-events: none) and fades with a CSS transition, and a plain timer unmounts it.
 * (A framer-motion exit waits on requestAnimationFrame, which stalls in background tabs and on
 * busy phones — the invisible screen then swallowed every tap on the portal.)
 */
import { useEffect, useState } from 'react';
import { FaceWelcomeScreen } from '@/ui/biometric/FaceWelcomeScreen';
import LoginWelcomeOverlay from '@/ui/LoginWelcomeOverlay';
import { useLoginCurtain } from '@/core/auth/loginCurtain';
import { useSheetLayout } from '@/core/platform';

const EXIT_MS = 340;

export default function LoginCurtain() {
    const curtain = useLoginCurtain();
    const fullScreen = useSheetLayout();
    const [last, setLast] = useState(null);

    useEffect(() => {
        if (curtain.open) {
            setLast(curtain);
            return undefined;
        }
        const t = window.setTimeout(() => setLast(null), EXIT_MS);
        return () => window.clearTimeout(t);
    }, [curtain]);

    // Paint in the same frame the curtain opens (the login screen hands over to it directly).
    const view = curtain.open ? curtain : last;
    if (!view) return null;
    const leaving = !curtain.open;

    return (
        <div key={view.id} className="login-curtain" data-leaving={leaving ? '' : undefined} aria-hidden={leaving || undefined}>
            {view.variant === 'face' ? (
                <FaceWelcomeScreen name={view.name} fullScreen={fullScreen} />
            ) : (
                <LoginWelcomeOverlay open name={view.name} />
            )}
        </div>
    );
}
