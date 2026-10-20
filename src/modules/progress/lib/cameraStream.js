import { Capacitor, registerPlugin } from '@capacitor/core';
import { CAMERA_PREVIEW_CONSTRAINTS } from '@/modules/progress/lib/config';
import { listNativeLenses, nativeForcesDigitalZoom } from '@/modules/progress/lib/capacitorCamera';
import { storageKey } from '@/core/storage'

const NativeCameraPermission = registerPlugin('NativeCameraPermission');

const CAMERA_PREF_KEY = storageKey('progress', 'spt_camera_device_id');

export function stopMediaStream(stream) {
  try {
    stream?.getTracks?.().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

// The rear lens used to be remembered between sessions. A remembered id could
// be a telephoto/ultra-wide picked once (or mislabeled), which made "1×" open
// zoomed in on every later launch. The viewfinder now always starts on the
// main lens, so the stale value is wiped instead of read.
function clearSavedCameraId() {
  try {
    localStorage.removeItem(CAMERA_PREF_KEY);
  } catch {
    /* ignore */
  }
}

export async function listVideoCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const classified = classifyVideoCameras(devices.filter((d) => d.kind === 'videoinput' && d.deviceId));
    const native = await listNativeLenses();
    return mergeNativeLensRoles(classified, native);
  } catch {
    return [];
  }
}

function cameraRoleName(role, index = 0) {
  if (role === 'ultrawide') return 'Ultra-wide';
  if (role === 'telephoto') return 'Telephoto';
  if (role === 'front') return 'Front camera';
  if (role === 'main') return 'Rear camera';
  return `Camera ${index + 1}`;
}

/**
 * Label rear lenses so Ultra-wide is a real choice. Names that say ultra-wide
 * win. Otherwise the second unlabeled rear camera is treated as ultra-wide
 * (Android often lists it as "camera2 2, facing back" with no "ultra" in the name).
 */
