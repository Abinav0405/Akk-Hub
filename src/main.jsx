import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@/index.css';
import { LanguageProvider } from '@/core/i18n';
import { initNativeShell, hideNativeCapacitorSplash } from '@/core/nativeShell';
import { runNativeFirstLaunchPermissionsIfNeeded } from '@/core/permissions';
import { isAppUI, isNativeApp } from '@/core/platform';
import AppRoutes from '@/app/AppRoutes';
import ErrorBoundary from '@/app/ErrorBoundary';
import LoginCurtain from '@/ui/LoginCurtain';
import AppIntro from '@/ui/intro/AppIntro';
import { NativeConfirmHost } from '@/ui/native/NativeConfirm';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

function App() {
    return (
        <ErrorBoundary label="AKK Hub">
            <QueryClientProvider client={queryClient}>
                <LanguageProvider>
                    {/* v7 flags: route changes run in startTransition (keeps the current screen up
                        while a lazy screen loads, instead of flashing a fallback). */}
                    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                        <AppRoutes />
                        <LoginCurtain />
                        {/* App only (native, or ?app=1 preview): brand intro over the first screen. */}
                        <AppIntro enabled={isAppUI()} />
                        <NativeConfirmHost />
                        <Toaster
                            position={isNativeApp() ? 'top-center' : 'bottom-right'}
                            richColors
                            closeButton
                            toastOptions={{
                                className: 'g-toast',
                                style: {
                                    borderRadius: '16px',
                                    border: '1px solid rgb(255 255 255 / 0.9)',
                                    boxShadow: 'inset 0 1px 0 #fff, 0 16px 36px -14px rgb(15 29 51 / 0.32)',
                                },
                            }}
                        />
                    </BrowserRouter>
                </LanguageProvider>
            </QueryClientProvider>
        </ErrorBoundary>
    );
}

initNativeShell().finally(() => {
    // Reuse the root when Vite hot-reloads this module (avoids a second createRoot in dev).
    const root = window.__akkHubRoot || (window.__akkHubRoot = ReactDOM.createRoot(document.getElementById('root')));
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
    if (isNativeApp()) {
        hideNativeCapacitorSplash();
        // Notification taps (incl. the one that launched the app) are queued until the router is up.
        void import('@/core/push').then((push) => push.initPush());
        // Ask for notifications / location / camera once per install, after the first paint.
        window.setTimeout(() => void runNativeFirstLaunchPermissionsIfNeeded(), 1200);
    }
});
