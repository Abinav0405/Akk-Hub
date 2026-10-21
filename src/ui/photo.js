/**
 * Turn a picked image into a passport-style JPEG data URL (4:5, centre-cropped, ~360×450,
 * ~30–60 KB) so it can be stored with the employee record. Runs on the device; no upload of
 * the original photo.
 */
export async function toPassportPhoto(file, { width = 360, height = 450, quality = 0.82 } = {}) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file.');
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Could not read that image.'));
            el.src = url;
        });
        const target = width / height;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (sw / sh > target) sw = Math.round(sh * target);
        else sh = Math.round(sw / target);
        const sx = Math.round((img.naturalWidth - sw) / 2);
        // Faces sit in the upper part of most photos: bias the crop upwards a little.
        const sy = Math.max(0, Math.round((img.naturalHeight - sh) * 0.35));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', quality);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
