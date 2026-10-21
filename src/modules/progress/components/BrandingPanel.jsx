import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Loader2, Trash2, Upload } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import LivePhotoOverlays from '@/modules/progress/components/LivePhotoOverlays';
import {
  DEFAULT_BRANDING,
  PREVIEW_VERIFY_CODE,
  LOGO_SIZE_MIN,
  LOGO_SIZE_MAX,
  OVERLAY_SCALE_MIN,
  OVERLAY_SCALE_MAX,
  OVERLAY_OPACITY_MIN,
  OVERLAY_OPACITY_MAX,
  VERIFY_SCALE_MIN,
  VERIFY_SCALE_MAX,
  brandingLogoUrl,
  staffGetCompanyBranding,
  staffUpdateCompanyBranding,
  uploadCompanyLogo,
  removeCompanyLogoFile,
  invalidateBrandingCache,
  pctToCell,
} from '@/modules/progress/lib/branding';
import { DEFAULT_DOCUMENT_CHROME, normalizeDocumentChrome } from '@/modules/progress/lib/documentChrome';
import {
  OVERLAY_LINE_LABELS,
  overlayEditorLines,
  buildOverlayLayout,
} from '@/modules/progress/lib/overlayText';
import { invalidateBrandLogoCache } from '@/modules/progress/lib/canvasOverlay';
import { PHOTO_ASPECT_RATIO } from '@/modules/progress/lib/config';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { isNativeApp } from '@/core/platform';
import { cn } from '@/modules/progress/lib/utils';
import StaffPanelIntro from '@/modules/progress/components/StaffPanelIntro';

