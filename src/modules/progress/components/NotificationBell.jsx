import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/modules/progress/lib/utils';
import { formatDateTime } from '@/modules/progress/lib/dates';
import { useNotifications } from '@/modules/progress/hooks/useNotifications';
import { isNativeApp } from '@/core/platform';
import { pushNativeBackHandler } from '@/core/nativeBack';

export default function NotificationBell({ role, inbox }) {
  const owned = useNotifications(inbox ? null : role);
  const { unread, items, markRead, clear } = inbox || owned;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();
  const native = isNativeApp();

  useEffect(() => {
    if (!open || native) return undefined;
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open, native]);

  useEffect(() => {
    if (!open || !native) return undefined;
    return pushNativeBackHandler(() => {
      setOpen(false);
      return true;
    });
  }, [open, native]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await markRead();
      } catch {
        /* ignore */
      }
    }
  };

  const handleItem = (item) => {
    setOpen(false);
    if (item.path) navigate(item.path);
  };

  const handleClearAll = async () => {
    if (!items.length || busy) return;
    if (!window.confirm('Clear all notifications?')) return;
    setBusy(true);
    try {
      await clear();
    } catch {
      /* SQL not applied yet */
    } finally {
      setBusy(false);
    }
  };

  const handleClearOne = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await clear([id]);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const header = (sheet) => (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border',
        sheet ? 'px-4 py-3' : 'px-3 py-2'
      )}
    >
      <p
        className={
          sheet
            ? 'text-sm font-semibold text-slate-900'
            : 'text-xs font-semibold uppercase tracking-wide text-muted-foreground'
        }
      >
        Notifications
      </p>
      {items.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={handleClearAll}
          className="shrink-0 text-xs font-medium text-brand hover:underline disabled:opacity-50"
        >
          Clear all
        </button>
      )}
    </div>
  );

  const list = (sheet) =>
    items.length === 0 ? (
      <p className={cn('text-center text-sm text-muted-foreground', sheet ? 'px-4 py-10' : 'px-3 py-8')}>
        No notifications yet.
      </p>
    ) : (
      <ul className={sheet ? 'akk-scroll-y max-h-[min(58dvh,26rem)] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom,0px))]' : 'max-h-80 overflow-y-auto'}>
        {items.map((item) => (
          <li key={item.id} className="flex items-stretch border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => handleItem(item)}
              className={cn(
                'min-w-0 flex-1 text-left hover:bg-slate-50',
                sheet ? 'px-4 py-3' : 'px-3 py-2.5',
                !item.readAt && 'bg-brand-muted/40'
              )}
            >
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {formatDateTime(item.createdAt, { seconds: false })}
              </p>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleClearOne(item.id)}
              aria-label="Clear notification"
              className={cn(
                'shrink-0 self-start text-slate-400 hover:text-slate-700 disabled:opacity-50',
                sheet ? 'px-3 py-3' : 'px-2 py-2.5'
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div ref={wrapRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn('relative', native ? 'h-11 w-11 min-h-11' : 'h-9 w-9 min-h-9')}
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        onClick={handleOpen}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>
      {open && native && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close notifications"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="app-native-sheet absolute bottom-0 left-0 right-0 max-h-[min(72dvh,32rem)] overflow-hidden rounded-t-[1.5rem] border border-border bg-white shadow-lg">
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden />
            {header(true)}
            {list(true)}
          </div>
        </div>
      )}
      {open && !native && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-white shadow-lg">
          {header(false)}
          {list(false)}
        </div>
      )}
    </div>
  );
}
