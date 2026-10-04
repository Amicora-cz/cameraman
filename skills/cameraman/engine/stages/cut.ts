/**
 * Cut a clip out of a recorded shot — around a marker the shot logged while
 * it recorded (see `Shot.markers`), or around an offset in seconds.
 *
 * The clip is plain footage, ready to drop into another scenario as a `card`
 * shot. That is how a long raw take (a whole match played by bots) becomes
 * the handful of beats a trailer actually uses.
 */
import fs from "node:fs";
import path from "node:path";
import { ffmpeg, durationSec } from "../lib/ffmpeg";

type Marker = { t: number; label: string };
type ShotRecord = {
  id: string;
  videoPath: string;
  markers?: Marker[];
  wallSeconds?: number;
};

export type CutOptions = {
  take: string;
  shot: string;
  /** Exact marker label to cut around. */
  marker?: string;
  /** Which occurrence of `marker`, 0-based. */
  nth?: number;
  /** Seconds into the shot's file, instead of a marker. */
  at?: number;
  before: number;
  after: number;
  /** Omit to only list the shot's markers. */
  out?: string;
};

function loadShot(takeDir: string, shotId: string): ShotRecord {
  const file = path.join(path.resolve(takeDir), "shots.json");
  const take = JSON.parse(fs.readFileSync(file, "utf8")) as { shots: ShotRecord[] };
  const shot = take.shots.find((s) => s.id === shotId);
  if (!shot) {
    throw new Error(
      `Take has no shot '${shotId}'. Shots: ${take.shots.map((s) => s.id).join(", ")}`,
    );
  }
  if (!shot.videoPath || !fs.existsSync(shot.videoPath)) {
    throw new Error(`Shot '${shotId}' has no recording on disk.`);
  }
  return shot;
}

export async function cut(options: CutOptions): Promise<string | null> {
  const shot = loadShot(options.take, options.shot);
  const fileSeconds = await durationSec(shot.videoPath);
  // Markers are wall-clock offsets. The grabber writes constant frame rate, so
  // the two should agree — rescaling covers whatever drift is left.
  const scale = shot.wallSeconds ? fileSeconds / shot.wallSeconds : 1;
  const markers = (shot.markers ?? []).map((m) => ({ ...m, t: m.t * scale }));

  if (!options.out) {
    process.stdout.write(`${shot.id}: ${fileSeconds.toFixed(1)}s, scale ${scale.toFixed(4)}\n`);
    for (const m of markers) process.stdout.write(`  ${m.t.toFixed(2).padStart(8)}s  ${m.label}\n`);
    return null;
  }

  let at: number;
  if (options.marker !== undefined) {
    const hits = markers.filter((m) => m.label === options.marker);
    const hit = hits[options.nth ?? 0];
    if (!hit) {
      throw new Error(
        `Shot '${shot.id}' has no marker '${options.marker}' #${options.nth ?? 0} ` +
          `(${hits.length} found). Run cut without --out to list them.`,
      );
    }
    at = hit.t;
  } else if (options.at !== undefined) {
    at = options.at;
  } else {
    throw new Error("cut needs --marker <label> or --at <seconds>.");
  }

  const start = Math.max(0, at - options.before);
  const end = Math.min(fileSeconds, at + options.after);
  if (end - start < 0.2) throw new Error(`Clip around ${at.toFixed(2)}s is empty.`);

  const out = path.resolve(options.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Re-encoded rather than stream-copied: a copy can only start on a keyframe,
  // which would drift the cut by up to a GOP.
  await ffmpeg([
    "-ss", start.toFixed(3),
    "-i", shot.videoPath,
    "-t", (end - start).toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    // A keyframe every second: editors that seek into the clip (Hyperframes
    // warns about "sparse keyframes") otherwise freeze or show wrong frames.
    "-g", "30", "-keyint_min", "30", "-movflags", "+faststart",
    "-an",
    out,
  ]);
  process.stdout.write(`✓ ${out} (${start.toFixed(2)}s → ${end.toFixed(2)}s)\n`);
  return out;
}
