# Real device validation protocol

Use this reference when a media-capture finding depends on native browser permission UI, operating-system permission state, real camera/microphone hardware, device indicators, device switching, unplugging, mute, backgrounding, or teardown behavior.

Do not treat Playwright `browserContext.grantPermissions()`, fake media devices, stubbed `getUserMedia()`, or synthetic `MediaStream` objects as proof of native permission UI or hardware behavior. Those tools are useful regression aids only.

This protocol is a manual evidence contract. It does not claim the steps have been executed.

## Contents

- [Scope](#scope)
- [Fresh profile setup](#fresh-profile-setup)
- [Permission matrix](#permission-matrix)
- [Hardware matrix](#hardware-matrix)
- [Required capture log](#required-capture-log)
- [Pass / fail rule](#pass--fail-rule)
- [Evidence packet](#evidence-packet)
- [Sources](#sources)

## Scope

This protocol validates top-level browser `getUserMedia()` sessions and the page-owned `MediaStreamTrack` lifecycle covered by `media-capture-device-contracts`.

Out of scope:

- iframe permission delegation;
- native WebView host permissions;
- `MediaRecorder` final chunk ordering;
- generic notification, geolocation, or unrelated permission prompts.

## Fresh profile setup

Use a clean browser profile for permission UI validation:

1. Clear existing camera/microphone permissions for the origin, or create a fresh profile with no persisted permission state.
2. Confirm the page is loaded from the intended secure origin.
3. Record browser, OS, profile state, origin, requested constraints, and attached camera/microphone hardware.
4. Start screen recording or capture still images of the permission UI and browser/OS indicators. Redact origin details if the environment requires it.

Do not use pre-granted permissions, automation permission overrides, fake-device flags, or cached profiles for the native-permission claim.

## Permission matrix

Run separate fresh-profile attempts for each permission outcome the product claims to handle.

| Outcome | Required evidence | Pass condition |
| --- | --- | --- |
| Allow | Browser prompt or settings state, fulfilled `getUserMedia()`, live required tracks, visible capture indicator | UI reaches live only after a current stream is attached and required tracks are live and unmuted |
| Deny | Browser prompt denial or persisted blocked state, rejection name, recovery UI | UI reports denial truthfully and does not claim JavaScript can force the prompt to reopen |
| Dismiss / ignore | Prompt remains unanswered or is dismissed, request remains pending or rejects according to the browser | UI can cancel, retry, or supersede without converting a pending prompt into a false denial or live state |
| Retry after state change | User changes browser/OS permission or device state, then retries | UI reflects the new result and disposes of stale pending streams |

Record the exact exception `name` and any reported `constraint` for rejected requests. Do not collapse all failures into `NotAllowedError`.

## Hardware matrix

Run the rows that match the product's support claim.

| Scenario | Steps | Pass condition |
| --- | --- | --- |
| Camera attach | Allow video capture with a real camera | Current video track is live, attached once, and stopped on teardown |
| Microphone attach | Allow audio capture with a real microphone | Current audio track is live, owned once, and stopped on teardown |
| Device switch | Switch from one real camera or microphone to another | Replacement attaches as current, old owned tracks stop exactly once, UI does not show both as active unless dual capture is a product contract |
| Device unplug / disable | Remove, disable, or make the selected device unavailable during capture | UI moves to interrupted/no-device/unreadable state according to browser evidence and does not show healthy capture |
| Device restore | Reconnect or re-enable the device, then retry or select it | UI recovers only after a new valid stream or current live track evidence |
| Hardware mute | Mute camera cover, microphone hardware switch, OS input mute, or equivalent supported device mute | UI represents temporary interruption without falsely declaring a stopped track when `readyState` remains `live` |
| Background / tab switch | Background the tab, switch apps, lock/unlock if in scope, then return | UI and owned tracks remain truthful; background interruption does not leak duplicate streams |
| Route change / unmount | Navigate away, unmount, or replace the capture owner | Media elements detach and every page-owned track is stopped; late streams are stopped and never attached |

## Required capture log

Collect a redacted log around each run:

- request generation/session id;
- origin and secure-context status;
- requested constraints;
- permission outcome: allow, deny, dismiss, preblocked, or changed in settings;
- exception `name` and `constraint` when rejected;
- stream id or redacted stream token;
- track kind, redacted track token, `readyState`, `muted`, and current owner;
- `mute`, `unmute`, `ended`, and `devicechange` events when observed;
- media element attachment and `srcObject = null` detach points;
- `stop()` calls for every page-owned track;
- browser capture indicator and OS indicator state when visible.

Redact device labels, device ids, user names, room audio/video, notification content, origin details, and screenshots unless the test environment explicitly permits disclosure. Keep enough anonymized tokens to compare old and new track ownership.

## Pass / fail rule

Mark real-device coverage as **pass** only when the declared permission and hardware matrix has browser/OS evidence, current stream/track logs, and teardown evidence for every page-owned track. Mark it **partial** when browser automation, fake devices, virtual devices, or one permission outcome passed but native UI or real hardware rows are missing. Mark it **fail** when the UI mislabels the permission outcome, attaches a stale or superseded stream, leaks a page-owned track, fails to stop old tracks after replacement, or shows healthy capture while required current tracks are missing, ended, or muted.

## Evidence packet

Attach or summarize:

- test date and tester role;
- browser, OS, profile freshness, origin, and permission state;
- requested constraints and declared product support matrix;
- redacted permission UI screenshots or video;
- redacted browser/OS capture indicator evidence;
- redacted stream/track lifecycle log;
- final UI state and live owned-track count;
- rows not run and why.

## Sources

- Playwright, Emulation: browser contexts can emulate permissions and device properties, which makes them useful for repeatable tests but not native UI or hardware proof:
  <https://playwright.dev/docs/emulation>
- Playwright, `browserContext.grantPermissions()`: overrides permissions for a browser context and can later be cleared:
  <https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions>
- MDN, `MediaDevices.getUserMedia()`: prompts the user for permission, returns a `MediaStream` with requested tracks, requires secure-context handling, and reports different rejection names for different failure classes:
  <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>
