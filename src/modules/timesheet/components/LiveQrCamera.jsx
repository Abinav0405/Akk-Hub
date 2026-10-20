import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import jsQR from 'jsqr';
import { CameraOff, Flashlight, Images, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { cn } from '@/modules/timesheet/lib/utils';
import { requestCameraPermissionWithFallback } from '@/core/permissionManager';

const FILE_SCAN_CONFIG = {
    verbose: false,
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    useBarCodeDetectorIfSupported: false,
};

function decodeCanvas(canvas) {
    if (!canvas?.width || !canvas?.height) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
    });
    return result?.data?.trim() || null;
}

async function decodeWithBarcodeDetector(source) {
    try {
        if (typeof window.BarcodeDetector !== 'function') return null;
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (!formats.includes('qr_code')) return null;
        const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(source);
        return codes?.[0]?.rawValue ? String(codes[0].rawValue).trim() : null;
    } catch {
        return null;
    }
}

async function decodeQrFromFile(file, hostId) {
    if (!file) return null;

    try {
        const bitmap = await createImageBitmap(file);
        try {
            const native = await decodeWithBarcodeDetector(bitmap);
            if (native) return native;
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0);
            const fromJs = decodeCanvas(canvas);
            if (fromJs) return fromJs;
        } finally {
            bitmap.close?.();
        }
    } catch {
        /* fall through */
    }

    const scanner = new Html5Qrcode(hostId, FILE_SCAN_CONFIG);
    try {
        const text = await scanner.scanFile(file, false);
        return text ? String(text).trim() : null;
    } finally {
        try { scanner.clear(); } catch { /* ignore */ }
    }
}

async function openCameraStream() {
    const granted = await requestCameraPermissionWithFallback();
    if (!granted) {
        const err = new Error('Camera permission is needed to scan.');
        err.name = 'NotAllowedError';
        throw err;
    }

    const attempts = [
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: 'environment' }, audio: false },
        { video: true, audio: false },
    ];
    let lastError = null;
    for (const constraints of attempts) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('Could not start the camera.');
}

