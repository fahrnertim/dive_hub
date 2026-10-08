---
name: media-capture-device-contracts
description: "Use when browser camera or microphone capture stays blocked after denial, reports the wrong recovery, fails when a device is unplugged or switched, opens the same device twice, or leaves the camera light or microphone active after replacement, navigation, or unmount. Browser-page getUserMedia session (top-level pages and app WebViews), device-change, and MediaStreamTrack ownership scope; use iframe-embed-contracts for embedded capability delegation, webview-bridge-pages for the native app's permission grant and bridge timing (the page's own getUserMedia call, track replacement, and teardown inside a WebView stay here), user-activation-contracts only when a separate gesture-gated API fails with trusted-event timing evidence, and a recording-specific workflow for MediaRecorder final-chunk semantics."
---

# Media capture device contracts

A camera or microphone flow is a session lifecycle, not a one-time permission check. The contract is to request the intended tracks, represent the actual failure, recover without promising a browser prompt, replace devices without leaking capture, and release every track the page owns.

## Checklist

1. Reproduce in a supported browser with the actual origin, browsing context, requested constraints, and device state. Record whether the context is secure and whether `navigator.mediaDevices` exists before interpreting a rejection as user denial.
2. Trace one request from `getUserMedia()` through stream attachment and teardown. Identify which component or session owns each returned track, clone, event listener, and media element.
3. Classify the actual exception instead of mapping every failure to "permission denied":
   - First separate API availability. An insecure context can leave `navigator.mediaDevices` unavailable, so handle a missing API or resulting `TypeError` before interpreting a callable request's rejection.
   - `NotAllowedError` can indicate denied capture or an applicable capability policy. Route an iframe policy failure to `iframe-embed-contracts`.
   - `NotFoundError` means the requested track type has no matching source.
   - `NotReadableError` means capture could not start despite permission, including browser, operating-system, or hardware access failures.
   - `OverconstrainedError` identifies constraints that no candidate can satisfy; record the reported constraint when the browser provides it.
   - Treat `AbortError`, `InvalidStateError`, `TypeError`, and other failures according to the captured browser evidence rather than relabeling them.
4. Model explicit states such as `idle`, `requesting`, `live`, `interrupted`, `denied`, `no-device`, `unreadable`, `constraints-failed`, and `stopped`. Commit `live` only after a current stream is attached and its required tracks are live and not `muted`. A user can leave the browser prompt unanswered, so do not convert a still-pending request into denial. Let the UI dismiss or supersede that attempt, then dispose of any stream that resolves late.
5. Keep recovery truthful:
   - After denial, offer an explicit retry and accurate browser-settings help; do not claim JavaScript can force the permission prompt to reopen.
   - For no-device or device removal, use `devicechange` where the target browser exposes it, reconcile again on explicit retry, and let the user select an available device.
   - For an unreadable device, release tracks the session owns before retrying and avoid telling the user that permission is necessarily missing.
   - Relax an overconstrained request only when the product accepts the fallback. Report the degraded mode instead of silently changing it.
6. Use the Permissions API only as optional diagnostic context when the browser exposes the relevant descriptor. A permission query can reject or omit part of the capture decision; the `getUserMedia()` result and live track state remain authoritative.
7. Make device replacement a defined ownership transition. Do not open a second capture merely to preview the source when an owned track or deliberately owned clone can satisfy the use case. If replacement requires a new stream, attach the accepted replacement and stop/detach the old owned stream exactly once. If the platform cannot open both concurrently, represent the interruption while releasing the old source first.
8. Handle temporary and permanent interruption separately. An owned track can retain `readyState === "live"` while `muted === true` because its source is temporarily unable to provide media. On `mute`, move the UI to a truthful `interrupted` state without declaring the track stopped; on `unmute`, return to `live` only if the same current track is still owned, live, and unmuted. Use the `ended` event for source-ended paths. Calling `stop()` sets `readyState` to `ended` but does not fire that event, so the owner must perform its own stopped-state transition and cleanup. Reconcile the device list after `devicechange`, and do not report healthy capture while a required track is muted.
9. On replacement, cancellation, route change, or unmount, remove listeners, clear pending-request ownership, detach media elements (`srcObject = null` where the page assigned it), and call `stop()` on every track this session owns. If a late request resolves after disposal, stop its tracks immediately instead of attaching them. Register and remove `mute`, `unmute`, and `ended` handlers as one idempotent per-track ownership unit so replaced tracks cannot update the current session.
10. Do not stop a borrowed track without an ownership contract. Stopping one track ends that track, but a shared camera or microphone source can remain active while another track still uses it.

## Quick probes

- Log a request generation, constraints, exception `name`, reported `constraint`, track IDs, `readyState`, and owning session at each transition. Avoid logging device labels or identifiers unless the debugging environment permits that data.
- Count live owned tracks before capture, after device replacement, and after unmount. The final count must return to zero.
- Deny capture, retry from the recovery UI, and verify that the UI never says the camera is active before a live track is attached.
- Unplug or disable the selected device, then restore or select another one. Verify one recovery path and no duplicate listeners or streams.
- Temporarily interrupt the source without ending its track. Assert `readyState === "live"` with `muted === true` produces an interrupted UI, then confirm `unmute` restores the same current session without reacquiring or duplicating tracks.
- Delay `getUserMedia()`, unmount before it resolves, and assert that the late stream is stopped and never assigned to the media element.

