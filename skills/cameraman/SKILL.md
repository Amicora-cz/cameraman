---
name: cameraman
description: Record a narrated, subtitled screencast of a running web app by driving a real browser from a scenario file. Use when someone says "/cameraman", asks for a demo video, a product walkthrough, a screen recording, or a verification screencast for Google OAuth review or Meta App Review. Scenarios are data, so a rejected video is re-shot by one command, not by clicking through it again.
---

# /cameraman

You shipped it. Now let someone watch it work.

`/cameraman` drives a real Chrome through a scenario you can read, records the
screen, narrates it, and cuts the result with subtitles. It is built for videos
that get **re-shot**: app review rejections, UI changes, a new language.

## Invocation dispatch (must happen first)

Parse the whole invocation before touching the project.

| Option | Values | Default | Handled by |
|---|---|---|---|
| `--scenario` | scenario id | ask, or author one (Step 1) | engine |
| `--output` | output id within the scenario | `full` | engine |
| `--backend` | `obs`, `x11grab`, `none` | `obs`, or `x11grab` on headless Linux | engine |
| `--pointer` | `os`, `cdp` | `os` | engine |
| `--dry-run` | flag | off | engine |
| `--reset` | flag | off | engine |
| `--burn-subs` | flag | sidecar `.srt` only | engine |
| `--intro` / `--outro` | path to an mp4 | none | engine |
| `--poster` | flag, or seconds | off | engine |
| `--voice` | `elevenlabs`, `file:<path>`, `none` | `elevenlabs` when a key is present | agent-level |
| `--lang` | narration language | the scenario's | agent-level |
| `--preset` | `review`, `promo`, `tutorial` | inferred | agent-level |

Agent-level options are yours to act on — they change what you write and which
tools you reach for, not how the engine is invoked.

## Presets

A preset is a starting shape, not a template. Say which one you assumed.

| Preset | Length | Narration | Bookends |
|---|---|---|---|
| `review` | as the reviewer requires (Google: 3–7 min) | plain, names each scope as it is shown | none — evidence, not a trailer |
| `promo` | 30–60 s | written for delivery, a hook in the first two seconds | intro and outro earn their place |
| `tutorial` | as long as the task takes | instructional, second person | title cards between sections |

`--dry-run` still clicks. It walks the whole flow and reports every selector
that stopped existing; it only skips recording, the OS cursor, human gates and
long holds. A dry run that does not click never reaches later states and
reports failures that are not real.

## Skill directory

`<skill-dir>` is the directory holding this `SKILL.md`. Claude Code prints it
as "Base directory for this skill". The engine lives at `<skill-dir>/engine/`,
the throwaway demo app at `<skill-dir>/demo/`. Never guess an install path — a
plugin install, a `~/.claude/skills/` copy and a clone of this repo all put it
somewhere different.

Run the engine with `npx tsx <skill-dir>/engine/cli.ts <command>`.

---

## Step 0: Preflight

**Read:** [references/recording.md](references/recording.md) § Requirements

Check, and stop on the first failure rather than discovering it mid-take:

- `ffmpeg` and `ffprobe` — on PATH, or `FFMPEG_PATH`/`FFPROBE_PATH`, or the
  bundled fallback npm unpacked. The engine resolves them in that order, so
  this fails preflight only when all three miss; report which source it found.
- a pointer tool: `xdotool` (Linux) · `cliclick` (macOS) · PowerShell
  (Windows). No npm package supplies these — they are a real system install.
- `playwright-core` resolvable from `<skill-dir>`. `/plugin install` runs
  `npm install` for you, so a marketplace install already has it and the
  ffmpeg fallback too; a `~/.claude/skills/` copy and a bare clone have
  neither. Recording then needs one `npm install` in `<plugin-root>` (the
  directory holding `package.json`, two levels above `<skill-dir>`). `list`,
  `voice` and `assemble` run either way.
- a **real** Chrome started by the human with `--remote-debugging-port=9222`
  (never launched by the agent — see recording.md for why)
- the target URL answers, and is not on the scenario's `forbidHosts`

**Gate:** every requirement reports present, and the target responds.

---

## Step 1: Scenario

**Read:** [references/scenario-format.md](references/scenario-format.md)

Use the named scenario, or write one: shots with `setup` (navigation, off
camera) and `steps` (what the viewer sees), an `outputs` list, and `narration`
per shot.

Then prove it still matches the app:

