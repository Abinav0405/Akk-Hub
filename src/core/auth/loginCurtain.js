/**
 * Login curtain — one continuous full-screen cover from "login succeeded" to "portal ready".
 *
 * The login page starts it in the same frame its own success screen is showing (the 'face'
 * variant looks identical to the Face ID success screen), then navigates straight to the
 * portal underneath. The route chunk, session check and first data load all happen behind it,
 * so the password page, loaders and a second welcome screen never flash. The portal ends it
 * once it has something to show; a safety timer ends it regardless.
 */
import { useSyncExternalStore } from 'react';

const SAFETY_MS = 8000;

let state = { open: false, variant: 'welcome', name: '', id: 0 };
const listeners = new Set();
let safetyTimer = null;

function emit() {
    listeners.forEach((fn) => fn());
}

/** @param {{ variant?: 'face' | 'welcome', name?: string }} options */
export function startLoginCurtain({ variant = 'welcome', name = '' } = {}) {
    state = { open: true, variant, name, id: Date.now() };
    window.clearTimeout(safetyTimer);
    safetyTimer = window.setTimeout(endLoginCurtain, SAFETY_MS);
    emit();
}

export function endLoginCurtain() {
    window.clearTimeout(safetyTimer);
    if (!state.open) return;
    state = { ...state, open: false };
    emit();
}

export function isLoginCurtainOpen() {
    return state.open;
}

function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function useLoginCurtain() {
    return useSyncExternalStore(subscribe, () => state, () => state);
}
