/**
 * QR decoding. The browser's BarcodeDetector is used when it exists; otherwise (and in tests) the bundled
 * jsQR decoder reads raw pixels. Both paths feed the same label check in `checkLabel`.
 */
import jsQR from 'jsqr';
import { isPartId } from '../shared/ids';

/** Trim and lower-case (some handheld scanners type in capitals). */
export const normalizeLabel = (raw: string): string => raw.trim().toLowerCase();

export type LabelCheck = { ok: true; partId: string } | { ok: false; text: string };

/** Only text that is exactly a part ID is accepted as a label. */
export function checkLabel(raw: string): LabelCheck {
  const t = normalizeLabel(raw);
  return isPartId(t) ? { ok: true, partId: t } : { ok: false, text: raw.trim() };
}

/** Decode a QR code from RGBA pixels (same layout as ImageData.data). Returns the text or null. */
export function decodeQrFromPixels(data: Uint8ClampedArray, width: number, height: number): string | null {
  const hit = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return hit ? hit.data : null;
}

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts?: { formats?: string[] }) => DetectorLike;

export function createNativeDetector(): DetectorLike | null {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

/** Reads one video frame: native detector first, bundled decoder as the fallback. */
export function createFrameReader(): (video: HTMLVideoElement) => Promise<string | null> {
  const native = createNativeDetector();
  let canvas: HTMLCanvasElement | null = null;
  return async (video) => {
    if (native) {
      try {
        const found = await native.detect(video);
        if (found[0]?.rawValue) return found[0].rawValue;
        return null;
      } catch {
        /* fall through to the bundled decoder */
      }
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, 720 / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    canvas ??= document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return decodeQrFromPixels(img.data, w, h);
  };
}
