import { isNativeApp } from '@/core/platform';

/**
 * Warm route chunks so tab switches don't flash a loading screen.
 * Hub pages are Claude-owned — prefetch only modules that already live under
 * `src/modules/progress/`. Login / dashboard pages: TODO(claude) wire when routes exist.
 */

function idle(fn) {
  if (typeof window === 'undefined') return;
  const start = () => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 1500 });
    return;
  }
  window.setTimeout(start, 200);
}

export function prefetchWorkerRoutes() {
  if (!isNativeApp()) return;
  // TODO(claude): prefetch /login, /progress/submit, /progress/submissions, /account, /verify
  void import('@/modules/progress/components/CameraCapture.jsx');
  void import('@/modules/progress/components/NotificationBell.jsx');
}

export function prefetchStaffRoutes() {
  if (!isNativeApp()) return;
  // TODO(claude): prefetch /progress/review, /progress/admin, /progress/client
  void import('@/modules/progress/components/jsr/CommercialHub.jsx');
  void import('@/modules/progress/components/AnalyticsPanel.jsx');
  void import('@/modules/progress/components/BrandingPanel.jsx');
  void import('@/modules/progress/components/PackageReviewBoard.jsx');
}

export function prefetchWorkerRoutesIdle() {
  idle(prefetchWorkerRoutes);
}

export function prefetchStaffRoutesIdle() {
  idle(prefetchStaffRoutes);
}
