export const JSR_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  // Admin / Manager only review; the client is the one who approves (c-approved).
  approved: 'Reviewed',
  rejected: 'Rejected',
  passedout: 'Submitted to Client',
  clientreview: 'Under Client Review',
  'c-approved': 'Approved by Client',
  'c-rejected': 'Rejected by Client',
  'c-certified': 'Certified',
  'c-partial': 'Partially Certified',
  paymentcert: 'Payment Cert Received',
  invoiceprepared: 'Invoice Prepared',
  invoicesubmitted: 'Invoice Submitted',
  paymentpending: 'Payment Pending',
  paid: 'Paid',
  claimed: 'Included in Progress Claim',
};

/** Statuses where the document is with the client (visible + may still be editable). */
export const CLIENT_REVIEW_STATUSES = [
  'passedout',
  'clientreview',
  'c-approved',
  'c-rejected',
  'c-certified',
  'c-partial',
];

/** Terminal client decisions — no further Review / respond. */
export const CLIENT_TERMINAL_STATUSES = [
  'c-approved',
  'c-rejected',
  'c-certified',
  'c-partial',
];

export const CLIENT_VISIBLE_STATUSES = [
  ...CLIENT_REVIEW_STATUSES,
  'paymentcert',
  'invoiceprepared',
  'invoicesubmitted',
  'paymentpending',
  'paid',
];

const BADGE_CLASS = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  passedout: 'bg-sky-100 text-sky-800',
  clientreview: 'bg-amber-100 text-amber-900',
  'c-approved': 'bg-emerald-100 text-emerald-800',
  'c-rejected': 'bg-red-100 text-red-800',
  'c-certified': 'bg-cyan-100 text-cyan-900',
  'c-partial': 'bg-amber-100 text-amber-900',
  paymentcert: 'bg-violet-50 text-violet-700',
  invoiceprepared: 'bg-sky-100 text-sky-800',
  invoicesubmitted: 'bg-cyan-100 text-cyan-900',
  paymentpending: 'bg-amber-100 text-amber-900',
  paid: 'bg-emerald-100 text-emerald-800',
  claimed: 'bg-cyan-100 text-cyan-900',
};

export function jsrStatusLabel(status) {
  return JSR_STATUS_LABELS[status] || status || '—';
}

export function jsrStatusBadgeClass(status) {
  return BADGE_CLASS[status] || 'bg-slate-100 text-slate-700';
}

/** True only while client has not yet made a terminal decision (approved/rejected/certified/partial). */
export function clientCanRespond(status) {
  return status === 'passedout' || status === 'clientreview';
}

export function clientResponseIsFinal(status) {
  return CLIENT_TERMINAL_STATUSES.includes(status);
}

export const CLIENT_RESPONSE_LABELS = {
  approved: 'Approved',
  certified: 'Certified',
  partial: 'Revised (addition / deduction)',
  rejected: 'Rejected',
  reply: 'Reply / comment only',
};

export function clientResponseLabel(response) {
  return CLIENT_RESPONSE_LABELS[response] || response || '—';
}

export function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * How the client's figure compares with what was submitted. A client can raise a
 * price (addition) as well as lower it (deduction). `amount` is always positive;
 * `delta` is certified − submitted.
 */
export function clientAdjustment(submitted, certified) {
  const delta = Math.round(((Number(certified) || 0) - (Number(submitted) || 0)) * 100) / 100;
  if (delta >= 0.005) return { label: 'Addition', amount: delta, delta };
  if (delta <= -0.005) return { label: 'Deduction', amount: -delta, delta };
  return { label: 'No change', amount: 0, delta: 0 };
}

/** "+25.00" for an addition, "−89.00" for a deduction, "0.00" when unchanged. */
export function fmtSignedMoney(delta) {
  const d = Math.round((Number(delta) || 0) * 100) / 100;
  if (Math.abs(d) < 0.005) return '0.00';
  return `${d > 0 ? '+' : '−'}${fmtMoney(Math.abs(d))}`;
}

export function monthName(ym) {
  if (!ym || String(ym).length < 7) return ym || '—';
  try {
    return new Date(`${String(ym).slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return ym;
  }
}

export function photoStageLabel(stage) {
  return (
    {
      before: 'Photograph Before Installation',
      during: 'Photograph During Installation',
      after: 'Photograph After Installation',
      completion: 'Photograph on Completion',
    }[stage] || stage || 'Photograph'
  );
}

export function fileSafeName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ');
}

export const FALLBACK_COMPANY = {
  name: 'AKK ENGINEERING PTE. LTD.',
  addr: '15 Kaki Bukit Rd 4, #01-50 Singapore 417808',
  reg: '201917458W',
  email: 'admin@akk.com.sg',
  web: 'https://akk.com.sg/',
  phone: '+65 86084119',
  sub_by: 'Marimuthu Suresh',
};

export function companyLetterhead(company) {
  return {
    ...FALLBACK_COMPANY,
    ...(company || {}),
    name: company?.name || FALLBACK_COMPANY.name,
    addr: company?.addr || FALLBACK_COMPANY.addr,
    logo_path: company?.logo_path || null,
  };
}
