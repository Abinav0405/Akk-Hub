/**
 * Fixed output aspect ratio for every captured site-progress photo (width / height).
 * 4:3 is a placeholder pending Abinav's decision (PROJECT_PLAN.md action item #3) —
 * change this one constant to retune every photo across the whole app.
 */
export const PHOTO_ASPECT_RATIO = 4 / 3;

/** Longest output width (4:3 → 2560×1920). Never upscaled past the camera/file source. */
export const PHOTO_CAPTURE_MAX_WIDTH = 2560;

/**
 * Live viewfinder constraints. Keep this well below 4K — a 4K preview plus
 * continuous GPS is what overheats phones while the camera stays open.
 * Capture uses the current preview frame (not a separate still-camera shot).
 */
export const CAMERA_PREVIEW_CONSTRAINTS = {
  width: { ideal: 1920 },
  height: { ideal: 1440 },
  frameRate: { ideal: 24, max: 30 },
};

/** JPEG encode quality for captured and attached site photos. */
export const PHOTO_JPEG_QUALITY = 0.92;

/** Max photos per capture session (per stage). */
export const MAX_PHOTOS_PER_STAGE = 40;

export const STAGES = ['before', 'during', 'after', 'completion'];

export const STAGE_LABELS = {
  before: 'Before Servicing',
  during: 'During Servicing',
  after: 'After Servicing',
  completion: 'Completion',
};

export const STAGE_PICKER_LABELS = {
  before: 'Before',
  during: 'During',
  after: 'After',
  completion: 'Completion',
};

/** Worker-facing label for the completion stage. Submit to Admin is a separate action. */
export const FINAL_STAGE_LABEL = 'Completion';

export function isStandaloneStage(stage) {
  return stage === 'before' || stage === 'completion';
}
