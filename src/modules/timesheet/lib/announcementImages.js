import { supabaseTimesheet } from '@/core/supabase'

export const ANNOUNCEMENT_IMAGES_BUCKET = 'announcement-images';
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ANNOUNCEMENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export function validateAnnouncementImage(file) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) {
        return 'Please choose an image file (JPEG, PNG, WebP, or GIF).';
    }
    if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
        return 'Image must be 5 MB or smaller.';
    }
    return null;
}

export function storagePathFromPublicUrl(url) {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${ANNOUNCEMENT_IMAGES_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.slice(idx + marker.length));
}

export async function uploadAnnouncementImage(announcementId, file) {
    const validationError = validateAnnouncementImage(file);
    if (validationError) throw new Error(validationError);

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
    const path = `${announcementId}/${Date.now()}.${safeExt}`;

    const { error: uploadError } = await supabaseTimesheet.storage
        .from(ANNOUNCEMENT_IMAGES_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
        const msg = uploadError.message || '';
        if (/bucket not found|does not exist|invalid bucket/i.test(msg)) {
            throw new Error(
                'Image storage is not set up. Run SQL files/active/announcements_storage.sql in the Supabase SQL editor, then try again.'
            );
        }
        throw new Error(msg || 'Failed to upload image');
    }

    const { data } = supabaseTimesheet.storage.from(ANNOUNCEMENT_IMAGES_BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

export async function removeAnnouncementImageFromStorage(imageUrl) {
    const path = storagePathFromPublicUrl(imageUrl);
    if (!path) return;
    const { error } = await supabaseTimesheet.storage.from(ANNOUNCEMENT_IMAGES_BUCKET).remove([path]);
    if (error) throw error;
}
