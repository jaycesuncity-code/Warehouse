// QR scanning: BarcodeDetector where the browser has it, bundled jsQR otherwise.
// Only `prt-` part labels are accepted by callers (see ids.ts).

import jsQR from "jsqr";

/** Decodes a QR code from raw RGBA pixels. Returns the text or null. */
export function decodeImageData(data: Uint8ClampedArray, width: number, height: number): string | null {
  const r = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return r?.data ?? null;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function nativeDetector(): Detector | null {
  const BD = (globalThis as typeof globalThis & {BarcodeDetector?: new(options:{formats:string[]})=>Detector}).BarcodeDetector;
  if (!BD) return null;
  try {
    return new BD({ formats: ["qr_code"] }) as Detector;
  } catch {
    return null;
  }
}

export interface ScannerHandle {
  stop: () => void;
  torch: (on: boolean) => Promise<boolean>;
}

/** Starts the rear camera on `video` and calls onCode for each decoded value (deduped ~1.5 s). */
export async function startCameraScanner(video: HTMLVideoElement, onCode: (text: string) => void): Promise<ScannerHandle> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("no_camera");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play().catch(() => {});
  const detector = nativeDetector();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let stopped = false;
  let last = "";
  let lastAt = 0;
  const emit = (t: string) => {
    const now = Date.now();
    if (t === last && now - lastAt < 1500) return;
    last = t;
    lastAt = now;
    onCode(t);
  };
  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        if (detector) {
          const found = await detector.detect(video);
          if (found[0]?.rawValue) emit(found[0].rawValue);
        } else {
          const w = Math.min(640, video.videoWidth);
          const h = Math.round((video.videoHeight / video.videoWidth) * w);
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const t = decodeImageData(img.data, w, h);
          if (t) emit(t);
        }
      } catch {
        /* keep scanning */
      }
    }
    setTimeout(() => requestAnimationFrame(() => void tick()), 120);
  };
  void tick();
  const track = stream.getVideoTracks()[0];
  return {
    stop: () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
    torch: async (on: boolean) => {
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet & {torch:boolean}] });
        return true;
      } catch {
        return false;
      }
    },
  };
}
