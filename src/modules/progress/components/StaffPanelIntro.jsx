import { isNativeApp } from '@/core/platform';
import { PortalPageHeader } from '@/ui/layout';

/**
 * Progress staff panels inside the hub: on web, PortalShell already titles the section.
 * Native APK keeps the in-panel title block.
 */
export default function StaffPanelIntro({ actions, ...headerProps }) {
    const native = isNativeApp();
    if (!native) {
        if (!actions) return null;
        return <div className="mb-4 flex flex-wrap items-center justify-end gap-2">{actions}</div>;
    }
    return <PortalPageHeader {...headerProps} actions={actions} />;
}
