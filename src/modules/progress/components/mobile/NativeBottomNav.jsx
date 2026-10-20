// TODO(claude): provide @/core/nativeBack (pushNativeBackHandler)
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';
import { pushNativeBackHandler } from '@/core/nativeBack';

const MAX_PRIMARY = 5;

function TabInner({ item }) {
  const Icon = item.icon;
  return (
    <>
      <span className="relative">
        <Icon className="h-5 w-5" strokeWidth={1.85} />
        {item.badge > 0 ? (
          <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold text-white">
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        ) : null}
      </span>
      <span className="app-native-tabbar__label">{item.label}</span>
    </>
  );
}

function TabControl({ item, onPick, className }) {
  if (item.to) {
    return (
      <NavLink
        to={item.to}
        onClick={(e) => {
          item.onClick?.(e);
          onPick?.();
        }}
        aria-label={item.label}
        className={({ isActive }) =>
          cn(className, (isActive || item.active) && 'is-active')
        }
        end
      >
        <TabInner item={item} />
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        item.onClick?.();
        onPick?.();
      }}
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      className={cn(className, item.active && 'is-active')}
    >
      <TabInner item={item} />
    </button>
  );
}

export default function NativeBottomNav({ items = [] }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const overflow = items.length > MAX_PRIMARY;
  const primary = overflow ? items.slice(0, MAX_PRIMARY - 1) : items;
  const extra = overflow ? items.slice(MAX_PRIMARY - 1) : [];
  const extraActive = extra.some((item) => item.active);

  useEffect(() => {
    if (!moreOpen) return undefined;
    return pushNativeBackHandler(() => {
      setMoreOpen(false);
      return true;
    });
  }, [moreOpen]);

  if (!isNativeApp() || items.length === 0) return null;

  return (
    <>
      {moreOpen && extra.length > 0 && (
        <div className="app-native-more" role="presentation">
          <button
            type="button"
            className="app-native-more__backdrop"
            aria-label="Close more menu"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="app-native-more__sheet"
            role="dialog"
            aria-label="More"
          >
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              More
            </p>
            <div className="grid grid-cols-3 gap-1">
              {extra.map((item) => (
                <TabControl
                  key={item.id || item.to || item.label}
                  item={item}
                  onPick={() => setMoreOpen(false)}
                  className="app-native-more__item"
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <nav className="app-native-tabbar" aria-label="App">
        {primary.map((item) => (
          <TabControl
            key={item.id || item.to || item.label}
            item={item}
            className="app-native-tabbar__item"
          />
        ))}
        {overflow ? (
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="More"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn('app-native-tabbar__item', (moreOpen || extraActive) && 'is-active')}
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.85} />
            <span className="app-native-tabbar__label">More</span>
          </button>
        ) : null}
      </nav>
    </>
  );
}
