/**
 * Sign out with a short, calm hand-off: a brand veil fades in ("Signing out…"), the sessions are
 * cleared underneath, the app lands on Home, and the veil fades away. Plain DOM + CSS (glass.css
 * §18) so it survives the route change and costs nothing until used.
 */
import { signOutEverywhere } from '@/core/auth/identity';

const MIN_MS = 650;
let running = false;

function showVeil() {
    const el = document.createElement('div');
    el.className = 'g-signout';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
        '<div class="g-signout__card"><img src="/Akk-logo.png" alt="" class="g-signout__logo" />' +
        '<p class="g-signout__text">Signing out…</p><span class="g-signout__bar"><span></span></span></div>';
    document.body.appendChild(el);
    // next frame → fade in
    requestAnimationFrame(() => el.classList.add('is-in'));
    return el;
}

function hideVeil(el) {
    el.classList.remove('is-in');
    el.classList.add('is-out');
    const done = () => el.remove();
    el.addEventListener('transitionend', done, { once: true });
    window.setTimeout(done, 600);
}

/** @param {(to: string, opts?: object) => void} navigate react-router navigate */
export async function signOutWithAnimation(navigate) {
    if (running) return;
    running = true;
    const veil = showVeil();
    const started = Date.now();
    try {
        await signOutEverywhere();
    } finally {
        const wait = Math.max(0, MIN_MS - (Date.now() - started));
        await new Promise((r) => window.setTimeout(r, wait));
        navigate('/', { replace: true });
        window.setTimeout(() => {
            hideVeil(veil);
            running = false;
        }, 120);
    }
}