export function classifyVideoCameras(devices) {
  const classified = (devices || []).map((device, index) => {
    const lower = String(device.label || '').toLowerCase();
    let facing = 'unknown';
    if (/front|user|face|selfie/.test(lower)) facing = 'front';
    else if (/back|rear|environment|world/.test(lower)) facing = 'back';

    let role = 'camera';
    if (facing === 'front') role = 'front';
    else if (/ultra[\s-]?wide|ultrawide|\buw\b/.test(lower)) role = 'ultrawide';
    else if (/tele|periscope/.test(lower)) role = 'telephoto';
    else if (facing === 'back') role = 'main';

    return { ...device, facing, role, index };
  });

  const unlabeledBacks = classified.filter((c) => c.facing === 'back' && c.role === 'main');
  if (unlabeledBacks.length >= 2) {
    unlabeledBacks[1].role = 'ultrawide';
    if (unlabeledBacks[2]) unlabeledBacks[2].role = 'telephoto';
  }

  return classified.map((c) => ({
    ...c,
    name: cameraRoleName(c.role, c.index),
  }));
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a Camera2 id such as "2" to a WebView label like "camera2 2, facing back". */
export function matchCamera2Device(devices, cameraId) {
  if (!cameraId) return null;
  const id = String(cameraId).trim();
  if (!id) return null;
  const re = new RegExp(`camera2\\s+${escapeRe(id)}(?:\\D|$)`, 'i');
  return (devices || []).find((d) => re.test(String(d.label || ''))) || null;
}

function mergeNativeLensRoles(devices, native) {
  if (!native?.lenses?.length) return devices;
  return devices.map((device) => {
    const lens = (native.lenses || []).find((l) => matchCamera2Device([device], l.id));
    if (!lens) return device;
    const role = lens.role === 'ultrawide' || lens.role === 'telephoto' || lens.role === 'front' || lens.role === 'main'
      ? lens.role
      : device.role;
    return {
      ...device,
      role,
      facing: lens.facing === 'front' || lens.facing === 'back' ? lens.facing : device.facing,
      name: cameraRoleName(role, device.index),
      nativeCameraId: lens.id,
    };
  });
}

/**
 * Decide how (and whether) 0.5× can be a real ultra-wide capture.
 * Never reports available based on a guessed extra deviceId.
 */
export async function discoverUltraWide(stream, devices) {
  const native = await listNativeLenses();
  const labeled = (devices || []).find((d) => d.role === 'ultrawide' && d.deviceId);
  const mainWeb = (devices || []).find((d) => d.role === 'main') || (devices || []).find((d) => d.facing === 'back');

  if (native?.hasUltraWide) {
    const ultraId = native.ultraCameraId || (native.lenses || []).find((l) => l.role === 'ultrawide')?.id || '';
    const zoomRatio = Number(native.ultraZoomRatio);
    const matched = matchCamera2Device(devices, ultraId);
    const differentDevice = Boolean(
      matched?.deviceId &&
      mainWeb?.deviceId &&
      matched.deviceId !== mainWeb.deviceId
    );
    if (native.methodHint === 'physicalId' && differentDevice) {
      return {
        available: true,
        method: 'device',
        deviceId: matched.deviceId,
        nativeCameraId: ultraId,
        zoom: Number.isFinite(zoomRatio) && zoomRatio > 0 ? zoomRatio : null,
      };
    }
    return {
      available: true,
      method: 'native',
      deviceId: null,
      nativeCameraId: ultraId,
      zoom: Number.isFinite(zoomRatio) && zoomRatio < 0.95 ? zoomRatio : null,
    };
  }

  if (labeled?.deviceId && (!mainWeb?.deviceId || labeled.deviceId !== mainWeb.deviceId)) {
    return {
      available: true,
      method: 'device',
      deviceId: labeled.deviceId,
      nativeCameraId: labeled.nativeCameraId || null,
      zoom: null,
    };
  }

  if (!nativeForcesDigitalZoom()) {
    const range = readTrackZoom(stream);
    if (range.supported && range.min < 0.95) {
      return {
        available: true,
        method: 'zoom',
        deviceId: null,
        nativeCameraId: null,
        zoom: range.min,
      };
    }
  }

  return { available: false, method: null, deviceId: null, nativeCameraId: null, zoom: null };
}

export function friendlyCameraName(device, index = 0) {
  if (device?.name) return device.name;
  const label = device?.label || '';
  const lower = label.toLowerCase();
  if (/ultra[\s-]?wide|ultrawide/.test(lower)) return 'Ultra-wide';
  if (/tele|periscope/.test(lower)) return 'Telephoto';
  if (/back|rear|environment|world/.test(lower)) return 'Rear camera';
  if (/front|user|face|selfie/.test(lower)) return 'Front camera';
  const cleaned = label.replace(/\s*\(.*\)$/, '').trim();
  return cleaned || `Camera ${index + 1}`;
}

export function formatZoomLabel(zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return '1×';
  if (Math.abs(z - 0.5) < 0.08) return '0.5×';
  if (Math.abs(z - 1) < 0.08) return '1×';
  if (Math.abs(z - 2) < 0.08) return '2×';
  if (Math.abs(z - 4) < 0.08) return '4×';
  if (Math.abs(z - 8) < 0.08) return '8×';
  return `${z >= 10 ? z.toFixed(0) : z.toFixed(1).replace(/\.0$/, '')}×`;
}

export function readTrackZoom(stream) {
  const track = stream?.getVideoTracks?.()?.[0];
  const caps = track?.getCapabilities?.() || {};
  const settings = track?.getSettings?.() || {};
  const range = caps.zoom;
  if (range == null && settings.zoom == null) {
    return { supported: false, min: 1, max: 1, value: 1 };
  }
  const min = Number(range?.min ?? 1);
  const max = Number(range?.max ?? settings.zoom ?? 1);
  const value = Number(settings.zoom ?? 1);
  return {
    supported: Number.isFinite(min) && Number.isFinite(max) && max - min >= 0.15,
    min: Number.isFinite(min) ? min : 1,
    max: Number.isFinite(max) ? max : 1,
    value: Number.isFinite(value) ? value : 1,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Applies a hardware zoom constraint and VERIFIES it actually took effect by
 * re-reading the track's own settings afterward. Some Android WebView builds
 * report a usable `getCapabilities().zoom` range but silently no-op on
 * `applyConstraints({ zoom })` — without this check the UI would show a zoom
 * level that was never actually applied to the live feed or the capture.
 */
export async function applyTrackZoom(stream, zoom) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track?.applyConstraints) return false;
  const caps = track.getCapabilities?.() || {};
  if (caps.zoom == null) return false;
  const min = Number(caps.zoom.min ?? 1);
  const max = Number(caps.zoom.max ?? 1);
  const z = Math.min(max, Math.max(min, zoom));
  const tolerance = Math.max(0.05, z * 0.08);
  const verify = () => {
    const applied = Number(track.getSettings?.()?.zoom);
    return Number.isFinite(applied) && Math.abs(applied - z) < tolerance;
  };

  try {
    await track.applyConstraints({ zoom: z });
  } catch {
    /* fall through to the 'advanced' form below */
  }
  await sleep(60);
  if (verify()) return true;

  try {
    await track.applyConstraints({ advanced: [{ zoom: z }] });
  } catch {
    return false;
  }
  await sleep(60);
  return verify();
}

async function requestNativeCameraPermission() {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const result = await NativeCameraPermission.request();
    return result?.granted !== false;
  } catch (e) {
    console.warn('[camera] native permission plugin unavailable:', e);
    return true;
  }
}

