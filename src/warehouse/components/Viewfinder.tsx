import { Button } from '../../shared/ui';
import { useCameraScan, type CameraState } from '../useCameraScan';

const MESSAGES: Partial<Record<CameraState, { title: string; body: string }>> = {
  denied: {
    title: 'Camera is blocked',
    body: 'Allow the camera for this site in your browser settings, then tap Try again. You can still type the code below or use a handheld scanner.',
  },
  'no-camera': {
    title: 'No camera found',
    body: 'This device has no usable camera. Type the code below or use a handheld scanner.',
  },
  unsupported: {
    title: 'Camera not available here',
    body: 'Browsers only allow the camera on secure (HTTPS) pages. Type the code below or use a handheld scanner.',
  },
  error: {
    title: "Couldn't start the camera",
    body: 'Close other apps that use the camera, then tap Try again.',
  },
};

interface Props {
  enabled: boolean;
  onText: (text: string) => void;
  className?: string;
}

/** Live viewfinder with torch toggle and friendly states. */
export function Viewfinder({ enabled, onText, className = '' }: Props) {
  const { videoRef, state, torchSupported, torchOn, toggleTorch, retry } = useCameraScan({ enabled, onText });
  const msg = MESSAGES[state];
  return (
    <div
      className={`relative overflow-hidden rounded-3xl bg-black ${className}`}
      data-testid="viewfinder"
      data-camera-state={state}
    >
      <video
        ref={videoRef}
        className="aspect-[4/3] w-full object-cover"
        playsInline
        muted
        aria-label="Camera view"
      />
      {state === 'running' || state === 'starting' ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="relative h-[62%] aspect-square rounded-2xl border-4 border-gold/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <div className="scan-line absolute inset-x-0 top-0 h-1 bg-gold" />
            </div>
          </div>
          <p className="absolute inset-x-0 bottom-2 text-center text-base font-bold text-white drop-shadow">
            {state === 'starting' ? 'Starting camera…' : 'Point at the QR code on the label'}
          </p>
        </>
      ) : null}
      {torchSupported ? (
        <button
          type="button"
          onClick={() => void toggleTorch()}
          aria-pressed={torchOn}
          className={`absolute right-2 top-2 min-h-touch min-w-touch rounded-2xl border-2 px-3 text-lg font-extrabold ${torchOn ? 'border-gold bg-gold text-ink' : 'border-white/70 bg-black/50 text-white'}`}
        >
          {torchOn ? '🔦 Light on' : '🔦 Light'}
        </button>
      ) : null}
      {msg ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink p-5 text-center text-white"
          role="status"
          data-testid="camera-message"
        >
          <p className="text-xl font-extrabold">{msg.title}</p>
          <p className="text-base text-white/85">{msg.body}</p>
          {state !== 'unsupported' && state !== 'no-camera' ? (
            <Button variant="gold" onClick={retry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
