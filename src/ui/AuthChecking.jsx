/**
 * Shown while a session is re-checked with the server: a quiet skeleton of the screen that
 * is coming (fast checks never flash a spinner).
 */
import { NativeSkeleton } from '@/ui/native/NativeStates';

export default function AuthChecking({ label = 'Checking your session…' }) {
    return (
        <div className="g-main space-y-3" aria-busy="true" role="status">
            <span className="sr-only">{label}</span>
            <div className="flex items-center gap-3 py-2">
                <NativeSkeleton className="h-11 w-11 rounded-2xl" />
                <div className="flex-1 space-y-2">
                    <NativeSkeleton className="h-3 w-24" />
                    <NativeSkeleton className="h-5 w-48" />
                </div>
            </div>
            <NativeSkeleton className="h-28 w-full rounded-[20px]" />
            <NativeSkeleton className="h-16 w-full rounded-[20px]" />
            <NativeSkeleton className="h-16 w-full rounded-[20px]" />
        </div>
    );
}
