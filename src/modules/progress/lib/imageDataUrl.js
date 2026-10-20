/** Fetches a (typically signed) image URL and reads it back as a data: URL. */
export async function blobUrlToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load a photo');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
