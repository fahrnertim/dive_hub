#!/usr/bin/env python3
"""Serve the native and synthetic media lifecycle browser casebooks."""

from __future__ import annotations

import json
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


FIXTURE_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Media capture lifecycle casebook</title>
</head>
<body>
  <video id="preview" autoplay muted playsinline></video>
  <script>
  (() => {
    const preview = document.querySelector('#preview');

    const deferred = () => {
      let resolve;
      const promise = new Promise((fulfill) => { resolve = fulfill; });
      return { promise, resolve };
    };

    const allTracksAre = (stream, readyState) =>
      stream.getTracks().length > 0
      && stream.getTracks().every((track) => track.readyState === readyState);

    const stopStream = (stream) => {
      if (!stream) return;
      for (const track of stream.getTracks()) track.stop();
    };

    class CaptureSession {
      constructor(mediaElement, createStream) {
        this.mediaElement = mediaElement;
        this.createStream = createStream;
        this.generation = 0;
        this.currentStream = null;
        this.disposed = false;
        this.attachments = [];
      }

      async acquire(constraints, deliver = (streamPromise) => streamPromise) {
        const requestGeneration = ++this.generation;
        const streamPromise = this.createStream(constraints);
        const stream = await deliver(streamPromise);

        if (this.disposed || requestGeneration !== this.generation) {
          stopStream(stream);
          return { accepted: false, stream };
        }

        if (this.currentStream) stopStream(this.currentStream);
        this.currentStream = stream;
        this.mediaElement.srcObject = stream;
        this.attachments.push(stream);
        return { accepted: true, stream };
      }

      dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.generation += 1;
        this.mediaElement.srcObject = null;
        stopStream(this.currentStream);
        this.currentStream = null;
      }
    }

    const gatedDelivery = () => {
      const acquired = deferred();
      const release = deferred();
      let acquiredStream = null;

      return {
        acquired: acquired.promise,
        release: () => release.resolve(),
        get stream() { return acquiredStream; },
        deliver: async (streamPromise) => {
          acquiredStream = await streamPromise;
          acquired.resolve(acquiredStream);
          await release.promise;
          return acquiredStream;
        },
      };
    };

    const nativeStreamFactory = (constraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('native getUserMedia primitive unavailable');
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    };

    const syntheticResources = [];

    const syntheticStreamFactory = async (constraints) => {
      if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
        throw new Error('synthetic source primitive unavailable: HTMLCanvasElement.captureStream');
      }
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (typeof AudioContextConstructor !== 'function') {
        throw new Error('synthetic source primitive unavailable: AudioContext');
      }

      const tracks = [];
      const resources = {};

      if (constraints.video) {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('synthetic source primitive unavailable: CanvasRenderingContext2D');
        }
        context.fillStyle = '#0f0';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const canvasStream = canvas.captureStream(5);
        const videoTrack = canvasStream.getVideoTracks()[0];
        if (!videoTrack) {
          throw new Error('synthetic source primitive failed: canvas produced no video track');
        }
        tracks.push(videoTrack);
        resources.canvas = canvas;
        resources.canvasStream = canvasStream;
      }

      if (constraints.audio) {
        const audioContext = new AudioContextConstructor();
        const destination = audioContext.createMediaStreamDestination();
        const oscillator = audioContext.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        const audioTrack = destination.stream.getAudioTracks()[0];
        if (!audioTrack) {
          oscillator.stop();
          void audioContext.close();
          throw new Error('synthetic source primitive failed: Web Audio produced no audio track');
        }
        tracks.push(audioTrack);
        resources.audioContext = audioContext;
        resources.destination = destination;
        resources.oscillator = oscillator;
      }

      const stream = new MediaStream(tracks);
      syntheticResources.push(resources);
      return stream;
    };

    const closeSyntheticResources = async () => {
      for (const resources of syntheticResources) {
        if (resources.oscillator) {
          try { resources.oscillator.stop(); } catch {}
        }
        if (resources.audioContext && resources.audioContext.state !== 'closed') {
          await resources.audioContext.close();
        }
      }
    };

    window.runMediaCaptureCasebook = async (mode, browserName) => {
      const createStream = mode === 'synthetic-app-lifecycle'
        ? syntheticStreamFactory
        : nativeStreamFactory;

      const initial = new CaptureSession(preview, createStream);
      const initialResult = await initial.acquire({ audio: true, video: true });
      const acquiredKinds = initialResult.stream.getTracks()
        .map((track) => track.kind)
        .sort();
      const initialTracksLive = allTracksAre(initialResult.stream, 'live');
      const initialAttached = preview.srcObject === initialResult.stream;
      initial.dispose();

      const initialTracksEnded = allTracksAre(initialResult.stream, 'ended');
      const initialDetached = initialAttached && preview.srcObject === null;

      const replacement = new CaptureSession(preview, createStream);
      const supersededGate = gatedDelivery();
      const supersededPromise = replacement.acquire(
        { audio: true, video: true },
        supersededGate.deliver,
      );
      await supersededGate.acquired;
      const replacementResult = await replacement.acquire({ audio: true, video: true });
      const replacementTracksLive = allTracksAre(replacementResult.stream, 'live');
      supersededGate.release();
      const supersededResult = await supersededPromise;

      const supersededLateStopped =
        !supersededResult.accepted && allTracksAre(supersededResult.stream, 'ended');
      const supersededNeverAttached =
        replacement.attachments.length === 1
        && !replacement.attachments.includes(supersededGate.stream)
        && preview.srcObject === replacementResult.stream;
      replacement.dispose();

      const replacementTracksEnded = allTracksAre(replacementResult.stream, 'ended');
      const replacementDetached = preview.srcObject === null;

      const disposed = new CaptureSession(preview, createStream);
      const disposedGate = gatedDelivery();
      const disposedPromise = disposed.acquire(
        { audio: true, video: true },
        disposedGate.deliver,
      );
      await disposedGate.acquired;
      disposed.dispose();
      disposedGate.release();
      const disposedResult = await disposedPromise;

      const disposedLateStopped =
        !disposedResult.accepted && allTracksAre(disposedResult.stream, 'ended');
      const disposedLateNeverAttached =
        disposed.attachments.length === 0 && preview.srcObject === null;

      const payload = {
        status: 'pass',
        browserName,
        mode,
        evidenceScope: mode === 'synthetic-app-lifecycle'
          ? 'synthetic MediaStream app lifecycle'
          : 'Chromium fake-device getUserMedia app lifecycle',
        secureContext: window.isSecureContext,
        mediaDevicesAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
        syntheticPrimitives: {
          canvasCaptureStream:
            typeof HTMLCanvasElement.prototype.captureStream === 'function',
          webAudioDestination:
            typeof (window.AudioContext || window.webkitAudioContext) === 'function',
        },
        acquiredKinds,
        initialTracksLive,
        initialTracksEnded,
        initialDetached,
        supersededLateStopped,
        supersededNeverAttached,
        replacementTracksLive,
        replacementTracksEnded,
        replacementDetached,
        disposedLateStopped,
        disposedLateNeverAttached,
        notProofOf: mode === 'synthetic-app-lifecycle'
          ? [
              'native permission or getUserMedia behavior',
              'OS permission UI',
              'physical device unplug or mute',
              'real camera and microphone hardware',
            ]
          : [
              'OS permission UI',
              'physical device unplug or mute',
              'real camera and microphone hardware',
            ],
      };

      for (const [key, value] of Object.entries(payload)) {
        if (
          ![
            'notProofOf',
            'acquiredKinds',
            'status',
            'browserName',
            'mode',
            'evidenceScope',
            'syntheticPrimitives',
          ].includes(key)
          && value !== true
        ) {
          throw new Error(`${key} was not true: ${JSON.stringify(payload)}`);
        }
      }
      if (acquiredKinds.join(',') !== 'audio,video') {
        throw new Error(`unexpected track kinds: ${JSON.stringify(payload)}`);
      }
      await closeSyntheticResources();
      return payload;
    };
  })();
  </script>
</body>
</html>
"""


class FixtureHandler(BaseHTTPRequestHandler):
    server_version = "MediaCaptureCasebookFixture/1.0"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path not in {"/", "/index.html"}:
            self.send_error(404)
            return

        body = FIXTURE_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    shutdown_started = threading.Event()

    def stop_server(_signum: int, _frame: object) -> None:
        if shutdown_started.is_set():
            return
        shutdown_started.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    signal.signal(signal.SIGINT, stop_server)

    host, port = server.server_address
    print(json.dumps({"url": f"http://{host}:{port}/"}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
