/** Thin wrappers over ffmpeg/ffprobe. No npm dependency — the binaries are called. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function ffmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

export async function durationSec(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
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
  const { stdout } = await run("ffprobe", [
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

export async function assertToolsAvailable(): Promise<void> {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    try {
      await run(tool, ["-version"]);
    } catch {
      throw new Error(`${tool} is missing. Install ffmpeg (apt/brew/winget).`);
    }
  }
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
