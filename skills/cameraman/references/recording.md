# Recording

## Requirements

| | |
|---|---|
| Node | ≥ 22 — the OBS client uses the global `WebSocket` |
| ffmpeg + ffprobe | ≥ 6 on PATH, or the bundled fallback — see below |
| Chrome, or an Electron app | a **real** Chrome, not a bundled Chromium — or any Electron app with its own `--remote-debugging-port` open (see below) |
| cursor | Linux `xdotool` · macOS `cliclick` · Windows PowerShell |
| OBS Studio | ≥ 30.2, only for `--backend obs`; `x11grab` (Linux) and `gdigrab` (Windows) need nothing else |

### Which ffmpeg gets used

Per tool, in order: `FFMPEG_PATH` / `FFPROBE_PATH`, then PATH, then the copy
npm unpacked into `node_modules`. PATH wins over the bundle deliberately — it
is the newer build and the one the operator chose.

The bundle is optionalDependencies, so a blocked registry or a platform with
no build leaves the install standing with PATH as the only source. It exists so
a machine with no ffmpeg records instead of failing preflight.

| | | |
|---|---|---|
| `ffmpeg-static` | ffmpeg 7.0.2 | fetched by a postinstall step |
| `@ffprobe-installer/ffprobe` | ffprobe 5.2 | plain npm resolution, always present |

`ffprobe-static` is not in the list — 336 MB of every platform at once, for an
ffprobe 4.0.2 older than what `@ffprobe-installer` already gives.

### The fetch preflight does for you

`/plugin install` runs npm with **scripts disabled**, so on that path
`ffmpeg-static` unpacks to a directory with no binary in it. **Preflight does
that fetch**: the first run that actually needs ffmpeg pulls the build once,
then resolves to it. It is the same download npm would have done, at the first
moment we are allowed to do it.

It is skipped whenever the answer is already settled — `FFMPEG_PATH` is set, an
ffmpeg is on PATH, the binary is already there, or `ffmpeg-static` is not
installed. It is also skipped by the commands that never encode: a `--dry-run`
and `--backend none` walk the scenario without touching ffmpeg at all.

```bash
CAMERAMAN_SKIP_FFMPEG_DOWNLOAD=1   # never reach the network at preflight
```

Opt out on a locked-down machine, and supply ffmpeg yourself — on PATH, via
`FFMPEG_PATH`, or by running the fetch by hand, once, in `<plugin-root>`:

```bash
node node_modules/ffmpeg-static/install.js
```

There is no second bundled ffmpeg behind this one. An earlier version kept
`@ffmpeg-installer` (ffmpeg 4.1, abandoned in 2022) as a floor for exactly the
scripts-disabled case, but once preflight fetches the real build, 68 MB of
2018 ffmpeg buys nothing. So a failed fetch with nothing on PATH is a failed
preflight, which is where you want to find out — before a take, not on the
first `recorder.stop()`.

Verified: libx264, aac, `subtitles` (libass), `silencedetect`, the concat
demuxer and `x11grab` all present, and assemble runs end to end. ffprobe 5.2
sits below the ≥ 6 above — a floor, not a recommendation, so install a current
ffmpeg where you can. The binaries are GPL builds, worth knowing if you
redistribute the recording environment; cameraman itself stays MIT and does not
ship them.

## The target is started by a human

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cameraman-profile" \
  --window-size=1920,1080 --window-position=0,0
```

The engine attaches with `connectOverCDP`, so anything that speaks the CDP
protocol works, not only Chrome. If it launched the browser itself, the
capture would show the "Chrome is being controlled by automated test
software" bar, and Google blocks sign-in on such a browser with "This browser
or app may not be secure" — which is a required part of a verification video.
So a person signs into the Google account once, beforehand, outside automation.

In that profile: turn on **"Always show full URLs"** (otherwise the `client_id`
in the consent URL is not legible), hide the bookmarks bar, zoom 100 %, no
fullscreen.

### Recording an Electron app instead of a browser

Electron is Chromium underneath, so the same `connectOverCDP` attach works:
have the app open its own debugging port (`app.commandLine.appendSwitch(
"remote-debugging-port", "9222")`, called before `app.whenReady()`, ideally
behind an opt-in env var so a packaged build never exposes it), point
`RECORD_CDP_URL` at it, and skip the "Chrome, not Chromium" and Google-signin
concerns above — they are specific to browser-based OAuth review, not to an
Electron target.

`toScreen()`'s screen-coordinate math (`window.screenX/outerWidth/…`) holds
for any Chromium renderer window, framed or frameless, so no engine change is
needed to point at an Electron `BrowserWindow`.

If the app opens several `BrowserWindow`s at once (e.g. a host window plus
simulated player windows for local multi-actor testing), each is a separate
CDP page target. Give each window a distinguishing URL (a query param is
enough) and use the `switchTab` step (`urlIncludes`) to move the engine's
active page between them before a shot's `click`/`type` steps — `forbidHosts`
and the production-URL check are about review videos and don't apply here.

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

### Background music

`--music <file>` mixes a track under the whole assembled video (including any
`--intro`/`--outro`), at `--music-volume` (default `0.25`, roughly -12 dB) —
low enough to sit under narration without per-word ducking, which this does
not attempt: one track, mixed once. It is looped if shorter than the final
video and cut to length if longer, so any track works without measuring it
first.

Get the track from wherever — a stock-music library, or a prompt to a music
generator asking for the whole arc a trailer needs (tension → build → a sting
around the reveal → a resolved outro) in one generation, since that arc is
composition, and composition is exactly what cameraman does not do (same
reasoning as [hyperframes.md](hyperframes.md) for visual bookends). There is
no music-generation integration in cameraman itself — hand `assemble` a
finished file.
