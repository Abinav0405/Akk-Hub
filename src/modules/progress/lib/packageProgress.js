/** Optional stored % wins; otherwise infer from before/during/after (or completion). */
export function packageCompletionPct(pkg) {
  const stored = pkg?.completion_pct;
  if (stored != null && stored !== '') {
    const n = Number(stored);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  if (pkg?.has_completion) return 100;
  const flags = [pkg?.has_before, pkg?.has_during, pkg?.has_after];
  const done = flags.filter(Boolean).length;
  return Math.round((done / 3) * 100);
}

export function packagePhotoCounts(pkg) {
  const total = Number(pkg?.photo_count);
  if (Number.isFinite(total) && total >= 0) {
    return {
      total,
      before: Number(pkg.before_count) || 0,
      during: Number(pkg.during_count) || 0,
      after: Number(pkg.after_count) || 0,
      completion: Number(pkg.completion_count) || 0,
    };
  }
  return {
    total: [pkg?.has_before, pkg?.has_during, pkg?.has_after, pkg?.has_completion].filter(Boolean).length,
    before: pkg?.has_before ? 1 : 0,
    during: pkg?.has_during ? 1 : 0,
    after: pkg?.has_after ? 1 : 0,
    completion: pkg?.has_completion ? 1 : 0,
  };
}

export function submittedByLabel(pkg) {
  const name = pkg?.worker?.display_name || pkg?.worker_display_name || 'Deleted employee/technician';
  const code = pkg?.worker?.employee_code || pkg?.worker_employee_code || '';
  return code ? `${name} (${code})` : name;
}
