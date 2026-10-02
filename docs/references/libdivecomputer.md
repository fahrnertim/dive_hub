---
title: libdivecomputer
summary: LGPL C library for downloading and parsing dive computer data; de-facto minimum sample model.
status: living
date: 2026-10-02
url: https://github.com/libdivecomputer/libdivecomputer
---

# libdivecomputer

## What it is
LGPL-2.1 C library that downloads and parses data from many dive computers over
USB, serial and BLE. v0.9.0 was released 2025-06-30; still active. Subsurface keeps a fork
(<https://github.com/subsurface/libdc>) with extra devices, including Garmin.

## What we take from it
- Parser field list (`include/libdivecomputer/parser.h`) as the minimum for our dive and sample model.
- Candidate for a future direct dive-computer download app.

## Notes
- Garmin support exists only in the Subsurface fork, not upstream.
- LGPL: linking terms need checking before we embed it.
