import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useHeartbeat } from '@/modules/progress/hooks/useHeartbeat';
import { listNotifications, markNotificationsRead, unreadNotificationCount, clearNotifications } from '@/modules/progress/lib/notifications';

/**
 * Polls unread notifications and toasts when a new one arrives.
 * Works on web and Android (does not depend on FCM).
 */
export function useNotifications(role, { toastOnArrival = true } = {}) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const knownNewestId = useRef(null);
  const readyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!role) return;
    try {
      const [count, rows] = await Promise.all([
        unreadNotificationCount(role),
        listNotifications(role),
      ]);
      const newestId = rows[0]?.id || null;
      if (
        toastOnArrival &&
        readyRef.current &&
        newestId &&
        newestId !== knownNewestId.current
      ) {
        const fresh = rows.filter((row) => !row.readAt);
        if (fresh[0]) {
          toast(fresh[0].title, { description: fresh[0].body, duration: 6000 });
        }
      }
      knownNewestId.current = newestId;
      readyRef.current = true;
      setUnread(count);
      setItems(rows);
    } catch {
      /* session expired / SQL not applied yet — don't spam */
    }
  }, [role, toastOnArrival]);

  useEffect(() => {
    readyRef.current = false;
    knownNewestId.current = null;
    setUnread(0);
    setItems([]);
    if (!role) return undefined;
    refresh();
    return undefined;
  }, [role, refresh]);

  useHeartbeat({
    enabled: !!role,
    intervalMs: 5000,
    queryFn: async () => String(await unreadNotificationCount(role)),
    onChange: refresh,
  });

  const markRead = useCallback(
    async (ids = null) => {
      if (!role) return;
      await markNotificationsRead(role, ids);
      await refresh();
    },
    [role, refresh]
  );

  const clear = useCallback(
    async (ids = null) => {
      if (!role) return;
      const idSet = ids ? new Set(ids) : null;
      setItems((prev) => {
        if (!idSet) return [];
        return prev.filter((row) => !idSet.has(row.id));
      });
      if (!idSet) {
        setUnread(0);
        knownNewestId.current = null;
      }
      try {
        await clearNotifications(role, ids);
      } finally {
        await refresh();
      }
    },
    [role, refresh]
  );

  return { unread, items, refresh, markRead, clear };
}
