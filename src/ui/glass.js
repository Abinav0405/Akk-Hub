/**
 * Tailwind class strings for the glass look, under the names the Timesheet screens used
 * (PortalShell.jsx exported glassPanel / glassDialog / glassInput). Scrolling content uses
 * near-opaque fills — real backdrop blur is reserved for fixed chrome (see styles/glass.css).
 */
/** Solid content surface (ONE PRODUCT) — blur stays on hub chrome only. */
export const glassPanel =
    'rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface,#fff)] shadow-[0_1px_2px_rgb(15_29_51/0.04)]';

export const glassDialog = 'g-dialog rounded-[26px] border-white/90 bg-white sm:rounded-[26px]';

export const glassInput = 'h-11 rounded-xl border-[rgb(15_29_51/0.13)] bg-white text-base sm:text-sm';

export const glassCard = 'g-card';
export const glassRow = 'g-row';
export const glassChip = 'g-chip';
