import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

/**
 * The "submitted by / checked by" names printed at the foot of JSR and claim PDFs.
 * `value` has the five fields from defaultJsrSignoff(); `onChange(key, nextValue)` per edit.
 */
export default function SignoffFields({ value, onChange, idPrefix = 'signoff' }) {
  const field = (key, label, extra = '') => (
    <div>
      <Label htmlFor={`${idPrefix}-${key}`}>{label}{extra}</Label>
      <Input
        id={`${idPrefix}-${key}`}
        className="mt-1"
        value={value?.[key] || ''}
        onChange={(e) => onChange(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PDF sign-off — submitted by</p>
        {field('submitted_by_name', 'Name')}
        {field('submitted_by_company', 'Company')}
      </div>
      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PDF sign-off — checked by</p>
        {field('checked_by_title', 'Title')}
        {field('checked_by_name', 'Name', ' (optional)')}
        {field('checked_by_company', 'Company')}
      </div>
    </div>
  );
}
