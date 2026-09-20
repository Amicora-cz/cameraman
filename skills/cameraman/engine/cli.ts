/**
 * cameraman — the recording engine.
 *
 *   tsx scripts/gverify/cli.ts list
 *   tsx scripts/gverify/cli.ts record --scenario demo --backend x11grab
 *   tsx scripts/gverify/cli.ts record --scenario google-calendar --dry-run
 *   tsx scripts/gverify/cli.ts assemble --take out/gverify/take-…
 *   tsx scripts/gverify/cli.ts voice --take out/gverify/take-… --scenario demo
 *   tsx scripts/gverify/cli.ts voice --take out/gverify/take-… --scenario demo \
 *        --single-take narration.mp3     # one continuous read, split automatically
 */
import { record } from "./stages/record";
import { assemble, type AssembleOptions } from "./stages/assemble";
import { voice } from "./stages/voice";
import { listScenarios, getScenario } from "./scenarios";

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}
const has = (name: string) => process.argv.includes(`--${name}`);

function assembleOptions(): AssembleOptions {
  // `--poster` alone means "pick one"; `--poster 12.5` pins the timestamp.
  const poster = flag("poster");
  return {
    burnSubtitles: has("burn-subs"),
    intro: flag("intro"),
    outro: flag("outro"),
    poster: poster === "true" ? true : poster !== undefined ? Number(poster) : undefined,
  };
}

async function main() {
  const command = process.argv[2];

  if (command === "list" || !command) {
    for (const scenario of listScenarios()) {
      process.stdout.write(`${scenario.id}  — ${scenario.title}\n`);
      for (const output of scenario.outputs) {
        process.stdout.write(`   output '${output.id}': ${output.shots.length} shots\n`);
      }
    }
    return;
  }

  if (command === "record") {
    const scenarioId = flag("scenario", "demo")!;
    const outputId = flag("output", "full")!;
    getScenario(scenarioId); // fail on an unknown id before anything starts
    const dir = await record({
      scenarioId,
      outputId,
      backend: (flag("backend", "obs") as "obs" | "x11grab" | "none"),
      pointer: (flag("pointer", "os") as "os" | "cdp"),
      dryRun: has("dry-run"),
      reset: has("reset"),
      display: flag("display"),
      captureSize: flag("size"),
    });
    if (has("assemble")) await assemble(dir, assembleOptions());
    return;
  }

  if (command === "voice") {
    await voice(
      flag("take")!,
      flag("scenario", "google-calendar")!,
      flag("output", "full")!,
      flag("single-take"),
    );
    return;
  }

  if (command === "assemble") {
    await assemble(flag("take")!, assembleOptions());
    return;
  }

  throw new Error(`Unknown command '${command}'. Use: list | record | voice | assemble`);
}

main().catch((error) => {
  process.stderr.write(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
