import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"


export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/** Old page names → hub paths (aligned with `src/app/AppRoutes.jsx`). */
const PAGE_PATHS = {
  RequestPortal: '/materials/request',
  RequestHistory: '/materials/history',
  History: '/materials/log',
  AdminDashboard: '/materials/admin',
  ManagerDashboard: '/materials/manage',
  AdminLogin: '/login',
  ManagerLogin: '/login',
  WorkerLogin: '/login',
};

export function createPageUrl(pageName) {
  return PAGE_PATHS[pageName] || `/${pageName}`;
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