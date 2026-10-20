import { Loader2 } from 'lucide-react';
import { isNativeApp } from '@/core/platform';
import { NativeLoadingScreen } from '@/ui/native/NativeStates';

/** Lightweight fallback while lazy route chunks load. */
export default function PageLoader() {
    if (isNativeApp()) return <NativeLoadingScreen inline />;
    return (
        <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#dc6b2f]" aria-label="Loading" />
        </div>
    );
}
