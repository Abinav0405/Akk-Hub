import { useEffect, useState } from 'react';
import { formatDateTime } from '@/modules/progress/lib/dates';
import { listDocumentEvents } from '@/modules/progress/lib/documentAudit';

function roleLabel(role, portal) {
  if (role === 'exporter' || portal === 'export') return 'Export Only';
  if (role === 'manager' || portal === 'manager') return 'Manager';
  if (role === 'admin' || portal === 'admin') return 'Admin';
  if (role === 'worker' || portal === 'worker') return 'Employee/Technician';
  return role || portal || 'Staff';
}

export default function DocumentAuditTrail({ kind, documentId, newestFirst = true }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!kind || !documentId) return undefined;
    let cancelled = false;
    setRows(null);
    setError('');
    listDocumentEvents({ kind, documentId })
      .then((list) => {
        if (cancelled) return;
        const ordered = newestFirst ? [...list].reverse() : list;
        setRows(ordered);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e?.message || 'Could not load the audit trail';
        // Soft-fail misleading access errors; real failures still show inline (no toast).
        if (/document not found|cannot view that audit trail/i.test(msg)) {
          console.warn('[DocumentAuditTrail]', msg);
          setError('');
          setRows([]);
          return;
        }
        setError(msg);
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, documentId, newestFirst]);

  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-semibold">Audit trail</h4>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading audit trail…</p>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">No events recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-border bg-slate-50/80 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{row.summary || row.action}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(row.createdAt, { seconds: false })}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.actorName || 'Unknown'} · {roleLabel(row.actorRole, row.portal)}
              </p>
              {row.details && Object.keys(row.details).length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">
                    {JSON.stringify(row.details, null, 2)}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
