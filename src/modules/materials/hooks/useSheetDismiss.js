import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp } from '@/core/platform';

/**
 * Slide the login sheet down, then run navigation.
 * When `enabled` is false (website/desktop), `fn` runs immediately.
 */
export function useSheetDismiss(enabled) {
  const [sheetOpen, setSheetOpen] = useState(true);
  const pendingFinishRef = useRef(null);

  const runPendingFinish = useCallback(() => {
    const fn = pendingFinishRef.current;
    pendingFinishRef.current = null;
    fn?.();
  }, []);

  const dismissSheetThen = useCallback(
    (fn) => {
      pendingFinishRef.current = fn;
      if (!enabled) {
        const run = pendingFinishRef.current;
        pendingFinishRef.current = null;
        run?.();
        return;
      }
      window.setTimeout(() => setSheetOpen(false), isNativeApp() ? 0 : 80);
    },
    [enabled]
  );

  useEffect(() => {
    if (sheetOpen) return undefined;
    const t = window.setTimeout(runPendingFinish, isNativeApp() ? 360 : 700);
    return () => window.clearTimeout(t);
  }, [sheetOpen, runPendingFinish]);

  return { sheetOpen, dismissSheetThen, runPendingFinish };
}
