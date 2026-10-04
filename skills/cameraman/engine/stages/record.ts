/**
 * The core: rolls the camera and clicks through the scenario.
 *
 * Output is `shots.json` — one entry per shot, naming the file it was recorded
 * to and how long it ran. Lengths are settled in post, not here.
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright-core";
import { config, takeDir, stamp } from "../config";
import { durationSec, assertToolsAvailable } from "../lib/ffmpeg";
import { connect, screenPointOf, type Session } from "../lib/browser";
import { assertPointerToolAvailable, clickAt, moveSmooth, hotkey } from "../lib/pointer";
import { gate, type GateLog } from "../lib/gate";
import { noopRecorder, obsRecorder, x11grabRecorder, gdigrabRecorder, type Recorder } from "../lib/recorder";
import {
  getScenario,
  shotsForOutput,
  scenarioDir,
  type Marker,
  type MarkerWatch,
  type Shot,
  type Step,
  type Target,
} from "../scenarios";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RecordOptions = {
  scenarioId: string;
  outputId: string;
  /** `obs` (produkce), `x11grab` (Linux/CI), `gdigrab` (Windows, no install), `none` (jen proklik). */
  backend: "obs" | "x11grab" | "gdigrab" | "none";
  /** `os` = the real cursor, `cdp` = clicks with nothing visible (smoke test). */
  pointer: "os" | "cdp";
  /**
   * Walk the scenario for real as far as clicking goes, but without recording,
   * without the real cursor, without gates and with shortened holds. It checks
   * that the scenario still matches the UI — which is why it must click:
   * without clicking it never reaches the later states and would report
   * missing selectors that are perfectly fine.
   */
  dryRun: boolean;
  /** Put the app back to its starting state before filming (scenario.reset). */
  reset?: boolean;
  display?: string;
  captureSize?: string;
};

export type ShotRecord = {
  id: string;
  title: string;
  /** This shot's file — recording is per shot, so the file IS the shot. */
  videoPath: string;
  seconds: number;
  minHoldMs: number;
  narration: string;
  /** State changes seen while recording — see `Shot.markers`. */
  markers?: Marker[];
  /** Wall-clock length of the recording, to rescale markers onto file time. */
  wallSeconds?: number;
};

function locate(page: Page, target: Target): Locator {
  const candidates: Locator[] = [];
  if (target.testId) candidates.push(page.locator(`[data-testid="${target.testId}"]`));
  if (target.role && target.name) candidates.push(page.getByRole(target.role, { name: target.name }));
  if (target.text) {
    candidates.push(page.getByRole("button", { name: target.text }));
    candidates.push(page.getByText(target.text, { exact: false }));
  }
  if (candidates.length === 0) throw new Error("Target bez selektoru.");
  return candidates.reduce((acc, next) => acc.or(next)).first();
}

function describe(target: Target): string {
  return target.testId ?? target.name ?? target.text ?? "?";
}

async function clickTarget(
  session: Session,
  target: Target,
  options: RecordOptions,
): Promise<void> {
  const locator = locate(session.page, target);
  if (options.pointer === "cdp" || options.dryRun) {
    await locator.click({ timeout: 20_000 });
    return;
  }
  const point = await screenPointOf(session, locator);
  await clickAt(point, config.pointerMoveMs);
}

async function runStep(
  step: Step,
  session: Session,
  since: () => number,
  gates: GateLog[],
  options: RecordOptions,
  missing: string[],
): Promise<void> {
  switch (step.kind) {
    case "goto":
      await session.page.goto(step.url, { waitUntil: "domcontentloaded" });
      await sleep(500);
      return;

    case "newTab": {
      const next = await session.newTab(step.url);
      session.use(next);
      await sleep(700);
      return;
    }

    case "switchTab": {
      // Every context, not just the current page's: Electron windows with
      // their own session partition show up as separate CDP contexts.
      const matches = session.browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((p) => p.url().includes(step.urlIncludes));
      const match = matches[step.nth ?? 0];
      if (!match) {
        throw new Error(
          `No open tab matches '${step.urlIncludes}' at index ${step.nth ?? 0} ` +
            `(${matches.length} matched).`,
        );
      }
      await match.bringToFront();
      session.use(match);
      await sleep(400);
      return;
    }

    case "waitFor":
      try {
        await locate(session.page, step.target).waitFor({
          state: "visible",
          timeout: step.timeoutMs ?? (options.dryRun ? 6000 : 20_000),
        });
      } catch {
        missing.push(describe(step.target));
        if (!options.dryRun) throw new Error(`Prvek '${describe(step.target)}' se neobjevil.`);
      }
      return;

    case "click":
      try {
        await clickTarget(session, step.target, options);
      } catch {
        missing.push(describe(step.target));
        if (!options.dryRun) throw new Error(`Could not click '${describe(step.target)}'.`);
      }
      await sleep(options.dryRun ? 120 : 350);
      return;

    case "type": {
      // Character by character — the recording should show the text being written.
      try {
        await locate(session.page, step.target).pressSequentially(step.text, {
          delay: options.dryRun ? 0 : (step.perCharMs ?? 45),
          timeout: 20_000,
        });
      } catch {
        missing.push(describe(step.target));
        if (!options.dryRun) throw new Error(`Could not type into '${describe(step.target)}'.`);
      }
      return;
    }

    case "point": {
      if (options.dryRun || options.pointer === "cdp") {
        const count = await locate(session.page, step.target).count();
        if (count === 0) missing.push(describe(step.target));
        return;
      }
      const where = await screenPointOf(session, locate(session.page, step.target));
      await moveSmooth(where, config.pointerMoveMs);
      return;
    }

    case "scroll": {
      const overMs = options.dryRun ? 150 : (step.overMs ?? 2000);
      const steps = Math.max(6, Math.round(overMs / 60));
      for (let i = 0; i < steps; i += 1) {
        await session.page.mouse.wheel(0, step.deltaY / steps);
        await sleep(overMs / steps);
      }
      return;
    }

    case "focusAddressBar":
      if (options.dryRun || options.pointer === "cdp") return;
      await hotkey("ctrl+l");
      return;

    case "hold":
      await sleep(options.dryRun ? Math.min(step.ms, 150) : step.ms);
      return;

    case "gate":
      if (options.dryRun) return;
      await gate(step.name, step.message, since, gates);
      return;

    case "evaluate":
      await session.page.evaluate(step.script);
      return;

    case "waitUntil": {
      const label = step.description ?? step.script;
      const deadline = Date.now() + (step.timeoutMs ?? 60_000);
      const pollMs = step.pollMs ?? 500;
      for (;;) {
        const ok = await session.page.evaluate(step.script).catch(() => false);
        if (ok) return;
        if (Date.now() > deadline) {
          missing.push(`until:${label}`);
          if (options.dryRun) return;
          throw new Error(`Timed out waiting until: ${label}`);
        }
        await sleep(pollMs);
      }
    }
  }
}

