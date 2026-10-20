/**
 * Lazy loader for ported module screens (src/modules/<module>/pages/<Name>.jsx).
 *
 * import.meta.glob means a screen Cursor hasn't ported yet doesn't break the build — the
 * route shows a "being moved into AKK Hub" placeholder instead.
 */
import { Suspense, lazy } from 'react';
import { Construction } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { EmptyState } from '@/ui/hub/primitives';
import AuthChecking from '@/ui/AuthChecking';
import ErrorBoundary from '@/app/ErrorBoundary';

const loaders = import.meta.glob('/src/modules/*/pages/*.jsx');
const cache = new Map();

function Placeholder({ module, name }) {
    return (
        <HubPage title={name.replace(/([a-z])([A-Z])/g, '$1 $2')} eyebrow={module} backTo="/">
            <EmptyState icon={Construction} tone={module} title="Being moved into AKK Hub">
                This screen from the {module} app hasn’t been ported yet.
            </EmptyState>
        </HubPage>
    );
}

export function modulePage(module, name) {
    const key = `${module}/${name}`;
    if (cache.has(key)) return cache.get(key);
    const loader = loaders[`/src/modules/${module}/pages/${name}.jsx`];
    let Component;
    if (loader) {
        const Lazy = lazy(loader);
        Component = function ModuleScreen(props) {
            return (
                <ErrorBoundary label={`${module} · ${name}`}>
                    <Suspense fallback={<AuthChecking label="Loading…" />}>
                        <Lazy {...props} />
                    </Suspense>
                </ErrorBoundary>
            );
        };
    } else {
        Component = function MissingScreen() {
            return <Placeholder module={module} name={name} />;
        };
    }
    Component.displayName = `ModulePage(${key})`;
    cache.set(key, Component);
    return Component;
}

/** Prefetch a module screen's chunk (e.g. on hover / after sign-in). */
export function prefetchModulePage(module, name) {
    const loader = loaders[`/src/modules/${module}/pages/${name}.jsx`];
    if (loader) void loader().catch(() => {});
}
