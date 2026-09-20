/**
 * Split one continuous read into per-shot clips.
 *
 * Why this exists: the way to get a commentary that holds together is to have
 * it spoken **in one piece** — one TTS request, or a person reading the whole
 * script once. Prosody then carries itself. But the pipeline needs a clip per
 * shot, because a clip's length sets the shot's length.
 *
 * Cuts are looked for in the silence between sentences. Taking "the N-1
 * longest pauses" is not enough: in a longer read three of the longest can sit
 * inside a single shot. So each boundary gets an expected time from the ratio
 * of text lengths, and takes the silence nearest to it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Silence = { start: number; end: number; middle: number };

/** Find silences longer than `minDurationSec` (ffmpeg silencedetect). */
export async function detectSilences(
  file: string,
  noiseDb = -34,
  minDurationSec = 0.22,
): Promise<Silence[]> {
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file,
     "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`, "-f", "null", "-"],
    { maxBuffer: 32 * 1024 * 1024 },
  ).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));

  const silences: Silence[] = [];
  let start: number | null = null;
  for (const line of String(stderr).split("\n")) {
    const startMatch = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (startMatch) start = Number(startMatch[1]);
    const endMatch = /silence_end:\s*([\d.]+)/.exec(line);
    if (endMatch && start !== null) {
      const end = Number(endMatch[1]);
      silences.push({ start, end, middle: (start + end) / 2 });
      start = null;
    }
  }
  return silences;
}

/**
 * Pick cut points for `weights` segments (typically the per-shot text
 * lengths). Returns `weights.length - 1` strictly increasing times.
 */
export function pickCutPoints(
  totalSec: number,
  weights: number[],
  silences: Silence[],
): { cuts: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const total = weights.reduce((sum, w) => sum + w, 0);

  const cuts: number[] = [];
  let cumulative = 0;
  let searchFrom = 0;

  for (let i = 0; i < weights.length - 1; i += 1) {
    cumulative += weights[i];
    const expected = (cumulative / total) * totalSec;

    const candidates = silences.filter((s) => s.middle > searchFrom + 0.2);
    if (candidates.length === 0) {
      warnings.push(
        `No silence left for boundary ${i + 1} — cutting at the expected ${expected.toFixed(2)}s.`,
      );
      cuts.push(expected);
      searchFrom = expected;
      continue;
    }

    const best = candidates.reduce((a, b) =>
      Math.abs(a.middle - expected) <= Math.abs(b.middle - expected) ? a : b,
    );
    const drift = Math.abs(best.middle - expected);
    if (drift > 2.5) {
      warnings.push(
        `Boundary ${i + 1}: the nearest silence is ${drift.toFixed(1)}s from the expected time ` +
          "— check that the narration still matches the scenario.",
      );
    }
    cuts.push(best.middle);
    searchFrom = best.middle;
  }

  return { cuts, warnings };
}
