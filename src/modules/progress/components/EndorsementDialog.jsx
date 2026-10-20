import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { Input } from '@/ui/input';
import SignatureOrSealPad from '@/modules/progress/components/SignatureOrSealPad';
import EndorsementPreview from '@/modules/progress/components/EndorsementPreview';
import { storageKey } from '@/core/storage'
import {
  defaultEndorsementForKind,
  shouldAddFooterSignatureLine,
  ensureDocumentArtifact,
  replaceDocumentArtifact,
  downloadStoredPdf,
  listEndorsements,
  listMySignatures,
  loadSignatureImage,
  nextStampPosition,
  removeEndorsements,
  saveEndorsements,
} from '@/modules/progress/lib/documentEndorsement';
import { commercialPdfLayoutOptions } from '@/modules/progress/lib/jsrPdf';

function placementLabel(mode) {
  return mode === 'seal' ? 'Company seal' : 'Signature';
}

function savedSummary(items) {
  const signatures = items.filter((item) => item.mode === 'signature').length;
  const seals = items.filter((item) => item.mode === 'seal').length;
  const parts = [];
  if (signatures) parts.push(`${signatures} signature${signatures === 1 ? '' : 's'}`);
  if (seals) parts.push(`${seals} company seal${seals === 1 ? '' : 's'}`);
  return `Added ${parts.join(' and ')} to the document`;
}

/**
 * Sign / stamp a stored document.
 *
 * `onCommit(result)` (optional, async) is the action the signature is for — e.g. passing the
 * document to the client. It runs inside this dialog after the marks are saved. If it throws,
 * the marks just added are removed again and the stored PDF is rebuilt without them, so a
 * failed send never leaves a signature stuck on the document. The dialog stays open with the
 * marks still placed, so the user can simply try again.
 */
