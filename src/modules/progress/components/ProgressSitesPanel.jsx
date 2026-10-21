import SitesPanel from '@/modules/progress/components/SitesPanel';
import PackageSuggestionsPanel from '@/modules/progress/components/PackageSuggestionsPanel';

/** Photo-package sites + section prefixes (and description / street-name suggestions). */
export default function ProgressSitesPanel() {
  return (
    <div className="space-y-5">
      <SitesPanel />
      <div id="site-descriptions" className="scroll-mt-24">
        <PackageSuggestionsPanel />
      </div>
    </div>
  );
}
