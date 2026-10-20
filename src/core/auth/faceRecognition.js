/**
 * Face Recognition Utility
 * Uses face-api.js for face detection and recognition
 * 
 * This module provides functions for:
 * - Loading face recognition models
 * - Detecting faces in images/video
 * - Extracting face descriptors (embeddings)
 * - Comparing face descriptors for authentication
 */

let faceapiModule = null;
let modelsLoaded = false;
let loadingPromise = null;
/** @type {import('face-api.js').TinyFaceDetectorOptions | null} */
let faceDetectorOptions = null;

async function getFaceApi() {
    if (!faceapiModule) {
        faceapiModule = await import('face-api.js');
    }
    return faceapiModule;
}

async function getFaceDetectorOptions() {
    if (!faceDetectorOptions) {
        const faceapi = await getFaceApi();
        faceDetectorOptions = new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.2,
        });
    }
    return faceDetectorOptions;
}

/**
 * Load face-api.js models
 * Models are loaded from CDN or local public folder
 */
export async function loadModels() {
    if (modelsLoaded) {
        return true;
    }

    if (loadingPromise) {
        return loadingPromise;
    }

    loadingPromise = (async () => {
        try {
            const faceapi = await getFaceApi();
            // Try loading from CDN first (faster)
            const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
            
            try {
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
                ]);
                
                modelsLoaded = true;
                return true;
            } catch (cdnError) {
                console.warn('Failed to load models from CDN, trying local path:', cdnError);
                
                // Fallback to local public folder
                const PUBLIC_MODEL_URL = '/models';
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(PUBLIC_MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(PUBLIC_MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(PUBLIC_MODEL_URL)
                ]);
                
                modelsLoaded = true;
                return true;
            }
        } catch (error) {
            console.error('Error loading face recognition models:', error);
            modelsLoaded = false;
            loadingPromise = null;
            throw new Error('Failed to load face recognition models. Please check your internet connection.');
        }
    })();

    return loadingPromise;
}

/**
 * Detect face in video/image and extract descriptor
 * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} input - Video element, image, or canvas
 * @returns {Promise<Float32Array|null>} Face descriptor (128-dimensional vector) or null if no face detected
 */
export async function detectFace(input) {
    try {
        await loadModels();
        const faceapi = await getFaceApi();
        const detectorOptions = await getFaceDetectorOptions();

        // Detect face with landmarks (relaxed options for angle/distance tolerance)
        const detection = await faceapi
            .detectSingleFace(input, detectorOptions)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            return null;
        }

        return detection.descriptor;
    } catch (error) {
        console.error('Error detecting face:', error);
        throw error;
    }
}

/**
 * Detect face with full detection data (including landmarks and bounding box)
 * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} input - Video element, image, or canvas
 * @returns {Promise<Object|null>} Full detection object with descriptor, landmarks, and detection box, or null
 */
export async function detectFaceWithLandmarks(input) {
    try {
        if (!input) return null;
        if (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) {
            if (!input.isConnected || !input.videoWidth) return null;
        }

        await loadModels();
        const faceapi = await getFaceApi();
        const detectorOptions = await getFaceDetectorOptions();

        // Detect face with landmarks and descriptor (relaxed options for angle/distance tolerance)
        const detection = await faceapi
            .detectSingleFace(input, detectorOptions)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            return null;
        }

        return detection;
    } catch (error) {
        console.error('Error detecting face with landmarks:', error);
        throw error;
    }
}

/**
 * Detect multiple faces in an image/video
 * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} input - Video element, image, or canvas
 * @returns {Promise<Array>} Array of face descriptors
 */
export async function detectFaces(input) {
    try {
        await loadModels();
        const faceapi = await getFaceApi();
        const detectorOptions = await getFaceDetectorOptions();

        const detections = await faceapi
            .detectAllFaces(input, detectorOptions)
            .withFaceLandmarks()
            .withFaceDescriptors();

        return detections.map(detection => detection.descriptor);
    } catch (error) {
        console.error('Error detecting faces:', error);
        throw error;
    }
}

/**
 * Get user-friendly pose/position feedback. Only rejects when position/angle is really wrong;
 * allows moderate angles and distances for smoother verification.
 * @param {Object} detection - Full detection with detection.detection.box and detection.landmarks
 * @param {number} videoWidth - Frame width
 * @param {number} videoHeight - Frame height
 * @returns {{ ok: boolean, message: string }} ok true when pose is good for verification; message to show user
 */
