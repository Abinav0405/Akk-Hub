import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

/**
 * Native-app navigation bar: transparent over the large title, then a compact
 * glass bar with the title once the large title scrolls underneath it.
 * Rendered by PageHeader on native only — the website keeps its own header.
 */
export default function NativeNavBar({
  title,
  subtitle,
  eyebrow,
  backTo,
  backLabel = 'Back',
  onBack,
  actions,
  tone,
  largeTitle = true,
}) {
  const headerRef = useRef(null);
  const titleRef = useRef(null);
  const [condensed, setCondensed] = useState(!largeTitle);

  useEffect(() => {
    if (!largeTitle) {
      setCondensed(true);
      return undefined;
    }
    const target = titleRef.current;
    const header = headerRef.current;
    if (!target || !header || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { rootMargin: `-${header.offsetHeight}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [largeTitle]);

  const backContent = (
    <>
      <ChevronLeft className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden />
      <span>{backLabel}</span>
    </>
  );

  let back = null;
  if (onBack) {
    back = (
      <button type="button" className="n-navbar__back" onClick={onBack}>
        {backContent}
      </button>
    );
  } else if (backTo) {
    back = (
      <Link to={backTo} className="n-navbar__back">
        {backContent}
      </Link>
    );
  }

  return (
    <>
      <header
        ref={headerRef}
        className="n-navbar"
        data-condensed={condensed ? 'true' : 'false'}
        data-tone={tone}
      >
        <div className="n-navbar__inner">
          <div className="n-navbar__lead">{back}</div>
          <div className="n-navbar__title" aria-hidden={largeTitle ? true : undefined}>
            {largeTitle ? title : <h1 className="truncate">{title}</h1>}
          </div>
          <div className="n-navbar__trail">{actions}</div>
        </div>
      </header>
      {largeTitle ? (
        <div className="n-largetitle">
          {eyebrow ? <p className="n-largetitle__eyebrow">{eyebrow}</p> : null}
          <h1 ref={titleRef} className="n-largetitle__text">
            {title}
          </h1>
          {subtitle ? <p className="n-largetitle__sub">{subtitle}</p> : null}
        </div>
      ) : null}
    </>
  );
}

/** Round glass icon button for the navigation bar. */
export function NavIconButton({ icon: Icon, label, onClick, badge, tone, ...rest }) {
  return (
    <button
      type="button"
      className="n-iconbtn"
      onClick={onClick}
      aria-label={badge ? `${label} (${badge})` : label}
      data-tone={tone}
      {...rest}
    >
      <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
      {badge ? (
        <span className="n-iconbtn__badge" aria-hidden>
          {badge}
        </span>
      ) : null}
    </button>
  );
}