/**
 * Poll `watch.script` while a shot records and log every change of its value
 * with its offset from the moment the recorder was asked to start. Returns a
 * stop function that resolves to the collected markers.
 */
function watchMarkers(session: Session, watch: MarkerWatch, startedAt: number) {
  const markers: Marker[] = [];
  let running = true;
  let last: string | null = null;
  const loop = (async () => {
    while (running) {
      const value = await session.page
        .evaluate(watch.script)
        .then((v) => (v == null ? null : String(v)))
        .catch(() => null);
      if (value != null && value !== last) {
        markers.push({ t: (Date.now() - startedAt) / 1000, label: value });
        last = value;
      }
      await sleep(watch.pollMs ?? 250);
    }
  })();
  return async () => {
    running = false;
    await loop;
    return markers;
  };
}

function assertAllowedHost(baseUrl: string, forbidHosts: string[]): void {
  const hit = forbidHosts.find((host) => baseUrl.includes(host));
  if (hit) {
    throw new Error(
      `This scenario refuses to record on '${hit}' (baseUrl=${baseUrl}). ` +
        "A reviewer has to see production on a verified domain.",
    );
  }
}

export async function record(options: RecordOptions): Promise<string> {
  const scenario = getScenario(options.scenarioId);
  assertAllowedHost(scenario.baseUrl, scenario.forbidHosts);
  const shots: Shot[] = shotsForOutput(scenario, options.outputId);

  if (!options.dryRun && options.pointer === "os") await assertPointerToolAvailable();
  // Only a backend that writes a file needs ffmpeg; a dry run and `none` never
  // touch it. A card shot needs ffprobe regardless of backend, to measure the
  // file it is given. Checked here so a missing binary stops the take before
  // the browser moves, rather than surfacing on the first `recorder.stop()`.
  const hasCardShots = shots.some((shot) => shot.card);
  if (!options.dryRun && (options.backend !== "none" || hasCardShots)) {
    await assertToolsAvailable();
  }

  const dir = takeDir(`${scenario.id}-${options.outputId}-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });

  const recorder: Recorder =
    options.backend === "obs"
      ? obsRecorder(config.obs.url, config.obs.password)
      : options.backend === "x11grab"
        ? x11grabRecorder({
            display: options.display ?? process.env.DISPLAY ?? ":0",
            size: options.captureSize ?? "1920x1080",
            drawMouse: options.pointer !== "cdp",
          })
        : options.backend === "gdigrab"
          ? gdigrabRecorder({ size: options.captureSize, drawMouse: options.pointer !== "cdp" })
          : noopRecorder();

  // An output made entirely of card shots never touches a browser — nothing
  // in it needs a live app running.
  const hasLiveShots = shots.some((shot) => !shot.card);
  const session = hasLiveShots ? await connect(config.cdpUrl, config.pointerScale) : null;

  // Tabs from earlier runs would be in frame — a take starts on a clean window.
  if (session && !options.dryRun) await session.closeExtraTabs();

  if (session && options.reset && scenario.reset) {
    await session.page.goto(scenario.reset.url, { waitUntil: "domcontentloaded" });
    await session.page.evaluate(scenario.reset.evaluate);
    process.stdout.write("↺ starting state restored\n");
  }

  const rawDir = path.join(dir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });

  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const gates: GateLog[] = [];
  const records: ShotRecord[] = [];
  const missing: string[] = [];

  try {
    for (const shot of shots) {
      process.stdout.write(`▶ ${shot.id} — ${shot.title}\n`);

      // A card shot's footage is a file, not the browser — nothing here
      // touches the recorder, the session or the pointer. It still gets a
      // shots.json entry with a videoPath and narration, so `assemble`
      // treats it exactly like a recorded shot.
      if (shot.card) {
        // Resolved from the scenario directory, not process.cwd() — a
        // scenario's `card: { file: "./cards/x.mp4" }` means "next to me",
        // regardless of where `record` was invoked from.
        const sourceFile = path.isAbsolute(shot.card.file)
          ? shot.card.file
          : path.resolve(scenarioDir, shot.card.file);
        if (!fs.existsSync(sourceFile)) {
          missing.push(`card:${shot.id}`);
          if (!options.dryRun) {
            throw new Error(`Card shot '${shot.id}' references missing file '${sourceFile}'.`);
          }
          records.push({
            id: shot.id,
            title: shot.title,
            videoPath: "",
            seconds: 0,
            minHoldMs: shot.minHoldMs,
            narration: shot.narration,
          });
          continue;
        }
        if (options.dryRun) {
          process.stdout.write(`   ▤ card ${path.basename(sourceFile)} (dry run — not copied)\n`);
          records.push({
            id: shot.id,
            title: shot.title,
            videoPath: "",
            seconds: 0,
            minHoldMs: shot.minHoldMs,
            narration: shot.narration,
          });
          continue;
        }
        const target = path.join(rawDir, `${shot.id}${path.extname(sourceFile) || ".mp4"}`);
        fs.copyFileSync(sourceFile, target);
        const seconds = await durationSec(target);
        process.stdout.write(`   ▤ ${path.basename(target)} ${seconds.toFixed(1)}s (card)\n`);
        records.push({
          id: shot.id,
          title: shot.title,
          videoPath: target,
          seconds,
          minHoldMs: shot.minHoldMs,
          narration: shot.narration,
        });
        continue;
      }

      // Reaching here means this shot has no `card`, so `hasLiveShots` was
      // true and `session` was connected above.
      const liveSession = session!;

      // Navigation and waiting for render — before the camera rolls, so no
      // loading state reaches the video and nothing needs cutting out.
      for (const step of shot.setup ?? []) {
        await runStep(step, liveSession, since, gates, options, missing);
      }

      const target = path.join(rawDir, `${shot.id}.mp4`);
      const recordStartedAt = Date.now();
      if (!options.dryRun) await recorder.start(target);
      await recorder.chapter(shot.title);
      const stopMarkers = shot.markers
        ? watchMarkers(liveSession, shot.markers, recordStartedAt)
        : null;

      const startedMs = Date.now();
      let failed = false;
      try {
        for (const step of shot.steps) {
          await runStep(step, liveSession, since, gates, options, missing);
        }

        // A still beat at the end: post-production draws on it when the
        // narration runs longer than expected.
        const elapsed = Date.now() - startedMs;
        if (!options.dryRun && elapsed < shot.minHoldMs) await sleep(shot.minHoldMs - elapsed);
        if (!options.dryRun) await sleep(600);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        // Also on failure: a long take that dies twenty minutes in is still
        // footage, and an unstopped grabber leaves an unreadable file behind.
        const markers = stopMarkers ? await stopMarkers() : undefined;
        const wallSeconds = (Date.now() - recordStartedAt) / 1000;
        const written = options.dryRun ? "" : await recorder.stop().catch(() => "");
        const seconds = written ? await durationSec(written).catch(() => 0) : 0;
        if (markers?.length) {
          const list = markers.map((m) => `${m.t.toFixed(1)}s ${m.label}`).join(" · ");
          process.stdout.write(`   ⚑ ${list}\n`);
        }
        if (written) {
          process.stdout.write(
            `   ⏺ ${path.basename(written)} ${seconds.toFixed(1)}s${failed ? " (incomplete)" : ""}\n`,
          );
        }

        records.push({
          id: shot.id,
          title: shot.title,
          videoPath: written,
          seconds,
          minHoldMs: shot.minHoldMs,
          narration: shot.narration,
          markers,
          wallSeconds,
        });
      }
    }
  } finally {
    fs.writeFileSync(
      path.join(dir, "shots.json"),
      JSON.stringify(
        {
          scenario: scenario.id,
          output: options.outputId,
          baseUrl: scenario.baseUrl,
          recordedAt: new Date().toISOString(),
          shots: records,
          gates,
        },
        null,
        2,
      ),
      "utf8",
    );
    await session?.browser.close().catch(() => undefined);
  }

  if (missing.length > 0) {
    process.stdout.write(`\n⚠ Not found (selector, or 'card:<shot id>' for a missing card file): ${[...new Set(missing)].join(", ")}\n`);
    if (options.dryRun) process.stdout.write("  (dry run — fix them in the scenario and run again)\n");
  }
  process.stdout.write(`\n✓ ${path.join(dir, "shots.json")}\n`);
  return dir;
}
