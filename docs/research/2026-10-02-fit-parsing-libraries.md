---
title: FIT parsing libraries
summary: Which libraries can parse Garmin Descent (and later Suunto) dive FIT files on a server, their licenses and maintenance, dive-specific pitfalls, and what that means for the server language.
status: done
date: 2026-10-02
---

# FIT parsing libraries

Markers: **[V]** checked against the primary source; **[S]** secondary source
(forum, blog, third-party doc); **[?]** not verified.

## Question

Which FIT parsing libraries are suitable for parsing Garmin Descent (phase 1) and
Suunto (later) dive FIT files on a server, and what does that imply for the
server's programming language?

## Method

- Garmin's official SDK repositories on GitHub: README, decoder source, license
  text, release list; registry metadata on npm, PyPI, NuGet and Maven Central.
- Shallow clones of the main community parsers: source grepped for dive messages,
  profile version, developer fields, compressed timestamps and chained files.
- Dive projects read at source level: divetracx (`src/modules/garmin/`),
  Subsurface's libdivecomputer fork (`garmin_parser.c`, `garmin.c`), Submersion
  (`pubspec.yaml`), OpenDiving (`pyproject.toml`), DiveJSON (`docs/fit-mapping.md`).
- Web search for Garmin export formats (no official Garmin page found for these).
- No library was run against a real Descent file; no benchmarks were run.

## Findings

### Official Garmin FIT SDKs

- **Languages:** C, C++, C#, Java, JavaScript, Objective-C, Python, Swift [V][fit-overview].
  Each has its own repo under `github.com/garmin` (`fit-<lang>-sdk`), plus
  `fit-sdk-tools` (FitCSVTool, profile) [V][garmin-gh].
