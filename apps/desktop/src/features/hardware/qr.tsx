import jsQR from 'jsqr';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Meter } from '@/components/data/meter';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { formatPercent } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useQrDecode } from './queries';

// QR codes for devices that sign without a cable: an animated sequence of
// codes to show to the device, and the camera to read its answer. The codes
// are made and read by the orchestrator (Uniform Resources, crypto-psbt); the
// interface only draws them and samples the camera.

export interface QrFrame {
  size: number;
  rows: string[];
}

const FRAME_INTERVAL_MS = 250;
const SCAN_INTERVAL_MS = 150;
const QUIET_ZONE = 4;

/** One QR code as an SVG path of its dark modules. */
export function framePath(frame: QrFrame): string {
  let path = '';
  frame.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '1') {
        x += 1;
        continue;
      }
      const start = x;
      while (row[x] === '1') x += 1;
      path += `M${String(start + QUIET_ZONE)} ${String(y + QUIET_ZONE)}h${String(x - start)}v1h${String(start - x)}z`;
    }
  });
  return path;
}

/** One QR code for a short text, such as a server address to scan with a phone. */
export function QrCode({ frame, label }: { frame: QrFrame; label: string }) {
  const size = frame.size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="size-56 shrink-0 rounded-md bg-white"
      shapeRendering="crispEdges"
    >
      <path d={framePath(frame)} fill="#000" />
    </svg>
  );
}

/** The PSBT's QR codes, cycling when there is more than one. */
export function QrFrames({ frames }: { frames: readonly QrFrame[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const paths = useMemo(() => frames.map(framePath), [frames]);
  useEffect(() => {
    if (paused || frames.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % frames.length);
    }, FRAME_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [paused, frames.length]);
  const frame = frames[index % frames.length];
  if (!frame) return null;
  const size = frame.size + QUIET_ZONE * 2;
  return (
    <figure className="space-y-2">
      <svg
        role="img"
        aria-label={t('hardware.qr.codeLabel')}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        className="size-72 rounded-md bg-white"
        shapeRendering="crispEdges"
      >
        <path d={paths[index % frames.length]} fill="#000" />
      </svg>
      <figcaption className="flex flex-wrap items-center gap-3 text-muted-foreground">
        {frames.length > 1
          ? t('hardware.qr.frame', { number: (index % frames.length) + 1, total: frames.length })
          : t('hardware.qr.single')}
        {frames.length > 1 && (
          <Button
            variant="ghost"
            onClick={() => {
              setPaused((current) => !current);
            }}
          >
            {paused ? t('hardware.qr.resume') : t('hardware.qr.pause')}
          </Button>
        )}
      </figcaption>
    </figure>
  );
}

type CameraState = 'starting' | 'scanning' | 'denied' | 'missing' | 'failed';

/** Reads QR codes from the camera until they make up a whole PSBT. */
export function QrScanner({ onPsbt, onCancel }: { onPsbt: (psbt: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef(new Set<string>());
  const decode = useQrDecode();
  const [camera, setCamera] = useState<CameraState>('starting');
  const [progress, setProgress] = useState(0);
  const [read, setRead] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        setCamera(name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'missing' : 'failed');
        return;
      }
      if (cancelled || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setCamera('scanning');
      timer = setInterval(() => {
        const element = video.current;
        const context = canvas.current?.getContext('2d', { willReadFrequently: true });
        if (!element || !context || element.videoWidth === 0 || done.current) return;
        context.canvas.width = element.videoWidth;
        context.canvas.height = element.videoHeight;
        context.drawImage(element, 0, 0);
        const image = context.getImageData(0, 0, element.videoWidth, element.videoHeight);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (!code?.data || parts.current.has(code.data)) return;
        parts.current.add(code.data);
        setRead(parts.current.size);
        decode.mutate([...parts.current], {
          onSuccess: (result) => {
            setProgress(result.progress);
            if (result.complete && result.psbt && !done.current) {
              done.current = true;
              onPsbt(result.psbt);
            }
          },
        });
      }, SCAN_INTERVAL_MS);
    };
    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
    // The camera starts once per scanner; decode and onPsbt are stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = decode.data;
  return (
    <div className="space-y-3">
      {camera === 'denied' && <StatusIndicator tone="failed" label={t('hardware.qr.denied')} />}
      {camera === 'missing' && <StatusIndicator tone="failed" label={t('hardware.qr.missing')} />}
      {camera === 'failed' && <StatusIndicator tone="failed" label={t('hardware.qr.failed')} />}
      <video
        ref={video}
        muted
        playsInline
        aria-label={t('hardware.qr.cameraLabel')}
        className={camera === 'scanning' ? 'w-full max-w-md rounded-md bg-black' : 'hidden'}
      />
      <canvas ref={canvas} className="hidden" />
      {camera === 'scanning' && (
        <div className="max-w-md space-y-1">
          <Meter
            role="progressbar"
            value={progress}
            label={t('hardware.qr.progressLabel')}
            valueText={formatPercent(progress)}
          />
          <p className="text-muted-foreground">
            {read === 0 ? t('hardware.qr.hold') : t('hardware.qr.reading', { count: read })}
          </p>
        </div>
      )}
      {result?.error && <StatusIndicator tone="failed" label={result.error} />}
      {decode.error && <StatusIndicator tone="failed" label={toOrchestratorError(decode.error).message} />}
      <Button variant="ghost" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
