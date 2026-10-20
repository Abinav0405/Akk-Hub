import { storageKey } from '@/core/storage'
/** Set after the native app runs the one-time notification + location + camera prompt. */
export const NATIVE_PERMISSIONS_WIZARD_KEY = storageKey('timesheet', 'akk_native_permissions_wizard_v1');

export function isNativePermissionsWizardComplete() {
    try {
        return localStorage.getItem(NATIVE_PERMISSIONS_WIZARD_KEY) === '1';
    } catch {
        return false;
    }
}

export function setNativePermissionsWizardComplete() {
    try {
        localStorage.setItem(NATIVE_PERMISSIONS_WIZARD_KEY, '1');
    } catch {
        /* ignore */
    }
}