function permissionDeniedError() {
  const err = new Error('Camera permission was denied. Allow camera access and try again.');
  err.name = 'NotAllowedError';
  return err;
}

function facingOf(stream) {
  const mode = stream?.getVideoTracks?.()?.[0]?.getSettings?.()?.facingMode;
  if (mode === 'user') return 'user';
  if (mode === 'environment') return 'environment';
  return null;
}

function trackDeviceId(stream) {
  return stream?.getVideoTracks?.()?.[0]?.getSettings?.()?.deviceId || '';
}

function normalizeFacing(facing) {
  if (facing === 'user' || facing === 'front') return 'user';
  if (facing === 'environment' || facing === 'back') return 'environment';
  return null;
}

async function gum(video) {
  const constraints = { audio: false, video };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      lastErr = e;
      if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') throw e;
      const retryable = e?.name === 'NotAllowedError' || e?.name === 'AbortError' || e?.name === 'NotReadableError';
      if (!retryable || attempt === 2) throw e;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Soft-cap the live stream so the viewfinder stays cool. Never force 4K. */
async function applyPreviewConstraints(stream) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track?.applyConstraints) return stream;
  const settings = track.getSettings?.() || {};
  const width = Number(settings.width) || 0;
  const height = Number(settings.height) || 0;
  if (width > 0 && width <= 1920 && height > 0 && height <= 1440) return stream;

  const next = { ...CAMERA_PREVIEW_CONSTRAINTS };
  if (settings.facingMode) next.facingMode = { exact: settings.facingMode };
  if (settings.deviceId) next.deviceId = { exact: settings.deviceId };
  try {
    await track.applyConstraints(next);
  } catch {
    try {
      await track.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      });
    } catch {
      /* keep whatever the device already opened */
    }
  }
  return stream;
}

async function openExactDevice(deviceId) {
  if (!deviceId) return null;
  try {
    return await gum({ deviceId: { exact: deviceId } });
  } catch {
    try {
      return await gum({ deviceId: { ideal: deviceId } });
    } catch {
      return null;
    }
  }
}

async function openFacing(facing) {
  const mode = facing === 'user' ? 'user' : 'environment';
  try {
    return await gum({ ...CAMERA_PREVIEW_CONSTRAINTS, facingMode: { exact: mode } });
  } catch {
    try {
      return await gum({ ...CAMERA_PREVIEW_CONSTRAINTS, facingMode: { ideal: mode } });
    } catch {
      try {
        return await gum({ facingMode: { exact: mode } });
      } catch {
        try {
          return await gum({ facingMode: { ideal: mode } });
        } catch {
          return null;
        }
      }
    }
  }
}

/**
 * `facingMode: environment` normally lands on the main rear lens, but some
 * Android builds hand back the telephoto (or ultra-wide) sensor instead — that
 * is what makes "1×" look 3× zoomed in. When the OS-picked rear lens is not the
 * main one, reopen the main lens explicitly. Returns the stream to use.
 */