## Boundary with sibling skills

- `iframe-embed-contracts` owns `allow`, sandbox, and Permissions Policy capability delegation between parent and guest documents.
- `webview-bridge-pages` owns the native app's permission grant, bridge message timing, and WebView host lifecycle. The page's own `getUserMedia()` call and its rejection handling, duplicate acquisition, device replacement, and track teardown stay in this skill even inside a WebView; route to `webview-bridge-pages` only when the evidence points at the host never granting the permission.
- A `getUserMedia()` rejection alone does not route to `user-activation-contracts`. Use that skill only when a distinct gesture-gated operation, such as playback or fullscreen, fails and the trusted-event timing or activation-consumption boundary is in evidence.
- Recording finalization, encoded chunks, and `MediaRecorder` stop/data event ordering require a recording-specific workflow. This skill owns the input tracks only.
- Generic geolocation, notifications, and unrelated permission prompts are out of scope.

## PR-worthiness gate

Require a real browser capture sequence that identifies the requested media kind, exception or track transition, owning session, and user-visible wrong state or leaked resource. A fix must preserve truthful recovery and add a regression for the failing denial, mute/unmute, device-change, replacement, or teardown sequence. Use a physical or controlled virtual camera/microphone for the live path and browser-controlled permission state for denial; mocked unit tests are supplemental, not proof of browser capture behavior. Use [`references/real-device-validation.md`](references/real-device-validation.md) when the claim includes native permission UI, OS indicators, or hardware.

The bundled localhost Chromium fake-device casebook exercises real `getUserMedia()` acquisition plus in-page stream attachment, replacement, late resolution, and teardown checks. A second Playwright matrix runs the same application-owned lifecycle with browser-created synthetic `MediaStream` tracks in the engines listed in `CASEBOOK_BROWSERS` (default Chromium only; set `CASEBOOK_BROWSERS=chromium,firefox,webkit` for all three, as the repository's CI workflow does). Both skip when the Playwright CLI is missing. The matrix is cross-engine application lifecycle evidence, not native permission, `getUserMedia()`, branded Safari, OS permission UI, physical unplug/mute, or real camera/microphone hardware evidence.

Reject weak findings: the mere presence of `getUserMedia()`, `enumerateDevices()`, or a permission query; an empty or redacted device label before permission; a stopped borrowed track whose owner intentionally keeps the source active; an unsupported browser claim with no target-browser evidence; or an iframe, native WebView, or recording-finalization defect that belongs to another workflow. A click handler, `await`, or capture rejection without a distinct gated API failure and trusted-event timing evidence is not an activation finding. A single `mute` or `unmute` listener is not a defect when the UI, current-track guard, and teardown remain truthful and idempotent.

## Output shape

Start with a disposition: confirmed, candidate/needs evidence, reject, or route. Report the browser/context and requested constraints, observed exception or track transition, `readyState` and `muted` evidence, current UI state versus real track state, ownership and listener/media-element evidence, smallest recovery or teardown change, sibling handoff when applicable, and the real-browser/device regression that confirms the intended result. State any untested denial, mute/unmute, unplug, switch, or late-resolution path instead of assuming it works.

## Sources

- MDN, `MediaDevices.getUserMedia()` security requirements, constraints, and rejection taxonomy: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>
- MDN, Permissions API, including permission-state aggregation and policy/context considerations: <https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API>
- MDN, `MediaDeviceInfo.label` permission-dependent disclosure: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDeviceInfo/label>
- MDN, `MediaStreamTrack.stop()`, including the immediate `readyState` change, absence of an `ended` event, and shared-source behavior:
  <https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop>
- MDN, `MediaStreamTrack` `mute` event for temporary inability to provide media: <https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/mute_event>
- MDN, `MediaStreamTrack` `unmute` event when the source resumes media: <https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/unmute_event>
- MDN, `MediaDevices.devicechange`: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event>
- MDN, Permissions Policy header and camera/microphone directives: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy>
- MDN, features gated by user activation and transient/sticky activation evidence: <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation>
- Playwright, browser installation and bundled Chromium, Firefox, and WebKit builds: <https://playwright.dev/docs/browsers>
- Playwright, `browserContext.grantPermissions()` and its browser/version support caveat:
  <https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions>
- Chromium source at revision `b7db704c908cfc97327db76c02ab5ef0f0372a27`, fake media-device switch replacing actual camera and microphone input:
  <https://chromium.googlesource.com/chromium/src/+/b7db704c908cfc97327db76c02ab5ef0f0372a27/media/base/media_switches.cc?format=TEXT>
- Public prior-art issue showing a denied-permission flow that expects the browser prompt to be reopened: <https://github.com/mozmorris/react-webcam/issues/160>
- Public prior-art issue showing camera capture remaining active after component unmount: <https://github.com/mozmorris/react-webcam/issues/292>
- Public prior-art issue showing double capture, device contention, track cloning, and cleanup concerns: <https://github.com/Vonage/vonage-video-react-app/issues/619>
