import { supabaseProgress } from '@/core/supabase'
import { portalManagerToken } from '@/core/auth/progress/portalAuth';
import { listAllPackages } from '@/modules/progress/lib/staffPackages';
import { listAllSites } from '@/modules/progress/lib/sites';
import { packageCompletionPct } from '@/modules/progress/lib/packageProgress';
import {
  addCalendarDays,
  parseDate,
  singaporeIsoFromInstant,
  singaporeTodayIso,
  toIsoDate,
} from '@/modules/progress/lib/dates';

const EMPTY_STATUS = { pending: 0, approved: 0, declined: 0 };
const STAGE_ORDER = ['before', 'during', 'after', 'completion'];
const PCT_BUCKETS = ['0–24%', '25–49%', '50–74%', '75–100%'];
const LAG_BUCKETS = ['Under 4h', '4–24h', '1–3 days', '3–7 days', 'Over 7 days'];

export function isMissingRpcError(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''} ${error?.code || ''}`;
  return /PGRST202|PGRST203|42883|could not find the function|function .* does not exist|schema cache/i.test(text);
}

export function defaultAnalyticsRange(preset = '30') {
  const to = singaporeTodayIso();
  if (preset === '7') return { from: addCalendarDays(to, -6), to, preset };
  if (preset === '90') return { from: addCalendarDays(to, -89), to, preset };
  if (preset === 'all') return { from: '2015-01-01', to, preset };
  return { from: addCalendarDays(to, -29), to, preset: '30' };
}

export function analyticsGrain(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return 'day';
  const days = Math.round((end - start) / 86400000);
  if (days > 366) return 'month';
  if (days > 92) return 'week';
  return 'day';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function bucketStart(iso, grain) {
  const d = parseDate(iso);
  if (!d) return iso;
  if (grain === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  if (grain === 'week') {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toIsoDate(d);
  }
  return toIsoDate(d);
}

function eachBucket(from, to, grain) {
  const out = [];
  let cursor = bucketStart(from, grain);
  const last = bucketStart(to, grain);
  const guard = 800;
  for (let i = 0; i < guard && cursor && cursor <= last; i += 1) {
    out.push(cursor);
    if (grain === 'month') {
      const d = parseDate(cursor);
      d.setMonth(d.getMonth() + 1);
      cursor = toIsoDate(d);
    } else if (grain === 'week') {
      cursor = addCalendarDays(cursor, 7);
    } else {
      cursor = addCalendarDays(cursor, 1);
    }
  }
  return out;
}

function pctBucket(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 25) return PCT_BUCKETS[0];
  if (n < 50) return PCT_BUCKETS[1];
  if (n < 75) return PCT_BUCKETS[2];
  return PCT_BUCKETS[3];
}

function lagBucket(hours) {
  if (hours < 4) return LAG_BUCKETS[0];
  if (hours < 24) return LAG_BUCKETS[1];
  if (hours < 72) return LAG_BUCKETS[2];
  if (hours < 168) return LAG_BUCKETS[3];
  return LAG_BUCKETS[4];
}

function countByStatus(rows) {
  return rows.reduce((acc, row) => {
    const key = row.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function statusPairs(map) {
  return Object.entries(map)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

function inRange(iso, from, to) {
  if (!iso) return false;
  return iso >= from && iso <= to;
}

function emptyDashboard(from, to, extra = {}) {
  const grain = analyticsGrain(from, to);
  const days = eachBucket(from, to, grain).map((date) => ({
    date,
    count: 0,
    pending: 0,
    approved: 0,
    declined: 0,
    avg_pct: null,
    completions: 0,
  }));
  return {
    range: { from, to, timezone: 'Asia/Singapore', grain },
    total_packages: 0,
    drafts_excluded: 0,
    status_counts: { ...EMPTY_STATUS },
    sent_to_export: 0,
    approved_not_sent: 0,
    avg_completion_pct: null,
    photo_total: 0,
    photos_by_stage: STAGE_ORDER.map((stage) => ({ stage, count: 0 })),
    completion_distribution: PCT_BUCKETS.map((bucket) => ({ bucket, count: 0 })),
    by_site: [],
    by_worker: [],
    submissions_by_day: days,
    avg_approval_hours: null,
    median_approval_hours: null,
    p90_approval_hours: null,
    review_lag_buckets: LAG_BUCKETS.map((bucket) => ({ bucket, count: 0 })),
    downloads: null,
    downloads_by_day: days.map(({ date }) => ({ date, count: 0 })),
    jsr: { available: false },
    ...extra,
  };
}

function normalizeDashboard(raw, from, to) {
  const base = emptyDashboard(from, to);
  let payload = raw;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return base;
    }
  }
  if (!payload || typeof payload !== 'object') return base;
  const status = payload.status_counts && typeof payload.status_counts === 'object' ? payload.status_counts : {};
  return {
    ...base,
    ...payload,
    range: { ...base.range, ...(payload.range || {}) },
    status_counts: {
      pending: Number(status.pending || 0),
      approved: Number(status.approved || 0),
      declined: Number(status.declined || 0),
    },
    photos_by_stage: Array.isArray(payload.photos_by_stage) && payload.photos_by_stage.length
      ? STAGE_ORDER.map((stage) => {
          const row = payload.photos_by_stage.find((x) => x.stage === stage);
          return { stage, count: Number(row?.count || 0) };
        })
      : base.photos_by_stage,
    jsr: payload.jsr && typeof payload.jsr === 'object' ? payload.jsr : { available: false },
  };
}

async function safeRpc(name, args) {
  try {
    const { data, error } = await supabaseProgress.rpc(name, args);
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function buildFromPackages({ packages, sites, from, to, siteId, exportEvents, jsrs, claims, invoices, avgApprovalHours }) {
  const grain = analyticsGrain(from, to);
  const filtered = (packages || []).filter((pkg) => {
    const day = singaporeIsoFromInstant(pkg.package_date) || String(pkg.package_date || '').slice(0, 10);
    if (!inRange(day, from, to)) return false;
    if (siteId && pkg.site?.id !== siteId) return false;
    return true;
  });

  const status_counts = { ...EMPTY_STATUS };
  const photos = { before: 0, during: 0, after: 0, completion: 0 };
  const pctCounts = Object.fromEntries(PCT_BUCKETS.map((b) => [b, 0]));
  const siteMap = new Map();
  const workerMap = new Map();
  const dayMap = new Map();
  let sent = 0;
  let notSent = 0;
  let pctSum = 0;

  (sites || []).forEach((s) => {
    if (siteId && s.id !== siteId) return;
    if (s.is_active === false) return;
    siteMap.set(s.id, {
      site_id: s.id,
      site_name: s.name,
      is_active: s.is_active !== false,
      count: 0,
      photos: 0,
      pending: 0,
      approved: 0,
      declined: 0,
    });
  });

  eachBucket(from, to, grain).forEach((date) => {
    dayMap.set(date, { date, count: 0, pending: 0, approved: 0, declined: 0, pctSum: 0, completions: 0 });
  });

  filtered.forEach((pkg) => {
    const status = pkg.approval_status;
    if (status_counts[status] != null) status_counts[status] += 1;
    if (status === 'approved' && pkg.sent_to_export) sent += 1;
    if (status === 'approved' && !pkg.sent_to_export) notSent += 1;

    photos.before += Number(pkg.before_count || 0);
    photos.during += Number(pkg.during_count || 0);
    photos.after += Number(pkg.after_count || 0);
    photos.completion += Number(pkg.completion_count || 0);
    const photoTotal = Number(pkg.photo_count || 0)
      || (photos && (Number(pkg.before_count || 0) + Number(pkg.during_count || 0) + Number(pkg.after_count || 0) + Number(pkg.completion_count || 0)));

    const pct = packageCompletionPct(pkg);
    pctSum += pct;
    pctCounts[pctBucket(pct)] += 1;

    const siteKey = pkg.site?.id || pkg.site_id || `name:${pkg.site?.name || 'Deleted site'}`;
    if (!siteMap.has(siteKey)) {
      siteMap.set(siteKey, {
        site_id: pkg.site?.id || null,
        site_name: pkg.site?.name || 'Deleted site',
        is_active: true,
        count: 0,
        photos: 0,
        pending: 0,
        approved: 0,
        declined: 0,
      });
    }
    const siteRow = siteMap.get(siteKey);
    siteRow.count += 1;
    siteRow.photos += Number(pkg.photo_count || photoTotal || 0);
    if (siteRow[status] != null) siteRow[status] += 1;

    const workerKey = pkg.worker?.id || `name:${pkg.worker?.display_name || 'deleted'}`;
    if (!workerMap.has(workerKey)) {
      workerMap.set(workerKey, {
        worker_id: pkg.worker?.id || null,
        name: pkg.worker?.display_name || 'Deleted employee/technician',
        employee_code: pkg.worker?.employee_code || null,
        count: 0,
        photos: 0,
        pending: 0,
        approved: 0,
        declined: 0,
      });
    }
    const workerRow = workerMap.get(workerKey);
    workerRow.count += 1;
    workerRow.photos += Number(pkg.photo_count || 0);
    if (workerRow[status] != null) workerRow[status] += 1;

    const day = bucketStart(singaporeIsoFromInstant(pkg.package_date) || String(pkg.package_date || '').slice(0, 10), grain);
    if (!dayMap.has(day)) {
      dayMap.set(day, { date: day, count: 0, pending: 0, approved: 0, declined: 0, pctSum: 0, completions: 0 });
    }
    const dayRow = dayMap.get(day);
    dayRow.count += 1;
    if (dayRow[status] != null) dayRow[status] += 1;
    dayRow.pctSum += pct;
    if (pkg.has_completion) dayRow.completions += 1;
  });

  const siteName = siteId ? (sites || []).find((s) => s.id === siteId)?.name : null;
  let downloads = null;
  const downloadDay = new Map(eachBucket(from, to, grain).map((date) => [date, 0]));
  if (Array.isArray(exportEvents)) {
    const matched = exportEvents.filter((ev) => {
      const day = singaporeIsoFromInstant(ev.exported_at);
      if (!inRange(day, from, to)) return false;
      if (siteId && siteName && ev.site_name && ev.site_name !== siteName) return false;
      return true;
    });
    downloads = {
      events: matched.length,
      packages: new Set(matched.map((e) => e.package_id).filter(Boolean)).size,
      pdf: matched.filter((e) => e.format === 'pdf').length,
      excel: matched.filter((e) => e.format === 'excel').length,
    };
    matched.forEach((ev) => {
      const bucket = bucketStart(singaporeIsoFromInstant(ev.exported_at), grain);
      downloadDay.set(bucket, (downloadDay.get(bucket) || 0) + 1);
    });
  }

  let jsr = { available: false };
  if (Array.isArray(jsrs)) {
    const jsrRows = jsrs.filter((row) => {
      const day = singaporeIsoFromInstant(row.jsr_date) || String(row.jsr_date || '').slice(0, 10);
      if (!inRange(day, from, to)) return false;
      if (siteId && siteName && row.site_name && row.site_name !== siteName) return false;
      return true;
    });
    const claimRows = (claims || []).filter((row) => {
      const day = singaporeIsoFromInstant(row.claim_date) || String(row.claim_date || '').slice(0, 10);
      return inRange(day, from, to);
    });
    const invoiceRows = (invoices || []).filter((row) => {
      const day = singaporeIsoFromInstant(row.invoice_date) || String(row.invoice_date || '').slice(0, 10);
      return inRange(day, from, to);
    });
    jsr = {
      available: true,
      total: jsrRows.length,
      by_status: statusPairs(countByStatus(jsrRows)),
      claims_total: claimRows.length,
      claims_by_status: statusPairs(countByStatus(claimRows)),
      invoices_total: invoiceRows.length,
    };
  }

  return {
    range: { from, to, timezone: 'Asia/Singapore', grain },
    total_packages: filtered.length,
    drafts_excluded: 0,
    status_counts,
    sent_to_export: sent,
    approved_not_sent: notSent,
    avg_completion_pct: filtered.length ? Math.round(pctSum / filtered.length) : null,
    photo_total: photos.before + photos.during + photos.after + photos.completion,
    photos_by_stage: STAGE_ORDER.map((stage) => ({ stage, count: photos[stage] || 0 })),
    completion_distribution: PCT_BUCKETS.map((bucket) => ({ bucket, count: pctCounts[bucket] || 0 })),
    by_site: [...siteMap.values()].sort((a, b) => b.count - a.count || a.site_name.localeCompare(b.site_name)),
    by_worker: [...workerMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    submissions_by_day: [...dayMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        count: row.count,
        pending: row.pending,
        approved: row.approved,
        declined: row.declined,
        avg_pct: row.count ? Math.round(row.pctSum / row.count) : null,
        completions: row.completions,
      })),
    avg_approval_hours: avgApprovalHours,
    median_approval_hours: null,
    p90_approval_hours: null,
    review_lag_buckets: LAG_BUCKETS.map((bucket) => ({ bucket, count: 0 })),
    downloads,
    downloads_by_day: [...downloadDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    jsr,
  };
}

async function buildClientFallback({ from, to, siteId }) {
  const token = portalManagerToken();
  const [packagesRes, sitesRes, summaryRes, exportRes, jsrRes, claimRes, invoiceRes] = await Promise.all([
    listAllPackages().then((data) => ({ data, error: null })).catch((error) => ({ data: [], error })),
    listAllSites().then((data) => ({ data, error: null })).catch((error) => ({ data: [], error })),
    safeRpc('admin_analytics_summary', {}),
    safeRpc('admin_list_package_export_events', {}),
    safeRpc('staff_list_jsrs', { p_manager_token: token }),
    safeRpc('staff_list_claims', { p_manager_token: token }),
    safeRpc('staff_list_invoices', { p_manager_token: token }),
  ]);

  if (packagesRes.error && !packagesRes.data?.length) {
    throw packagesRes.error;
  }

  const avg = summaryRes.data?.avg_approval_hours ?? null;
  return {
    data: buildFromPackages({
      packages: packagesRes.data || [],
      sites: sitesRes.data || [],
      from,
      to,
      siteId,
      exportEvents: exportRes.error ? null : (exportRes.data || []),
      jsrs: jsrRes.error ? null : (jsrRes.data || []),
      claims: claimRes.error ? null : (claimRes.data || []),
      invoices: invoiceRes.error ? null : (invoiceRes.data || []),
      avgApprovalHours: avg,
    }),
    source: 'client',
    warning: 'Showing a browser summary. Run 0042_analytics_dashboard.sql in Supabase for review lag and faster totals.',
  };
}

/**
 * Admin analytics blob. Prefers the 0042 RPC; if that SQL is not on the live
 * database yet, builds the same shape from staff_list_packages (fail-soft).
 */
export async function getAnalyticsDashboard({ from, to, siteId } = {}) {
  const range = from && to ? { from, to } : defaultAnalyticsRange('30');
  const args = {
    p_from: range.from,
    p_to: range.to,
    p_site_id: siteId || null,
  };

  const { data, error } = await safeRpc('admin_analytics_dashboard', args);
  if (!error && data) {
    return { data: normalizeDashboard(data, range.from, range.to), source: 'rpc', warning: null };
  }
  if (error && !isMissingRpcError(error) && !/column .* does not exist|42703/i.test(`${error.message || ''} ${error.code || ''}`)) {
    // Auth / network — don't hide a real failure behind a client fallback.
    if (/Admin access required|not authenticated|jwt/i.test(`${error.message || ''} ${error.details || ''}`)) {
      throw error;
    }
  }

  try {
    return await buildClientFallback({ from: range.from, to: range.to, siteId: siteId || null });
  } catch (fallbackError) {
    if (error) throw error;
    throw fallbackError;
  }
}

export async function getAnalyticsSummary() {
  const result = await getAnalyticsDashboard();
  return result.data;
}