export function getFacePoseFeedback(detection, videoWidth, videoHeight) {
    if (!detection || !detection.detection || !detection.detection.box) {
        return { ok: false, message: "Can't see your face. Look at the camera and move into frame." };
    }
    const box = detection.detection.box;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const frameCenterX = videoWidth / 2;
    const frameCenterY = videoHeight / 2;
    // Wider margins so only clearly off-center triggers feedback
    const marginX = videoWidth * 0.38;
    const marginY = videoHeight * 0.38;
    // Allow face smaller (further) and larger (closer) — only reject when really off
    const minFaceW = videoWidth * 0.10;
    const minFaceH = videoHeight * 0.12;
    const maxFaceW = videoWidth * 0.92;
    const maxFaceH = videoHeight * 0.92;

    if (box.width < minFaceW || box.height < minFaceH) {
        return { ok: false, message: "Move closer — face too far from camera." };
    }
    if (box.width > maxFaceW || box.height > maxFaceH) {
        return { ok: false, message: "Move back a bit — face too close." };
    }
    if (cx < frameCenterX - marginX) {
        return { ok: false, message: "Move your face a bit to the right." };
    }
    if (cx > frameCenterX + marginX) {
        return { ok: false, message: "Move your face a bit to the left." };
    }
    if (cy < frameCenterY - marginY) {
        return { ok: false, message: "Move your face a bit down." };
    }
    if (cy > frameCenterY + marginY) {
        return { ok: false, message: "Move your face a bit up." };
    }

    // Only reject on extreme head tilt or look up/down — allow moderate angles
    if (detection.landmarks && detection.landmarks.positions && detection.landmarks.positions.length >= 48) {
        const positions = detection.landmarks.positions;
        const leftEyeY = (positions[36].y + positions[37].y + positions[38].y + positions[39].y + positions[40].y + positions[41].y) / 6;
        const rightEyeY = (positions[42].y + positions[43].y + positions[44].y + positions[45].y + positions[46].y + positions[47].y) / 6;
        const eyeCenterY = (leftEyeY + rightEyeY) / 2;
        const noseY = positions[30].y;
        const tiltPx = Math.abs(leftEyeY - rightEyeY);
        const lookUpDownPx = Math.abs(noseY - eyeCenterY);
        const tiltThreshold = Math.min(box.height * 0.22, 35);
        const lookThreshold = box.height * 0.45;

        if (tiltPx > tiltThreshold) {
            return { ok: false, message: "Straighten your head — keep it level." };
        }
        if (lookUpDownPx > lookThreshold) {
            if (noseY < eyeCenterY) {
                return { ok: false, message: "Look down a bit — face is angled up." };
            }
            return { ok: false, message: "Look up a bit — face is angled down." };
        }
    }

    return { ok: true, message: "Hold still..." };
}

/**
 * Compare two face descriptors and return similarity score
 * 
 * ⚠️ IMPORTANT: This does NOT measure physical distance from screen!
 * 
 * This function calculates the EUCLIDEAN DISTANCE between two 128-dimensional
 * face embedding vectors. These vectors represent:
 * - Facial structure and geometry
 * - Facial features (eyes, nose, mouth, etc.)
 * - Facial landmarks (68 key points)
 * - Texture and appearance patterns
 * 
 * The embeddings are extracted by a neural network (face-api.js) that analyzes
 * facial features regardless of:
 * - Physical distance from camera
 * - Camera angle
 * - Lighting conditions
 * - Facial expressions
 * 
 * Two different people will have VERY different embeddings (high distance)
 * even if they are at the same physical distance from the screen.
 * 
 * @param {Float32Array} descriptor1 - First face descriptor (128D vector)
 * @param {Float32Array} descriptor2 - Second face descriptor (128D vector)
 * @returns {number} Euclidean distance between embeddings (lower = more similar, 0 = identical faces)
 */
export function compareFaces(descriptor1, descriptor2) {
    if (!descriptor1 || !descriptor2) {
        return Infinity;
    }

    if (descriptor1.length !== descriptor2.length) {
        return Infinity;
    }

    // Calculate Euclidean distance between 128-dimensional face embedding vectors
    // This measures similarity of FACIAL FEATURES, not physical position
    let sum = 0;
    for (let i = 0; i < descriptor1.length; i++) {
        const diff = descriptor1[i] - descriptor2[i];
        sum += diff * diff;
    }

    return Math.sqrt(sum);
}

/**
 * Check if two faces match (within threshold)
 * @param {Float32Array} descriptor1 - First face descriptor
 * @param {Float32Array} descriptor2 - Second face descriptor
 * @param {number} threshold - Maximum distance for a match (default: 0.6)
 * @returns {boolean} True if faces match
 */
export function isFaceMatch(descriptor1, descriptor2, threshold = 0.6) {
    const distance = compareFaces(descriptor1, descriptor2);
    return distance < threshold;
}

/**
 * Convert Float32Array descriptor to JSON-serializable array
 * @param {Float32Array} descriptor - Face descriptor
 * @returns {Array<number>} Array of numbers
 */
export function descriptorToArray(descriptor) {
    if (!descriptor) return null;
    return Array.from(descriptor);
}

/**
 * Convert array back to Float32Array descriptor
 * @param {Array<number>} array - Array of numbers
 * @returns {Float32Array} Face descriptor
 */
export function arrayToDescriptor(array) {
    if (!array || !Array.isArray(array)) return null;
    return new Float32Array(array);
}

