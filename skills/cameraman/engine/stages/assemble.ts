/**
 * Post-production: turns the per-shot recordings and `shots.json` into the
 * finished video and its subtitles.
 *
 * What it does:
 *  1. fits each shot to its target length (freezing the last frame if short),
 *  2. lays the narration clip on the shot and derives that target from it, so
 *     sync comes from construction rather than nudging,
 *  3. writes the SRT from the same numbers.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ffmpeg,
  durationSec,
  assertToolsAvailable,
  srtTime,
  probeStream,
  shiftSrt,
  extractPoster,
} from "../lib/ffmpeg";
import { captionText } from "../scenarios";

type ShotRecord = {
  id: string;
  title: string;
  /** The shot's file. Recording is per shot, so the file IS the shot. */
  videoPath: string;
  seconds: number;
  minHoldMs: number;
  narration: string;
};
type Take = { shots: ShotRecord[] };
type VoiceClip = {
  id: string;
  file: string;
  seconds: number;
  source?: "single-take" | "per-shot";
  narration?: string;
};

/**
 * Silence padded around the narration — but ONLY for clips generated per
 * shot, which carry no pause of their own.
 *
 * Clips from a single take are cut in the middle of the silence between
 * sentences, so each already carries half a pause at each end. Adding more
 * produced the model's own pause PLUS 0.8s between every sentence, and that is
 * exactly what a spliced-together read sounds like, rather than someone
 * drawing breath.
 */
const LEAD_IN_SEC = 0.35;
const TAIL_SEC = 0.45;

function padsFor(clip: VoiceClip | undefined): { lead: number; tail: number } {
  if (!clip || clip.source === "single-take") return { lead: 0, tail: 0 };
  return { lead: LEAD_IN_SEC, tail: TAIL_SEC };
}

export type AssembleOptions = {
  burnSubtitles?: boolean;
  /**
   * Designed motion to bookend the footage — typically rendered by Hyperframes
   * (`npx hyperframes render`). Cameraman owns the real product footage, the
   * narration and the captions; a composition tool owns title cards, callouts
   * and an outro. The seam is an mp4: it is re-encoded to match the shots, so
   * resolution, frame rate and audio layout do not have to agree in advance.
   */
  intro?: string;
  outro?: string;
  /**
   * Pull a still to use as the thumbnail. Give a timestamp in seconds; the
   * default picks a third of the way in, which lands on content rather than on
   * a page still settling.
   */
  poster?: number | true;
};