export default function EndorsementDialog({
  open,
  kind,
  documentId,
  companyId,
  buildPdfBlob,
  title = 'Sign or stamp this document',
  allowSkip = false,
  confirmLabel = 'Add to document',
  replaceExisting = false,
  signerName: signerNameProp = '',
  // Off where the name is always the logged-in user's (Export Only).
  showSignerName = true,
  // Off for Export Only: they add their own marks but cannot remove ones already on the
  // document. (A failed send still undoes the marks just added — see onCommit.)
  canRemoveExisting = true,
  onCommit,
  onClose,
  onDone,
  onSkip,
}) {
  const [mode, setMode] = useState('signature');
  const [placements, setPlacements] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [viewPage, setViewPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [signerName, setSignerName] = useState(signerNameProp);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [padClearToken, setPadClearToken] = useState(0);
  const [existing, setExisting] = useState([]);
  const [removingId, setRemovingId] = useState('');
  // The signer's own recent signatures (only theirs — the database decides from the login).
  const [recent, setRecent] = useState([]);
  const [pickingId, setPickingId] = useState('');
  const activeIdRef = useRef(null);
  const viewPageRef = useRef(0);
  const placementsRef = useRef([]);
  const buildRef = useRef(buildPdfBlob);
  const pdfUrlRef = useRef('');
  buildRef.current = buildPdfBlob;
  placementsRef.current = placements;
  const showFooterGuide = shouldAddFooterSignatureLine(kind);

  const revokeAll = (items) => {
    items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  };

  const freezeDraft = () => {
    activeIdRef.current = null;
    setActiveId(null);
  };

  const removePlacement = (id) => {
    const current = placementsRef.current.find((item) => item.id === id);
    if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
    if (activeIdRef.current === id) {
      activeIdRef.current = null;
      setActiveId(null);
      setPadClearToken((token) => token + 1);
    }
    setPlacements((prev) => prev.filter((item) => item.id !== id));
  };

  const changePage = (next) => {
    const page = Number(next);
    if (!Number.isFinite(page) || page === viewPageRef.current) return;
    freezeDraft();
    viewPageRef.current = page;
    setViewPage(page);
    setPadClearToken((token) => token + 1);
  };

  /** Point the preview at a stored PDF (after it is (re)built or stamped). */
  const showArtifact = async (art) => {
    if (!art?.storagePath) return;
    const bytes = await downloadStoredPdf(art.storagePath);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = blobUrl;
    setPdfUrl(blobUrl);
    if (art.pageCount) setPageCount(art.pageCount);
  };

  const refreshExisting = () => {
    listEndorsements({ kind, documentId })
      .then((rows) => setExisting(Array.isArray(rows) ? rows : []))
      .catch(() => setExisting([]));
  };

  useEffect(() => () => {
    revokeAll(placementsRef.current);
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    revokeAll(placementsRef.current);
    setPlacements([]);
    setExisting([]);
    activeIdRef.current = null;
    setActiveId(null);
    const start = defaultEndorsementForKind(kind).pageIndex || 0;
    viewPageRef.current = start;
    setViewPage(start);
    setMode('signature');
    setPadClearToken((token) => token + 1);
    setLoadingPdf(true);
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = '';
    }
    setPdfUrl('');
    setSignerName(signerNameProp || localStorage.getItem(storageKey('progress', 'adminName')) || localStorage.getItem(storageKey('progress', 'managerName')) || localStorage.getItem(storageKey('progress', 'exporterName')) || '');
    setRecent([]);
    listMySignatures().then(setRecent).catch(() => setRecent([]));
  }, [open, documentId, kind, signerNameProp]);

  useEffect(() => {
    if (!open || !kind || !documentId) return undefined;
    let cancelled = false;
    setLoadingPdf(true);
    const layoutOpts = commercialPdfLayoutOptions(kind);
    const prepare = replaceExisting ? replaceDocumentArtifact : ensureDocumentArtifact;
    prepare({
      kind,
      documentId,
      buildPdfBlob: () => buildRef.current?.(),
      ...layoutOpts,
    })
      .then(async (art) => {
        if (cancelled) return;
        await showArtifact(art);
        if (!cancelled) refreshExisting();
      })
      .catch((e) => {
        if (!cancelled) toast.error(e.message || 'Could not prepare the document preview');
      })
      .finally(() => {
        if (!cancelled) setLoadingPdf(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, documentId, replaceExisting]);

  const acceptImage = (blob, nextMode) => {
    if (!blob) return;
    const next = nextMode === 'seal' ? 'seal' : 'signature';
    const previewUrl = URL.createObjectURL(blob);
    const id = activeIdRef.current;
    if (id) {
      const current = placementsRef.current.find((item) => item.id === id);
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      setPlacements((prev) => prev.map((item) => (
        item.id === id ? { ...item, mode: next, imageBlob: blob, previewUrl, sourceId: null, sourceImagePath: null } : item
      )));
      return;
    }
    const nextId = crypto.randomUUID();
    activeIdRef.current = nextId;
    setActiveId(nextId);
    const pageIndex = viewPageRef.current;
    setPlacements((prev) => {
      const pos = nextStampPosition(kind, pageIndex, prev);
      return [...prev, {
        id: nextId,
        mode: next,
        pageIndex,
        pages: [pageIndex],
        imageBlob: blob,
        previewUrl,
        ...pos,
      }];
    });
  };

  /** Place one of your own recent signatures on the page in view. */
  const pickRecent = async (row) => {
    if (!row?.id || pickingId) return;
    setPickingId(row.id);
    try {
      const blob = await loadSignatureImage(row.imagePath);
      freezeDraft();
      const previewUrl = URL.createObjectURL(blob);
      const pageIndex = viewPageRef.current;
      setPlacements((prev) => [...prev, {
        id: crypto.randomUUID(),
        mode: 'signature',
        pageIndex,
        pages: [pageIndex],
        imageBlob: blob,
        previewUrl,
        sourceId: row.id,
        sourceImagePath: row.imagePath,
        ...nextStampPosition(kind, pageIndex, prev),
      }]);
    } catch (e) {
      toast.error(e.message || 'Could not load that signature');
    } finally {
      setPickingId('');
    }
  };

  /** Pages a mark goes on (same position on each). At least one page stays selected. */
  const togglePage = (id, page) => {
    setPlacements((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const pages = item.pages || [item.pageIndex];
      const next = pages.includes(page) ? pages.filter((p) => p !== page) : [...pages, page].sort((a, b) => a - b);
      return next.length ? { ...item, pages: next, pageIndex: next[0] } : item;
    }));
  };

  const setAllPages = (id, all) => {
    setPlacements((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const pages = all ? Array.from({ length: pageCount }, (_, i) => i) : [viewPageRef.current];
      return { ...item, pages, pageIndex: pages[0] };
    }));
  };

  /** Remove a mark that is already saved on the document (e.g. left over from a failed send). */
  const removeExisting = async (row) => {
    if (!row?.id) return;
    if (!window.confirm(`Remove this ${placementLabel(row.mode).toLowerCase()} from the document?`)) return;
    setRemovingId(row.id);
    setLoadingPdf(true);
    try {
      const art = await removeEndorsements({
        kind,
        documentId,
        ids: [row.id],
        buildPdfBlob: () => buildRef.current?.(),
      });
      await showArtifact(art);
      refreshExisting();
      toast.success(`${placementLabel(row.mode)} removed`);
    } catch (e) {
      toast.error(e.message || 'Could not remove it');
    } finally {
      setRemovingId('');
      setLoadingPdf(false);
    }
  };

  const confirm = async () => {
    const items = placementsRef.current;
    if (!items.length) {
      toast.error('Draw or upload a signature or company seal');
      return;
    }
    if (loadingPdf) {
      toast.error('Wait for the document preview to finish loading');
      return;
    }
    setBusy(true);
    setBusyLabel('Adding…');
    let result = null;
    try {
      result = await saveEndorsements({
        kind,
        documentId,
        companyId,
        items: items.flatMap((item) => (item.pages || [item.pageIndex]).map((page) => ({
          mode: item.mode,
          imageBlob: item.imageBlob,
          xPct: item.xPct,
          yPct: item.yPct,
          scale: item.scale,
          pageIndex: page,
          signerName,
          groupId: item.id,
          sourceId: item.sourceId || null,
          sourceImagePath: item.sourceImagePath || null,
        }))),
      });
    } catch (e) {
      toast.error(e.message || 'Could not add the signature');
      setBusy(false);
      setBusyLabel('');
      return;
    }

    if (onCommit) {
      setBusyLabel('Sending…');
      try {
        await onCommit(result);
      } catch (e) {
        // The send failed — take back the marks we just added so they do not stick.
        setBusyLabel('Undoing…');
        const ids = (result?.endorsements || []).map((row) => row?.id).filter(Boolean);
        try {
          const art = await removeEndorsements({ kind, documentId, ids, buildPdfBlob: () => buildRef.current?.() });
          await showArtifact(art);
        } catch (undoErr) {
          console.warn('[EndorsementDialog] could not undo the marks after a failed send:', undoErr);
        }
        refreshExisting();
        toast.error(`${e?.message || 'Could not send the document'} — nothing was sent and the signature was not kept. Fix the problem and press the button again.`);
        setBusy(false);
        setBusyLabel('');
        return;
      }
    }

    toast.success(savedSummary(items.flatMap((item) => (item.pages || [item.pageIndex]).map(() => item))));
    setBusy(false);
    setBusyLabel('');
    onDone?.(result);
    onClose?.();
  };

  const visibleStamps = placements
    .filter((item) => (item.pages || [item.pageIndex]).includes(viewPage) && item.previewUrl)
    .map((item) => ({
      id: item.id,
      imageUrl: item.previewUrl,
      xPct: item.xPct,
      yPct: item.yPct,
      scale: item.scale,
      mode: item.mode,
      active: item.id === activeId,
    }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose?.()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Add a signature, a company seal, or both — draw one, or tap one of your recent signatures. To sign several pages at once, tick the pages under the mark. Use Add another for another mark.
        </p>
        {canRemoveExisting && existing.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">Already on this document</p>
            <p className="mb-2 text-xs text-amber-900/80">
              These were saved earlier. Remove any that should not be there before adding new ones.
            </p>
            <ul className="space-y-1">
              {existing.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{placementLabel(row.mode)}</span>
                    <span className="text-muted-foreground">
                      {' '}· Page {(Number(row.pageIndex) || 0) + 1}
                      {row.signerName ? ` · ${row.signerName}` : ''}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-red-200 text-red-700 hover:bg-red-50"
                    disabled={busy || Boolean(removingId)}
                    onClick={() => removeExisting(row)}
                  >
                    {removingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remove'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <SignatureOrSealPad
          mode={mode}
          onModeChange={(next) => {
            freezeDraft();
            setMode(next === 'seal' ? 'seal' : 'signature');
          }}
          companyId={companyId}
          disabled={busy}
          clearToken={padClearToken}
          onDiscard={() => {
            const id = activeIdRef.current;
            if (id) removePlacement(id);
          }}
          onImageReady={acceptImage}
        />
        {mode === 'signature' && recent.length ? (
          <div className="rounded-lg border border-border bg-slate-50/70 p-3">
            <p className="text-sm font-medium text-slate-800">Your recent signatures</p>
            <p className="mb-2 text-xs text-muted-foreground">Only you can see and use these. Tap one to place it on this page.</p>
            <div className="flex flex-wrap gap-2">
              {recent.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  disabled={busy || Boolean(pickingId)}
                  onClick={() => pickRecent(row)}
                  className="relative flex h-16 w-32 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-1 hover:border-brand hover:ring-2 hover:ring-brand/20 disabled:opacity-50"
                  title={row.signerName ? `Signed as ${row.signerName}` : 'Your signature'}
                  aria-label="Use this signature"
                >
                  {row.url ? <img src={row.url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">Signature</span>}
                  {pickingId === row.id ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="h-4 w-4 animate-spin" /></span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              freezeDraft();
              setPadClearToken((token) => token + 1);
            }}
          >
            Add another
          </Button>
          <p className="text-xs text-muted-foreground">
            {placements.length
              ? `${placements.length} mark${placements.length === 1 ? '' : 's'} ready to save.`
              : 'Nothing placed yet.'}
          </p>
        </div>
        {placements.length ? (
          <ul className="space-y-1">
            {placements.map((item) => {
              const pages = item.pages || [item.pageIndex];
              const allPages = pageCount > 1 && pages.length === pageCount;
              return (
                <li key={item.id} className="space-y-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => changePage(pages.includes(viewPage) ? viewPage : pages[0])}
                    >
                      <span className="font-medium">{placementLabel(item.mode)}</span>
                      {item.sourceId ? <span className="text-muted-foreground"> · recent</span> : null}
                      <span className="text-muted-foreground">
                        {' '}· {pages.length === 1 ? `Page ${pages[0] + 1}` : `${pages.length} pages`}
                      </span>
                      {item.id === activeId ? <span className="text-muted-foreground"> · editing</span> : null}
                    </button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => removePlacement(item.id)}>
                      Remove
                    </Button>
                  </div>
                  {pageCount > 1 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-xs text-muted-foreground">Put on pages:</span>
                      {Array.from({ length: pageCount }, (_, i) => {
                        const on = pages.includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={busy}
                            aria-pressed={on}
                            onClick={() => togglePage(item.id, i)}
                            className={on
                              ? 'h-7 min-w-7 rounded-md bg-slate-900 px-2 text-xs font-semibold text-white'
                              : 'h-7 min-w-7 rounded-md border border-border bg-white px-2 text-xs text-slate-600 hover:border-slate-400'}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setAllPages(item.id, !allPages)}
                        className="ml-1 h-7 rounded-md px-2 text-xs font-medium text-brand hover:underline"
                      >
                        {allPages ? 'Only this page' : 'All pages'}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {showSignerName ? (
          <div>
            <Label htmlFor="endorsement-signer">Signer name</Label>
            <Input
              id="endorsement-signer"
              className="mt-1"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              disabled={busy}
            />
          </div>
        ) : null}
        {pageCount > 1 ? (
          <div>
            <Label htmlFor="endorsement-page">Page</Label>
            <select
              id="endorsement-page"
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={viewPage}
              disabled={busy}
              onChange={(e) => changePage(e.target.value)}
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <option key={i} value={i}>
                  Page {i + 1}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {loadingPdf ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing the stored PDF…
          </p>
        ) : pdfUrl ? (
          <EndorsementPreview
            pdfUrl={pdfUrl}
            stamps={visibleStamps}
            pageIndex={viewPage}
            showFooterGuide={showFooterGuide}
            onChangePosition={({ id, xPct, yPct }) => {
              setPlacements((prev) => prev.map((item) => (item.id === id ? { ...item, xPct, yPct } : item)));
            }}
            onPageCount={setPageCount}
          />
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {allowSkip ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onSkip?.();
                onClose?.();
              }}
            >
              Skip
            </Button>
          ) : null}
          <Button type="button" disabled={busy || loadingPdf || !placements.length} onClick={confirm}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {busyLabel || 'Adding…'}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
