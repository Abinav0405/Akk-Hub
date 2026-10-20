/**
 * Tailwind class strings for the glass look, under the names the Timesheet screens used
 * (PortalShell.jsx exported glassPanel / glassDialog / glassInput). Scrolling content uses
 * near-opaque fills — real backdrop blur is reserved for fixed chrome (see styles/glass.css).
 */
export const glassPanel =
    'rounded-2xl border border-white/90 bg-white/[0.86] shadow-[inset_0_1px_0_#fff,0_1px_2px_rgb(15_29_51/0.05),0_12px_28px_-18px_rgb(15_29_51/0.38)]';

export const glassDialog = 'g-dialog rounded-[26px] border-white/90 bg-white sm:rounded-[26px]';

export const glassInput = 'h-11 rounded-xl border-[rgb(15_29_51/0.13)] bg-white text-base sm:text-sm';

export const glassCard = 'g-card';
export const glassRow = 'g-row';
export const glassChip = 'g-chip';
