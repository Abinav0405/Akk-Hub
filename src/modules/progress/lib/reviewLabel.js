/** Who last approved or declined this package, or null if it is still pending. */
export function reviewAttribution(pkg) {
  const status = pkg?.approval_status;
  if (status !== 'approved' && status !== 'declined') return null;

  const name = String(pkg?.reviewed_by_name || '').trim();
  const role = pkg?.reviewed_by_role === 'manager' ? 'Manager' : pkg?.reviewed_by_role === 'admin' ? 'Admin' : '';
  if (!name && !role) return null;

  const verb = status === 'approved' ? 'Approved by' : 'Declined by';
  if (!name || name === role) return `${verb} ${role || name}`;
  return role ? `${verb} ${name} (${role})` : `${verb} ${name}`;
}
