import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/** Old page names → hub paths (aligned with `src/app/AppRoutes.jsx`). */
const PAGE_PATHS = {
  SubmitProgress: '/progress/submit',
  MySubmissions: '/progress/submissions',
  PhotoVerification: '/verify',
  MyAccount: '/account',
  AdminLogin: '/login',
  ManagerLogin: '/login',
  WorkerLogin: '/login',
  ExporterLogin: '/progress/client/login',
  AdminDashboard: '/progress/admin',
  ManagerDashboard: '/progress/review',
  ExporterDashboard: '/progress/client',

  WorkerPortal: '/progress/home',
  Home: '/',
};

export function createPageUrl(pageName) {
  return PAGE_PATHS[pageName] || `/${pageName}`;
}

/**
 * HashRouter puts `?query` inside the hash (`#/Page?role=admin`). Capacitor can
 * also land a query on the document URL. Merge router params with both so
 * My Account / Photo Verification / resubmit links keep working in the APK.
 */
export function routeSearchParams(routerParams) {
  const merged = new URLSearchParams()
  if (routerParams && typeof routerParams.forEach === 'function') {
    routerParams.forEach((value, key) => {
      if (value != null && value !== '') merged.set(key, value)
    })
  }
  if (typeof window === 'undefined') return merged
  try {
    const hash = window.location.hash || ''
    const q = hash.indexOf('?')
    if (q >= 0) {
      new URLSearchParams(hash.slice(q + 1)).forEach((value, key) => {
        if (!merged.has(key)) merged.set(key, value)
      })
    }
    new URLSearchParams(window.location.search).forEach((value, key) => {
      if (!merged.has(key)) merged.set(key, value)
    })
  } catch {
    /* ignore malformed URLs */
  }
  return merged
}

/** Escape user text before interpolating into print / HTML strings. */
export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
