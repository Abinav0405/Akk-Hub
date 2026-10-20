import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { toast } from 'sonner';
import { X, RotateCcw, Check, Loader2, SwitchCamera, MapPin, Zap, ZapOff } from 'lucide-react';
import { cn } from '@/modules/progress/lib/utils';
import { PHOTO_ASPECT_RATIO, MAX_PHOTOS_PER_STAGE, PHOTO_CAPTURE_MAX_WIDTH } from '@/modules/progress/lib/config';
import { buildOverlayLayout } from '@/modules/progress/lib/overlayText';
import { snapshotToCanvas, paintCaptureOverlays, canvasToJpegBlob, getBrandLogoImage, drawVerificationMark, loadImageFromFile } from '@/modules/progress/lib/canvasOverlay';
import { generateVerificationCode } from '@/modules/progress/lib/verificationCode';
import { sha256Hex, dHashFromCanvas } from '@/modules/progress/lib/photoHash';
import { getCompanyBranding, brandingLogoUrl, DEFAULT_BRANDING } from '@/modules/progress/lib/branding';
import { reverseGeocode } from '@/modules/progress/lib/geocode';
import { setStatusBarDark, setStatusBarLight } from '@/core/nativeBootstrap';
import { pushNativeBackHandler } from '@/core/nativeBack';
import {
    openCameraStream,
    attachStreamToVideo,
    detachStreamFromVideo,
    listVideoCameras,
    friendlyCameraName,
    readTrackZoom,
    applyTrackZoom,
    formatZoomLabel,
    discoverUltraWide,
} from '@/modules/progress/lib/cameraStream';
import {
    nativeForcesDigitalZoom,
    canvasFromZoomedPreview,
    startNativeUltraWidePreview,
    stopNativeUltraWidePreview,
    captureNativeUltraWideStill,
} from '@/modules/progress/lib/capacitorCamera';

const DIGITAL_ZOOM_MAX = 8;

/** Turn the camera's light on/off. True only if the camera reports it actually changed. */
async function setTorch(stream, on) {
    const track = stream?.getVideoTracks?.()?.[0];
    if (!track?.applyConstraints) return false;
    try {
        await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
    } catch {
        return false;
    }
    const applied = track.getSettings?.()?.torch;
    // Some WebViews do not echo `torch` back in getSettings; trust the call then.
    return applied === undefined ? true : Boolean(applied) === Boolean(on);
}

function streamHasTorch(stream) {
    const track = stream?.getVideoTracks?.()?.[0];
    try {
        return Boolean(track?.getCapabilities?.()?.torch);
    } catch {
        return false;
    }
}
// Shots still being burned/encoded in the background. Further taps are ignored
// past this so a burst can't pile up full-size canvases on a low-memory phone.
const MAX_PENDING_CAPTURES = 3;

/** Lets the shutter flash + placeholder tile paint before heavy canvas work starts. */
function yieldToPaint() {
    return new Promise((resolve) => {
        const fallback = setTimeout(resolve, 100);
        requestAnimationFrame(() => setTimeout(() => {
            clearTimeout(fallback);
            resolve();
        }, 0));
    });
}

function touchDistance(a, b) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
}

async function readFreshGps() {
    const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('GPS coordinates unavailable');
    }
    let address = null;
    try {
        address = await reverseGeocode(lat, lng);
    } catch {
        address = null;
    }
    return { lat, lng, accuracy: pos.coords.accuracy, address };
}

/**
 * Live camera viewfinder (picture + chrome only). Branding, overlay wording,
 * GPS, and barcode are burned into the JPEG after capture: the shutter freezes
 * the frame instantly and the burn-in + encode finish in the background.
 * Front / rear / extra lenses can be chosen in the viewfinder.
 * getUserMedia is used (not the Capacitor Camera plugin, which hands off to
 * the OS camera UI).
 */
