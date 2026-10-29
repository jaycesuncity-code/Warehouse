import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { isPartId } from "../ids";
import { startCameraScanner, type ScannerHandle } from "./index";

/** Camera scan of a part label. Calls onPartId only for valid `prt-` IDs. */
export function ScannerDialog({ open, onClose, onPartId }: { open: boolean; onClose: () => void; onPartId: (id: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "live" | "denied" | "none" | "bad">("starting");
  const [torch, setTorch] = useState(false);
  const handle = useRef<ScannerHandle | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState("starting");
    (async () => {
      try {
        const h = await startCameraScanner(video.current!, (text) => {
          const t = text.trim();
          if (isPartId(t)) {
            navigator.vibrate?.(60);
            onPartId(t);
          } else setState("bad");
        });
        if (cancelled) h.stop();
        else {
          handle.current = h;
          setState("live");
        }
      } catch (e: unknown) {
        setState(e instanceof Error && e.name === "NotAllowedError" ? "denied" : "none");
      }
    })();
    return () => {
      cancelled = true;
      handle.current?.stop();
      handle.current = null;
    };
  }, [open, onPartId]);
  return (
    <Dialog open={open} title="Scan a part label" onClose={onClose}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
        <video ref={video} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-8 rounded-lg border-4 border-gold/80" />
      </div>
      <p className="mt-2 text-sm text-gray-700">
        {state === "starting" && "Starting the camera…"}
        {state === "live" && "Point the camera at the QR on a part label."}
        {state === "denied" && "Camera permission was denied. Allow camera access in the browser settings, or type the Part ID in the search box."}
        {state === "none" && "No camera found. Type or paste the Part ID in the search box instead (a handheld scanner works there too)."}
        {state === "bad" && "That isn't one of our part labels. Part labels hold an ID like prt-k7m2qx9d."}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          className="btn-ghost"
          disabled={state !== "live"}
          onClick={async () => {
            const ok = await handle.current?.torch(!torch);
            if (ok) setTorch(!torch);
          }}
        >
          {torch ? "Torch off" : "Torch on"}
        </button>
        <button className="btn-ghost ml-auto" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