export default function BrandingPanel() {
  const native = isNativeApp();
  const fileRef = useRef(null);
  const [branding, setBranding] = useState(null);
  const [companyName, setCompanyName] = useState(DEFAULT_BRANDING.company_name);
  const [companyAddress, setCompanyAddress] = useState(DEFAULT_BRANDING.company_address);
  const [logoSize, setLogoSize] = useState(DEFAULT_BRANDING.logo_size_pct);
  const [logoOpacity, setLogoOpacity] = useState(DEFAULT_BRANDING.logo_opacity_pct);
  const [logoX, setLogoX] = useState(DEFAULT_BRANDING.logo_x_pct);
  const [logoY, setLogoY] = useState(DEFAULT_BRANDING.logo_y_pct);
  const [overlayX, setOverlayX] = useState(DEFAULT_BRANDING.overlay_x_pct);
  const [overlayY, setOverlayY] = useState(DEFAULT_BRANDING.overlay_y_pct);
  const [overlayScale, setOverlayScale] = useState(DEFAULT_BRANDING.overlay_scale_pct);
  const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_BRANDING.overlay_opacity_pct);
  const [lineRows, setLineRows] = useState(() => overlayEditorLines(DEFAULT_BRANDING.overlay_lines));
  const [verifyX, setVerifyX] = useState(DEFAULT_BRANDING.verify_x_pct);
  const [verifyY, setVerifyY] = useState(DEFAULT_BRANDING.verify_y_pct);
  const [verifyScale, setVerifyScale] = useState(DEFAULT_BRANDING.verify_scale_pct);
  const [docChrome, setDocChrome] = useState(() => normalizeDocumentChrome(DEFAULT_DOCUMENT_CHROME));
  const [logoPath, setLogoPath] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const applyRow = (row) => {
    setBranding(row);
    setCompanyName(row.company_name);
    setCompanyAddress(row.company_address);
    setLogoSize(row.logo_size_pct);
    setLogoOpacity(row.logo_opacity_pct);
    setLogoX(row.logo_x_pct);
    setLogoY(row.logo_y_pct);
    setOverlayX(row.overlay_x_pct);
    setOverlayY(row.overlay_y_pct);
    setOverlayScale(row.overlay_scale_pct);
    setOverlayOpacity(row.overlay_opacity_pct ?? DEFAULT_BRANDING.overlay_opacity_pct);
    setLineRows(overlayEditorLines(row.overlay_lines));
    setVerifyX(row.verify_x_pct);
    setVerifyY(row.verify_y_pct);
    setVerifyScale(row.verify_scale_pct);
    setDocChrome(normalizeDocumentChrome(row.document_chrome));
    setLogoPath(row.logo_path);
  };

  const load = () => {
    staffGetCompanyBranding()
      .then((row) => {
        applyRow(row);
      })
      .catch((e) => {
        toast.error(friendlyDbError(e, 'Could not load branding'));
        applyRow({ ...DEFAULT_BRANDING });
      });
  };

  useEffect(load, []);

  const overlayLines = lineRows.filter((row) => row.on).map((row) => row.id);
  const previewBranding = {
    ...(branding || DEFAULT_BRANDING),
    company_name: companyName,
    company_address: companyAddress,
    logo_size_pct: logoSize,
    logo_opacity_pct: logoOpacity,
    logo_position: pctToCell(logoX, logoY),
    overlay_position: pctToCell(overlayX, overlayY),
    overlay_lines: overlayLines,
    gps_position: null,
    logo_x_pct: logoX,
    logo_y_pct: logoY,
    overlay_x_pct: overlayX,
    overlay_y_pct: overlayY,
    overlay_scale_pct: overlayScale,
    overlay_opacity_pct: overlayOpacity,
    gps_x_pct: null,
    gps_y_pct: null,
    verify_x_pct: verifyX,
    verify_y_pct: verifyY,
    verify_scale_pct: verifyScale,
    logo_path: logoPath,
  };

  const previewLayout = buildOverlayLayout({
    date: new Date('2026-09-18T10:42:15+08:00'),
    lat: 1.35208,
    lng: 103.81984,
    accuracy: 8,
    address: companyAddress || DEFAULT_BRANDING.company_address,
    lcbId: '001',
    sectionLabel: 'LCB',
    siteName: 'Marina Tower',
    stage: 'before',
    branding: previewBranding,
  });

  const applyPreviewPatch = (patch) => {
    if (patch.logo_x_pct != null) setLogoX(patch.logo_x_pct);
    if (patch.logo_y_pct != null) setLogoY(patch.logo_y_pct);
    if (patch.overlay_x_pct != null) setOverlayX(patch.overlay_x_pct);
    if (patch.overlay_y_pct != null) setOverlayY(patch.overlay_y_pct);
    if (patch.overlay_scale_pct != null) setOverlayScale(patch.overlay_scale_pct);
    if (patch.verify_x_pct != null) setVerifyX(patch.verify_x_pct);
    if (patch.verify_y_pct != null) setVerifyY(patch.verify_y_pct);
    if (patch.verify_scale_pct != null) setVerifyScale(patch.verify_scale_pct);
    if (patch.logo_size_pct != null) setLogoSize(patch.logo_size_pct);
  };

  const save = async (next = {}) => {
    setBusy(true);
    try {
      const path = next.logoPath !== undefined ? next.logoPath : logoPath;
      const nextLines = next.overlayLines ?? overlayLines;
      await staffUpdateCompanyBranding({
        companyName: next.companyName ?? companyName,
        companyAddress: next.companyAddress ?? companyAddress,
        logoPath: path,
        logoSizePct: next.logoSize ?? logoSize,
        logoOpacityPct: next.logoOpacity ?? logoOpacity,
        logoPosition: pctToCell(next.logoX ?? logoX, next.logoY ?? logoY),
        overlayPosition: pctToCell(next.overlayX ?? overlayX, next.overlayY ?? overlayY),
        overlayLines: nextLines,
        gpsPosition: null,
        logoXPct: next.logoX ?? logoX,
        logoYPct: next.logoY ?? logoY,
        overlayXPct: next.overlayX ?? overlayX,
        overlayYPct: next.overlayY ?? overlayY,
        overlayScalePct: next.overlayScale ?? overlayScale,
        overlayOpacityPct: next.overlayOpacity ?? overlayOpacity,
        gpsXPct: null,
        gpsYPct: null,
        verifyXPct: next.verifyX ?? verifyX,
        verifyYPct: next.verifyY ?? verifyY,
        verifyScalePct: next.verifyScale ?? verifyScale,
        documentChrome: next.documentChrome ?? docChrome,
      });
      invalidateBrandingCache();
      invalidateBrandLogoCache();
      toast.success('Branding saved');
      load();
    } catch (e) {
      toast.error(friendlyDbError(e, 'Could not save branding'));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadCompanyLogo(file);
      setLogoPath(path);
      await save({ logoPath: path });
    } catch (e) {
      toast.error(friendlyDbError(e, 'Could not upload logo'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    if (!logoPath) return;
    if (!window.confirm('Remove the company logo from captured photos and reports?')) return;
    setBusy(true);
    try {
      await removeCompanyLogoFile(logoPath);
      setLogoPath(null);
      await save({ logoPath: null });
    } catch (e) {
      toast.error(friendlyDbError(e, 'Could not remove logo'));
      setBusy(false);
    }
  };

  const moveLine = (index, dir) => {
    const next = index + dir;
    if (next < 0 || next >= lineRows.length) return;
    setLineRows((rows) => {
      const copy = [...rows];
      const [row] = copy.splice(index, 1);
      copy.splice(next, 0, row);
      return copy;
    });
  };

  const logoUrl = branding ? brandingLogoUrl(previewBranding) : null;

  return (
    <div className="space-y-5">
      <StaffPanelIntro
        title="Branding"
        description="Logo stamps on photos and letterheads on printed packages and reports."
      />

      {!branding ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading branding…
        </div>
      ) : null}

      {branding ? (
      <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h3 className="text-sm font-semibold text-slate-900">Logo</h3>
          <div className="space-y-2">
            <Label htmlFor="brand-company">Company name</Label>
            <Input
              id="brand-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">Used on PDF/Excel letterheads. Photos stamp the logo only — not this name.</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-slate-50">
              <img src={logoUrl} alt="" className="max-h-16 max-w-16 object-contain" />
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className={native ? 'min-h-11' : undefined}
                disabled={busy || uploading}
                asChild
              >
                <label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/*"
                    className="sr-only"
                    disabled={busy || uploading}
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                  {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
                  Upload logo
                </label>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50"
                disabled={busy || !logoPath}
                onClick={handleRemoveLogo}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Remove logo
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">PNG with a transparent background works best. Stored in Supabase and stamped on new captures.</p>

          <div className="space-y-2">
            <Label>Logo size on photo: {logoSize}% of width</Label>
            <input
              type="range"
              min={LOGO_SIZE_MIN}
              max={LOGO_SIZE_MAX}
              value={logoSize}
              onChange={(e) => setLogoSize(Number(e.target.value))}
              className="w-full accent-brand"
            />
          </div>
          <div className="space-y-2">
            <Label>Logo opacity: {logoOpacity}%</Label>
            <input
              type="range"
              min={40}
              max={100}
              value={logoOpacity}
              onChange={(e) => setLogoOpacity(Number(e.target.value))}
              className="w-full accent-brand"
            />
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-slate-900">Preview on a captured photo</h3>
          <div
            className="relative w-full overflow-hidden rounded-xl bg-slate-700 touch-none"
            style={{ aspectRatio: PHOTO_ASPECT_RATIO }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#64748b,#334155)]" />
            <LivePhotoOverlays
              branding={previewBranding}
              layout={previewLayout}
              logoUrl={logoUrl}
              companyName={companyName || DEFAULT_BRANDING.company_name}
              verificationCode={PREVIEW_VERIFY_CODE}
              interactive
              showGrid
              onChange={applyPreviewPatch}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Drag logo, details (date, address, GPS), and the barcode. Corner handles resize. Gridlines are a guide only — they are not burned into photos. Click Save branding to keep placements after refresh.
          </p>
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Overlay wording</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Timestamp, site, section, status, address, and GPS (±accuracy) share one dark details box. Toggle a line or move it up or down. Drag the block on the preview to place it.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Details section size: {overlayScale}%</Label>
            <input
              type="range"
              min={OVERLAY_SCALE_MIN}
              max={OVERLAY_SCALE_MAX}
              value={overlayScale}
              onChange={(e) => setOverlayScale(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <p className="text-xs text-muted-foreground">Scales the dark block’s font and padding together.</p>
          </div>
          <div className="space-y-2">
            <Label>Details box opacity: {overlayOpacity}%</Label>
            <input
              type="range"
              min={OVERLAY_OPACITY_MIN}
              max={OVERLAY_OPACITY_MAX}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <p className="text-xs text-muted-foreground">Transparency of the black pad behind date, address, and GPS.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Barcode + code size: {verifyScale}%</Label>
            <input
              type="range"
              min={VERIFY_SCALE_MIN}
              max={VERIFY_SCALE_MAX}
              value={verifyScale}
              onChange={(e) => setVerifyScale(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <p className="text-xs text-muted-foreground">Scales bars and XXXX-XXXX together. Drag the white tab on the preview to move it.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Line order</Label>
          {lineRows.map((row, i) => (
            <div key={row.id} className="flex items-center gap-2 rounded-lg border border-border bg-slate-50/80 px-2 py-1.5">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-brand"
                checked={row.on}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  setLineRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, on } : r)));
                }}
              />
              <span className={cn('flex-1 text-sm', row.on ? 'text-slate-900' : 'text-muted-foreground')}>
                {OVERLAY_LINE_LABELS[row.id]}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-11 w-11"
                disabled={busy || i === 0}
                onClick={() => moveLine(i, -1)}
                aria-label={`Move ${OVERLAY_LINE_LABELS[row.id]} up`}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-11 w-11"
                disabled={busy || i === lineRows.length - 1}
                onClick={() => moveLine(i, 1)}
                aria-label={`Move ${OVERLAY_LINE_LABELS[row.id]} down`}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="text-sm font-semibold text-slate-900">Letterhead</h3>
        <div className="space-y-2">
          <Label htmlFor="brand-address">Address</Label>
          <p className="text-xs text-muted-foreground">Used on photo overlays and Excel. PDF pages use the Documents header instead of this address.</p>
          <Textarea
            id="brand-address"
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
            disabled={busy}
            rows={2}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Documents</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            One header and footer for every page of a Package, JSR, Progress claim, and Invoice. The document name is added for you. Package details and descriptions stay on page 1.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="flex items-start justify-between gap-4 px-4 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              {docChrome.header_show_logo ? (
                <img src={logoUrl} alt="" className="h-12 w-12 object-contain" />
              ) : null}
              <div className="min-w-0">
                {docChrome.header_show_name ? (
                  <p className="text-[15px] font-bold text-slate-950">{companyName || DEFAULT_BRANDING.company_name}</p>
                ) : null}
                {docChrome.header_extra ? (
                  <p className="text-xs font-semibold text-slate-700">{docChrome.header_extra}</p>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold text-slate-950">Package Report</p>
              <p className="mt-1 border-l-2 border-[#c0392b] pl-2 text-[11px] font-bold text-slate-950">DOC-001</p>
            </div>
          </div>
          <div className="mx-4 mt-3 border-t-2 border-[#c0392b]" />
          <div className="px-4 pb-3 pt-6">
            {docChrome.footer_show_rule ? <div className="mb-1.5 border-t border-[#e7a8a8]" /> : null}
            <div className="flex items-start justify-between gap-3 text-[11px] font-semibold text-slate-950">
              <span className="min-w-0 text-slate-700">{docChrome.footer_extra || 'DOC-001 · Package Report'}</span>
              {docChrome.footer_show_page ? <span className="shrink-0">Page 1 of 1</span> : null}
            </div>
            <div className="mt-1.5 border-t border-[#e7a8a8]" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Header</p>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={docChrome.header_show_logo}
                disabled={busy}
                onChange={(e) => setDocChrome((c) => ({ ...c, header_show_logo: e.target.checked }))}
              />
              Company logo
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={docChrome.header_show_name}
                disabled={busy}
                onChange={(e) => setDocChrome((c) => ({ ...c, header_show_name: e.target.checked }))}
              />
              Company name
            </label>
            <div className="space-y-2">
              <Label htmlFor="doc-header-extra">Tagline</Label>
              <Input
                id="doc-header-extra"
                value={docChrome.header_extra}
                disabled={busy}
                placeholder="Electrical & Fire Protection Engineering"
                onChange={(e) => setDocChrome((c) => ({ ...c, header_extra: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Footer</p>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={docChrome.footer_show_page}
                disabled={busy}
                onChange={(e) => setDocChrome((c) => ({ ...c, footer_show_page: e.target.checked }))}
              />
              Page number, bottom right
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={docChrome.footer_show_rule}
                disabled={busy}
                onChange={(e) => setDocChrome((c) => ({ ...c, footer_show_rule: e.target.checked }))}
              />
              Faint red line above the footer
            </label>
            <div className="space-y-2">
              <Label htmlFor="doc-footer-extra">Extra footer text</Label>
              <Input
                id="doc-footer-extra"
                value={docChrome.footer_extra}
                disabled={busy}
                placeholder="Optional"
                onChange={(e) => setDocChrome((c) => ({ ...c, footer_extra: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </Card>

      <Button type="button" disabled={busy || uploading} onClick={() => save()} className={native ? 'min-h-11' : undefined}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Save branding
      </Button>
      </>
      ) : null}
    </div>
  );
}
