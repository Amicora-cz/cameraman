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
  | { kind: "switchTab"; urlIncludes: string }
  | { kind: "click"; target: Target }
  /** Move onto an element without clicking — show it without firing it. */
  | { kind: "point"; target: Target }
  | { kind: "type"; target: Target; text: string; perCharMs?: number }
  | { kind: "waitFor"; target: Target; timeoutMs?: number }
  | { kind: "scroll"; deltaY: number; overMs?: number }
  | { kind: "focusAddressBar" }
  | { kind: "hold"; ms: number }
  | { kind: "gate"; name: string; message: string };

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