/** Re-encode a bookend so it concatenates with the shots without artefacts. */
async function normaliseBookend(
  source: string,
  reference: string,
  target: string,
): Promise<void> {
  const [width, height, fps] = (
    await probeStream(reference, "width,height,r_frame_rate")
  ).split(",");
  await ffmpeg([
    "-i", source,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-vf", `scale=${width}:${height},fps=${fps},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ac", "2",
    "-map", "0:v:0", "-map", "0:a:0?", "-map", "1:a:0",
    "-map_metadata", "-1",
    target,
  ]).catch(async () => {
    // No audio track in the composition — mux the generated silence instead.
    await ffmpeg([
      "-i", source,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-shortest",
      "-vf", `scale=${width}:${height},fps=${fps},format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k", "-ac", "2",
      target,
    ]);
  });
}

export async function assemble(
  takeDirPath: string,
  options: AssembleOptions = {},
): Promise<string> {
  const burnSubtitles = options.burnSubtitles ?? false;
  await assertToolsAvailable();
  // The concat demuxer resolves list entries relative to the list file, not to
  // cwd — so everything here works in absolute paths.
  const takePath = path.resolve(takeDirPath);

  const take = JSON.parse(
    fs.readFileSync(path.join(takePath, "shots.json"), "utf8"),
  ) as Take;
  if (!take.shots?.length) {
    throw new Error("shots.json contains no shots.");
  }

  const voiceManifest = path.join(takePath, "voice", "manifest.json");
  const voice: VoiceClip[] = fs.existsSync(voiceManifest)
    ? (JSON.parse(fs.readFileSync(voiceManifest, "utf8")) as VoiceClip[])
    : [];

  const work = path.join(takePath, "work");
  fs.mkdirSync(work, { recursive: true });

  const pieces: string[] = [];
  const srt: string[] = [];
  let timeline = 0;

  for (const [index, shot] of take.shots.entries()) {
    if (!shot.videoPath || !fs.existsSync(shot.videoPath)) {
      throw new Error(`No recording for shot ${shot.id} (${shot.videoPath || "no path"}).`);
    }

    const recorded = shot.seconds || (await durationSec(shot.videoPath));
    const clip = voice.find((v) => v.id === shot.id);
    const { lead, tail } = padsFor(clip);
    const narrated = clip ? clip.seconds + lead + tail : shot.minHoldMs / 1000;

    /**
     * A shot is never trimmed below what was recorded: padding the audio with
     * silence costs nothing, dropping filmed frames costs the shot. Where the
     * footage falls short, the last frame is frozen.
     */
    const target = Math.max(recorded, narrated);

    const fitted = path.join(work, `${shot.id}-fitted.mp4`);
    if (recorded >= target - 0.05) {
      await ffmpeg(["-i", shot.videoPath, "-t", target.toFixed(3), "-c", "copy", fitted]);
    } else {
      await ffmpeg([
        "-i", shot.videoPath,
        "-vf", `tpad=stop_mode=clone:stop_duration=${(target - recorded).toFixed(3)}`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-an", fitted,
      ]);
    }

    const audio = path.join(work, `${shot.id}.m4a`);
    if (clip) {
      await ffmpeg([
        "-i", clip.file,
        "-af", `adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad`,
        "-t", target.toFixed(3), "-ac", "2", "-c:a", "aac", "-b:a", "192k",
        audio,
      ]);
    } else {
      await ffmpeg([
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", target.toFixed(3), "-c:a", "aac", "-b:a", "192k",
        audio,
      ]);
    }

    const piece = path.join(work, `${shot.id}-final.mp4`);
    await ffmpeg(["-i", fitted, "-i", audio, "-c", "copy", "-shortest", piece]);
    pieces.push(piece);

    srt.push(
      `${index + 1}\n${srtTime(timeline + lead)} --> ${srtTime(
        timeline + target - 0.2,
      )}\n${captionText(clip?.narration ?? shot.narration)}\n`,
    );
    timeline += target;
  }

  // Bookends are prepended/appended after the shots exist, so they can be
  // matched to the real footage rather than guessed at.
  let introSeconds = 0;
  if (options.intro) {
    const normalised = path.join(work, "intro.mp4");
    await normaliseBookend(path.resolve(options.intro), pieces[0], normalised);
    introSeconds = await durationSec(normalised);
    pieces.unshift(normalised);
  }
  if (options.outro) {
    const normalised = path.join(work, "outro.mp4");
    await normaliseBookend(path.resolve(options.outro), pieces[pieces.length - 1], normalised);
    pieces.push(normalised);
  }

  const listFile = path.join(work, "final-list.txt");
  fs.writeFileSync(listFile, pieces.map((p) => `file '${p}'`).join("\n"), "utf8");
  const final = path.join(takePath, "final.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", final]);
  // Captions were timed against the shots alone; an intro shifts all of them.
  const shifted = introSeconds > 0 ? shiftSrt(srt, introSeconds) : srt;
  fs.writeFileSync(path.join(takePath, "final.srt"), shifted.join("\n"), "utf8");

  const srtPath = path.join(takePath, "final.srt");

  let delivered = final;
  if (burnSubtitles) {
    // A sidecar .srt is not picked up by a player on its own. For sharing and
    // for a reviewer the captions are burned in; the sidecar stays for YouTube.
    const subbed = path.join(takePath, "final-subtitled.mp4");
    await ffmpeg([
      "-i", final,
      "-vf",
      `subtitles=${srtPath.replace(/[\\:]/g, "\\$&")}:force_style='FontSize=10,PrimaryColour=&Hffffff&,OutlineColour=&HB0000000&,BorderStyle=3,Outline=1,Shadow=0,MarginV=28'`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      subbed,
    ]);
    delivered = subbed;
  }

  if (options.poster) {
    const at = typeof options.poster === "number" ? options.poster : (await durationSec(final)) / 3;
    const poster = path.join(takePath, "poster.jpg");
    await extractPoster(delivered, at, poster);
    process.stdout.write(`✓ ${poster} (at ${at.toFixed(1)}s)\n`);
  }

  const total = await durationSec(delivered);
  process.stdout.write(`\n✓ ${delivered} (${total.toFixed(1)} s)\n✓ ${srtPath}\n`);
  return delivered;
}
