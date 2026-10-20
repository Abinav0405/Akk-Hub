import { JSR_PERM_GROUPS } from '@/modules/progress/lib/jsrPermissions';

export default function JsrPermissionGrid({ value, onChange }) {
  const toggle = (key, checked) => onChange({ ...value, [key]: checked });

  return (
    <div className="max-h-[min(50dvh,24rem)] space-y-3 overflow-y-auto akk-scroll-y rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Each box is independent. New managers start as view-only. Catalog, companies and deleting package photos stay off unless you tick them.
      </p>
      {JSR_PERM_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {group.keys.map((item) => (
              <label key={item.key} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-brand"
                  checked={Boolean(value?.[item.key])}
                  onChange={(e) => toggle(item.key, e.target.checked)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
