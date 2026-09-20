# Recording

## Requirements

| | |
|---|---|
| Node | ≥ 22 — the OBS client uses the global `WebSocket` |
| ffmpeg + ffprobe | ≥ 6 on PATH, or the bundled fallback — see below |
| Chrome | a **real** one, not a bundled Chromium |
| cursor | Linux `xdotool` · macOS `cliclick` · Windows PowerShell |
| OBS Studio | ≥ 30.2, only for `--backend obs`; on Linux `x11grab` needs nothing |

### Which ffmpeg gets used

Per tool, in order: `FFMPEG_PATH` / `FFPROBE_PATH`, then PATH, then the copy
npm unpacked into `node_modules`. PATH wins over the bundle deliberately — it
is the newer build and the one the operator chose.

The bundle (`@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`) is an
optionalDependency, so an unsupported platform or a blocked registry leaves the
install standing with PATH as the only source. It exists so a machine with no
ffmpeg records instead of failing preflight; it is **not** the recommended
build. It ships ffmpeg 4.1 and ffprobe 5.2, below the ≥ 6 above — verified to
carry libx264, aac, `subtitles` (libass), `silencedetect`, the concat demuxer
and `x11grab`, which is the whole pipeline, but install a current ffmpeg where
you can.

## The browser is started by a human

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cameraman-profile" \
  --window-size=1920,1080 --window-position=0,0
```

The engine attaches with `connectOverCDP`. If it launched the browser itself,
the capture would show the "Chrome is being controlled by automated test
software" bar, and Google blocks sign-in on such a browser with "This browser
or app may not be secure" — which is a required part of a verification video.
So a person signs into the Google account once, beforehand, outside automation.

In that profile: turn on **"Always show full URLs"** (otherwise the `client_id`
in the consent URL is not legible), hide the bookmarks bar, zoom 100 %, no
fullscreen.

## Why one file per shot

A single continuous capture would have to be cut by the scenario's clock, and
that clock is not the video's. When the capture cannot keep the requested fps —
under Xvfb in a container the recording came out 11 % short — the two
timelines drift, unevenly, so neither an offset nor a scale factor repairs it.
The end of a shot then shows the beginning of the next one.

One file per shot removes the mapping entirely: the file *is* the shot. It also
stops the capture during `setup` and during human gates, so nothing needs
cutting out afterwards.

## Cursor

Playwright dispatches input over CDP, which does not move the OS pointer. The
engine therefore uses Playwright only to *locate* an element, converts the
viewport box to screen coordinates, and moves the real cursor with the system
utility. `--pointer cdp` exists for smoke tests where nobody watches the video.

On HiDPI displays, override `RECORD_POINTER_SCALE` if clicks land off target.

## Assembly

Each shot is fitted to `max(recorded, narration + padding)`. It is never
trimmed below what was recorded: padding audio with silence costs nothing,
dropping filmed frames costs the shot. When narration outruns footage the last
frame is frozen — invisible on a static page, and the right trade.

`--burn-subs` renders the captions into the picture and keeps the sidecar
`.srt`, which is what YouTube wants.
