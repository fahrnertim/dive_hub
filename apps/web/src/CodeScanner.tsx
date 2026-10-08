import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileTrigger } from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { pictureOf, readQr, readQrFromFile } from './lib/qr-reader.ts';
import { Button, Dialog, Notice } from './ui/index.ts';

/** What the camera is doing, or why it isn't; each but `requesting` and `live` has its own sentence. */
type CameraState = 'requesting' | 'live' | 'insecure' | 'unsupported' | 'denied' | 'noDevice' | 'unreadable' | 'stopped' | 'failed';

/** States a new attempt can't change: the browser gives this page no camera at all. */
const FINAL: CameraState[] = ['insecure', 'unsupported'];

/** How often a frame is read while the camera runs. */
const FRAME_INTERVAL_MS = 150;
/** The longer side a frame is scaled down to: enough for a code held in front of the camera. */
const FRAME_LONGEST_SIDE = 960;

/** The browser's cameras. A page over plain HTTP has none, whatever the types say. */
const cameras = (): MediaDevices | undefined => navigator.mediaDevices;

/** Without `navigator.mediaDevices` nothing was denied, and no retry helps. */
function cameraAtStart(): CameraState {
  if (cameras()) return 'requesting';
  return window.isSecureContext ? 'unsupported' : 'insecure';
}

/** Why the camera didn't start, by the name of what `getUserMedia` rejected with. */
function cameraFailure(error: unknown): CameraState {
  switch (error instanceof DOMException ? error.name : '') {
    case 'NotAllowedError': case 'SecurityError': return 'denied';
    case 'NotFoundError': case 'OverconstrainedError': return 'noDevice';
    case 'NotReadableError': case 'AbortError': return 'unreadable';
    default: return 'failed';
  }
}

/**
 * The camera's picture, read until a QR code is found. This component owns the camera: it stops every track when the
 * code is read, when the camera ends by itself and when it unmounts, and a camera that answers after that is stopped
 * unseen.
 */
function CameraScan({ onText }: { onText: (text: string) => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(cameraAtStart);
  const found = useRef(onText);
  useEffect(() => { found.current = onText; }, [onText]);

  useEffect(() => {
    const devices = cameras();
    if (!devices) return;
    const element = video.current!;
    const canvas = document.createElement('canvas');
    let disposed = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const release = () => {
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      stream = null;
      element.srcObject = null;
    };
    const look = async () => {
      const picture = pictureOf(element, element.videoWidth, element.videoHeight, canvas, FRAME_LONGEST_SIDE);
      const text = picture && await readQr(picture);
      if (disposed || !stream) return;
      if (text) { release(); found.current(text); return; }
      timer = window.setTimeout(look, FRAME_INTERVAL_MS);
    };
    devices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(async (got) => {
      if (disposed) { got.getTracks().forEach((track) => track.stop()); return; }
      stream = got;
      // The camera ending by itself (unplugged, taken by the system): stop() doesn't fire this.
      got.getTracks().forEach((track) => { track.onended = () => { release(); setState('stopped'); }; });
      element.srcObject = got;
      // play() is refused when the stream is taken away meanwhile; the next frame simply has no picture.
      await element.play().catch(() => undefined);
      if (disposed || !stream) return;
      setState('live');
      void look();
    }, (error: unknown) => { if (!disposed) setState(cameraFailure(error)); });
    return () => { disposed = true; release(); };
  }, [attempt]);

  const failed = state !== 'requesting' && state !== 'live';
  return (
    <div className="scanner">
      {/* Always there, so the stream has its element; shown once the camera runs. */}
      <video ref={video} className="scanner-video" hidden={state !== 'live'} muted playsInline aria-label={t('scan.picture')} />
      {!failed && <p className="muted" role="status">{t(`scan.${state}`)}</p>}
      {failed && <Notice tone="danger">{t(`scan.${state}`)}</Notice>}
      {failed && !FINAL.includes(state) && (
        <div className="form-actions">
          <Button onPress={() => { setState('requesting'); setAttempt((n) => n + 1); }}>{t('scan.retry')}</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Reads a QR code by camera or from an image file and hands on its text (ADR 0043). What the text is stays the
 * server's to say. `children`: the buttons that stand before these two.
 */
export function CodeScanner({ onText, children }: { onText: (text: string) => void; children?: ReactNode }) {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [reading, setReading] = useState(false);
  const [noCode, setNoCode] = useState(false);
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setNoCode(false);
    setReading(true);
    const text = await readQrFromFile(file).finally(() => setReading(false));
    if (text) onText(text);
    else setNoCode(true);
  };
  return (
    <>
      <div className="form-actions">
        {children}
        <Button icon="camera" onPress={() => { setNoCode(false); setScanning(true); }}>{t('scan.camera')}</Button>
        <FileTrigger acceptedFileTypes={['image/*']} onSelect={(list) => { void readFile(list?.[0]); }}>
          <Button icon="image" isPending={reading}>{t('scan.image')}</Button>
        </FileTrigger>
      </div>
      {noCode && <Notice tone="danger">{t('scan.noCodeInImage')}</Notice>}
      <Dialog title={t('scan.title')} isOpen={scanning} onOpenChange={setScanning}>
        <CameraScan onText={(text) => { setScanning(false); onText(text); }} />
        <div className="form-actions">
          <Button onPress={() => setScanning(false)}>{t('scan.close')}</Button>
        </div>
      </Dialog>
    </>
  );
}
