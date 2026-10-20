/**
 * Opaque full-screen welcome + load state after a sign-in (Timesheet design).
 * Solid background (no blur) so the login form never shows through; CSS-only motion.
 */
export default function LoginWelcomeOverlay({ open, name }) {
    if (!open) return null;
    return (
        <div className="login-welcome-screen" role="status" aria-live="polite" aria-atomic="true">
            <div className="login-welcome-tick-wrap" aria-hidden>
                <div className="login-welcome-tick-core">
                    <svg viewBox="0 0 48 48" className="login-welcome-check" fill="none">
                        <path
                            className="login-welcome-check-path"
                            d="M12 24.5l8 8 16-16"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="4.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            pathLength="1"
                        />
                    </svg>
                </div>
            </div>
            <div className="login-welcome-copy">
                <p className="text-lg font-medium tracking-tight text-slate-500">Welcome,</p>
                <h2 className="mt-1 max-w-[18rem] text-[1.85rem] font-semibold leading-tight tracking-tight text-slate-900 sm:max-w-md sm:text-[2.15rem]">
                    {name}
                </h2>
            </div>
            <div className="login-welcome-loader">
                <div className="login-welcome-spinner" aria-hidden />
                <p className="text-sm text-slate-400">Opening AKK Hub…</p>
            </div>
        </div>
    );
}
