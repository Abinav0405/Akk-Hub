/**
 * Minimal port of Materials NativeConfirm (web fallback path).
 * Native sheet host is Claude-owned — see NEEDS.md.
 */
export function confirmAction({ title, message }) {
  return Promise.resolve(window.confirm(message || title));
}

export function promptSecret({ title, message }) {
  return Promise.resolve(window.prompt(message || title));
}

/** // TODO(claude): mount full NativeDialogHost for Capacitor */
export function NativeDialogHost() {
  return null;
}
