import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import StaffPanelIntro from '@/modules/progress/components/StaffPanelIntro';
import {
  listWorkers,
  setWorkerActive,
  deleteWorker,
  listAdmins,
  setAdminActive,
  deleteAdmin,
  listManagers,
  setManagerActive,
  deleteManager,
} from '@/modules/progress/lib/accounts';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { JSR_PERM_MIGRATION_HINT } from '@/modules/progress/lib/jsrPermissions';
import { UNIFIED, supabaseProgress } from '@/core/supabase';
import { cn } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';
import {
  AddWorkerDialog,
  ResetPasswordDialog,
  RevealCredentialsDialog,
} from '@/modules/progress/components/WorkerAccountsPanel';
import {
  AddManagerDialog,
  ResetManagerPasswordDialog,
  EditManagerJsrDialog,
  RegisterAdminDialog,
} from '@/modules/progress/components/StaffAccountsPanel';

const ALL_ROLES = [
  {
    id: 'technicians',
    label: 'Technicians',
    hint: 'Sign in to the site app with an employee ID',
  },
  {
    id: 'managers',
    label: 'Managers',
    hint: 'Approve packages — optional JSR and delete rights',
  },
  {
    id: 'admins',
    label: 'Admins',
    hint: 'Full access to this admin portal',
  },
];

/** Unified Hub: worker app access lives on Admin → Employees; keep staff accounts here. */
const ROLES = UNIFIED ? ALL_ROLES.filter((r) => r.id !== 'technicians') : ALL_ROLES;

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function ActiveToggle({ active, disabled, onToggle, label = 'Active' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="inline-flex items-center gap-2"
      aria-pressed={active}
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          active ? 'bg-emerald-500' : 'bg-slate-300',
          disabled && 'opacity-50'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            active ? 'left-[1.375rem] -translate-x-full' : 'left-0.5'
          )}
        />
      </span>
      <span className={cn('text-sm font-medium', active ? 'text-emerald-700' : 'text-slate-400')}>
        {active ? label : 'Disabled'}
      </span>
    </button>
  );
}

