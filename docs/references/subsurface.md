---
title: Subsurface
summary: Leading open-source dive log (GPL-2); import source and model inspiration.
status: living
date: 2026-10-02
url: https://github.com/subsurface/subsurface
---

# Subsurface

## What it is
GPL-2.0 desktop/mobile dive log, very active. Imports UDDF, DL7, Suunto, Garmin
(via its libdivecomputer fork) and many other logbooks via XSLT. Native format is XML
(`.ssrf`) or a git repository of line-based text files (also used by its cloud storage).
There's no formal spec: `core/save-xml.cpp`, `core/save-git.cpp` and `core/parse-xml.cpp` define the format.

## What we take from it
- Model ideas: multiple dive computers per dive, cylinders, weight systems,
  sensor-to-tank mapping, separate site and trip entities.
- Import adapter for Subsurface users.

## Notes
- Its UDDF exporter writes `version="3.2.0"` and has known ID validity issues.
