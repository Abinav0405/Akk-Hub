import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { closePrintPreview, isPrintPreviewOpen } from '@/modules/materials/lib/printDocument';

let backInterceptor = null;

/** Register a handler that can swallow the Android back button. Return true if handled. */
export function setNativeBackInterceptor(fn) {
  backInterceptor = fn;
  return () => {
    if (backInterceptor === fn) backInterceptor = null;
  };
}

/**
 * Hardware / gesture back: close print preview, else interceptor, else pop history, else exit.
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return undefined;

    let handle = null;
    let cancelled = false;

    (async () => {
      try {
        const listener = await App.addListener('backButton', ({ canGoBack }) => {
          if (isPrintPreviewOpen()) {
            closePrintPreview();
            return;
          }

          // An open sheet, dialog or menu closes first (Radix listens for Escape).
          if (document.querySelector('[role="dialog"][data-state="open"], [role="listbox"][data-state="open"]')) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return;
          }

          if (backInterceptor?.() === true) {
            return;
          }

          const path = location.pathname;
          const atRoot = path === '/' || path === '/Home' || path === '';

          if (!atRoot && (canGoBack || window.history.length > 1)) {
            navigate(-1);
            return;
          }

          App.exitApp();
        });
        if (cancelled) {
          listener.remove();
        } else {
          handle = listener;
        }
      } catch (e) {
        console.warn('Android back button listener failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [navigate, location.pathname]);
}
