/**
 * NFC for AKK ID cards: tap a card (NFC chip / sticker) to the back of the phone.
 *   - phone app (Android / iOS): @exxili/capacitor-nfc
 *   - website: Web NFC (Chrome on Android, https only)
 * A card tag holds ONE record: the printed-card code (`AKK1P.<token>`) — as a link to the public check page
 * when the site address is known, else as plain text. Reading goes through the same server check as a QR
 * scan (cancelled / replaced / expired cards show red), so a lost tag stops working when the card is cancelled.
 */
import { Capacitor } from '@capacitor/core';
import { qrPayload } from './cardModel';

const isNative = () => Capacitor.isNativePlatform();
let pluginPromise;
const plugin = () => (pluginPromise ||= import('@exxili/capacitor-nfc').then((m) => m.NFC));

/** Can this device read / write NFC tags? */
export async function nfcAvailable() {
    try {
        if (isNative()) return Boolean((await (await plugin()).isSupported())?.supported);
        return typeof window !== 'undefined' && 'NDEFReader' in window && window.isSecureContext;
    } catch {
        return false;
    }
}

const friendly = (e) => {
    const n = e?.name || '';
    const m = String(e?.error || e?.message || e || '');
    if (n === 'NotAllowedError' || /permission/i.test(m)) return 'NFC permission was refused. Allow it in the browser / phone settings.';
    if (n === 'NotSupportedError') return 'This phone has no NFC, or it is switched off. Turn NFC on in Settings.';
    if (n === 'AbortError') return null; // cancelled on purpose
    return m || 'Could not use NFC.';
};

function textOfRecords(records) {
    for (const rec of records || []) {
        let text = '';
        if (typeof rec.payload === 'string') text = rec.payload;
        else if (rec.data) {
            try {
                text = new TextDecoder(rec.encoding || 'utf-8').decode(rec.data);
            } catch {
                text = '';
            }
        }
        // 'U' / url records may begin with the NDEF URI-prefix byte; 'T' records with status + language
        text = text.replace(/^[\u0000-\u0004]/, '');
        if (rec.recordType === 'text' || rec.type === 'T') text = text.replace(/^[a-z]{2,5}(?=https?:|AKK1)/i, '');
        const hit = text.match(/(https?:\/\/\S*AKK1[LP]\.\S*|AKK1[LP]\.[\w.-]+)/); // only AKK card links / codes
        if (hit) return hit[1];
    }
    return null;
}

/**
 * Start listening for a tap. onText(code) gets the card code / link; onError(message) gets a readable error.
 * Returns stop().
 */
export async function startNfcRead(onText, onError) {
    if (isNative()) {
        const NFC = await plugin();
        const offRead = NFC.onRead((data) => {
            const text = textOfRecords(data.string()?.messages?.flatMap((m) => m.records) || []);
            if (text) onText(text);
            else onError?.('That tag is not an AKK card.');
        });
        const offErr = NFC.onError((e) => {
            const msg = friendly(e);
            if (msg) onError?.(msg);
        });
        try {
            await NFC.startScan?.(); // iOS opens its own sheet; Android is always listening
        } catch (e) {
            onError?.(friendly(e));
        }
        return () => {
            offRead?.();
            offErr?.();
            NFC.cancelScan?.().catch?.(() => {});
        };
    }
    const ctrl = new AbortController();
    try {
        const reader = new window.NDEFReader();
        await reader.scan({ signal: ctrl.signal });
        reader.onreadingerror = () => onError?.('Could not read that tag. Hold it steady against the back of the phone.');
        reader.onreading = (e) => {
            const text = textOfRecords(e.message?.records);
            if (text) onText(text);
            else onError?.('That tag is not an AKK card.');
        };
    } catch (e) {
        const msg = friendly(e);
        if (msg) onError?.(msg);
    }
    return () => ctrl.abort();
}

/** Write the card's tag (admin): one record with the printed-card code. Resolves when the tag was written. */
export async function writeCardTag(token) {
    const message = qrPayload(`AKK1P.${token}`);
    const isUrl = /^https?:\/\//.test(message);
    if (isNative()) {
        const NFC = await plugin();
        return new Promise((resolve, reject) => {
            const offOk = NFC.onWrite(() => {
                cleanup();
                resolve();
            });
            const offErr = NFC.onError((e) => {
                cleanup();
                reject(new Error(friendly(e) || 'Could not write the tag.'));
            });
            function cleanup() {
                offOk?.();
                offErr?.();
            }
            NFC.writeNDEF({ records: [{ type: isUrl ? 'U' : 'T', payload: message }] }).catch((e) => {
                cleanup();
                reject(new Error(friendly(e) || 'Could not write the tag.'));
            });
        });
    }
    try {
        await new window.NDEFReader().write({ records: [isUrl ? { recordType: 'url', data: message } : { recordType: 'text', data: message }] });
    } catch (e) {
        throw new Error(friendly(e) || 'Could not write the tag.');
    }
}

export async function cancelWrite() {
    if (isNative()) (await plugin()).cancelWriteAndroid?.().catch?.(() => {});
}
