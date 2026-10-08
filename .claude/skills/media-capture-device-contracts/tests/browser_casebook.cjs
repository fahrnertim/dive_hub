#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  const cli = process.env.PLAYWRIGHT_CLI;
  if (!cli) throw new Error('PLAYWRIGHT_CLI is required');
  const packageRoot = path.dirname(fs.realpathSync(cli));
  return require(packageRoot);
}

async function main() {
  const [, , infoPath, browserName = 'chromium', mode = 'native-get-user-media'] = process.argv;
  if (!infoPath) {
    throw new Error(
      'usage: browser_casebook.cjs <server-info.json> <browserName> '
      + '<native-get-user-media|synthetic-app-lifecycle>',
    );
  }
  if (!['native-get-user-media', 'synthetic-app-lifecycle'].includes(mode)) {
    throw new Error(`unsupported casebook mode: ${mode}`);
  }
  if (mode === 'native-get-user-media' && browserName !== 'chromium') {
    throw new Error('native-get-user-media mode is intentionally limited to Chromium fake devices');
  }

  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const playwright = loadPlaywright();
  const browserType = playwright[browserName];
  if (!browserType || typeof browserType.launch !== 'function') {
    throw new Error(`requested browser "${browserName}" is not exposed by Playwright`);
  }

  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      args: mode === 'native-get-user-media'
        ? [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ]
        : [],
    });
  } catch (error) {
    throw new Error(
      `requested browser "${browserName}" could not launch for ${mode}: ${error.message}`,
      { cause: error },
    );
  }

  try {
    const page = await browser.newPage();
    await page.goto(info.url, { waitUntil: 'domcontentloaded' });
    const payload = await page.evaluate(({ evaluatedBrowserName, evaluatedMode }) => Promise.race([
      window.runMediaCaptureCasebook(evaluatedMode, evaluatedBrowserName),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('media capture casebook timed out')), 10_000);
      }),
    ]), {
      evaluatedBrowserName: browserName,
      evaluatedMode: mode,
    });

    assert.equal(payload.status, 'pass');
    assert.equal(payload.browserName, browserName);
    assert.equal(payload.mode, mode);
    assert.equal(payload.secureContext, true);
    assert.deepEqual(payload.acquiredKinds, ['audio', 'video']);
    assert.equal(payload.initialTracksLive, true);
    assert.equal(payload.initialTracksEnded, true);
    assert.equal(payload.initialDetached, true);
    assert.equal(payload.supersededLateStopped, true);
    assert.equal(payload.supersededNeverAttached, true);
    assert.equal(payload.replacementTracksLive, true);
    assert.equal(payload.replacementTracksEnded, true);
    assert.equal(payload.replacementDetached, true);
    assert.equal(payload.disposedLateStopped, true);
    assert.equal(payload.disposedLateNeverAttached, true);
    if (mode === 'native-get-user-media') {
      assert.equal(payload.mediaDevicesAvailable, true);
      assert.equal(payload.evidenceScope, 'Chromium fake-device getUserMedia app lifecycle');
      assert.deepEqual(payload.notProofOf, [
        'OS permission UI',
        'physical device unplug or mute',
        'real camera and microphone hardware',
      ]);
    } else {
      assert.equal(payload.syntheticPrimitives.canvasCaptureStream, true);
      assert.equal(payload.syntheticPrimitives.webAudioDestination, true);
      assert.equal(payload.evidenceScope, 'synthetic MediaStream app lifecycle');
      assert.deepEqual(payload.notProofOf, [
        'native permission or getUserMedia behavior',
        'OS permission UI',
        'physical device unplug or mute',
        'real camera and microphone hardware',
      ]);
    }

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