- **Latest version:** 21.217.0, released 2026-09-22 in all checked repos (JS,
  Python, C#, Java, C) [V][js-releases].
- **Cadence:** 12 releases between 2026-01-09 and 2026-09-22, i.e. every 1–7 weeks;
  a gap from 21.178 (2025-07-16) to 21.188 (2026-01-09) [V][js-releases].
- **Registries:** npm `@garmin/fitsdk`, PyPI `garmin-fit-sdk`, NuGet `Garmin.FIT.Sdk`,
  Maven `com.garmin:fit` — all at 21.217.0 [V][npm-fitsdk][pypi-fitsdk][nuget-fitsdk][maven-fit].
  C, C++, Objective-C: GitHub only [V]; Swift package manager distribution [?].
  npm downloads ≈ 42k/week [V][npm-fitsdk].
- **Dive messages:** the generated profile contains `dive_settings`, `dive_gas`,
  `dive_alarm`, `dive_apnea_alarm`, `dive_summary`, `tank_update`, `tank_summary`
  and the `record` dive fields (`depth`, `next_stop_depth`, `ndl_time`,
  `time_to_surface`, `cns_load`, `n2_load`, `po2`, `pressure_sac`, `volume_sac`,
  `rmv`, `ascent_rate`, `air_time_remaining`, …) [V][fit-profile]. Every SDK
  language is generated from the same profile, so they decode the same set [S].
- **Developer fields:** decoded (JS: `developerFields` per message, plus a
  `fieldDescriptionListener`) [V][js-decoder].
- **Chained FIT files:** JS and Python loop over consecutive files in one stream [V][js-decoder].
- **Compressed timestamp headers:** **not supported** by JS and Python (they raise
  "compressed timestamp messages are not currently supported"); supported by C#
  and Java [V][js-decoder]. Whether Descent files use them: [?] (libdivecomputer handles
  them, which suggests some Garmin file does).
- **Decoder options** (JS/Python): scale/offset, sub-fields, components, enum strings,
  dates, unknown data, HR merge, memo globs; all on by default [V][js-readme].
- **Runtimes:** JS needs Node ≥ 14 (ESM); Python ≥ 3.6; C# targets
  netstandard2.0 / netcoreapp2.0 / net46 [V].

### License of the official SDK

The SDK ships under the proprietary **FIT Protocol License Agreement**, the same
text in all repos (`LICENSE.txt`; GitHub reports `NOASSERTION`; npm: "SEE LICENSE
IN LICENSE.txt") [V][fit-license]. Relevant clauses:

- §1: royalty-free, **non-transferable, non-sublicensable** license "for Licensee's
  internal business purposes, including to use the FIT protocol in any software
  created by Licensee" [V].
- §2c: no "distribute, publish, transfer or otherwise make available the Licensed
  Technology … to any third party" except as set forth in the agreement [V].
- §2d: must not be distributed so that it "becomes subject to any license that
  requires that the Licensed Technology … be disclosed or distributed in source
  code form" — i.e. it **must not be combined under a copyleft license** (GPL/AGPL) [V].
- §2g: not for "safety-critical applications" or where failure "could lead to
  personal injury" [V]. A logbook that reads finished dives is arguably not that;
  anything that plans dives would be [?].
- §2h/§3: must not deviate from the FIT protocol; modifications must keep
  interoperability [V].
- §4: the SDK is called Garmin "Confidential Information", though it is public on
  GitHub/npm (which §4(2) "generally known by the public" may neutralise) [V].
- §5: Garmin gets a license to any modifications [V]. §9: Garmin may terminate on
  breach or with 30 days' notice [V].

Reading (not legal advice): depending on `@garmin/fitsdk` / `garmin-fit-sdk` as a
package that users install is common practice (divetracx, MIT, does exactly this)
[V][divetracx-fit], but **vendoring the SDK in our repo or shipping it inside a
Docker image is distribution**, and an **AGPL/GPL Dive Hub would conflict with §2d** [?].
DiveJSON explicitly "carries no part of the FIT SDK, and does not use
`garmin-fit-sdk`" for this reason [V][divejson-readme].

### Community parsers

| Library | Language | Official? | Profile | Dive messages | Dev. fields | Compressed ts | Chained | Last release / activity | License |
|---|---|---|---|---|---|---|---|---|---|
| `@garmin/fitsdk` | JS/TS | yes | 21.217 | all | yes | **no** | yes | 21.217.0, 2026-09-22 | FIT license |
| `garmin-fit-sdk` | Python | yes | 21.217 | all | yes | **no** | yes | 21.217.0, 2026-09-22 | FIT license |
| `Garmin.FIT.Sdk` / `com.garmin:fit` | C# / Java | yes | 21.217 | all | yes | yes | yes | 21.217.0, 2026-09-22 | FIT license |
| [fit-file-parser][jimmykane] (jimmykane) | JS/TS | no | own "community-maintained" profile, version [?] | all incl. `tank_*`, `dive_apnea_alarm` | yes | yes (reconstructed) | [?] | 6.1.2, 2026-09-22; ≈35k dl/week | MIT |
| [fitdecode][fitdecode] | Python | no | 21.171 (exported 2025-08-04) | all | yes | yes | yes (explicit) | 0.11.0, 2025-08-06 | MIT |
| [python-fitparse][fitparse] | Python | no | old (`dive_summary`, no `tank_*`) | partial | yes | yes [?] | [?] | 1.2.0, **2020-09-07** | MIT |
| [muktihari/fit][muktihari] | Go | no | **21.217** | all | yes | yes | yes [?] | v0.28.4, 2026-09-11; commit 2026-10-01 | BSD-3 |
| [tormoder/fit][tormoder] | Go | no | 21.115 | all | **discarded in records** | yes | [?] | v0.15.0, 2023-10-01; commit 2026-07 | MIT |
| [fitparser][fitparser] (fitparse-rs) | Rust | no | 21.202 | all | yes (since 0.8) | yes | [?] | 0.11.0, 2026-05-01 | MIT |
| [fit_tool][fit-tool] | Dart | no | [?] | [?] | [?] | [?] | [?] | 1.0.5, **2022-11-08** | [?] |

All cells [V] from repo source/registries unless marked, except "all" in "Dive
messages", which means the six dive messages were found by name in the source [V]
but were not decoded from a real file [?].

Notes:
- **fitdecode** advertises being faster than fitparse, thread-safe, and easy with
  chained files [S][fitdecode]. It is single-maintainer and last released 14 months ago [V].
- **muktihari/fit** keeps message order and unknown messages, supports Protocol V2
  developer fields, and benchmarks faster and with ~7× fewer allocations than
  tormoder on a large activity [S][muktihari]. Go module needs Go 1.26 [V].
- **tormoder/fit** unmarshals into fixed structs and drops developer data in
  records [V][tormoder] — that loses Suunto's `dive_mode` and similar fields.
- **Elixir / Ruby:** no maintained FIT parser found on hex.pm; Ruby has `fit4ruby` [?].
- **Performance is not a deciding factor:** a 72-minute dive decodes to about 4,300
  frames [S][divejson-fit]; any of the libraries handles that in milliseconds [?].

### What dive projects use

| Project | Language | FIT parser | Notes |
|---|---|---|---|
| [divetracx][divetracx-fit] | TypeScript (Bun) | `@garmin/fitsdk` 21.217.0 | MIT app; downloads the "original" zip from Connect and unzips one `.fit` [V] |
| [OpenDiving][opendiving] / [DiveJSON][divejson-fit] | Python | `fitdecode` (via `divejson`) | DiveJSON avoids the Garmin SDK deliberately [V] |
| [Submersion][submersion] | Dart/Flutter | `fit_tool` 1.0.5 | Its own comment: "3 years unmaintained" [V] |
| [Subsurface libdc fork][libdc-garmin] | C | hand-written parser | LGPL-2.1; own message table incl. undocumented messages [V] |

## Pitfalls

1. **Undocumented tank pod metadata.** libdivecomputer reads message **147**
   (`sensor_profile`): ANT id, pod name, `sensor_type` 28 = tank pod, pressure units,
   rated/reserve pressure, **cylinder volume** (L×10 or cu ft×10) and "used for gas
   rate" [V][libdc-garmin]. Message 147 is **not in the public profile** [V][fit-profile],
   so SDK-based parsers only surface it as unknown data (JS: `includeUnknownData: true`) [?].
   Without it FIT has no cylinder size [S][divejson-fit].
2. **Pod ↔ gas link is missing.** `tank_update`/`tank_summary` key on `sensor` (ANT id),
   `dive_gas` on `message_index`; nothing joins them [S][divejson-fit]. libdc maps sensor
   ids to tank indexes via the 147 records [V][libdc-garmin].
3. **Units are not SI.** Tank pressure is `uint16` **bar ×100**, depth m ×1000,
   temperature whole °C, times s ×1000 [V][fit-profile]. Positions are **semicircles**
   (180/2³¹ °) with sentinel `0x7FFFFFFF` [V][libdc-garmin][S][divejson-fit]. Our model
   stores Pa/K/m³ ([data model](../spec/data-model.md)), so conversion is ours.
4. **GPS entry/exit.** Garmin: `session.start_position_*` (3/4) and
   `session.end_position_*` (38/39), plus lap and bounding-box fields — libdc counts
   "nine (!) different GPS fields" [V][libdc-garmin][fit-profile]. Suunto: only `record`
   positions, all after the deepest sample in DiveJSON's Ocean fixture [S][divejson-fit].
5. **Dive detection.** `sport` 53 = `diving`; dive sub-sports 53–57 and 63, plus
   `dynamic_apnea` (121) and sport `pool_apnea` (85) [V][fit-profile]. libdc only knows
   53–57/63 and falls back to "has `dive_summary.avg_depth`" [V][libdc-garmin];
   divetracx also accepts `dynamicApnea` [V][divetracx-fit].
6. **Multiple `dive_summary` messages.** Freediving writes one per descent plus a
   session-level one; pick by `reference_mesg` [S][divejson-fit].
7. **Sentinels and bitfields.** HR 0/255 = no reading; huge NDL = "no limit" [V][divetracx-fit].
   `dive_gas.message_index` carries flags in the top bits (e.g. `0x8000` selected) —
   mask the low 12 bits; enum rendering can turn `sensor`/`message_index` values into
   words like `mask` [S][divejson-fit]. Disabled `dive_gas` entries are configured, not carried [S].
8. **Suunto developer fields shadow native fields** (e.g. two `max_depth` in `session`,
   developer one is a float written last). Take native fields first [S][divejson-fit].
   Suunto documents `dive_mode` (0–10) as a developer field [V][suunto-fit]; no
   `dive_summary`/`tank_*` [S][divejson-fit].
9. **Time zone.** Offset = `activity.local_timestamp` − `activity.timestamp` [S][divejson-fit];
   libdc also reads `timestamp_correlation.local_timestamp` [V][libdc-garmin].
10. **Compressed timestamps** break the official JS/Python decoders (pitfall only if
    a Descent writes them) [V][js-decoder]/[?].
11. **Corrupt files** surface as arbitrary exceptions in third-party decoders; wrap and
    bound the decode (DiveJSON caps at 100,000 frames) [S][divejson-fit].

### Garmin export formats

- **Export Original** (per activity, Connect web): a **zip containing one `.fit`** [S][strava-export];
  divetracx confirms the download service returns "a zip holding the single .fit entry" [V][divetracx-fit].
- **Account data export** ("Export Your Data"): zip with `DI_CONNECT/`; FIT files sit in
  nested `UploadedFiles_*_Part*.zip` under `DI-Connect-Uploaded-Files/` or
  `DI-Connect-Fitness-Uploaded-Files/` (names vary); index in
  `DI-Connect-Fitness/*summarizedActivities.json`; filenames opaque; files of all
  types mixed (≈5 % activity) — filter by `file_id.type` and match by start time
  [S][tempo-224][gneta]. No turnaround guarantee [S][gneta].
- **USB:** Descent Mk2 and later are **MTP**, not mass storage; files in
  `Primary/GARMIN/Activity/*.fit` [S][ss-mk2]. libdc looks for `Garmin/Activity` and
  decodes short names like `C4ND0302.fit` → `2022-04-23-13-03-02.fit` [V][libdc-dev].
  Whether the USB file is byte-identical to Export Original: [?] (one guide says
  "no different" [S]).

## Implications for the server language

FIT parsing is a small, isolated import step; it does not dictate the language much.
Ranked by FIT ecosystem fit for Dive Hub:

1. **TypeScript/Node (or Bun).** Official `@garmin/fitsdk` (current profile, dive
   messages, developer fields, chained files) **and** an MIT alternative
   (`fit-file-parser`) if the FIT license is a problem. Closest prior art (divetracx)
   uses this stack. Gap: no compressed timestamps in the official decoder.
2. **Python.** Same official SDK (`garmin-fit-sdk`) plus MIT `fitdecode`, used by
   OpenDiving/DiveJSON. Gaps: official decoder lacks compressed timestamps; fitdecode
   lags the profile (21.171) and has one maintainer.
3. **Go.** No official SDK, but `muktihari/fit` (BSD-3, profile 21.217, active,
   developer fields, compressed timestamps) is the strongest community parser found;
   single static binary suits self-hosting. Avoid `tormoder/fit` (drops developer fields).
4. **C#/.NET or Java.** Official SDKs with the most complete decoders (compressed
   timestamps), on NuGet/Maven; no permissive community fallback of note found [?].
5. **Rust.** `fitparser` (MIT, profile 21.202, developer fields) is usable; slower
   release cadence.
6. **Not recommended:** Dart (`fit_tool` unmaintained), Elixir/Ruby (no maintained
   parser found), hand-written C like libdc (LGPL, large effort).

Cross-cutting: the **project license and the parser choice are linked**. A copyleft
Dive Hub should use a permissive community parser (fitdecode, muktihari/fit,
fit-file-parser, fitparser); a permissive Dive Hub can depend on the official SDK as
a package, with the distribution question for Docker images still open.

## Open points

- Get real Descent FIT fixtures (Mk2/Mk3/G1, OC multi-gas, with tank pods, apnea,
  CCR) and run the shortlisted parsers on them; check for compressed timestamps and
  message 147.
- Decide Dive Hub's license, then the parser — candidate ADR.
- Legal status of community profiles derived from Garmin's `Profile.xlsx` (fitdecode,
  fitparser and muktihari generate from it; DiveJSON calls the profile "MIT-licensed")
  [?].
