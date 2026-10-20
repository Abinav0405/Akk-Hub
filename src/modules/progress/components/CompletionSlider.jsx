import { Label } from '@/ui/label';
import { cn } from '@/modules/progress/lib/utils';

export default function CompletionSlider({ value, onChange, disabled, id = 'completion-pct' }) {
  const set = value != null && value !== '';
  const n = set ? Number(value) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          Completion {set ? <span className="tabular-nums">{n}%</span> : <span className="text-muted-foreground">(optional)</span>}
        </Label>
        {set && (
          <button
            type="button"
            className="min-h-11 min-w-11 text-xs font-medium text-brand hover:underline disabled:opacity-40"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Number.isFinite(n) ? n : 0}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('w-full min-h-11 accent-brand', disabled && 'opacity-50')}
      />
    </div>
  );
}
