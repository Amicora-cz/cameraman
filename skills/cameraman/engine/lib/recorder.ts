/**
 * Screen capture backends.
 *
 * - `obs`      — OBS Studio over obs-websocket. The production choice: scenes,
 *                quality, chapters, and it works on all three platforms.
 * - `x11grab`  — ffmpeg straight off an X display. Needs nothing else on Linux,
 *                so it suits CI and smoke-testing the pipeline.
 * - `gdigrab`  — ffmpeg straight off the desktop on Windows. Needs nothing
 *                else either — same reasoning as x11grab, same ffmpeg binary
 *                cameraman already resolves, just a different `-f`.
 * - `none`     — records nothing, just walks the scenario (`--dry-run`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { ObsClient } from "./obs";
import { ffmpegBin } from "./ffmpeg";

/**
 * Screen capture. Recording is PER SHOT — `start(target)` and `stop()` are
 * called for each shot separately.
 *
 * Why not one continuous file: the cuts would have to be found by the
 * scenario's clock, and video time is not wall-clock time. When the grabber
 * cannot keep the requested fps — under Xvfb in a container the recording came
 * out 11% short — the two drift apart, and unevenly, so not even a scale factor
 * repairs it. The end of a shot then shows the start of the next one.
 *
 * One file per shot removes the problem entirely: the file IS the shot. It also
 * stops recording during `setup` steps and while waiting on a human, so there
 * is nothing to cut out afterwards.
 */
export type Recorder = {
  start(outputPath: string): Promise<void>;
  chapter(name: string): Promise<void>;
  stop(): Promise<string>;
};

export function noopRecorder(): Recorder {
  return {
    async start() {},
    async chapter() {},
    async stop() {
      return "";
    },
  };
}

export function obsRecorder(url: string, password: string): Recorder {
  const client = new ObsClient(url, password);
  let connected = false;
  return {
    async start() {
      if (!connected) {
        await client.connect();
        connected = true;
      }
      await client.startRecord();
    },
    chapter: (name) => client.chapter(name),
    async stop() {
      // The connection is kept between shots; the run closes it at the end.
      return client.stopRecord();
    },
  };
}

export function x11grabRecorder(options: {
  display: string;
  size: string;
  fps?: number;
  /** Draw the OS cursor. Off for `--pointer cdp`: nothing moves it, so a
   *  cursor in frame is wherever the user's mouse happened to rest. */
  drawMouse?: boolean;
}): Recorder {
  let child: ChildProcess | null = null;
  let target = "";

  return {
    async start(outputPath: string) {
      target = outputPath;
      child = spawn(
        ffmpegBin(),
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "x11grab",
          "-draw_mouse", options.drawMouse === false ? "0" : "1",
          "-video_size", options.size,
          "-framerate", String(options.fps ?? 30),
          "-i", options.display,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-pix_fmt", "yuv420p",
          target,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      child.stderr?.on("data", (chunk) => process.stderr.write(`  ffmpeg: ${chunk}`));
      // ffmpeg needs a moment to grab the display, or the first shot is missing.
      await new Promise((r) => setTimeout(r, 1200));
    },
    async chapter() {
      // x11grab has no chapters — shot offsets live in shots.json anyway.
    },
    async stop() {
      if (!child) return "";
      const done = new Promise<void>((resolve) => child?.once("close", () => resolve()));
      // 'q' on stdin ends ffmpeg cleanly and writes the moov atom.
      child.stdin?.write("q");
      child.stdin?.end();
      await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
      if (child.exitCode === null) child.kill("SIGINT");
      child = null;
      return target;
    },
  };
}

/**
 * Full-desktop capture on Windows via ffmpeg's `gdigrab` — no separate
 * install, no websocket to configure, same reasoning as `x11grab` on Linux.
 * Captures the whole screen (not a specific window): the operator is
 * expected to put the target app in front — fullscreen, ideally, so nothing
 * else is in frame — the same way a human recording a demo would.
 */
export function gdigrabRecorder(options: { size?: string; fps?: number; drawMouse?: boolean }): Recorder {
  let child: ChildProcess | null = null;
  let target = "";

  return {
    async start(outputPath: string) {
      target = outputPath;
      const sizeArgs = options.size
        ? ["-offset_x", "0", "-offset_y", "0", "-video_size", options.size]
        : [];
      child = spawn(
        ffmpegBin(),
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "gdigrab",
          // Same rule as x11grab: no cursor unless the engine drives the real one.
          "-draw_mouse", options.drawMouse === false ? "0" : "1",
          "-framerate", String(options.fps ?? 30),
          ...sizeArgs,
          "-i", "desktop",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-pix_fmt", "yuv420p",
          // gdigrab stamps frames with capture time; constant frame rate
          // output fills any dropped frame with a duplicate, so file time
          // tracks wall-clock time and shot markers stay aligned.
          "-fps_mode", "cfr", "-r", String(options.fps ?? 30),
          // Fragmented MP4 stays readable if ffmpeg is killed before it can
          // write the index — a long take that dies is still footage.
          "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
          target,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      child.stderr?.on("data", (chunk) => process.stderr.write(`  ffmpeg: ${chunk}`));
      // Same settle time as x11grab — ffmpeg needs a moment to attach to the
      // desktop DC, or the first shot is missing.
      await new Promise((r) => setTimeout(r, 1200));
    },
    async chapter() {
      // gdigrab has no chapters — shot offsets live in shots.json anyway.
    },
    async stop() {
      if (!child) return "";
      const done = new Promise<void>((resolve) => child?.once("close", () => resolve()));
      // 'q' on stdin ends ffmpeg cleanly and writes the moov atom — same
      // trick as x11grab, ffmpeg's console-quit handling isn't backend-specific.
      child.stdin?.write("q");
      child.stdin?.end();
      await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
      if (child.exitCode === null) child.kill("SIGINT");
      child = null;
      return target;
    },
  };
}