export default function UsersAccessPanel() {
  const native = isNativeApp();
  const [role, setRole] = useState(() => ROLES[0]?.id || 'managers');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const [workers, setWorkers] = useState(null);
  const [managers, setManagers] = useState(null);
  const [admins, setAdmins] = useState(null);
  const [myId, setMyId] = useState(null);
  const warnedMigration = useRef(false);

  const [showAddWorker, setShowAddWorker] = useState(false);
  const [showAddManager, setShowAddManager] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [resetWorker, setResetWorker] = useState(null);
  const [resetManager, setResetManager] = useState(null);
  const [permTarget, setPermTarget] = useState(null);
  const [revealed, setRevealed] = useState(null);

  const refreshWorkers = () => {
    listWorkers()
      .then(setWorkers)
      .catch(() => {
        toast.error('Could not load employee/technician accounts');
        setWorkers([]);
      });
  };
  const refreshManagers = () => {
    listManagers()
      .then((rows) => {
        setManagers(rows);
        if (
          !warnedMigration.current
          && Array.isArray(rows)
          && rows.some((m) => !m || typeof m.jsr_permissions !== 'object')
        ) {
          warnedMigration.current = true;
          toast.error(JSR_PERM_MIGRATION_HINT);
        }
      })
      .catch((e) => {
        toast.error(e?.message || 'Could not load manager accounts');
        setManagers([]);
      });
  };
  const refreshAdmins = () => {
    listAdmins()
      .then(setAdmins)
      .catch(() => {
        toast.error('Could not load admin accounts');
        setAdmins([]);
      });
  };

  useEffect(() => {
    refreshWorkers();
    refreshManagers();
    refreshAdmins();
    supabaseProgress.auth.getUser().then(({ data }) => setMyId(data?.user?.id || null));
  }, []);

  useEffect(() => {
    setSearch('');
    setStatusFilter('all');
  }, [role]);

  const rows = useMemo(() => {
    const list =
      role === 'technicians' ? workers
        : role === 'managers' ? managers
          : admins;
    if (!list) return null;
    return list.filter((row) => {
      const active = Boolean(row.is_active);
      if (statusFilter === 'active' && !active) return false;
      if (statusFilter === 'disabled' && active) return false;
      if (role === 'technicians') {
        return matchesQuery([row.display_name, row.employee_code], search);
      }
      if (role === 'managers') {
        return matchesQuery([row.display_name, row.login_id], search);
      }
      return matchesQuery([row.display_name, row.email], search);
    });
  }, [role, workers, managers, admins, search, statusFilter]);

  const addLabel =
    role === 'technicians' ? '+ Add technician'
      : role === 'managers' ? '+ Add manager'
        : '+ Register admin';

  const onAdd = () => {
    if (role === 'technicians') setShowAddWorker(true);
    else if (role === 'managers') setShowAddManager(true);
    else setShowAddAdmin(true);
  };

  const toggleActive = async (row) => {
    setBusy(true);
    try {
      if (role === 'technicians') await setWorkerActive(row.id, !row.is_active);
      else if (role === 'managers') await setManagerActive(row.id, !row.is_active);
      else {
        if (row.user_id === myId) {
          toast.error('You cannot disable your own account');
          return;
        }
        await setAdminActive(row.user_id, !row.is_active);
      }
      if (role === 'technicians') refreshWorkers();
      else if (role === 'managers') refreshManagers();
      else refreshAdmins();
    } catch (e) {
      toast.error(friendlyDbError(e, 'Could not update account'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (row) => {
    if (role === 'technicians') {
      const label = `${row.display_name} (${row.employee_code})`;
      if (!window.confirm(`Delete the login for ${label}? They will not be able to sign in. Existing submissions stay in Packages.`)) return;
      setBusy(true);
      try {
        await deleteWorker(row.id);
        toast.success(`Deleted ${label}`);
        refreshWorkers();
      } catch (e) {
        toast.error(friendlyDbError(e, 'Could not delete account'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (role === 'managers') {
      if (!window.confirm(`Delete the manager login for ${row.display_name} (${row.login_id})? They will not be able to sign in.`)) return;
      setBusy(true);
      try {
        await deleteManager(row.id);
        toast.success(`Deleted ${row.display_name}`);
        refreshManagers();
      } catch (e) {
        toast.error(friendlyDbError(e, 'Could not delete account'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (row.user_id === myId) {
      toast.error('You cannot delete your own account');
      return;
    }
    if (!window.confirm(`Delete the admin login for ${row.display_name} (${row.email})? They will not be able to open the Admin portal.`)) return;
    setBusy(true);
    try {
      await deleteAdmin(row.user_id);
      toast.success(`Deleted ${row.display_name}`);
      refreshAdmins();
    } catch (e) {
      toast.error(friendlyDbError(e, 'Could not delete account'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <StaffPanelIntro
        title="Users & access"
        description="Everyone who can sign in to the site app or this admin portal, in one place."
        actions={
          <Button className={native ? 'min-h-11' : undefined} onClick={onAdd}>
            <Plus className="mr-1.5 h-4 w-4" />
            {addLabel.replace(/^\+\s*/, '')}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {ROLES.map((r) => {
          const active = role === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setRole(r.id)}
              aria-pressed={active}
              className={cn(
                'rounded-xl border bg-white p-4 text-left transition-all',
                active ? 'border-slate-900 ring-1 ring-slate-900' : 'border-border hover:border-slate-300'
              )}
            >
              <p className="text-sm font-semibold text-slate-900">{r.label}</p>
              <p className="mt-1 text-xs text-slate-500">{r.hint}</p>
            </button>
          );
        })}
      </div>

      {role === 'managers' && Array.isArray(managers) && managers.some((m) => !m || typeof m.jsr_permissions !== 'object') ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {JSR_PERM_MIGRATION_HINT}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <SearchField
            className="sm:flex-1"
            value={search}
            onChange={setSearch}
            placeholder="Search name, employee ID or email"
            native={native}
          />
          <select
            aria-label="Filter by status"
            className="h-10 rounded-lg border border-input bg-white px-3 text-sm text-slate-700 sm:w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="py-2.5 pl-4 pr-3">Name</th>
                <th className="py-2.5 pr-3">
                  {role === 'admins' ? 'Email' : 'Employee ID'}
                </th>
                <th className="py-2.5 pr-3">Can sign in</th>
                <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </span>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    No accounts match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const name = row.display_name || '—';
                  const idLabel =
                    role === 'technicians' ? row.employee_code
                      : role === 'managers' ? row.login_id
                        : row.email;
                  const key = row.id || row.user_id;
                  return (
                    <tr key={key} className="border-b border-border align-middle hover:bg-slate-50/70">
                      <td className="py-3 pl-4 pr-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                            {initials(name)}
                          </span>
                          <span className="font-medium text-slate-900">{name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {role === 'admins' ? idLabel : `ID ${idLabel}`}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <ActiveToggle
                          active={Boolean(row.is_active)}
                          disabled={busy || (role === 'admins' && row.is_active && row.user_id === myId)}
                          onToggle={() => toggleActive(row)}
                        />
                      </td>
                      <td className="py-3 pl-2 pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {role !== 'admins' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 min-h-0 gap-1.5 px-2.5 text-xs"
                              onClick={() => (role === 'technicians' ? setResetWorker(row) : setResetManager(row))}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              Reset password
                            </Button>
                          ) : null}
                          <MoreMenu
                            items={[
                              role === 'managers'
                                ? {
                                    label: 'Permissions',
                                    icon: <SlidersHorizontal className="h-4 w-4" />,
                                    onClick: () => setPermTarget(row),
                                  }
                                : null,
                              {
                                label: 'Delete login',
                                icon: <Trash2 className="h-4 w-4" />,
                                danger: true,
                                disabled: busy || (role === 'admins' && row.user_id === myId),
                                onClick: () => handleDelete(row),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddWorker ? (
        <AddWorkerDialog
          onClose={() => setShowAddWorker(false)}
          onCreated={(vals) => {
            setShowAddWorker(false);
            refreshWorkers();
            setRevealed({ employeeCode: vals.employeeCode, displayName: vals.displayName, password: vals.password });
          }}
        />
      ) : null}
      {showAddManager ? (
        <AddManagerDialog
          onClose={() => setShowAddManager(false)}
          onCreated={(vals) => {
            setShowAddManager(false);
            refreshManagers();
            setRevealed({ employeeCode: vals.loginId, displayName: vals.displayName, password: vals.password, loginLabel: 'Login ID' });
          }}
        />
      ) : null}
      {showAddAdmin ? (
        <RegisterAdminDialog
          onClose={() => setShowAddAdmin(false)}
          onCreated={() => {
            setShowAddAdmin(false);
            refreshAdmins();
          }}
        />
      ) : null}
      {resetWorker ? (
        <ResetPasswordDialog
          worker={resetWorker}
          onClose={() => setResetWorker(null)}
          onReset={(password) => {
            setRevealed({ employeeCode: resetWorker.employee_code, displayName: resetWorker.display_name, password });
            setResetWorker(null);
          }}
        />
      ) : null}
      {resetManager ? (
        <ResetManagerPasswordDialog
          manager={resetManager}
          onClose={() => setResetManager(null)}
          onReset={(password) => {
            setRevealed({ employeeCode: resetManager.login_id, displayName: resetManager.display_name, password, loginLabel: 'Login ID' });
            setResetManager(null);
          }}
        />
      ) : null}
      {permTarget ? (
        <EditManagerJsrDialog
          manager={permTarget}
          onClose={() => setPermTarget(null)}
          onSaved={() => {
            setPermTarget(null);
            refreshManagers();
          }}
        />
      ) : null}
      {revealed ? <RevealCredentialsDialog {...revealed} onClose={() => setRevealed(null)} /> : null}
    </div>
  );
}
