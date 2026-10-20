/** While an admin Time Tracker form is open, skip live shift refetch so typing stays responsive. */
let paused = false;

export function setAdminShiftRefreshPaused(next) {
    paused = !!next;
}

export function isAdminShiftRefreshPaused() {
    return paused;
}
