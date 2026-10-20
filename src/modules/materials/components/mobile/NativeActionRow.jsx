import { Link } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/materials/lib/utils';

/**
 * One row of an inset grouped list (native app only). Renders a Link when
 * `to` is set, otherwise a button. Wrap rows in `.n-group`.
 */
export default function NativeActionRow({
  to,
  onClick,
  icon: Icon,
  tone,
  title,
  hint,
  label,
  trailing,
  destructive = false,
  compact = false,
  current = false,
  disabled = false,
  state,
  className: extraClassName,
}) {
  const inner = (
    <>
      {Icon ? (
        <span className="n-row__icon" data-tone={destructive ? 'danger' : tone} aria-hidden>
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
      ) : null}
      <span className="n-row__body">
        <span className="n-row__title" data-tone={destructive ? 'danger' : undefined}>
          {title}
        </span>
        {hint ? <span className="n-row__sub">{hint}</span> : null}
      </span>
      <span className="n-row__trail">
        {trailing}
        {current ? (
          <Check className="h-5 w-5 text-[color:var(--n-brand-text)]" strokeWidth={2.4} aria-hidden />
        ) : !destructive ? (
          <ChevronRight className="h-5 w-5" strokeWidth={2.2} aria-hidden />
        ) : null}
      </span>
    </>
  );

  const className = cn('n-row', compact && 'n-row--compact', extraClassName);

  if (to) {
    return (
      <Link to={to} state={state} onClick={onClick} aria-label={label} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      className={className}
    >
      {inner}
    </button>
  );
}
