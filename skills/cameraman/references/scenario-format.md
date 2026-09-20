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

## Steps

| Step | Notes |
|---|---|
| `goto` `newTab` `switchTab` | Navigation. Belongs in `setup` unless the viewer should see it. |
| `click` | Moves the real cursor, pauses, then clicks. |
| `point` | Moves onto an element **without** clicking — for showing something that must not fire. |
| `type` | Types character by character, so the text is visibly written. |
| `waitFor` | Waits for a target to be visible. |
| `scroll` | Wheel scroll over a duration. |
| `focusAddressBar` | Ctrl/Cmd+L. Opens the omnibox dropdown, which covers the top of the page — worth it only when the URL must be legible. |
| `hold` | A still beat. |
| `gate` | Stops and waits for a human. Nothing is recorded while it waits. |

## Targets

Resolved in order: `testId` first, then `role` + `name`, then visible `text`.

Prefer `data-testid`. Role and text names come from the interface copy, so they
break on every rewording — and a scenario's whole job is to survive that.

## Narration and subtitles

`narration` may carry `eleven_v3` inline tags. `captionText()` strips them, so
the subtitles never show `[breathes]` and the tags do not count toward the
split weights. Keeping one field means the audio and the captions cannot drift
apart, which they will the moment there are two.
