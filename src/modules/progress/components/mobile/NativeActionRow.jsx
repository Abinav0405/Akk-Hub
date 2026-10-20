import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/modules/progress/lib/utils';

export default function NativeActionRow({
  to,
  onClick,
  icon: Icon,
  iconClass,
  title,
  hint,
  label,
  badge,
}) {
  const inner = (
    <>
      <span className={cn('app-native-home__icon', iconClass)}>
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="block text-[17px] font-semibold tracking-tight text-navy">
            {title}
          </span>
          {badge > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-slate-500 line-clamp-2">
            {hint}
          </span>
        ) : null}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
    </>
  );

  if (to) {
    return (
      <Link to={to} aria-label={label || title} className="app-native-home__row">
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label || title}
      className="app-native-home__row w-full"
    >
      {inner}
    </button>
  );
}