- Is shipping `@garmin/fitsdk` inside a Docker image "distribution" under §2c? [?]
- Suunto FIT fixtures, including the developer-field schema beyond `dive_mode`.
- Whether USB/MTP files and Export Original files differ.

## Sources

- [FIT SDK overview][fit-overview]; [Garmin GitHub organisation][garmin-gh]
- [FIT JS SDK releases][js-releases], [README][js-readme], [decoder.js][js-decoder], [profile.js][fit-profile], [LICENSE.txt][fit-license]
- Registries: [npm @garmin/fitsdk][npm-fitsdk], [PyPI garmin-fit-sdk][pypi-fitsdk], [NuGet Garmin.FIT.Sdk][nuget-fitsdk], [Maven com.garmin:fit][maven-fit]
- Community: [fitdecode][fitdecode], [python-fitparse][fitparse], [muktihari/fit][muktihari], [tormoder/fit][tormoder], [fitparse-rs][fitparser], [fit-file-parser][jimmykane], [fit_tool][fit-tool]
- Dive projects: [divetracx fit.ts][divetracx-fit], [OpenDiving][opendiving], [Submersion pubspec][submersion], [libdc garmin_parser.c][libdc-garmin], [libdc garmin.c][libdc-dev], [DiveJSON FIT mapping][divejson-fit], [DiveJSON README notices][divejson-readme], [Suunto FIT description][suunto-fit]
- Exports: [Strava: exporting from Garmin Connect][strava-export], [tempo issue #224][tempo-224], [gneta export guide][gneta], [Subsurface group: Mk2i download][ss-mk2]

[fit-overview]: https://developer.garmin.com/fit/overview/
[garmin-gh]: https://github.com/garmin
[js-releases]: https://github.com/garmin/fit-javascript-sdk/releases
[js-readme]: https://github.com/garmin/fit-javascript-sdk/blob/main/README.md
[js-decoder]: https://github.com/garmin/fit-javascript-sdk/blob/main/src/decoder.js
[fit-profile]: https://github.com/garmin/fit-javascript-sdk/blob/main/src/profile.js
[fit-license]: https://github.com/garmin/fit-javascript-sdk/blob/main/LICENSE.txt
[npm-fitsdk]: https://www.npmjs.com/package/@garmin/fitsdk
[pypi-fitsdk]: https://pypi.org/project/garmin-fit-sdk/
[nuget-fitsdk]: https://www.nuget.org/packages/Garmin.FIT.Sdk
[maven-fit]: https://repo1.maven.org/maven2/com/garmin/fit/
[fitdecode]: https://github.com/polyvertex/fitdecode
[fitparse]: https://github.com/dtcooper/python-fitparse
[muktihari]: https://github.com/muktihari/fit
[tormoder]: https://github.com/tormoder/fit
[fitparser]: https://github.com/stadelmanma/fitparse-rs
[jimmykane]: https://github.com/jimmykane/fit-parser
[fit-tool]: https://pub.dev/packages/fit_tool
[divetracx-fit]: https://github.com/michidk/divetracx/blob/main/src/modules/garmin/fit.ts
[opendiving]: https://github.com/opendiving/opendiving-api
[submersion]: https://github.com/submersion-app/submersion/blob/main/pubspec.yaml
[libdc-garmin]: https://github.com/subsurface/libdc/blob/Subsurface-DS9/src/garmin_parser.c
[libdc-dev]: https://github.com/subsurface/libdc/blob/Subsurface-DS9/src/garmin.c
[divejson-fit]: https://github.com/divejson/divejson/blob/main/docs/fit-mapping.md
[divejson-readme]: https://github.com/divejson/divejson/blob/main/README.md#notices
[suunto-fit]: https://apizone.suunto.com/fit-description
[strava-export]: https://support.strava.com/en-us/articles/15402167-exporting-files-from-garmin-connect
[tempo-224]: https://github.com/trevordavies095/tempo/issues/224
[gneta]: https://www.gneta.app/blog/export-garmin-data-guide
[ss-mk2]: https://groups.google.com/g/subsurface-divelog/c/xhpwyfhSsQs
