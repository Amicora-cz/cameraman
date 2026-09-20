/**
 * Screen capture backends.
 *
 * - `obs`      — OBS Studio over obs-websocket. The production choice: scenes,
 *                quality, chapters, and it works on all three platforms.
 * - `x11grab`  — ffmpeg straight off an X display. Needs nothing else on Linux,
 *                so it suits CI and smoke-testing the pipeline.
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
          "-draw_mouse", "1",
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
