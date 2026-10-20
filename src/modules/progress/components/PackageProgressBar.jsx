import { cn } from '@/modules/progress/lib/utils';
import { packageCompletionPct } from '@/modules/progress/lib/packageProgress';

export default function PackageProgressBar({ pkg, className }) {
  const pct = packageCompletionPct(pkg);
  const explicit = pkg?.completion_pct != null && pkg?.completion_pct !== '';
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Completion</span>
        <span className="tabular-nums font-medium text-slate-700">
          {pct}%{explicit ? '' : ' est.'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
