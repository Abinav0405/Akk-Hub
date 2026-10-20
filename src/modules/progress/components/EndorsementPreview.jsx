import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FOOTER_LINE_YPCT } from '@/modules/progress/lib/documentEndorsement';

GlobalWorkerOptions.workerSrc = pdfWorker;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export default function EndorsementPreview({
  pdfUrl,
  stamps = [],
  pageIndex = 0,
  /** True only when the PDF still draws a Signature / Company seal footer line. */
  showFooterGuide = true,
  onChangePosition,
  onPageCount,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef('');
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;
  const [pageCount, setPageCount] = useState(1);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!pdfUrl) return undefined;
    setRendering(true);
    setError('');
    (async () => {
      try {
        const pdf = await getDocument({ url: pdfUrl, withCredentials: false }).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        onPageCountRef.current?.(pdf.numPages);
        const idx = clamp((Number(pageIndex) || 0) + 1, 1, pdf.numPages);
        const page = await pdf.getPage(idx);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const width = wrapRef.current?.clientWidth || 560;
        // Render at the screen's pixel density so the preview (and the marks on it) are sharp.
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const viewport = page.getViewport({ scale: (width / unscaled.width) * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not preview the PDF');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageIndex]);

  const moveFromEvent = (e, id) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || !id) return;
    onChangePosition?.({
      id,
      xPct: clamp(((e.clientX - box.left) / box.width) * 100, 4, 96),
      yPct: clamp(((e.clientY - box.top) / box.height) * 100, 4, 97),
    });
  };

  const onPointerDown = (e) => {
    const hit = e.target?.closest?.('[data-stamp-id]');
    const hitId = hit?.getAttribute('data-stamp-id') || '';
    const activeId = stamps.find((stamp) => stamp.active)?.id || '';
    const targetId = hitId || activeId;
    if (!targetId || !onChangePosition) return;
    if (!hitId && e.target !== canvasRef.current && e.target !== wrapRef.current) return;
    dragRef.current = targetId;
    wrapRef.current?.setPointerCapture?.(e.pointerId);
    moveFromEvent(e, targetId);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    moveFromEvent(e, dragRef.current);
  };

  const onPointerUp = () => {
    dragRef.current = '';
  };

  const active = stamps.find((stamp) => stamp.active) || stamps[0];
  const noun = stamps.length > 1 ? 'marks' : (active?.mode === 'seal' ? 'seal' : 'signature');

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {stamps.length
          ? (showFooterGuide
            ? `Hold and drag the ${noun} onto the footer line (or anywhere on the page).`
            : `Hold and drag the ${noun} onto the Submitted by / Checked by area (or anywhere on the page).`)
          : 'Draw or upload a signature or company seal, then drag it into place.'}
        {pageCount > 1 ? ` Page ${(Number(pageIndex) || 0) + 1} of ${pageCount}. Marks already placed on other pages stay there.` : ''}
      </p>
      <div
        ref={wrapRef}
        className="relative touch-none overflow-hidden rounded-lg border border-border bg-slate-100"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} className="block w-full" />
        {showFooterGuide ? (
          <div
            className="pointer-events-none absolute left-[6%] right-[6%] border-t border-slate-800/70"
            style={{ top: `${FOOTER_LINE_YPCT}%` }}
          >
            <span className="absolute -top-4 left-0 text-[10px] uppercase tracking-wide text-slate-500">
              Signature / Company seal
            </span>
          </div>
        ) : null}
        {stamps.map((stamp) => (
          <img
            key={stamp.id}
            src={stamp.imageUrl}
            alt=""
            data-stamp-id={stamp.id}
            draggable={false}
            className={`absolute max-h-24 cursor-grab object-contain drop-shadow-sm ${stamp.active ? 'z-10 ring-2 ring-brand' : 'z-[1]'}`}
            style={{
              left: `${stamp.xPct}%`,
              top: `${stamp.yPct}%`,
              width: `${18 * (Number(stamp.scale) || 1)}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {rendering ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-muted-foreground">
            Loading page preview…
          </div>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
