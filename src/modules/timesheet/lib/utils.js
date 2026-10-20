import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { getSingaporeWallClock } from '@/modules/timesheet/lib/timeUtils'
import { glassDialog } from '@/ui/glass'

/** Long module dialogs: hub bottom sheet on phones + scroll cap on desktop. */
export function moduleSheetDialog(...extra) {
  return cn(
    glassDialog,
    'max-h-[min(90dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)))] overflow-y-auto overscroll-contain',
    ...extra,
  )
}

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/** Old page names → hub paths (aligned with `src/app/AppRoutes.jsx`). */
const PAGE_PATHS = {
  WorkerPortal: '/me',
  LeaveHistory: '/timesheet/leave/history',
  ShiftHistory: '/timesheet/shifts',
  WorkerTimesheets: '/timesheet/timesheets',
  ManagerTimesheets: '/timesheet/manage/timesheets',
  History: '/timesheet/history',
  AdminLogin: '/login',
  ManagerLogin: '/login',
  WorkerLogin: '/login',
  SupervisorLogin: '/login',
  PhotoVerification: '/verify',
  LegalNotice: '/privacy',
  WorkerFormFill: '/timesheet/forms',
  WorkerSubmittedForms: '/timesheet/forms',
  WorkerCompanyForms: '/timesheet/company-forms',
  WorkerCompanyFormFill: '/timesheet/company-forms/fill',
  WorkerCompanyFormHistory: '/timesheet/company-forms/history',
  AdminDashboard: '/timesheet/admin',
  ManagerDashboard: '/timesheet/manage',
  SupervisorDashboard: '/timesheet/site-shifts',
  AdminFormDetail: '/timesheet/admin/forms',
  AdminForms: '/timesheet/admin/forms',
  AdminAnnouncements: '/timesheet/admin/announcements',
  AdminCompanyForms: '/timesheet/admin/company-forms',
  Analytics: '/timesheet/admin/analytics',
  AttendanceReport: '/timesheet/admin/attendance',
};

export function createPageUrl(pageName) {
  const raw = String(pageName || '');
  const q = raw.indexOf('?');
  const name = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q) : '';
  const base = PAGE_PATHS[name] || `/${name}`;
  // Prefer /path/:id when query is only ?id= for form detail/fill
  if (name === 'AdminFormDetail' || name === 'WorkerFormFill') {
    const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    const id = params.get('id');
    if (id) {
      params.delete('id');
      const rest = params.toString();
      const path = name === 'AdminFormDetail'
        ? `/timesheet/admin/forms/${id}`
        : `/timesheet/forms/${id}`;
      return rest ? `${path}?${rest}` : path;
    }
  }
  return `${base}${query}`;
}

/**
 * Convert ISO datetime string to datetime-local input format (Singapore wall clock).
 * Uses UTC+8 arithmetic — not Intl hour12 — so 08:30 SGT never becomes 20:30.
 */
export function toDateTimeLocalUtc(dateString) {
  if (!dateString) return '';
  return getSingaporeWallClock(dateString)?.datetimeLocal || '';
}

/**
 * Convert datetime-local input format to ISO datetime string (Singapore timezone aware)
 */
export function fromDateTimeLocalUtc(dateTimeLocal) {
  if (!dateTimeLocal) return null;
  
  try {
    // Parse the datetime-local value (format: YYYY-MM-DDTHH:mm)
    const parts = dateTimeLocal.split('T');
    if (parts.length !== 2) {
      console.warn('Invalid datetime format:', dateTimeLocal);
      return null;
    }
    
    const [datePart, timePart] = parts;
    const dateParts = datePart.split('-');
    const timeParts = timePart.split(':');
    
    if (dateParts.length !== 3 || timeParts.length < 2) {
      console.warn('Invalid datetime parts:', dateTimeLocal);
      return null;
    }
    
    const [year, month, day] = dateParts;
    const [hours, minutes] = timeParts;
    
    // Validate that all parts are valid numbers
    if (!year || !month || !day || !hours || !minutes) {
      console.warn('Invalid datetime components:', { year, month, day, hours, minutes });
      return null;
    }
    
    // Treat input as Singapore time (UTC+8) explicitly to avoid browser-dependent
    // parsing. Without timezone, "2025-02-15T00:00" may be parsed as UTC in some
    // browsers (e.g. Chrome), making "12 AM" become 8 AM Singapore - causing wrong
    // hour calculations (e.g. 12 AM–9 AM showing as 23 hours).
    const singaporeDateStr = `${year}-${month}-${day}T${hours}:${minutes}:00+08:00`;
    const isoDate = new Date(singaporeDateStr);
    
    // Final validation before returning
    if (!Number.isFinite(isoDate.getTime())) {
      console.warn('Failed to parse date from:', dateTimeLocal, 'Parsed as:', singaporeDateStr);
      return null;
    }
    
    return isoDate.toISOString();
  } catch (error) {
    console.error('Error in fromDateTimeLocalUtc:', error, 'Input:', dateTimeLocal);
    return null;
  }
}