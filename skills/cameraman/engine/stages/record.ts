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
import { durationSec } from "../lib/ffmpeg";
import { connect, screenPointOf, type Session } from "../lib/browser";
import { assertPointerToolAvailable, clickAt, moveSmooth, hotkey } from "../lib/pointer";
import { gate, type GateLog } from "../lib/gate";
import { noopRecorder, obsRecorder, x11grabRecorder, type Recorder } from "../lib/recorder";
import { getScenario, shotsForOutput, type Shot, type Step, type Target } from "../scenarios";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RecordOptions = {
  scenarioId: string;
  outputId: string;
  /** `obs` (produkce), `x11grab` (Linux/CI), `none` (jen proklik). */
  backend: "obs" | "x11grab" | "none";
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
      const match = session.page
        .context()
        .pages()
        .find((p) => p.url().includes(step.urlIncludes));
      if (!match) throw new Error(`No open tab matches '${step.urlIncludes}'.`);
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
  }
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

  const dir = takeDir(`${scenario.id}-${options.outputId}-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });

  const recorder: Recorder =
    options.backend === "obs"
      ? obsRecorder(config.obs.url, config.obs.password)
      : options.backend === "x11grab"
        ? x11grabRecorder({
            display: options.display ?? process.env.DISPLAY ?? ":0",
            size: options.captureSize ?? "1920x1080",
          })
        : noopRecorder();

  const session = await connect(config.cdpUrl, config.pointerScale);

  // Tabs from earlier runs would be in frame — a take starts on a clean window.
  if (!options.dryRun) await session.closeExtraTabs();

  if (options.reset && scenario.reset) {
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

      // Navigation and waiting for render — before the camera rolls, so no
      // loading state reaches the video and nothing needs cutting out.
      for (const step of shot.setup ?? []) {
        await runStep(step, session, since, gates, options, missing);
      }

      const target = path.join(rawDir, `${shot.id}.mp4`);
      if (!options.dryRun) await recorder.start(target);
      await recorder.chapter(shot.title);

      const startedMs = Date.now();
      for (const step of shot.steps) {
        await runStep(step, session, since, gates, options, missing);
      }

      // A still beat at the end: post-production draws on it when the
      // narration runs longer than expected.
      const elapsed = Date.now() - startedMs;
      if (!options.dryRun && elapsed < shot.minHoldMs) await sleep(shot.minHoldMs - elapsed);
      if (!options.dryRun) await sleep(600);

      const written = options.dryRun ? "" : await recorder.stop().catch(() => "");
      const seconds = written ? await durationSec(written).catch(() => 0) : 0;
      if (written) process.stdout.write(`   ⏺ ${path.basename(written)} ${seconds.toFixed(1)}s\n`);

      records.push({
        id: shot.id,
        title: shot.title,
        videoPath: written,
        seconds,
        minHoldMs: shot.minHoldMs,
        narration: shot.narration,
      });
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
    await session.browser.close().catch(() => undefined);
  }

  if (missing.length > 0) {
    process.stdout.write(`\n⚠ Selectors not found: ${[...new Set(missing)].join(", ")}\n`);
    if (options.dryRun) process.stdout.write("  (dry run — fix them in the scenario and run again)\n");
  }
  process.stdout.write(`\n✓ ${path.join(dir, "shots.json")}\n`);
  return dir;
}
