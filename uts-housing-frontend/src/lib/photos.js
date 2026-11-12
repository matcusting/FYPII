export const MAX_PHOTOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/** Validate picked files in the browser (the server checks again). */
export function pickPhotos(fileList, currentCount) {
    const files = Array.from(fileList || []);
    const errors = [];
    const ok = [];
    for (const f of files) {
        if (!ALLOWED.includes(f.type)) errors.push(`${f.name}: only JPG, PNG or WEBP.`);
        else if (f.size > MAX_BYTES) errors.push(`${f.name}: larger than 5 MB.`);
        else if (currentCount + ok.length >= MAX_PHOTOS) errors.push(`Maximum ${MAX_PHOTOS} photos.`);
        else ok.push({ file: f, preview: URL.createObjectURL(f) });
    }
    return { ok, error: errors.length ? errors.join(' ') : null };
}