async function preferMainLens(stream) {
  const openedId = trackDeviceId(stream);
  if (!openedId) return stream;
  let devices = [];
  try {
    devices = await listVideoCameras();
  } catch {
    return stream;
  }
  const opened = devices.find((d) => d.deviceId === openedId);
  if (!opened || (opened.role !== 'telephoto' && opened.role !== 'ultrawide')) return stream;
  const main = devices.find((d) => d.role === 'main' && d.facing === 'back' && d.deviceId);
  if (!main || main.deviceId === openedId) return stream;

  stopMediaStream(stream);
  await sleep(140);
  const next = await openExactDevice(main.deviceId);
  if (next) {
    await applyPreviewConstraints(next);
    return next;
  }
  // Main lens would not open — better a working (if zoomed) camera than none.
  const fallback = await openFacing('environment');
  if (!fallback) throw new Error('Could not reopen the rear camera');
  await applyPreviewConstraints(fallback);
  return fallback;
}

/**
 * Opens a live video stream. Pass a deviceId to use that camera; otherwise
 * prefers the rear camera (facingMode environment) and makes sure it is the
 * main lens. Unconstrained getUserMedia defaults to the front camera on many
 * Android WebViews — never do that.
 */
export async function openCameraStream(deviceId, { facing, requireDevice = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera is not available in this browser');
  }

  const granted = await requestNativeCameraPermission();
  if (!granted) throw permissionDeniedError();
  // WebView getUserMedia often fails on the first call immediately after Allow.
  if (Capacitor.isNativePlatform()) await sleep(220);
  clearSavedCameraId();

  const want = normalizeFacing(facing);
  const preferred = deviceId || '';

  if (preferred) {
    const exact = await openExactDevice(preferred);
    if (exact) {
      const opened = facingOf(exact);
      let devices = [];
      try {
        devices = await listVideoCameras();
      } catch {
        devices = [];
      }
      const cam = devices.find((d) => d.deviceId === preferred);
      const isFront = opened === 'user' || cam?.role === 'front' || cam?.facing === 'front';
      const isRear =
        opened === 'environment' ||
        cam?.facing === 'back' ||
        cam?.role === 'main' ||
        cam?.role === 'ultrawide' ||
        cam?.role === 'telephoto';

      const matchesWant =
        want === 'user'
          ? isFront || (!isRear && opened !== 'environment')
          : isRear && !isFront;

      const openedId = trackDeviceId(exact);
      const idMatches = Boolean(openedId) && openedId === preferred;

      if (matchesWant && (!requireDevice || idMatches)) {
        await applyPreviewConstraints(exact);
        return exact;
      }
      stopMediaStream(exact);
      if (requireDevice) {
        const err = new Error('Could not open the requested camera');
        err.name = 'OverconstrainedError';
        throw err;
      }
    } else if (requireDevice) {
      const err = new Error('Could not open the requested camera');
      err.name = 'OverconstrainedError';
      throw err;
    }
  }

  if (requireDevice) {
    const err = new Error('Could not open the requested camera');
    err.name = 'OverconstrainedError';
    throw err;
  }

  const stream = await openFacing(want || 'environment');
  if (stream) {
    await applyPreviewConstraints(stream);
    // Front camera has one lens; only the rear side can land on the wrong one.
    if (want === 'user' || facingOf(stream) === 'user') return stream;
    return preferMainLens(stream);
  }

  try {
    return await applyPreviewConstraints(await gum(true));
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
      throw permissionDeniedError();
    }
    throw e;
  }
}

/** @deprecated use openCameraStream */
export async function openRearCameraStream() {
  return openCameraStream('');
}

export async function attachStreamToVideo(video, stream) {
  if (!video) {
    stopMediaStream(stream);
    throw new Error('Camera view is not ready');
  }

  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.playsInline = true;
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.controls = false;
  video.srcObject = stream;

  try {
    await video.play();
  } catch {
    /* autoplay may reject until a frame arrives — loadeddata below is the real gate */
  }

  if (video.readyState >= 2 && video.videoWidth > 0) return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Camera started but no frames arrived'));
    }, 10000);
    const onReady = () => {
      if (video.videoWidth > 0) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('playing', onReady);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('playing', onReady);
  });
}

export function detachStreamFromVideo(video, stream) {
  try {
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  stopMediaStream(stream);
}
