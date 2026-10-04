# Scenario format

A scenario is data, not a script of commands. It can be read in a pull request,
and a year later it still says what the approved video contained.

```ts
export const myScenario: Scenario = {
  id: "acme-google-calendar",
  title: "Acme — Google Calendar OAuth scopes demo",
  baseUrl: process.env.RECORD_BASE_URL ?? "https://acme.example",
  forbidHosts: ["localhost", "127.0.0.1", "vercel.app", "ngrok"],
  reset: { url: "https://acme.example/account", evaluate: "window.acme.resetDemo()" },
  outputs: [
    { id: "full", title: "Full walkthrough", shots: ["01-intro", "02-consent", "03-usage"] },
    { id: "publish-permission", title: "Content publishing", shots: ["01-intro", "03-usage"] },
  ],
  shots: [
    {
      id: "02-consent",
      title: "Granting access",
      minHoldMs: 12000,
      narration: "The user clicks Connect… [pause] and Google shows every permission we ask for.",
      setup: [
        { kind: "goto", url: "https://acme.example/en/account" },
        { kind: "waitFor", target: { testId: "gcal-connect" } },
      ],
      steps: [
        { kind: "click", target: { testId: "gcal-connect" } },
        { kind: "gate", name: "account-picker", message: "Pick the demo Google account." },
        { kind: "hold", ms: 3000 },
        { kind: "focusAddressBar" },
        { kind: "hold", ms: 3500 },
      ],
    },
  ],
};
```

## Fields

| Field | Why it exists |
|---|---|
| `forbidHosts` | Refuses to record a review video on a host a reviewer would reject. |
| `reset` | Puts the app back to its starting state so a re-shoot is identical. |
| `outputs` | Several videos from one scenario — Meta wants one screencast per permission. |
| `setup` | Runs before the camera rolls. Keeps navigation and loading out of frame. |
| `minHoldMs` | Floor for the shot length, independent of how long the narration runs. |
| `narration` | The single source of truth for **both** the voice-over and the subtitles. |
| `card` | Pre-rendered footage for this shot instead of a live recording — see below. |

## Card shots — text cards and title cards mid-sequence

A shot with `card: { file: "./cards/lying.mp4" }` instead of live `steps` gets
its footage from that file rather than from the browser. It still goes
through `assemble` exactly like a recorded shot — same narration, same
caption timing, same "freeze the last frame if narration outruns the
footage" rule — because `assemble` only ever looks at a shot's `videoPath`
and `narration`; it does not know or care where the video came from.

```ts
{
  id: "05-lying",
  title: "Someone was lying",
  minHoldMs: 2000,
  narration: "Someone was lying to you this whole time.",
  steps: [],
  card: { file: "./cameraman-cards/lying.mp4" },
}
```

Render the file with [Hyperframes](hyperframes.md) or any tool that produces
an mp4 — cameraman does not design motion, it only places the result in the
sequence. `setup` and `steps` are ignored for a card shot and can be left
empty. A relative `file` resolves from the scenario directory (`CAMERAMAN_SCENARIOS`,
default `./cameraman-scenarios`) — not from wherever `record` was invoked —
so it means "next to me" regardless of the working directory at record time.

This is a different mechanism from `--intro`/`--outro` (see hyperframes.md):
those bookend the *whole assembled video*, outside the caption timeline and
recorded/voiced separately. A `card` is one shot *among* the others — narrated
like any of them, and free to sit between two live-recorded shots.

## Steps

| Step | Notes |
|---|---|
| `goto` `newTab` `switchTab` | Navigation. Belongs in `setup` unless the viewer should see it. `switchTab`'s optional `nth` (default 0) picks among several pages matching `urlIncludes` — several player windows with the same URL shape, differing only in a query param the scenario can't predict (a random bot name), is exactly this case. |
| `click` | Moves the real cursor, pauses, then clicks. |
| `point` | Moves onto an element **without** clicking — for showing something that must not fire. |
| `type` | Types character by character, so the text is visibly written. |
| `waitFor` | Waits for a target to be visible. |
| `scroll` | Wheel scroll over a duration. |
| `focusAddressBar` | Ctrl/Cmd+L. Opens the omnibox dropdown, which covers the top of the page — worth it only when the URL must be legible. |
| `hold` | A still beat. |
| `gate` | Stops and waits for a human. Nothing is recorded while it waits. |
| `waitUntil` | Polls a JS expression in the page (`script`) until truthy — `timeoutMs` (default 60 s), `pollMs` (500), `description` for the error. For apps driven by something other than the scenario (a server, timers, bots), where a fixed `hold` is either flaky or dead footage. In `steps` it keeps the camera rolling until the condition holds: "record until the match ends". |
| `evaluate` | Runs JS in the page — for app state with no UI flow worth filming (a settings call, a feature flag), never for anything the viewer should see happen. Same idea as `scenario.reset.evaluate`, usable mid-scenario. |

## Targets

Resolved in order: `testId` first, then `role` + `name`, then visible `text`.

Prefer `data-testid`. Role and text names come from the interface copy, so they
break on every rewording — and a scenario's whole job is to survive that.

## Narration and subtitles

`narration` may carry `eleven_v3` inline tags. `captionText()` strips them, so
the subtitles never show `[breathes]` and the tags do not count toward the
split weights. Keeping one field means the audio and the captions cannot drift
apart, which they will the moment there are two.

## Markers and cutting a long take

A shot can log what happened while it recorded:

```ts
{
  id: "raw-match",
  title: "Whole match, bots playing",
  minHoldMs: 0,
  narration: "",
  markers: { script: "window.__appState?.phase", pollMs: 250 },
  steps: [{ kind: "waitUntil", script: "window.__appState?.phase === 'end'", timeoutMs: 900000 }],
}
```

Every time `script` returns a new value, `{ t, label }` is stored on the shot in
`shots.json` (`t` = seconds into the file). Then cut clips by what happened
instead of scrubbing through minutes of footage:

```bash
cameraman cut --take <dir> --shot raw-match                      # list markers
cameraman cut --take <dir> --shot raw-match --marker day#1 --before 1 --after 6 --out clips/day1.mp4
cameraman cut --take <dir> --shot raw-match --at 42.5 --before 0 --after 4 --out clips/x.mp4
```

`--nth` picks a repeated label (0-based). A clip is plain footage — use it in a
trailer scenario as a `card` shot.

Markers are timed against the wall clock. `gdigrab` records constant frame
rate (dropped frames are duplicated), so file time tracks that clock, and `cut`
also rescales by `file duration / wall duration` to absorb whatever drift is
left. Pad clips with `--before`/`--after` of a second rather than trusting a
frame-exact offset.