export default function LiveQrCamera({
    onDecoded,
    disabled = false,
    busy = false,
    hint = 'Point the camera at the QR code',
    gpsLabel = null,
    className,
}) {
    const fileHostIdRef = useRef(`qr-file-${Math.random().toString(36).slice(2)}`);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const onDecodedRef = useRef(onDecoded);
    const lockedRef = useRef(false);
    const streamRef = useRef(null);
    const fileInputRef = useRef(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);
    const [torchOn, setTorchOn] = useState(false);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [readingFile, setReadingFile] = useState(false);
    const [restartKey, setRestartKey] = useState(0);

    onDecodedRef.current = onDecoded;

    const retry = () => {
        lockedRef.current = false;
        setError(null);
        setReady(false);
        setTorchOn(false);
        setTorchAvailable(false);
        setRestartKey((n) => n + 1);
    };

    useEffect(() => {
        if (disabled) return undefined;

        let cancelled = false;
        let timer = null;
        lockedRef.current = false;

        const stopTracks = (stream) => {
            stream?.getTracks?.().forEach((track) => {
                try { track.stop(); } catch { /* ignore */ }
            });
        };

        const emit = (text) => {
            if (cancelled || lockedRef.current || !text) return;
            lockedRef.current = true;
            if (timer) window.clearTimeout(timer);
            stopTracks(streamRef.current);
            streamRef.current = null;
            onDecodedRef.current?.(text);
        };

        const tick = () => {
            if (cancelled || lockedRef.current) return;
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
                const maxW = 1280;
                const scale = Math.min(1, maxW / video.videoWidth);
                canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
                canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const text = decodeCanvas(canvas);
                if (text) {
                    emit(text);
                    return;
                }
            }
            timer = window.setTimeout(tick, 70);
        };

        const start = async () => {
            setError(null);
            setReady(false);
            try {
                const stream = await openCameraStream();
                if (cancelled) {
                    stopTracks(stream);
                    return;
                }
                streamRef.current = stream;
                const video = videoRef.current;
                if (!video) {
                    stopTracks(stream);
                    throw new Error('Camera view is not ready.');
                }
                video.srcObject = stream;
                video.setAttribute('playsinline', 'true');
                video.muted = true;
                await video.play();
                if (cancelled) return;

                const track = stream.getVideoTracks()[0];
                if (track?.getCapabilities?.()?.torch) setTorchAvailable(true);

                setReady(true);
                timer = window.setTimeout(tick, 120);
            } catch (err) {
                if (cancelled) return;
                setError(err?.name === 'NotAllowedError'
                    ? 'Camera permission is needed to scan.'
                    : 'Could not start the camera. Check permissions and try again.');
            }
        };

        void start();

        return () => {
            cancelled = true;
            if (timer) window.clearTimeout(timer);
            stopTracks(streamRef.current);
            streamRef.current = null;
            const video = videoRef.current;
            if (video) video.srcObject = null;
        };
    }, [disabled, restartKey]);

    const toggleTorch = async () => {
        const next = !torchOn;
        try {
            const track = streamRef.current?.getVideoTracks?.()[0];
            if (!track?.getCapabilities?.()?.torch) {
                setTorchAvailable(false);
                return;
            }
            await track.applyConstraints({ advanced: [{ torch: next }] });
            setTorchOn(next);
        } catch {
            setTorchAvailable(false);
        }
    };

    const openGallery = () => {
        if (disabled || busy || readingFile) return;
        fileInputRef.current?.click();
    };

    const onFilePicked = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || disabled || busy || lockedRef.current) return;

        setReadingFile(true);
        try {
            const text = await decodeQrFromFile(file, fileHostIdRef.current);
            if (!text) {
                toast.error('No QR code found in that image. Try a clearer photo.');
                return;
            }
            lockedRef.current = true;
            streamRef.current?.getTracks?.().forEach((track) => {
                try { track.stop(); } catch { /* ignore */ }
            });
            streamRef.current = null;
            onDecodedRef.current?.(text);
        } catch {
            toast.error('Could not read that image. Pick another photo of the QR code.');
        } finally {
            setReadingFile(false);
        }
    };

    const overlayBusy = busy || readingFile;

    return (
        <div className={cn('space-y-2', className)}>
            <div className="qr-live">
                <video
                    ref={videoRef}
                    className="qr-live__video"
                    playsInline
                    muted
                    autoPlay
                />
                <canvas ref={canvasRef} className="qr-live__decode-canvas" aria-hidden="true" />
                <div id={fileHostIdRef.current} className="qr-live__file-host" aria-hidden="true" />

                {!ready && !error ? (
                    <div className="qr-live__status">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Starting camera…
                    </div>
                ) : null}

                {error ? (
                    <div className="qr-live__status qr-live__status--error">
                        <CameraOff className="h-5 w-5" />
                        <p>{error}</p>
                        <Button type="button" size="sm" className="mt-2 h-9 rounded-xl bg-white text-slate-900 hover:bg-slate-100" onClick={retry}>
                            Try again
                        </Button>
                    </div>
                ) : null}

                {overlayBusy ? (
                    <div className="qr-live__status">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {readingFile ? 'Reading photo…' : 'Checking…'}
                    </div>
                ) : null}

                {torchAvailable && ready && !error ? (
                    <button
                        type="button"
                        onClick={toggleTorch}
                        className={cn(
                            'absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 backdrop-blur-md',
                            torchOn ? 'bg-amber-400 text-slate-900' : 'bg-black/45 text-white',
                        )}
                        aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
                    >
                        <Flashlight className="h-4 w-4" />
                    </button>
                ) : null}
            </div>

            <p className="px-0.5 text-xs text-slate-500">
                {overlayBusy
                    ? (readingFile ? 'Reading photo…' : 'Checking…')
                    : hint}
                {gpsLabel ? ` · ${gpsLabel}` : ''}
            </p>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                onChange={onFilePicked}
            />

            <Button
                type="button"
                variant="outline"
                disabled={disabled || busy || readingFile}
                onClick={openGallery}
                className="h-11 w-full rounded-xl border-slate-200/90 bg-white text-slate-800"
            >
                <Images className="mr-2 h-4 w-4" />
                Scan photo from gallery
            </Button>
        </div>
    );
}
