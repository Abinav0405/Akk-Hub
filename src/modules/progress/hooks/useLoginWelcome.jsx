import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import LoginWelcomeOverlay from '@/ui/LoginWelcomeOverlay';
import { isNativeApp } from '@/core/platform';

/**
 * Opaque welcome screen after login so the form never flashes through.
 * `ready` should become true once the destination portal can render.
 */
export function useLoginWelcome({ ready = true } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const welcomeName = typeof location.state?.welcomeName === 'string' ? location.state.welcomeName : '';
  const welcomeAt = Number(location.state?.welcomeAt) || 0;
  const [minTimeDone, setMinTimeDone] = useState(() => !welcomeName);

  useEffect(() => {
    if (!welcomeName) {
      setMinTimeDone(true);
      return undefined;
    }
    const remaining = Math.max(0, 1100 - (Date.now() - (welcomeAt || Date.now())));
    const t = window.setTimeout(() => setMinTimeDone(true), remaining);
    return () => window.clearTimeout(t);
  }, [welcomeName, welcomeAt]);

  useEffect(() => {
    if (!welcomeName || !minTimeDone || !ready) return;
    if (location.state?.welcomeName) {
      navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: {} }
    );
    }
  }, [welcomeName, minTimeDone, ready, location.pathname, location.state, navigate]);

  const showWelcome = isNativeApp() && Boolean(welcomeName) && !(minTimeDone && ready);

  return {
    showWelcome,
    overlay: showWelcome ? (
      <LoginWelcomeOverlay key={welcomeAt || welcomeName} open name={welcomeName} />
    ) : null,
  };
}
