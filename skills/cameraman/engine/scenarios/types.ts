/**
 * The scenario model.
 *
 * A scenario is the source one or more videos (`outputs`) are assembled from.
 * Google wants a single video for the whole request; Meta wants a screencast
 * per permission. Hence outputs, rather than "a scenario is a video".
 * Viz docs/runbooks/video-tool-repo-plan.md §2b.
 */

export type Target = {
  /** Preferred selector — survives rewording of the interface. */
  testId?: string;
  role?: "button" | "link" | "textbox" | "heading";
  name?: string;
  /** Fallback to visible text where no testId exists yet. */
  text?: string;
};

export type Step =
  | { kind: "goto"; url: string }
  | { kind: "newTab"; url: string }
  /**
   * `nth` (0-based, default 0) picks among several pages that all match
   * `urlIncludes` — several player windows spawned with the same URL shape
   * (differing only in query params like `playerName`) are the case this
   * exists for: there is no substring that identifies "the second one"
   * short of a value the scenario cannot know in advance (a randomly
   * generated bot name).
   */
  | { kind: "switchTab"; urlIncludes: string; nth?: number }
  | { kind: "click"; target: Target }
  /** Move onto an element without clicking — show it without firing it. */
  | { kind: "point"; target: Target }
  | { kind: "type"; target: Target; text: string; perCharMs?: number }
  | { kind: "waitFor"; target: Target; timeoutMs?: number }
  | { kind: "scroll"; deltaY: number; overMs?: number }
  | { kind: "focusAddressBar" }
  | { kind: "hold"; ms: number }
  | { kind: "gate"; name: string; message: string }
  /**
   * Run arbitrary JS in the page — for flipping app state that has no UI
   * flow worth filming (a settings IPC call, a feature flag), not for
   * anything the viewer is meant to see happen. `scenario.reset.evaluate`
   * already does the same thing for "start of take"; this is the per-step
   * version for the middle of a scenario.
   */
  | { kind: "evaluate"; script: string }
  /**
   * Poll a JS expression in the page until it is truthy. For apps whose
   * progress is driven by something other than the scenario (a server, a
   * timer, bots) a fixed `hold` is either too short (flaky) or too long
   * (dead footage); waiting on the app's own state is neither. `description`
   * names the condition in the error and the dry-run report.
   */
  | {
      kind: "waitUntil";
      script: string;
      description?: string;
      timeoutMs?: number;
      pollMs?: number;
    };

/**
 * Timeline markers for a recorded shot. `script` is polled in the page while
 * the camera rolls; every time its (string) value changes, the new value is
 * logged with its offset into the shot's file. A long raw take — a whole
 * match played by bots — can then be cut into clips by what happened in it
 * (`cameraman cut --marker ...`) instead of by scrubbing through it.
 */
export type MarkerWatch = { script: string; pollMs?: number };

export type Marker = { t: number; label: string };

export type Shot = {
  id: string;
  title: string;
  /**
   * Steps that run BEFORE the shot starts and never reach the video —
   * navigation, and waiting for the page to finish rendering.
   *
   * Without this a shot opened on a loading skeleton: `goto` waits only for
   * `domcontentloaded` and the rest fills in client-side, so the narration
   * described content that was not on screen yet. Nothing is recorded while
   * setup runs.
   */
  setup?: Step[];
  /**
   * The text to be spoken. May carry `eleven_v3` inline tags
   * (`[breathes]`, `[whispering]`, `[laughs softly]`) a interpunkci, kterou se
   * drives delivery: an ellipsis `…` is a thinking pause, an em-dash `—` a
   * short beat, commas and periods the natural breaths.
   *
   * Tags never reach the subtitles — `captionText()` strips them. That makes
   * this one string the source of truth for both the audio and the captions,
   * so they cannot drift apart, which they always do when written twice.
   */
  narration: string;
  /** Floor for the shot length — the still beats a reviewer needs to read. */
  minHoldMs: number;
  steps: Step[];
  markers?: MarkerWatch;
  /**
   * Pre-rendered footage instead of a live recording — a designed text or
   * title card (typically from Hyperframes, or any tool that produces an
   * mp4), placed anywhere in the shot sequence like any other shot.
   *
   * It rides the same pipeline as a recorded shot: narration, caption
   * timing, and "never trim below what was shot, freeze the last frame if
   * narration outruns it" all apply unchanged, because `assemble` only sees
   * a shot with a `videoPath` and a `narration` — it does not know or care
   * where the file came from. `record` copies `file` into the take's `raw/`
   * directory and skips `setup`/`steps` for this shot entirely, so both may
   * be left empty.
   *
   * This is deliberately not the same mechanism as `--intro`/`--outro`:
   * those bookend the whole assembled video and sit outside the caption
   * timeline; a `card` is one shot among others, narrated and captioned like
   * any of them.
   */
  card?: { file: string };
};

export type Output = {
  id: string;
  title: string;
  /** Which shots this video is assembled from. */
  shots: string[];
};

export type Scenario = {
  id: string;
  title: string;
  baseUrl: string;
  /**
   * Return the app to its starting state so a re-shoot is identical. For a
   * real scenario this usually calls into the product; for the demo it is
   * enough to clear browser storage.
   */
  reset?: { url: string; evaluate: string };
  /** Hosts this scenario must NOT be recorded on (localhost, for review videos). */
  forbidHosts: string[];
  shots: Shot[];
  outputs: Output[];
};

/** Text for subtitles and for length estimates: the model's tags removed. */
export function captionText(narration: string): string {
  return narration
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shotsForOutput(scenario: Scenario, outputId: string): Shot[] {
  const output = scenario.outputs.find((o) => o.id === outputId);
  if (!output) {
    throw new Error(
      `Scenario '${scenario.id}' has no output '${outputId}'. Available: ${scenario.outputs
        .map((o) => o.id)
        .join(", ")}`,
    );
  }
  return output.shots.map((id) => {
    const shot = scenario.shots.find((s) => s.id === id);
    if (!shot) throw new Error(`Output '${outputId}' references unknown shot '${id}'.`);
    return shot;
  });
}
