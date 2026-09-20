/**
 * The demo scenario — verifies the whole pipeline without touching production.
 *
 * It deliberately uses EVERY step kind a real scenario needs (click, type,
 * wait for state, scroll, new tab, switch tab, focus the address bar), so if
 * this passes, the mechanics of a real shoot will too. No gate is used here:
 * the demo has to run without a human.
 */
import type { Scenario } from "./types";

const BASE = process.env.DEMO_URL || "http://127.0.0.1:4599";

export const demoScenario: Scenario = {
  id: "demo",
  title: "Acme Notes — pipeline smoke test",
  baseUrl: BASE,
  forbidHosts: [],
  reset: { url: `${BASE}/`, evaluate: "window.acmeDemo.reset()" },
  outputs: [
    {
      id: "full",
      title: "Acme Notes demo",
      shots: ["01-dashboard", "02-connect", "03-note", "04-result"],
    },
    // A second output from the same shots — proves the model handles what Meta
    // asks for (a video per permission) without duplicating the scenario.
    {
      id: "connect-only",
      title: "Acme Notes — connecting a notebook",
      shots: ["01-dashboard", "02-connect"],
    },
  ],
  shots: [
    {
      id: "01-dashboard",
      title: "Dashboard",
      minHoldMs: 6000,
      narration:
        "So, this is Acme Notes \u2014 a small demo workspace. Up at the top you can see whether the notebook is synced, and just below that, the notes the user has saved so far.",
      steps: [
        { kind: "goto", url: `${BASE}/` },
        { kind: "hold", ms: 1500 },
        { kind: "scroll", deltaY: 420, overMs: 1600 },
        { kind: "hold", ms: 800 },
        { kind: "scroll", deltaY: -420, overMs: 1400 },
        { kind: "hold", ms: 800 },
      ],
    },
    {
      id: "02-connect",
      title: "Connecting the notebook",
      minHoldMs: 5000,
      narration:
        "Alright, let\u2019s connect a notebook\u2026 And there it goes \u2014 the badge flips over to connected, and the button itself turns into a disconnect action.",
      steps: [
        { kind: "waitFor", target: { testId: "connect-notebook" } },
        { kind: "click", target: { testId: "connect-notebook" } },
        { kind: "waitFor", target: { testId: "disconnect-notebook" } },
        { kind: "hold", ms: 2000 },
      ],
    },
    {
      id: "03-note",
      title: "Writing a note",
      minHoldMs: 8000,
      narration:
        "Now let\u2019s actually write something down. We open the new note form, type in a title, add a bit of body text, and hit save. And the app confirms it \u2014 the note went straight into the connected notebook.",
      steps: [
        { kind: "click", target: { testId: "new-note" } },
        { kind: "waitFor", target: { testId: "note-title" } },
        { kind: "click", target: { testId: "note-title" } },
        { kind: "type", target: { testId: "note-title" }, text: "Recording pipeline smoke test", perCharMs: 55 },
        { kind: "click", target: { testId: "note-body" } },
        {
          kind: "type",
          target: { testId: "note-body" },
          text: "If this text appears on screen, scripted typing is visible in the capture.",
          perCharMs: 26,
        },
        { kind: "hold", ms: 600 },
        { kind: "click", target: { testId: "save-note" } },
        { kind: "waitFor", target: { testId: "save-confirmation" } },
        { kind: "hold", ms: 2000 },
      ],
    },
    {
      id: "04-result",
      title: "The note on the dashboard",
      minHoldMs: 7000,
      narration:
        "And back on the dashboard\u2026 there it is \u2014 our note, with the time it was saved. Notice as well that the address bar stayed visible the whole way through, which is exactly what the review process asks for.",
      steps: [
        { kind: "newTab", url: `${BASE}/` },
        { kind: "waitFor", target: { testId: "note-item" } },
        { kind: "hold", ms: 1500 },
        { kind: "focusAddressBar" },
        { kind: "hold", ms: 2500 },
      ],
    },
  ],
};
