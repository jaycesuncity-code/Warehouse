/** Test utility: inspect actual PDF streams and rasterize their vector QR rectangles. */
import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import { isPartId } from '../shared/ids';

type Rectangle = { x: number; y: number; w: number; h: number };
export function inspectLabelPdf(bytes: Buffer) {
  const text = bytes.toString('latin1');
  const page = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  if (!page) throw new Error('Missing PDF MediaBox');
  const pages = [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    const stream = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    const rectangles: Rectangle[] = [...stream.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\b/g)].map(match => ({ x: +match[1], y: +match[2], w: +match[3], h: +match[4] }));
    const labels = rectangles.filter(rect => Math.abs(rect.w - 2.95 * 72) < .001 && Math.abs(rect.h + .84 * 72) < .001);
    const ink = rectangles.filter(rect => rect.h > 0 && rect.h < 4);
    const decoded = labels.map(label => {
      const scale = 300 / 72, width = Math.round(label.w * scale), height = Math.round(-label.h * scale);
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (const rect of ink) {
        if (rect.x < label.x || rect.x + rect.w > label.x + label.w || rect.y + rect.h > label.y || rect.y < label.y + label.h) continue;
        const x0 = Math.round((rect.x - label.x) * scale), x1 = Math.round((rect.x + rect.w - label.x) * scale);
        const y0 = Math.round((label.y - rect.y - rect.h) * scale), y1 = Math.round((label.y - rect.y) * scale);
        for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
          const p = (y * width + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0;
        }
      }
      const qr = jsQR(data, width, height);
      if (!qr || !isPartId(qr.data)) throw new Error('PDF QR failed canonical scanner roundtrip');
      return qr.data;
    });
    return { labels, decoded, stream };
  });
  return { width: +page[1], height: +page[2], pages };
}