export default function CameraCapture({
    lcbId,
    sectionLabel,
    siteName,
    stage,
    initialPhotos = [],
    active = true,
    onDone,
    onCancel,
}) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const viewfinderRef = useRef(null);
    const frameRef = useRef(null);
    // The exact rectangle the saved photo covers (PHOTO_ASPECT_RATIO), fitted
    // inside the viewfinder area. The live picture is drawn only inside it, so
    // what the worker frames is what the JPEG contains.
    const [frameBox, setFrameBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
    const [cameraError, setCameraError] = useState(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [position, setPosition] = useState(null);
    const [address, setAddress] = useState(null);
    const [locating, setLocating] = useState(true);
    const [branding, setBranding] = useState(DEFAULT_BRANDING);
    const [photos, setPhotos] = useState(() => initialPhotos);
    // Always current (state lags a render) — background jobs and Done read this.
    const photosRef = useRef(initialPhotos);
    const queueRef = useRef(Promise.resolve());
    const pendingCountRef = useRef(0);
    const cancelledShotsRef = useRef(new Set());
    const shotSeqRef = useRef(0);
    const unmountedRef = useRef(false);
    const [finishing, setFinishing] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [session, setSession] = useState(0);
    // '' = "let the app choose" (rear main lens). Only an explicit pick from the
    // camera list sets an id; nothing is remembered across sessions.
    const [deviceId, setDeviceId] = useState('');
    const [activeDeviceId, setActiveDeviceId] = useState('');
    const [facingIntent, setFacingIntent] = useState('environment');
    const [streamFacing, setStreamFacing] = useState('environment');
    const [cameras, setCameras] = useState([]);
    const [showCameraPicker, setShowCameraPicker] = useState(false);
    const [foreground, setForeground] = useState(true);
    const [shutterFlash, setShutterFlash] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [zoomCaps, setZoomCaps] = useState({ supported: false, min: 1, max: 1 });
    const [pinching, setPinching] = useState(false);
    const [lens, setLens] = useState('wide');
    const [ultraSupport, setUltraSupport] = useState(null);
    const [useNativePreview, setUseNativePreview] = useState(false);
    // Flash: the camera light stays on while this is on (through every shot) until it is turned
    // off or the camera closes. Only shown when the current lens has a light.
    const [torchSupported, setTorchSupported] = useState(false);
    const [flashOn, setFlashOn] = useState(false);
    const flashOnRef = useRef(false);
    flashOnRef.current = flashOn;
    const capturingRef = useRef(false);
    const shutterFromPointerRef = useRef(false);
    const positionRef = useRef(position);
    const addressRef = useRef(address);
    const zoomRef = useRef(1);
    const zoomCapsRef = useRef({ supported: false, min: 1, max: 1 });
    const pinchRef = useRef(null);
    const zoomRafRef = useRef(null);
    const pendingZoomRef = useRef(null);
    const nativeImgRef = useRef(null);
    const nativeUrlRef = useRef('');
    const nativePreviewBlobRef = useRef(null);
    const ultraSupportRef = useRef(null);
    const lensRef = useRef('wide');
    const useNativePreviewRef = useRef(false);
    positionRef.current = position;
    addressRef.current = address;
    zoomRef.current = zoom;
    zoomCapsRef.current = zoomCaps;
    ultraSupportRef.current = ultraSupport;
    lensRef.current = lens;
    useNativePreviewRef.current = useNativePreview;

    const revokeNativePreviewUrl = useCallback(() => {
        if (nativeUrlRef.current) {
            URL.revokeObjectURL(nativeUrlRef.current);
            nativeUrlRef.current = '';
        }
        nativePreviewBlobRef.current = null;
    }, []);

    // Fit a PHOTO_ASPECT_RATIO box inside the viewfinder area (letterboxed, centred).
    // Re-measured on rotate / resize so it always matches what capture will crop.
    useLayoutEffect(() => {
        const el = viewfinderRef.current;
        if (!el) return undefined;
        const measure = () => {
            const aw = el.clientWidth;
            const ah = el.clientHeight;
            if (!aw || !ah) return;
            let w = aw;
            let h = w / PHOTO_ASPECT_RATIO;
            if (h > ah) {
                h = ah;
                w = h * PHOTO_ASPECT_RATIO;
            }
            w = Math.round(w);
            h = Math.round(h);
            const x = Math.round((aw - w) / 2);
            const y = Math.round((ah - h) / 2);
            setFrameBox((prev) => (
                prev.w === w && prev.h === h && prev.x === x && prev.y === y ? prev : { x, y, w, h }
            ));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        getCompanyBranding({ force: true })
            .then((row) => {
                if (cancelled) return;
                setBranding(row);
                getBrandLogoImage(brandingLogoUrl(row));
            })
            .catch(() => {
                if (!cancelled) getBrandLogoImage();
            });
        return () => {
            cancelled = true;
        };
    }, [active]);

    // Stop the camera + GPS when the viewfinder stays covered (app switched away).
    // Do not use Capacitor appStateChange, and debounce visibilitychange — the
    // CAMERA permission dialog can hide the document briefly and would otherwise
    // cancel the first getUserMedia right after Allow.
    useEffect(() => {
        if (!active) return undefined;
        let hideTimer = null;
        const onVis = () => {
            if (typeof document === 'undefined' || !document.hidden) {
                if (hideTimer) {
                    clearTimeout(hideTimer);
                    hideTimer = null;
                }
                setForeground(true);
                return;
            }
            hideTimer = setTimeout(() => setForeground(false), 1200);
        };
        document.addEventListener('visibilitychange', onVis);
        return () => {
            if (hideTimer) clearTimeout(hideTimer);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, [active]);

    // One high-accuracy lock when the viewfinder opens, then cheap refreshes.
    // A continuous high-accuracy GPS watch keeps the radio hot and overheats phones.
    useEffect(() => {
        if (!active || !foreground) return undefined;

        let cancelled = false;
        let refreshTimer = null;
        let lastGeocodeAt = 0;
        let lastGeocodeLat = null;
        let lastGeocodeLng = null;
        let geocodeSeq = 0;

        const maybeGeocode = (lat, lng) => {
            const ts = Date.now();
            const movedFar =
                lastGeocodeLat == null ||
                Math.abs(lat - lastGeocodeLat) > 0.0003 ||
                Math.abs(lng - lastGeocodeLng) > 0.0003;
            if (!movedFar && ts - lastGeocodeAt < 20000) return;
            lastGeocodeAt = ts;
            lastGeocodeLat = lat;
            lastGeocodeLng = lng;
            const seq = ++geocodeSeq;
            reverseGeocode(lat, lng)
                .then((addr) => {
                    if (!cancelled && seq === geocodeSeq) setAddress(addr);
                })
                .catch(() => {});
        };

        const applyFix = (pos) => {
            const lat = pos?.coords?.latitude;
            const lng = pos?.coords?.longitude;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                setLocating(false);
                return false;
            }
            setPosition({ lat, lng, accuracy: Number.isFinite(pos.coords?.accuracy) ? pos.coords.accuracy : null });
            setLocating(false);
            maybeGeocode(lat, lng);
            return true;
        };

        const readPosition = async ({ highAccuracy, maximumAge, timeout }) => {
            const pos = await Geolocation.getCurrentPosition({
                enableHighAccuracy: highAccuracy,
                timeout,
                maximumAge,
            });
            if (!cancelled) applyFix(pos);
        };

        (async () => {
            try {
                if (Capacitor.isNativePlatform()) {
                    await Geolocation.requestPermissions();
                }
                await readPosition({ highAccuracy: true, maximumAge: 5000, timeout: 15000 });
            } catch (e) {
                console.warn('[CameraCapture] location unavailable:', e);
                if (!cancelled) setLocating(false);
            }
            if (cancelled) return;
            refreshTimer = setInterval(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                readPosition({ highAccuracy: false, maximumAge: 20000, timeout: 8000 }).catch(() => {});
            }, 20000);
        })();

        return () => {
            cancelled = true;
            if (refreshTimer) clearInterval(refreshTimer);
        };
    }, [active, foreground]);

    useEffect(() => {
        if (!active || !foreground) return undefined;

        let cancelled = false;
        setCameraError(null);
        setCameraReady(false);

        const bindGumStream = async (stream, { uiZoom, persistId, facingOverride, skipTrackZoom } = {}) => {
            if (cancelled) {
                detachStreamFromVideo(null, stream);
                return false;
            }
            streamRef.current = stream;
            const el = videoRef.current;
            await attachStreamToVideo(el, stream);
            if (cancelled) {
                detachStreamFromVideo(el, stream);
                streamRef.current = null;
                return false;
            }
            const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
            const liveId = settings.deviceId || persistId || deviceId;
            const openedFacing = facingOverride || (settings.facingMode === 'user' ? 'user' : 'environment');
            const devices = await listVideoCameras();
            const forceDigitalZoom = nativeForcesDigitalZoom();
            let range = forceDigitalZoom
                ? { supported: false, min: 1, max: 1, value: 1 }
                : readTrackZoom(stream);
            let startZoom = uiZoom != null
                ? uiZoom
                : (range.supported && range.min <= 1 && range.max >= 1 ? 1 : range.value || 1);
            const pending = pendingZoomRef.current;
            pendingZoomRef.current = null;
            if (pending != null && pending >= 1) startZoom = pending;
            if (range.supported && uiZoom == null) {
                const applied = await applyTrackZoom(stream, startZoom);
                if (!applied) {
                    range = { supported: false, min: 1, max: 1, value: 1 };
                    startZoom = pending != null && pending >= 1 ? pending : 1;
                }
            } else if (range.supported && uiZoom != null && !skipTrackZoom) {
                const applied = await applyTrackZoom(stream, uiZoom);
                if (!applied && lensRef.current === 'ultra') {
                    detachStreamFromVideo(el, stream);
                    streamRef.current = null;
                    throw new Error('Hardware ultra-wide zoom was not applied');
                }
            }
            if (cancelled) {
                detachStreamFromVideo(el, stream);
                streamRef.current = null;
                return false;
            }
            setCameras(devices);
            setZoomCaps(range);
            zoomCapsRef.current = range;
            zoomRef.current = startZoom;
            setZoom(startZoom);
            setStreamFacing(openedFacing);
            const listed = devices.some((d) => d.deviceId && d.deviceId === liveId);
            const uiId = (persistId && devices.some((d) => d.deviceId === persistId))
                ? persistId
                : (listed ? liveId : persistId || liveId);
            if (uiId) setActiveDeviceId(uiId);
            const support = await discoverUltraWide(stream, devices);
            if (!cancelled) setUltraSupport(support);
            // A new stream starts with the light off; put it back on if Flash is on.
            const hasTorch = streamHasTorch(stream);
            setTorchSupported(hasTorch);
            if (hasTorch && flashOnRef.current) {
                const lit = await setTorch(stream, true);
                if (!lit && !cancelled) setFlashOn(false);
            } else if (!hasTorch && flashOnRef.current && !cancelled) {
                setFlashOn(false);
            }
            setUseNativePreview(false);
            setCameraReady(true);
            return true;
        };

        (async () => {
            try {
                await stopNativeUltraWidePreview();
                if (cancelled) return;
                const support = ultraSupportRef.current;
                const wantNativeUltra = lens === 'ultra' && support?.method === 'native';
                await new Promise((r) => setTimeout(r, wantNativeUltra ? 280 : 160));
                if (cancelled) return;

                if (lens === 'ultra') {
                    if (!support?.available) {
                        setLens('wide');
                        return;
                    }

                    if (support.method === 'device' && support.deviceId) {
                        try {
                            const stream = await openCameraStream(support.deviceId, {
                                facing: 'environment',
                                requireDevice: true,
                            });
                            const bound = await bindGumStream(stream, {
                                uiZoom: 0.5,
                                persistId: support.deviceId,
                                facingOverride: 'environment',
                                skipTrackZoom: true,
                            });
                            if (bound) {
                                setZoomCaps({ supported: false, min: 1, max: 1, value: 1 });
                                zoomCapsRef.current = { supported: false, min: 1, max: 1, value: 1 };
                            }
                            return;
                        } catch (e) {
                            console.warn('[camera-ultra] getUserMedia ultra-wide failed:', e);
                            if (!Capacitor.isNativePlatform()) {
                                throw e;
                            }
                        }
                    }

                    if (support.method === 'zoom' && support.zoom != null) {
                        const stream = await openCameraStream(deviceId, { facing: 'environment' });
                        await bindGumStream(stream, {
                            uiZoom: support.zoom,
                            persistId: deviceId,
                            facingOverride: 'environment',
                        });
                        return;
                    }

                    if (!Capacitor.isNativePlatform()) {
                        throw new Error('Ultra-wide camera is not available on this device.');
                    }

                    setUseNativePreview(true);
                    let firstFrameResolve;
                    const firstFramePromise = new Promise((resolve, reject) => {
                        const t = window.setTimeout(() => reject(new Error('Ultra-wide preview produced no frames')), 8000);
                        firstFrameResolve = () => {
                            window.clearTimeout(t);
                            resolve();
                        };
                    });
                    await startNativeUltraWidePreview({
                        cameraId: support.nativeCameraId,
                        zoomRatio: support.zoom,
                        onFrame: (blob) => {
                            nativePreviewBlobRef.current = blob;
                            const url = URL.createObjectURL(blob);
                            const prev = nativeUrlRef.current;
                            nativeUrlRef.current = url;
                            if (nativeImgRef.current) nativeImgRef.current.src = url;
                            if (prev && prev !== url) URL.revokeObjectURL(prev);
                            if (firstFrameResolve) {
                                const done = firstFrameResolve;
                                firstFrameResolve = null;
                                done();
                            }
                        },
                    });
                    await firstFramePromise;
                    if (cancelled) {
                        await stopNativeUltraWidePreview();
                        return;
                    }
                    zoomRef.current = 0.5;
                    setZoom(0.5);
                    setZoomCaps({ supported: false, min: 1, max: 1, value: 1 });
                    zoomCapsRef.current = { supported: false, min: 1, max: 1, value: 1 };
                    setStreamFacing('environment');
                    setUseNativePreview(true);
                    setCameraReady(true);
                    return;
                }

                revokeNativePreviewUrl();
                setUseNativePreview(false);
                const stream = await openCameraStream(deviceId, { facing: facingIntent });
                await bindGumStream(stream, { persistId: deviceId });
            } catch (e) {
                console.error('[CameraCapture] camera unavailable:', e);
                if (cancelled) return;
                if (lensRef.current === 'ultra') {
                    setUltraSupport({ available: false, method: null, deviceId: null, nativeCameraId: null, zoom: null });
                    ultraSupportRef.current = { available: false, method: null, deviceId: null, nativeCameraId: null, zoom: null };
                    setUseNativePreview(false);
                    setLens('wide');
                    toast.error('Ultra-wide camera is not available on this device.');
                    return;
                }
                setCameraError(
                    e?.name === 'NotAllowedError'
                        ? 'Camera permission was denied. Allow camera access in system settings and try again.'
                        : (e?.message || 'Could not access the camera on this device.')
                );
            }
        })();

        return () => {
            cancelled = true;
            detachStreamFromVideo(videoRef.current, streamRef.current);
            streamRef.current = null;
            stopNativeUltraWidePreview();
            setCameraReady(false);
            if (pendingZoomRef.current == null) {
                setZoomCaps({ supported: false, min: 1, max: 1 });
            }
        };
    }, [active, session, deviceId, facingIntent, foreground, lens, revokeNativePreviewUrl]);

    const clampZoom = useCallback((value) => {
        const support = ultraSupportRef.current;
        const caps = zoomCapsRef.current;
        const min = support?.available ? 0.5 : (caps.supported ? caps.min : 1);
        if (caps.supported && lensRef.current !== 'ultra') {
            return Math.min(caps.max, Math.max(Math.max(caps.min, min > 0.9 ? caps.min : min), value));
        }
        return Math.min(DIGITAL_ZOOM_MAX, Math.max(min, value));
    }, []);

    const commitZoom = useCallback((value) => {
        const support = ultraSupportRef.current;
        if (support?.available && facingIntent !== 'user') {
            if (value < 0.75) {
                zoomRef.current = 0.5;
                setZoom(0.5);
                if (lensRef.current !== 'ultra') {
                    pendingZoomRef.current = 0.5;
                    setLens('ultra');
                }
                return 0.5;
            }
            if (lensRef.current === 'ultra') {
                const next = Math.min(DIGITAL_ZOOM_MAX, Math.max(1, value));
                pendingZoomRef.current = next;
                zoomRef.current = next;
                setZoom(next);
                setLens('wide');
                return next;
            }
        }
        const next = clampZoom(Math.max(1, value));
        zoomRef.current = next;
        if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
        zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null;
            setZoom(next);
            if (zoomCapsRef.current.supported) {
                applyTrackZoom(streamRef.current, next).then((applied) => {
                    if (applied) return;
                    // Hardware zoom stopped verifying mid-session — switch to digital
                    // zoom rather than leave the UI claiming a level that isn't real.
                    const fallback = { supported: false, min: 1, max: 1, value: 1 };
                    zoomCapsRef.current = fallback;
                    setZoomCaps(fallback);
                    const digitalNext = Math.min(DIGITAL_ZOOM_MAX, Math.max(1, zoomRef.current));
                    zoomRef.current = digitalNext;
                    setZoom(digitalNext);
                });
            }
        });
        return next;
    }, [clampZoom, facingIntent]);

    useEffect(() => {
        const el = viewfinderRef.current;
        if (!el || !cameraReady) return undefined;

        const onStart = (e) => {
            if (e.touches.length === 2) {
                pinchRef.current = {
                    startDist: touchDistance(e.touches[0], e.touches[1]),
                    startZoom: zoomRef.current,
                };
                setPinching(true);
            }
        };
        const onMove = (e) => {
            const pinch = pinchRef.current;
            if (!pinch || e.touches.length !== 2) return;
            e.preventDefault();
            const dist = touchDistance(e.touches[0], e.touches[1]);
            if (pinch.startDist < 8) return;
            commitZoom(pinch.startZoom * (dist / pinch.startDist));
        };
        const onEnd = (e) => {
            if (e.touches.length < 2) {
                pinchRef.current = null;
                setPinching(false);
            }
        };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd);
        el.addEventListener('touchcancel', onEnd);
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onEnd);
            el.removeEventListener('touchcancel', onEnd);
        };
    }, [cameraReady, commitZoom]);

    const updatePhotos = useCallback((fn) => {
        const next = fn(photosRef.current);
        photosRef.current = next;
        setPhotos(next);
    }, []);

    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
        };
    }, []);

    // Everything after the frame is frozen: burn overlays + verification mark,
    // encode the JPEG, hash it, then swap the placeholder tile for the real photo.
    // Runs one shot at a time so the UI thread stays responsive between taps.
    const finishShot = useCallback(async ({ id, canvas, lines, brandingAtTap, meta }) => {
        const dead = () => unmountedRef.current || cancelledShotsRef.current.has(id);
        try {
            await yieldToPaint();
            if (dead()) return;
            await paintCaptureOverlays(canvas, lines, true, brandingAtTap);
            if (dead()) return;
            const verificationCode = generateVerificationCode();
            drawVerificationMark(canvas.getContext('2d'), canvas.width, canvas.height, verificationCode, brandingAtTap);
            const blob = await canvasToJpegBlob(canvas);
            if (dead()) return;
            let phash = '';
            try {
                phash = dHashFromCanvas(canvas);
            } catch (e) {
                console.warn('[CameraCapture] perceptual hash failed:', e);
            }
            const sha256 = await sha256Hex(blob);
            if (dead()) return;
            const url = URL.createObjectURL(blob);
            updatePhotos((prev) => prev.map((p) => (
                p.id === id ? { ...meta, id, blob, url, verificationCode, sha256, phash } : p
            )));
        } catch (e) {
            console.error('[CameraCapture] capture failed:', e);
            updatePhotos((prev) => prev.filter((p) => p.id !== id));
            if (!dead()) toast.error('Could not save that photo. Try again.');
        } finally {
            // Release the full-size backing store right away (Android WebView memory).
            canvas.width = 0;
            canvas.height = 0;
        }
    }, [updatePhotos]);

    const handleCapture = useCallback(async () => {
        const video = videoRef.current;
        const loc = positionRef.current;
        const nativeUltra = useNativePreviewRef.current && lensRef.current === 'ultra';
        if (capturingRef.current || photosRef.current.length >= MAX_PHOTOS_PER_STAGE) return;
        if (pendingCountRef.current >= MAX_PENDING_CAPTURES) return;
        if (!nativeUltra && (!video || !video.videoWidth)) return;
        if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) {
            toast.error('Wait until location and coordinates are identified, then try again.');
            return;
        }
        capturingRef.current = true;
        // Only the native ultra-wide still (a Camera2 round trip) is genuinely async.
        if (nativeUltra) setIsCapturing(true);
        setShutterFlash(true);
        window.setTimeout(() => setShutterFlash(false), 70);
        try {
            const shotAt = new Date();
            const { lat, lng, accuracy } = loc;
            const captureAddress = addressRef.current;
            const hardwareZoom = zoomCapsRef.current.supported && lensRef.current !== 'ultra';
            let source = video;
            let cropZoom = 1;
            if (lensRef.current === 'ultra') {
                if (nativeUltra) {
                    let blob = null;
                    try {
                        blob = await captureNativeUltraWideStill();
                    } catch (e) {
                        console.warn('[camera-ultra] still capture failed, using preview frame:', e);
                        blob = nativePreviewBlobRef.current;
                    }
                    if (!blob) throw new Error('Ultra-wide frame unavailable');
                    source = await loadImageFromFile(blob);
                    try {
                        const frame = frameRef.current;
                        source = await canvasFromZoomedPreview(
                            source,
                            1,
                            frame?.clientWidth,
                            frame?.clientHeight
                        );
                    } catch (e) {
                        console.warn('[camera-ultra] preview crop failed, using full still:', e);
                    }
                }
            } else if (!hardwareZoom) {
                cropZoom = Math.max(1, zoomRef.current);
            }
            // Freeze the frame NOW (synchronous on the normal path).
            const canvas = snapshotToCanvas(source, PHOTO_ASPECT_RATIO, PHOTO_CAPTURE_MAX_WIDTH, cropZoom);
            const lines = buildOverlayLayout({
                date: shotAt,
                lat,
                lng,
                accuracy,
                address: captureAddress,
                lcbId,
                sectionLabel,
                siteName,
                stage,
                locating: false,
                branding,
            });
            shotSeqRef.current += 1;
            const id = `shot-${shotSeqRef.current}`;
            updatePhotos((prev) => [...prev, { id, pending: true, url: '' }]);
            pendingCountRef.current += 1;
            const job = {
                id,
                canvas,
                lines,
                brandingAtTap: branding,
                meta: {
                    capturedAt: shotAt.toISOString(),
                    lat,
                    lng,
                    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
                    address: captureAddress,
                },
            };
            queueRef.current = queueRef.current
                .then(() => finishShot(job))
                .finally(() => {
                    pendingCountRef.current -= 1;
                });
        } catch (e) {
            console.error('[CameraCapture] capture failed:', e);
            toast.error('Could not capture that photo. Try again.');
        } finally {
            capturingRef.current = false;
            if (nativeUltra) setIsCapturing(false);
        }
    }, [lcbId, sectionLabel, siteName, stage, branding, finishShot, updatePhotos]);

    // A pending shot has no blob URL yet; cancelling it stops its background job.
    const discardPhoto = (photo) => {
        if (!photo) return;
        if (photo.pending) {
            cancelledShotsRef.current.add(photo.id);
            return;
        }
        const wasInitial = initialPhotos.some((p) => p.url === photo.url);
        if (!wasInitial) URL.revokeObjectURL(photo.url);
    };

    const handleRetakeLast = () => {
        discardPhoto(photosRef.current[photosRef.current.length - 1]);
        updatePhotos((prev) => prev.slice(0, -1));
    };

    const handleRemove = (index) => {
        discardPhoto(photosRef.current[index]);
        updatePhotos((prev) => prev.filter((_, i) => i !== index));
    };

    const handleCancel = () => {
        photosRef.current.forEach(discardPhoto);
        onCancel?.();
    };

    const handleCancelRef = useRef(handleCancel);
    handleCancelRef.current = handleCancel;

    useEffect(() => {
        if (!active) return undefined;
        setStatusBarDark('#000000');
        const releaseBack = pushNativeBackHandler(() => {
            handleCancelRef.current();
            return true;
        });
        return () => {
            releaseBack();
            setStatusBarLight();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    const handleDone = async () => {
        if (finishing) return;
        // Shots are burned/encoded in the background — hand over only finished ones.
        if (pendingCountRef.current > 0) {
            setFinishing(true);
            await queueRef.current;
            if (unmountedRef.current) return;
            setFinishing(false);
        }
        onDone?.(photosRef.current.filter((p) => !p.pending));
    };

    const currentCameraId = activeDeviceId || deviceId;
    const canSwitchCamera = true;
    const currentCamera = cameras.find((c) => c.deviceId === currentCameraId);
    const currentCameraIndex = Math.max(0, cameras.findIndex((c) => c.deviceId === currentCameraId));
    const mainCam = cameras.find((c) => c.role === 'main') || cameras.find((c) => c.facing === 'back');
    const frontCam = cameras.find((c) => c.role === 'front' || c.facing === 'front');
    const zoomPresets = (() => {
        const presets = [{
            id: 'ultra',
            lens: 'ultra',
            zoom: 0.5,
            label: '0.5×',
            disabled: !ultraSupport?.available,
        }];
        presets.push({
            id: '1x',
            lens: 'wide',
            zoom: zoomCaps.supported ? Math.min(zoomCaps.max, Math.max(zoomCaps.min, 1)) : 1,
            label: '1×',
        });
        if (zoomCaps.supported && zoomCaps.max >= 1.8) {
            presets.push({ id: '2x', lens: 'wide', zoom: Math.min(2, zoomCaps.max), label: '2×' });
            if (zoomCaps.max >= 3.6) presets.push({ id: '4x', lens: 'wide', zoom: Math.min(4, zoomCaps.max), label: '4×' });
            if (zoomCaps.max >= 7.2) presets.push({ id: '8x', lens: 'wide', zoom: Math.min(8, zoomCaps.max), label: '8×' });
        } else if (!zoomCaps.supported) {
            presets.push({ id: '2x', lens: 'wide', zoom: 2, label: '2×' });
            presets.push({ id: '4x', lens: 'wide', zoom: 4, label: '4×' });
            presets.push({ id: '8x', lens: 'wide', zoom: 8, label: '8×' });
        }
        return presets;
    })();

    const selectCamera = (id, facing) => {
        if (isCapturing) return;
        const cam = cameras.find((c) => c.deviceId === id);
        const nextFacing =
            facing === 'user' || facing === 'front'
                ? 'user'
                : facing === 'environment' || facing === 'back'
                    ? 'environment'
                    : cam?.facing === 'front' || cam?.role === 'front'
                        ? 'user'
                        : 'environment';
        if (id && id === currentCameraId && nextFacing === facingIntent) {
            setShowCameraPicker(false);
            return;
        }
        setShowCameraPicker(false);
        setCameraReady(false);
        if (nextFacing === 'user' && lens === 'ultra') setLens('wide');
        pendingZoomRef.current = nextFacing === 'user' ? 1 : pendingZoomRef.current;
        setZoom(nextFacing === 'user' ? 1 : zoomRef.current);
        zoomRef.current = nextFacing === 'user' ? 1 : zoomRef.current;
        setFacingIntent(nextFacing);
        setDeviceId(id || '');
    };

    const applyZoomPreset = (preset) => {
        if (isCapturing) return;
        if (preset.lens === 'ultra' || preset.id === 'ultra') {
            if (!ultraSupport?.available) return;
            pendingZoomRef.current = 0.5;
            zoomRef.current = 0.5;
            setZoom(0.5);
            if (facingIntent === 'user' || streamFacing === 'user') {
                setFacingIntent('environment');
                setDeviceId(mainCam?.deviceId || '');
            }
            if (ultraSupport.method === 'native') setUseNativePreview(true);
            setCameraReady(false);
            setLens('ultra');
            return;
        }
        const nextZoom = preset.zoom != null ? preset.zoom : 1;
        pendingZoomRef.current = nextZoom;
        if (lens === 'ultra') {
            setUseNativePreview(false);
            setCameraReady(false);
            zoomRef.current = nextZoom;
            setZoom(nextZoom);
            setLens('wide');
            return;
        }
        if (preset.zoom != null) commitZoom(preset.zoom);
    };

    const activePresetId = (() => {
        if (lens === 'ultra') return 'ultra';
        const match = zoomPresets.find((p) => p.lens !== 'ultra' && p.zoom != null && Math.abs(zoom - p.zoom) < 0.08);
        return match?.id ?? null;
    })();

    const cycleCamera = () => {
        if (isCapturing) return;
        const onFront = streamFacing === 'user' || currentCamera?.role === 'front' || currentCamera?.facing === 'front';
        if (onFront) {
            const rear = mainCam || cameras.find((c) => c.facing === 'back' && c.role !== 'front');
            selectCamera(rear?.deviceId || '', 'environment');
        } else {
            if (lens === 'ultra') setLens('wide');
            selectCamera(frontCam?.deviceId || '', 'user');
        }
    };

    const gpsReady = Number.isFinite(position?.lat) && Number.isFinite(position?.lng);
    const shutterDisabled = !cameraReady || locating || !gpsReady || finishing || photos.length >= MAX_PHOTOS_PER_STAGE;

    const fireShutter = (e) => {
        e.preventDefault();
        if (shutterDisabled) return;
        handleCapture();
    };

    return (
        <div className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden overscroll-none bg-black landscape:flex-row">
            <div ref={viewfinderRef} className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-black">
                {/* Only this box is drawn — it is exactly the area the saved photo covers. */}
                <div
                    ref={frameRef}
                    className="absolute overflow-hidden bg-black ring-1 ring-white/40"
                    style={{ left: frameBox.x, top: frameBox.y, width: frameBox.w, height: frameBox.h }}
                >
                    <img
                        ref={(el) => {
                            nativeImgRef.current = el;
                            if (el && nativeUrlRef.current && el.src !== nativeUrlRef.current) {
                                el.src = nativeUrlRef.current;
                            }
                        }}
                        alt=""
                        className={cn('absolute inset-0 h-full w-full object-cover', useNativePreview ? 'block' : 'hidden')}
                    />
                    <video
                        ref={videoRef}
                        className={cn(
                            'absolute inset-0 h-full w-full object-cover',
                            useNativePreview && 'hidden'
                        )}
                        style={
                            useNativePreview || zoomCaps.supported || lens === 'ultra' || zoom <= 1.001
                                ? undefined
                                : { transform: `scale(${zoom})`, transformOrigin: 'center center' }
                        }
                        playsInline
                        muted
                        autoPlay
                        controls={false}
                        disablePictureInPicture
                        disableRemotePlayback
                    />
                </div>

                {!cameraReady && !cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white">
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <p className="text-sm text-white/70">Starting camera…</p>
                    </div>
                )}

                {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-8 text-center text-white">
                        <p className="text-base font-medium">{cameraError}</p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <button
                                type="button"
                                onClick={() => setSession((n) => n + 1)}
                                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900"
                            >
                                Try again
                            </button>
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="rounded-xl bg-white/15 px-4 py-2.5 text-sm font-medium"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

                {cameraReady && pinching && (
                    <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 text-4xl font-semibold tabular-nums text-white drop-shadow">
                        {formatZoomLabel(zoom)}
                    </div>
                )}

                {cameraReady && (
                    <div className="absolute left-2 top-1/2 z-10 flex -translate-y-1/2 touch-auto flex-col items-center gap-1.5">
                        <div className="flex h-40 w-11 items-center justify-center">
                            <input
                                type="range"
                                min={ultraSupport?.available && streamFacing !== 'user' ? 0.5 : (zoomCaps.supported ? zoomCaps.min : 1)}
                                max={zoomCaps.supported ? zoomCaps.max : DIGITAL_ZOOM_MAX}
                                step={0.05}
                                value={zoom}
                                onInput={(e) => commitZoom(Number(e.currentTarget.value))}
                                onChange={(e) => commitZoom(Number(e.currentTarget.value))}
                                disabled={isCapturing}
                                aria-label="Camera zoom"
                                className="h-11 w-40 accent-amber-400 disabled:opacity-40"
                                style={{ transform: 'rotate(-90deg)' }}
                            />
                        </div>
                        <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                            {formatZoomLabel(zoom)}
                        </span>
                    </div>
                )}

                {shutterFlash && (
                    <div className="pointer-events-none absolute inset-0 bg-white/85" />
                )}

                <button
                    type="button"
                    onClick={handleCancel}
                    aria-label="Close camera"
                    className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top,0px))] flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top,0px))] flex flex-col items-end gap-1.5">
                    <div className="rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white">
                        {photos.length}/{MAX_PHOTOS_PER_STAGE}
                    </div>
                    {cameraReady && torchSupported && !useNativePreview ? (
                        <button
                            type="button"
                            onClick={async () => {
                                const next = !flashOnRef.current;
                                const ok = await setTorch(streamRef.current, next);
                                if (!ok) {
                                    toast.error('Flash is not available on this camera');
                                    setTorchSupported(false);
                                    setFlashOn(false);
                                    return;
                                }
                                setFlashOn(next);
                            }}
                            disabled={isCapturing}
                            aria-label={flashOn ? 'Turn flash off' : 'Turn flash on'}
                            aria-pressed={flashOn}
                            className={cn(
                                'flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40',
                                flashOn ? 'bg-amber-400 text-black' : 'bg-black/55 text-white'
                            )}
                        >
                            {flashOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                        </button>
                    ) : null}
                    {canSwitchCamera && (
                        <>
                            <button
                                type="button"
                                onClick={cycleCamera}
                                disabled={isCapturing}
                                aria-label="Switch camera"
                                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white disabled:opacity-40"
                            >
                                <SwitchCamera className="h-5 w-5" />
                            </button>
                            {cameras.length > 1 && (
                            <button
                                type="button"
                                onClick={() => setShowCameraPicker((open) => !open)}
                                disabled={isCapturing}
                                className="max-w-[9.5rem] truncate rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                            >
                                {streamFacing === 'user'
                                    ? 'Front camera'
                                    : friendlyCameraName(currentCamera || mainCam || cameras[0], currentCameraIndex)}
                            </button>
                            )}
                        </>
                    )}
                </div>

                {locating && (
                    <div className="absolute left-3 top-[max(4.25rem,calc(env(safe-area-inset-top,0px)+3.25rem))] rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/85">
                        Getting location…
                    </div>
                )}
                {!locating && !gpsReady && (
                    <button
                        type="button"
                        onClick={() => {
                            setLocating(true);
                            readFreshGps()
                                .then((loc) => {
                                    setPosition({ lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy });
                                    setAddress(loc.address);
                                })
                                .catch(() => {
                                    toast.error('Could not identify location and coordinates. Check GPS and try again.');
                                })
                                .finally(() => setLocating(false));
                        }}
                        className="absolute left-3 top-[max(4.25rem,calc(env(safe-area-inset-top,0px)+3.25rem))] flex items-center gap-1.5 rounded-full bg-red-600/90 px-3 py-1.5 text-[11px] font-medium text-white"
                    >
                        <MapPin className="h-3.5 w-3.5" />
                        Retry GPS
                    </button>
                )}
                {showCameraPicker && cameras.length > 1 && (
                    <div className="absolute inset-x-3 bottom-3 z-20 overflow-hidden rounded-2xl bg-black/80 text-white backdrop-blur-sm touch-auto">
                        <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                            Choose camera
                        </p>
                        <div className="max-h-48 overflow-y-auto akk-scroll-y py-1">
                            {cameras.map((cam, i) => (
                                <button
                                    key={cam.deviceId || i}
                                    type="button"
                                    onClick={() => selectCamera(cam.deviceId)}
                                    className={cn(
                                        'flex w-full items-center justify-between px-4 py-3 text-left text-sm',
                                        cam.deviceId === currentCameraId ? 'bg-white/15 font-semibold' : 'text-white/90'
                                    )}
                                >
                                    {friendlyCameraName(cam, i)}
                                    {cam.deviceId === currentCameraId ? <Check className="h-4 w-4" /> : null}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom bar in portrait; a side rail in landscape so the 4:3 frame can use the full height. */}
            <div className="flex shrink-0 flex-col bg-black landscape:w-[11.5rem] landscape:justify-center landscape:overflow-y-auto">
                {photos.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto bg-black px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {photos.map((p, i) => (
                            <button
                                key={p.id || p.url}
                                type="button"
                                onClick={() => handleRemove(i)}
                                className="relative h-14 min-h-11 shrink-0 overflow-hidden rounded-lg border border-white/25 bg-white/10"
                                style={{ aspectRatio: PHOTO_ASPECT_RATIO }}
                                aria-label={`Remove photo ${i + 1}`}
                            >
                                {p.pending ? (
                                    <span className="flex h-full w-full items-center justify-center">
                                        <Loader2 className="h-4 w-4 animate-spin text-white/70" />
                                    </span>
                                ) : (
                                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                                )}
                                <span className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white">
                                    <X className="h-3.5 w-3.5" />
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {cameraReady && zoomPresets.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-2 bg-black px-3 pb-1 pt-2">
                        {zoomPresets.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                onClick={() => applyZoomPreset(preset)}
                                disabled={isCapturing || preset.disabled}
                                title={preset.disabled ? 'Ultra-wide not available on this camera' : undefined}
                                className={cn(
                                    'flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[12px] font-semibold tabular-nums disabled:opacity-40',
                                    activePresetId === preset.id
                                        ? 'bg-amber-400 text-black'
                                        : 'bg-white/15 text-white'
                                )}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3 bg-black px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-3 landscape:flex-col-reverse landscape:justify-center landscape:px-3">
                    <button
                        type="button"
                        onClick={handleRetakeLast}
                        disabled={photos.length === 0}
                        className="flex h-12 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-white/80 disabled:opacity-30"
                    >
                        <RotateCcw className="h-4 w-4" />
                        Retake
                    </button>

                    <button
                        type="button"
                        onPointerDown={(e) => {
                            if (e.button != null && e.button !== 0) return;
                            shutterFromPointerRef.current = true;
                            fireShutter(e);
                        }}
                        onClick={(e) => {
                            if (shutterFromPointerRef.current) {
                                shutterFromPointerRef.current = false;
                                e.preventDefault();
                                return;
                            }
                            fireShutter(e);
                        }}
                        disabled={shutterDisabled}
                        aria-label="Capture photo"
                        className="flex h-[4.5rem] w-[4.5rem] touch-manipulation items-center justify-center rounded-full border-[5px] border-white bg-white/20 disabled:opacity-40"
                    >
                        <span className="h-[3.25rem] w-[3.25rem] rounded-full bg-white" />
                    </button>

                    <button
                        type="button"
                        onClick={handleDone}
                        disabled={photos.length === 0 || finishing}
                        className="flex h-12 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-white disabled:opacity-30"
                    >
                        {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
