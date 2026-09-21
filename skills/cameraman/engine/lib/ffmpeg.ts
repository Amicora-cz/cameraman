/**
 * Thin wrappers over ffmpeg/ffprobe, and the one place that decides which
 * binary they are.
 *
 * Resolution order, per tool: `FFMPEG_PATH`/`FFPROBE_PATH` → PATH → the copy
 * npm put in `node_modules`. PATH wins over the bundled build on purpose: it
 * is the newer one and the one the operator chose. The bundle is the floor, so
 * that a machine with no ffmpeg still records instead of failing preflight.
 *
 * The bundle is optionalDependencies — an unsupported platform or a blocked
 * registry leaves the install standing, with PATH as the only source.
 *
 * ffmpeg comes from `ffmpeg-static` (7.0.2), which fetches its binary in a
 * postinstall step. `/plugin install` runs npm with scripts disabled, so on
 * that path it unpacks to a directory with no binary in it — which is what
 * `ensureBundledFfmpeg` below is for.
 */
import fs from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ToolSource = "override" | "path" | "bundled";
export type ResolvedTool = { bin: string; source: ToolSource };

function onPath(tool: string): boolean {
  try {
    execFileSync(tool, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * `require` the installer package and hand back the binary it unpacked.
 *
 * Two export shapes, because the two packages disagree: `ffmpeg-static` is the
 * path, `@ffprobe-installer` wraps it in `{ path }`.
 *
 * The executable bit is re-applied rather than trusted: `@ffprobe-installer`
 * has been seen unpacking its binary 0644 (and 0744, which only happens to
 * work when the installing user is the one recording), and the package checks
 * the file's size but never whether it can be run. Fixing the mode is right
 * either way — the file is ours, inside our own node_modules.
 *
 * A missing file is a normal outcome, not a bug: `ffmpeg-static` downloads in
 * a postinstall step, so a blocked registry or `--ignore-scripts` leaves the
 * path pointing at nothing. Returning null lets the caller say so properly.
 */
function bundledBin(spec: string): string | null {
  let bin: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(spec) as string | { path?: string } | undefined;
    const resolved = typeof mod === "string" ? mod : mod?.path;
    if (!resolved) return null;
    bin = resolved;
  } catch {
    return null;
  }
  try {
    fs.accessSync(bin, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(bin, 0o755);
      fs.accessSync(bin, fs.constants.X_OK);
    } catch {
      return null;
    }
  }
  return bin;
}

/** `installers` is tried in order, newest build first. */
function resolveTool(tool: "ffmpeg" | "ffprobe", installers: string[]): ResolvedTool {
  const override = process.env[tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (override) return { bin: override, source: "override" };
  if (onPath(tool)) return { bin: tool, source: "path" };
  for (const installer of installers) {
    const bundled = bundledBin(installer);
    if (bundled) return { bin: bundled, source: "bundled" };
  }
  const fetchHint =
    tool === "ffmpeg"
      ? "`npm install` in the cameraman directory, or, where npm was not " +
        "allowed to run scripts, `node node_modules/ffmpeg-static/install.js` there"
      : "`npm install` in the cameraman directory";
  throw new Error(
    `${tool} is missing. Either install ffmpeg (apt/brew/winget), or run ` +
      `${fetchHint}, or point ` +
      `${tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"} at one.`,
  );
}

// Probing the filesystem once per process is enough; the answer cannot change
// mid-take, and `detectSilences` alone would otherwise re-probe per shot.
let ffmpegTool: ResolvedTool | null = null;
let ffprobeTool: ResolvedTool | null = null;

export function ffmpegBin(): string {
  ffmpegTool ??= resolveTool("ffmpeg", ["ffmpeg-static"]);
  return ffmpegTool.bin;
}

export function ffprobeBin(): string {
  ffprobeTool ??= resolveTool("ffprobe", ["@ffprobe-installer/ffprobe"]);
  return ffprobeTool.bin;
}

export async function ffmpeg(args: string[]): Promise<void> {
  await run(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

export async function durationSec(file: string): Promise<number> {
  const { stdout } = await run(ffprobeBin(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const value = Number(stdout.trim());
  if (!Number.isFinite(value)) throw new Error(`ffprobe returned no duration for ${file}`);
  return value;
}

/** Read stream properties of the first video stream, comma separated. */
export async function probeStream(file: string, entries: string): Promise<string> {
  const { stdout } = await run(ffprobeBin(), [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", `stream=${entries}`,
    "-of", "csv=p=0:s=,",
    file,
  ]);
  return stdout.trim().split("\n")[0];
}

/** Pull a still for use as a thumbnail. */
export async function extractPoster(video: string, atSeconds: number, target: string): Promise<void> {
  await ffmpeg(["-ss", atSeconds.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "2", target]);
}

/** Set to 1 to keep preflight from reaching the network. */
const SKIP_DOWNLOAD = "CAMERAMAN_SKIP_FFMPEG_DOWNLOAD";

/**
 * One retry, because the download is an 80 MB reach across the network and the
 * only source of an ffmpeg on a plugin install. A gateway timing out once is
 * not a reason to fail a take.
 */
const FETCH_ATTEMPTS = 2;

/**
 * Why the fetch failed, in one line.
 *
 * `execFile` rejects with "Command failed: node install.js" and nothing else,
 * which diagnoses nothing. The installer's own stack ends in a `{ url,
 * statusCode }` tail, and that status is the whole answer \u2014 a 504 from a proxy
 * reads very differently from a 404.
 */
function fetchFailureReason(error: unknown): string {
  const details = error as { stderr?: string; message?: string } | undefined;
  const text = (details?.stderr ?? "").trim();
  const line = /^Error: .*/m.exec(text)?.[0];
  const status = /statusCode:\s*(\d+)/.exec(text)?.[1];
  if (line && status) return `${line} \u2014 HTTP ${status}`;
  if (line) return line;
  if (status) return `HTTP ${status}`;
  return (details?.message ?? String(error)).split("\n")[0];
}

/**
 * Fetch the modern bundled ffmpeg when npm was not allowed to.
 *
 * `ffmpeg-static` pulls its binary in a postinstall step, and `/plugin
 * install` runs npm with scripts disabled, so the package lands as a directory
 * with nothing in it. Preflight does that fetch itself — the same thing the
 * postinstall would have done, at the first moment we are allowed to do it.
 *
 * It is skipped whenever the answer is already settled: an operator's
 * `FFMPEG_PATH`, an ffmpeg on PATH, a binary already fetched, or the opt-out.
 * On a plugin install this is the only source of an ffmpeg, so a failure here
 * means preflight fails — loudly, before a take, which is the point of doing
 * it at preflight rather than at the first `recorder.stop()`.
 */
async function ensureBundledFfmpeg(): Promise<void> {
  if (process.env[SKIP_DOWNLOAD] === "1") return;
  if (process.env.FFMPEG_PATH) return;
  if (onPath("ffmpeg")) return;
  if (bundledBin("ffmpeg-static")) return;

  let installer: string;
  try {
    installer = require.resolve("ffmpeg-static/install.js");
  } catch {
    return; // not installed at all; nothing to fetch
  }

  process.stdout.write("  ffmpeg: fetching the bundled build, once (~80 MB)\n");
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      await run(process.execPath, [installer], { timeout: 10 * 60_000 });
      ffmpegTool = null; // re-resolve; the binary is there now
      process.stdout.write("  ffmpeg: fetched\n");
      return;
    } catch (error) {
      const why = fetchFailureReason(error);
      if (attempt < FETCH_ATTEMPTS) {
        process.stdout.write(`  ffmpeg: fetch failed (${why}), retrying\n`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      // Not thrown here: PATH and FFMPEG_PATH were already ruled out, so the
      // resolver is about to fail with the full list of places it looked. One
      // line of why the fetch did not help is worth more than a second throw.
      process.stdout.write(`  ffmpeg: fetch failed (${why})\n`);
    }
  }
}

/**
 * Preflight. Resolves both tools and proves each one actually executes — a
 * path that resolves but will not run is the failure worth catching before a
 * take, not mid-assemble.
 */
export async function assertToolsAvailable(): Promise<ResolvedTool[]> {
  await ensureBundledFfmpeg();
  const tools = [
    { name: "ffmpeg", resolved: { bin: ffmpegBin(), source: ffmpegTool!.source } },
    { name: "ffprobe", resolved: { bin: ffprobeBin(), source: ffprobeTool!.source } },
  ];
  for (const { name, resolved } of tools) {
    try {
      await run(resolved.bin, ["-version"]);
    } catch {
      throw new Error(
        `${name} resolved to ${resolved.bin} (${resolved.source}) but will not run.`,
      );
    }
  }
  return tools.map((t) => t.resolved);
}

/**
 * Shift every cue in an SRT by `offsetSeconds`.
 *
 * Captions are timed against the shots alone, so anything prepended — an intro
 * composition, for instance — desynchronises all of them at once.
 */
export function shiftSrt(cues: string[], offsetSeconds: number): string[] {
  const shiftOne = (stamp: string): string => {
    const [h, m, rest] = stamp.split(":");
    const [sec, ms] = rest.split(",");
    const total =
      Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(ms) / 1000 + offsetSeconds;
    return srtTime(total);
  };
  return cues.map((cue) =>
    cue.replace(
      /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/,
      (_match, from: string, to: string) => `${shiftOne(from)} --> ${shiftOne(to)}`,
    ),
  );
}

/** Seconds to SRT time (00:00:03,500). */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}
