export const JSR_PERM_GROUPS = [
  {
    id: 'view',
    label: 'View',
    keys: [
      { key: 'view_jsrs', label: 'View JSRs' },
      { key: 'view_claims', label: 'View claims' },
      { key: 'view_invoices', label: 'View invoices' },
    ],
  },
  {
    id: 'jsrs',
    label: 'JSRs',
    keys: [
      { key: 'create_jsr', label: 'Create JSR' },
      { key: 'edit_jsr', label: 'Edit draft / submitted / rejected JSR' },
      { key: 'submit_jsr', label: 'Submit for approval' },
      { key: 'approve_jsr', label: 'Review / reject (before the client)' },
      { key: 'pass_out_jsr', label: 'Pass out to Export Only' },
      { key: 'assign_exporter', label: 'Assign / change Export Only IDs' },
      { key: 'delete_jsr', label: 'Delete JSR (not if claimed or invoiced)' },
    ],
  },
  {
    id: 'claims',
    label: 'Claims',
    keys: [
      { key: 'create_claim', label: 'Create claim' },
      { key: 'edit_claim', label: 'Edit draft / rejected claim' },
      { key: 'submit_claim', label: 'Submit claim' },
      { key: 'approve_claim', label: 'Review / reject claim (the client approves it)' },
      { key: 'pass_out_claim', label: 'Pass claim to client' },
      { key: 'delete_claim', label: 'Delete claim' },
    ],
  },
  {
    id: 'invoices',
    label: 'Invoices & payment',
    keys: [
      { key: 'payment_cert', label: 'Record payment certificate' },
      { key: 'prepare_invoice', label: 'Prepare invoice' },
      { key: 'submit_invoice', label: 'Submit invoice to client' },
      { key: 'mark_payment', label: 'Mark payment pending / paid' },
    ],
  },
  {
    id: 'adminish',
    label: 'Catalog & companies',
    keys: [
      { key: 'catalog', label: 'Edit catalog (off unless granted)' },
      { key: 'companies', label: 'Edit companies & contracts (off unless granted)' },
    ],
  },
  {
    id: 'photos',
    label: 'Photo packages',
    keys: [
      { key: 'delete_package_photos', label: 'Delete individual photos in packages (never once approved; off unless granted)' },
    ],
  },
];

export const JSR_PERM_KEYS = JSR_PERM_GROUPS.flatMap((g) => g.keys.map((k) => k.key));

/** New managers: view-only until Admin ticks more boxes. */
export const JSR_PERM_DEFAULTS = Object.fromEntries(
  JSR_PERM_KEYS.map((key) => [key, key === 'view_jsrs' || key === 'view_claims' || key === 'view_invoices'])
);

export const JSR_PERM_ALL_TRUE = Object.fromEntries(JSR_PERM_KEYS.map((key) => [key, true]));

export const JSR_PERM_MIGRATION_HINT =
  'Apply migration 0043_manager_jsr_permission_enforce.sql in the Supabase SQL editor so manager JSR access can be saved and enforced.';

export const PHOTO_DELETE_MIGRATION_HINT =
  'Apply migrations 0062_manager_delete_package_photos.sql and 0063_manager_no_photo_delete_after_approval.sql in the Supabase SQL editor so managers can be allowed to delete package photos.';

function truthyFlag(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

export function parseJsrPermsRaw(raw) {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

/** Fail closed: missing or unknown keys are false. Admins ignore this map. */
export function normalizeJsrPerms(raw) {
  const src = parseJsrPermsRaw(raw);
  return Object.fromEntries(JSR_PERM_KEYS.map((key) => [key, truthyFlag(src[key])]));
}

export function lookupsHaveJsrPermissions(lookups) {
  if (!lookups || typeof lookups !== 'object') return false;
  if (lookups.permissionsPresent === true) return true;
  const perms = lookups.permissions;
  return perms != null && typeof perms === 'object' && !Array.isArray(perms);
}

export function jsrPermsForRole(role, lookups, sessionPerms) {
  if (role === 'admin') return { ...JSR_PERM_ALL_TRUE };
  if (lookupsHaveJsrPermissions(lookups)) return normalizeJsrPerms(lookups.permissions);
  if (sessionPerms) return normalizeJsrPerms(sessionPerms);
  return normalizeJsrPerms(null);
}

export function jsrCan(role, perms, key) {
  if (role === 'admin') return true;
  return perms?.[key] === true;
}

export function managerHasJsrModule(role, perms) {
  return (
    jsrCan(role, perms, 'view_jsrs')
    || jsrCan(role, perms, 'view_claims')
    || jsrCan(role, perms, 'view_invoices')
    || jsrCan(role, perms, 'catalog')
    || jsrCan(role, perms, 'companies')
  );
}