```
npx tsx <skill-dir>/engine/cli.ts record --scenario <id> --backend none --pointer cdp --dry-run --reset
```

**Gate:** the dry run finishes and reports no missing selectors. Fix the
scenario, not the app, until it does.

---

## Step 2: Narration

**Read:** [references/narration.md](references/narration.md)

Generate the commentary for the whole output as **one continuous read**, then
split it on the silences:

```
npx tsx <skill-dir>/engine/cli.ts voice --take <dir> --scenario <id> --single-take <audio>
```

Per-shot generation is the fallback for providers that cannot take the whole
script at once. It sounds chopped, because each clip starts cold and ends on a
falling intonation.

**Gate:** one clip per shot, and the splitter reports no drift warning. A
warning means the narration no longer matches the scenario — fix the text.

---

## Step 3: Record

```
npx tsx <skill-dir>/engine/cli.ts record --scenario <id> --output <id> --backend <backend> --pointer os --reset
```

Each shot is recorded to its own file. Do not ask for one continuous capture:
video time and wall-clock time are not the same thing when the capture drops
frames, and no offset or scale factor repairs it afterwards.

**Gate:** `cameraman-output/take-*/raw/` holds one non-empty file per shot in
the output, and `shots.json` lists them.

---

## Step 4: Assemble and deliver

```
npx tsx <skill-dir>/engine/cli.ts assemble --take <dir> --burn-subs
```

**Gate:** `final.mp4` exists; duration sits inside the band the preset
requires; `ffprobe` shows both a video and an audio stream; integrated loudness
is not silence.

---

## Step 5: Bookends (optional, `promo` and `tutorial`)

**Read:** [references/hyperframes.md](references/hyperframes.md)

A hook and an outro are designed motion, not footage. Render them with
[Hyperframes](https://hyperframes.heygen.com/) and hand them to `assemble`:

```
npx hyperframes doctor && npx hyperframes lint ./composition
npx hyperframes render -o intro.mp4
npx tsx <skill-dir>/engine/cli.ts assemble --take <dir> --intro intro.mp4 --burn-subs --poster
```

Bookends are re-encoded to match the shots, and the captions are shifted by the
intro's length — concatenating by hand silently desynchronises them.

Never put evidence in a composition. If a reviewer has to believe the app does
something, it has to be the app on screen doing it.

**Gate:** `hyperframes lint` reports zero errors before rendering, and the
final duration still sits inside the preset's band.

---

## Telling the human

Close with, in this order:

1. The paths: `final.mp4`, `final.srt`, `poster.jpg`.
2. Duration, and whether it fits the preset's band.
3. What you assumed — the preset, the voice, anything the invocation left open.
4. The two things only a person can judge: whether the narration sits on the
   right pictures, and whether anything private is in frame.
5. Anything you could not verify, named plainly.

Do not describe the video back to them. They are about to watch it.

---

## Recording laws

These hold for every scenario.

**Production, not localhost.** A reviewer must see the app the request is
about. Videos recorded on `localhost`, `*.vercel.app` or a tunnel domain are a
standard rejection reason. `forbidHosts` enforces this per scenario.

**The address bar stays visible.** No fullscreen, no kiosk. Google requires the
OAuth `client_id` to be legible in the URL. Turn on "Always show full URLs".

**A real cursor.** The browser is driven over CDP, which does not move the
operating system pointer — a recording made that way shows things happening
with nothing causing them. The engine moves the real cursor; keep it that way.

**Navigation happens off camera.** `goto` waits only for `domcontentloaded` and
the rest renders client-side, so a shot that starts on navigation opens on a
loading skeleton while the narration describes content that is not there yet.
Put navigation and waiting in `setup`.

**Never trim footage below what was shot.** Padding audio with silence costs
nothing; dropping filmed frames costs the shot. Tighten the scenario's holds
instead.

**One take of narration, split afterwards.** Prosody has to carry across the
whole commentary.

**Punctuation before audio tags.** Ellipses and commas do the breathing; tags
force an effect and only land where the context already supports them.

**Show every claim.** For a verification screencast, each requested scope or
permission needs a moment on screen where it is visibly used — this is the most
common reason a review video is rejected.

---

## Outputs

One scenario can produce several videos. Google wants a single video for the
whole request; Meta wants a screencast **per permission**. Shots are named and
shared between outputs, so the login and connect shots are recorded once and
appear in both.
