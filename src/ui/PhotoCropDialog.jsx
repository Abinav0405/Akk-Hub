/**
 * Crop a picked photo to the passport frame (4:5): drag to move, slider / pinch-free zoom, then "Use photo".
 * Output is the same ~360×450 JPEG data URL the rest of the app stores. Runs on the device.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';

const FRAME_W = 264;
const FRAME_H = 330;
const OUT_W = 360;
const OUT_H = 450;

export default function PhotoCropDialog({ file, onCancel, onDone, busy = false }) {
    const [img, setImg] = useState(null);
    const [error, setError] = useState('');
    const [zoom, setZoom] = useState(1);
    const [off, setOff] = useState({ x: 0, y: 0 });
    const drag = useRef(null);
    const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

    useEffect(() => {
        if (!url) return undefined;
        let live = true;
        setImg(null);
        setError('');
        setZoom(1);
        setOff({ x: 0, y: 0 });
        const el = new Image();
        el.onload = () => live && setImg(el);
        el.onerror = () => live && setError('Could not read that image.');
        el.src = url;
        return () => {
            live = false;
            URL.revokeObjectURL(url);
        };
    }, [url]);

    const cover = img ? Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight) : 1;
    const scale = cover * zoom;
    const clamp = (o, z = zoom) => {
        if (!img) return o;
        const s = cover * z;
        const mx = Math.max(0, (img.naturalWidth * s - FRAME_W) / 2);
        const my = Math.max(0, (img.naturalHeight * s - FRAME_H) / 2);
        return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
    };

    const onDown = (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
    };
    const onMove = (e) => {
        if (!drag.current) return;
        setOff(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }));
    };
    const onUp = () => {
        drag.current = null;
    };
    const changeZoom = (z) => {
        const next = Math.min(4, Math.max(1, z));
        setZoom(next);
        setOff((o) => clamp(o, next));
    };

    const confirm = () => {
        if (!img) return;
        const sw = FRAME_W / scale;
        const sh = FRAME_H / scale;
        const sx = img.naturalWidth / 2 - sw / 2 - off.x / scale;
        const sy = img.naturalHeight / 2 - sh / 2 - off.y / scale;
        const canvas = document.createElement('canvas');
        canvas.width = OUT_W;
        canvas.height = OUT_H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, OUT_W, OUT_H);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
        onDone(canvas.toDataURL('image/jpeg', 0.82));
    };

    return (
        <Dialog open={Boolean(file)} onOpenChange={(o) => !o && !busy && onCancel()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Crop your photo</DialogTitle>
                    <DialogDescription>Drag to move the photo, use the slider to zoom. Your face should fill the frame.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center gap-3">
                    <div
                        className="relative touch-none select-none overflow-hidden rounded-xl bg-slate-100 ring-2 ring-[var(--g-brand)]"
                        style={{ width: FRAME_W, height: FRAME_H, cursor: img ? 'grab' : 'default' }}
                        onPointerDown={onDown}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                    >
                        {img ? (
                            <img
                                src={url}
                                alt="Photo to crop"
                                draggable={false}
                                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                                style={{
                                    width: img.naturalWidth * scale,
                                    height: img.naturalHeight * scale,
                                    transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
                                }}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-sm text-slate-500">{error || <Loader2 className="h-5 w-5 animate-spin" />}</div>
                        )}
                    </div>
                    <div className="flex w-full items-center gap-2">
                        <ZoomOut className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                        <input type="range" min="1" max="4" step="0.02" value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} aria-label="Zoom" className="h-8 w-full accent-[var(--g-brand)]" disabled={!img} />
                        <ZoomIn className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={confirm} disabled={!img || busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Use photo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
