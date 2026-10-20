import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Deliberately its own tiny module (Capacitor APIs only) — no html2canvas/jsPDF.
// Anything that just needs to save/share a blob (a downloaded photo, an
// already-built PDF) should import from here, not from pdf.js, so it doesn't
// drag the whole PDF-rendering pipeline into its chunk.

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('Unexpected read result'));
        return;
      }
      resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function isShareCanceled(error) {
  const m = error && (error.message || String(error));
  return /cancel|dismiss|abort/i.test(m || '');
}

/**
 * Desktop / mobile browser: trigger a real file download.
 * Capacitor WebView: write to cache and open the share sheet (Save to Downloads, Drive, Files, printer apps).
 */
export async function savePdfBlob(blob, fileName) {
  const safeName = (fileName || 'document.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'document.pdf';

  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { shared: true };
  }

  const base64Data = await blobToBase64(blob);
  await Filesystem.writeFile({ path: safeName, data: base64Data, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache });
  if (!uri) throw new Error('Could not prepare the file');

  try {
    await Share.share({
      title: safeName,
      files: [uri],
      dialogTitle: 'Save or share',
    });
    return { shared: true };
  } catch (e) {
    if (isShareCanceled(e)) return { shared: false, canceled: true };
    try {
      await Share.share({
        title: safeName,
        url: uri,
        dialogTitle: 'Save or share',
      });
      return { shared: true };
    } catch (e2) {
      if (isShareCanceled(e2)) return { shared: false, canceled: true };
      throw e2;
    }
  }
}

function uniqueFileName(name, used) {
  const safe = (name || 'document').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'document';
  if (!used.has(safe.toLowerCase())) {
    used.add(safe.toLowerCase());
    return safe;
  }
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let n = 2;
  let next = `${base}-${n}${ext}`;
  while (used.has(next.toLowerCase())) {
    n += 1;
    next = `${base}-${n}${ext}`;
  }
  used.add(next.toLowerCase());
  return next;
}

/**
 * Download several files as separate files in one action.
 * Web: sequential downloads. Native: one share sheet with every file.
 */
export async function saveBlobs(files) {
  if (!files?.length) return { shared: true };
  const used = new Set();
  const named = files.map((file) => ({
    blob: file.blob,
    fileName: uniqueFileName(file.fileName, used),
  }));

  if (!Capacitor.isNativePlatform()) {
    for (let i = 0; i < named.length; i += 1) {
      await savePdfBlob(named[i].blob, named[i].fileName);
      if (i < named.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    return { shared: true };
  }

  const uris = [];
  for (const file of named) {
    const base64Data = await blobToBase64(file.blob);
    await Filesystem.writeFile({ path: file.fileName, data: base64Data, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: file.fileName, directory: Directory.Cache });
    if (uri) uris.push(uri);
  }
  if (!uris.length) throw new Error('Could not prepare the files');

  try {
    await Share.share({
      title: `${uris.length} files`,
      files: uris,
      dialogTitle: 'Save files',
    });
    return { shared: true };
  } catch (e) {
    if (isShareCanceled(e)) return { shared: false, canceled: true };
    try {
      for (let i = 0; i < uris.length; i += 1) {
        await Share.share({
          title: named[i].fileName,
          files: [uris[i]],
          dialogTitle: 'Save files',
        });
      }
      return { shared: true };
    } catch (e2) {
      if (isShareCanceled(e2)) return { shared: false, canceled: true };
      throw e2;
    }
  }
}
