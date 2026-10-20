import { useEffect, useState } from 'react';

/**
 * True only once `flag` has stayed true for `delay` ms — so a fast request
 * never flashes a spinner, while a slow one still shows progress.
 */
export function useDelayedFlag(flag, delay = 200) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!flag) {
      setShown(false);
      return undefined;
    }
    const t = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(t);
  }, [flag, delay]);

  return flag && shown;
}