/**
 * Capture frame from video element
 * @param {HTMLVideoElement} video - Video element
 * @returns {HTMLCanvasElement} Canvas with captured frame
 */
export function captureFrame(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return canvas;
}

/**
 * Create video element from user's camera
 * @param {Object} constraints - MediaStreamConstraints (optional)
 * @returns {Promise<HTMLVideoElement>} Video element with camera stream
 */
export async function createVideoElement(constraints = { video: true }) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    return video;
}

/**
 * Stop video stream
 * @param {HTMLVideoElement} video - Video element
 */
export function stopVideoStream(video) {
    if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }
}

/**
 * Draw face detection box on canvas
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Object} detection - Face detection result from face-api.js
 */
export function drawFaceBox(canvas, detection) {
    const ctx = canvas.getContext('2d');
    const box = detection.detection.box;
    
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
}

/**
 * Draw facial landmarks on canvas with name label
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Object} detection - Face detection result with landmarks from face-api.js
 * @param {string} name - Optional name to display at top left of face box
 */
export function drawFaceLandmarks(canvas, detection, name = null, videoElement = null) {
    if (!detection || !detection.landmarks) return;
    
    const ctx = canvas.getContext('2d');
    const landmarks = detection.landmarks;
    const box = detection.detection.box;
    
    // Clear canvas first
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Canvas has CSS scaleX(-1) mirror transform, so we need to flip X coordinates
    // Detection coordinates are in original video space, but canvas displays mirrored
    const flipX = (x) => canvas.width - x;
    
    // Draw face bounding box (flip X coordinates for mirror)
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    const flippedBoxX = flipX(box.x + box.width);
    ctx.strokeRect(flippedBoxX, box.y, box.width, box.height);
    
    // Draw name box at top left of face (flip X coordinates)
    // Name should appear on the left side as you see yourself (which is actually right side in detection)
    if (name) {
        const padding = 5;
        const nameBoxHeight = 30;
        const nameBoxWidth = Math.max(120, name.length * 8 + 20);
        // Flip the X position so name appears on correct side
        const flippedNameBoxX = flipX(box.x + nameBoxWidth);
        
        // Draw background box
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(flippedNameBoxX, box.y - nameBoxHeight - padding, nameBoxWidth, nameBoxHeight);
        
        // Draw border
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(flippedNameBoxX, box.y - nameBoxHeight - padding, nameBoxWidth, nameBoxHeight);
        
        // Draw name text (text alignment needs to account for mirroring)
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, flippedNameBoxX + 10, box.y - nameBoxHeight / 2 - padding);
    }
    
    // Draw 68 facial landmarks (flip X coordinates for mirror)
    ctx.strokeStyle = '#00ff00';
    ctx.fillStyle = '#00ff00';
    ctx.lineWidth = 1.5;
    
    // Draw landmark points
    const positions = landmarks.positions;
    for (let i = 0; i < positions.length; i++) {
        const point = positions[i];
        ctx.beginPath();
        ctx.arc(flipX(point.x), point.y, 2, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw landmark connections (outline of face features)
    const drawLandmarkPath = (indices) => {
        if (indices.length === 0) return;
        ctx.beginPath();
        const firstPoint = positions[indices[0]];
        ctx.moveTo(flipX(firstPoint.x), firstPoint.y);
        for (let i = 1; i < indices.length; i++) {
            const point = positions[indices[i]];
            ctx.lineTo(flipX(point.x), point.y);
        }
        ctx.stroke();
    };
    
    // Jaw line (0-16)
    drawLandmarkPath([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    
    // Right eyebrow (17-21)
    drawLandmarkPath([17, 18, 19, 20, 21]);
    
    // Left eyebrow (22-26)
    drawLandmarkPath([22, 23, 24, 25, 26]);
    
    // Nose bridge (27-30)
    drawLandmarkPath([27, 28, 29, 30]);
    
    // Nose tip (31-35)
    drawLandmarkPath([31, 32, 33, 34, 35]);
    
    // Right eye (36-41)
    drawLandmarkPath([36, 37, 38, 39, 40, 41, 36]);
    
    // Left eye (42-47)
    drawLandmarkPath([42, 43, 44, 45, 46, 47, 42]);
    
    // Outer mouth (48-59)
    drawLandmarkPath([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 48]);
    
    // Inner mouth (60-67)
    drawLandmarkPath([60, 61, 62, 63, 64, 65, 66, 67, 60]);
}

/**
 * Get face detection status message
 * @param {boolean} faceDetected - Whether a face was detected
 * @param {number} faceCount - Number of faces detected
 * @returns {string} Status message
 */
export function getFaceDetectionStatus(faceDetected, faceCount = 0) {
    if (!faceDetected) {
        return 'No face detected. Please position your face in the camera.';
    }
    if (faceCount > 1) {
        return 'Multiple faces detected. Please ensure only one person is in the frame.';
    }
    return 'Face detected. Hold still...';
}
