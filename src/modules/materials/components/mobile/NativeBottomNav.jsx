import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { isNativeApp } from '@/core/platform';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import NativeActionRow from '@/modules/materials/components/mobile/NativeActionRow';

const MAX_TABS = 5;

/**
 * True while the Android soft keyboard is open. The activity uses
 * adjustResize, so the WebView shrinks — a fixed tab bar would ride up over
 * the focused field. We hide it instead.
 */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let tallest = window.innerHeight;
    const onResize = () => {
      const h = window.innerHeight;
      if (h > tallest) tallest = h;
      setOpen(tallest - h > 150);
    };
    const onRotate = () => {
      tallest = 0;
      window.setTimeout(onResize, 250);
    };
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onRotate);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onRotate);
    };
  }, []);

  return open;
}

function TabContent({ icon: Icon, label, badge }) {
  return (
    <>
      <span className="n-tab__icon">
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden />
        {badge ? (
          <span className="n-tab__badge" aria-hidden>
            {badge}
          </span>
        ) : null}
      </span>
      <span className="n-tab__label">{label}</span>
    </>
  );
}

function tabLabel(item) {
  return item.badge ? `${item.label}, ${item.badge} new` : item.label;
}

/**
 * Floating glass tab bar for the native app. Items are either routes (`to`)
 * or in-page sections (`onClick` + `active`). More than five items fold the
 * rest into a "More" sheet. Renders nothing on the website.
 */
export default function NativeBottomNav({ items = [] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboardOpen = useKeyboardOpen();

  if (!isNativeApp() || items.length === 0) return null;

  const overflow = items.length > MAX_TABS;
  const visible = overflow ? items.slice(0, MAX_TABS - 1) : items;
  const hidden = overflow ? items.slice(MAX_TABS - 1) : [];
  const moreActive = hidden.some((item) => item.active);

  return (
    <>
      <nav
        className="n-tabbar"
        aria-label="Primary"
        data-hidden={keyboardOpen ? 'true' : undefined}
      >
        <div className="n-tabbar__inner">
          {visible.map((item) =>
            item.to ? (
              <NavLink
                key={item.to}
                to={item.to}
                end
                onClick={item.onClick}
                className="n-tab"
                aria-label={tabLabel(item)}
              >
                <TabContent {...item} />
              </NavLink>
            ) : (
              <button
                key={item.id || item.label}
                type="button"
                onClick={item.onClick}
                className="n-tab"
                data-active={item.active ? 'true' : 'false'}
                aria-current={item.active ? 'page' : undefined}
                aria-label={tabLabel(item)}
              >
                <TabContent {...item} />
              </button>
            )
          )}
          {overflow ? (
            <button
              type="button"
              className="n-tab"
              data-active={moreActive ? 'true' : 'false'}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
            >
              <TabContent
                icon={moreActive ? hidden.find((item) => item.active).icon : MoreHorizontal}
                label={moreActive ? hidden.find((item) => item.active).label : 'More'}
              />
            </button>
          ) : null}
        </div>
      </nav>

      {overflow ? (
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogContent>
            <div className="n-sheet__head">
              <DialogTitle className="n-sheet__title">More</DialogTitle>
              <DialogDescription className="sr-only">Other sections</DialogDescription>
            </div>
            <div className="n-group">
              {hidden.map((item) => (
                <NativeActionRow
                  key={item.id || item.label}
                  icon={item.icon}
                  tone={item.active ? 'brand' : undefined}
                  title={item.label}
                  hint={item.hint}
                  compact
                  current={item.active}
                  onClick={() => {
                    setMoreOpen(false);
                    item.onClick?.();
                  }}
                />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
