import { useCallback, useEffect, useRef, useState } from 'react';
import { createFrameReader } from './scanner';

export type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'no-camera' | 'unsupported' | 'error';

interface Options {
  enabled: boolean;
  /** Called with the raw text of a QR code. The same text is not reported again for `repeatMs`. */
  onText: (text: string) => void;
  repeatMs?: number;
}

/** Live camera + QR reading. Handles permission denied, no camera, and pages that are not HTTPS. */
export function useCameraScan({ enabled, onText, repeatMs = 2500 }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const [state, setState] = useState<CameraState>('idle');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    const last = { text: '', at: 0 };
    const videoEl = videoRef.current;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unsupported');
        return;
      }
      setState('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (e) {
        if (stopped) return;
        const name = (e as DOMException)?.name;
        setState(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'no-camera'
              : 'error',
        );
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute('playsinline', 'true');
      try {
        await video.play();
      } catch {
        /* autoplay quirks: frames still arrive */
      }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchSupported(!!caps.torch);
      setTorchOn(false);
      setState('running');

      const read = createFrameReader();
      let busy = false;
      timer = window.setInterval(async () => {
        if (busy || stopped || video.readyState < 2) return;
        busy = true;
        try {
          const text = await read(video);
          if (text && !stopped) {
            const now = Date.now();
            if (text !== last.text || now - last.at > repeatMs) {
              last.text = text;
              last.at = now;
              onTextRef.current(text);
            }
          }
        } finally {
          busy = false;
        }
      }, 160);
    }
    void start();

    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      if (videoEl) videoEl.srcObject = null;
    };
  }, [enabled, attempt, repeatMs]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { videoRef, state, torchSupported, torchOn, toggleTorch, retry };
}
