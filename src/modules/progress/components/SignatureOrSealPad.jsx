import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';
import { blobFromUrl, getLastCompanySeal } from '@/modules/progress/lib/documentEndorsement';

// The pad is drawn at the screen's real pixel density (at least 3x its CSS size) and
// matches its on-screen shape, so strokes are not stretched or upscaled. The saved PNG is
// trimmed to the ink, so the mark fills its stamp box on the PDF instead of being a small
// signature inside a mostly empty image.
const MIN_PAD_SCALE = 3;
const BASE_LINE = { signature: 2.4, seal: 3.2 };
const TRIM_PAD_CSS = 10;

function padScale() {
  return Math.max(MIN_PAD_SCALE, Math.min(4, window.devicePixelRatio || 1));
}

/** Smallest box around every non-transparent pixel, plus a margin. Null when empty. */
function inkBounds(canvas, margin) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  return {
    x,
    y,
    w: Math.min(width, maxX + margin + 1) - x,
    h: Math.min(height, maxY + margin + 1) - y,
  };
}

function fileToPngBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Seals are printed ~4 cm wide; 1600 px keeps fine print in the seal sharp.
      const maxW = 1600;
      const scale = Math.min(1, maxW / Math.max(img.naturalWidth, 1));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

export default function SignatureOrSealPad({
  mode,
  onModeChange,
  onImageReady,
  onDiscard,
  clearToken = 0,
  companyId,
  disabled = false,
}) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const inkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [hint, setHint] = useState('');

  const currentMode = mode === 'seal' ? 'seal' : 'signature';

  const resetPreview = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  };

  const wipeSurface = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    inkRef.current = false;
    setHasInk(false);
    resetPreview();
    setHint('');
  };

  const clearCanvas = () => {
    wipeSurface();
    onDiscard?.();
  };

  useEffect(() => () => resetPreview(), []);

  // Match the backing store to the element's real size x pixel density. Only while empty —
  // resizing a canvas wipes it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const fit = () => {
      if (inkRef.current) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const s = padScale();
      const w = Math.round(rect.width * s);
      const h = Math.round(rect.height * s);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    wipeSurface();
    // Switching signature/seal starts a new mark. Queued stamps stay in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode]);

  useEffect(() => {
    if (!clearToken) return;
    wipeSurface();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearToken]);

  const point = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const emitCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !inkRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : padScale();
    const box = inkBounds(canvas, Math.round(TRIM_PAD_CSS * scale));
    if (!box) return;
    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const dataUrl = out.toDataURL('image/png');
    const binary = atob(dataUrl.split(',')[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    onImageReady?.(new Blob([bytes], { type: 'image/png' }), currentMode);
  };

  const onPointerDown = (e) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    drawing.current = true;
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width ? canvas.width / rect.width : padScale();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = (currentMode === 'seal' ? BASE_LINE.seal : BASE_LINE.signature) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const onPointerMove = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inkRef.current = true;
    setHasInk(true);
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      emitCanvas();
    } catch {
      // Ignore a failed capture; the user can draw again.
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await fileToPngBlob(file);
      resetPreview();
      setPreviewUrl(URL.createObjectURL(blob));
      inkRef.current = true;
      setHasInk(true);
      setHint('');
      onImageReady?.(blob, currentMode);
    } catch (err) {
      setHint(err.message || 'Could not read that image');
    }
  };

  const useLastSeal = async () => {
    if (!companyId) return;
    try {
      const last = await getLastCompanySeal(companyId);
      if (!last?.url) {
        setHint('No saved company seal yet');
        return;
      }
      const blob = await blobFromUrl(last.url);
      resetPreview();
      setPreviewUrl(URL.createObjectURL(blob));
      inkRef.current = true;
      setHasInk(true);
      onImageReady?.(blob, 'seal');
      setHint('Using the last company seal');
    } catch (err) {
      setHint(err.message || 'Could not load the last seal');
    }
  };

  return (
    <div className="space-y-3">
      <Tabs value={currentMode} onValueChange={(v) => onModeChange?.(v === 'seal' ? 'seal' : 'signature')}>
        <TabsList>
          <TabsTrigger value="signature">Draw signature</TabsTrigger>
          <TabsTrigger value="seal">Company seal</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">
        {currentMode === 'seal'
          ? 'Upload a company seal, reuse the last one, or sketch a stamp.'
          : 'Sign in the box. Hold and draw with a finger or mouse.'}
      </p>
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border border-input bg-white"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {previewUrl ? <img src={previewUrl} alt="" className="max-h-24 object-contain" /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={clearCanvas} disabled={disabled}>
          Clear
        </Button>
        <Label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-input px-3 text-sm">
          {currentMode === 'seal' ? 'Upload seal' : 'Upload image'}
          <input type="file" accept="image/*" className="sr-only" disabled={disabled} onChange={onUpload} />
        </Label>
        {currentMode === 'seal' && companyId ? (
          <Button type="button" size="sm" variant="outline" onClick={useLastSeal} disabled={disabled}>
            Use last seal
          </Button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {hasInk ? null : <p className="text-xs text-muted-foreground">Nothing captured yet.</p>}
    </div>
  );
}
