/**
 * Narration — ElevenLabs, or a human voice.
 *
 * **Why this is not just "send each sentence separately".** Generated per
 * shot, the model knows nothing about the neighbouring sentences: every clip
 * starts cold and ends on a falling intonation, as if that sentence were the
 * last. It is audible — the result sounds spliced rather than spoken.
 *
 * The preferred fix is one continuous read, split on the silences
 * (`splitSingleTake`). Where a provider cannot take the whole script at once,
 * the fallback is **request stitching**: each sentence is sent with the text
 * before and after it (`previous_text` / `next_text`) and the ids of previous
 * generations (`previous_request_ids`), so prosody carries across the whole
 * commentary while the clips stay separate — which is needed, because a clip's
 * length sets its shot's length.
 *
 * Stitched clips are generated **sequentially**, not in parallel: chaining
 * needs the id from the previous response.
 *
 * If `voice/` already holds `NN-<id>.wav`, the stage leaves it alone and only
 * measures it — so a recorded human voice can replace TTS at any point without
 * changing anything else.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { ffmpeg, durationSec, assertToolsAvailable } from "../lib/ffmpeg";
import { captionText, getScenario, shotsForOutput, type Shot } from "../scenarios";
import { detectSilences, pickCutPoints } from "../lib/split";

export type VoiceClip = {
  id: string;
  file: string;
  seconds: number;
  /**
   * Where the clip came from. `single-take` clips carry their own pause from
   * the recording (the cut runs through the middle of the silence), so
   * post-production must NOT pad them — see LEAD_IN_SEC in assemble.ts.
   */
  source: "single-take" | "per-shot";
  /**
   * The text spoken in this clip.
   *
   * Subtitles are taken from here, not from the snapshot made while recording:
   * the text is typically revised after the shoot and only `voice` is re-run.
   * Reading captions from `shots.json` showed wording older than the audio —
   * which is exactly what happened once.
   */
  narration: string;
};

/**
 * Split one continuous read into per-shot clips.
 *
 * This is the **preferred path**, whether the audio came from a single TTS
 * request or from a person reading the whole script once: prosody holds by
 * itself and none of the spliced quality of per-sentence generation appears.
 * Cuts are found in the silence between sentences (see lib/split.ts).
 */
export async function splitSingleTake(
  takePath: string,
  sourceAudio: string,
  shots: Shot[],
): Promise<VoiceClip[]> {
  const dir = path.join(takePath, "voice");
  fs.mkdirSync(dir, { recursive: true });

  const totalSec = await durationSec(sourceAudio);
  const silences = await detectSilences(sourceAudio);
  const { cuts, warnings } = pickCutPoints(
    totalSec,
    // Weight = length of the spoken text, excluding tags, which are not said.
    shots.map((shot) => captionText(shot.narration).length),
    silences,
  );
  for (const warning of warnings) process.stdout.write(`  ⚠ ${warning}\n`);

  const bounds = [0, ...cuts, totalSec];
  const clips: VoiceClip[] = [];

  for (const [index, shot] of shots.entries()) {
    const file = path.join(dir, `${String(index + 1).padStart(2, "0")}-${shot.id}.wav`);
    await ffmpeg([
      "-ss", bounds[index].toFixed(3),
      "-to", bounds[index + 1].toFixed(3),
      "-i", sourceAudio,
      "-ar", "48000", "-ac", "1",
      file,
    ]);
    const seconds = await durationSec(file);
    process.stdout.write(`  ✂ ${path.basename(file)} ${seconds.toFixed(2)} s\n`);
    clips.push({ id: shot.id, file, seconds, source: "single-take", narration: shot.narration });
  }

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(clips, null, 2), "utf8");
  return clips;
}

/** How many previous generations are sent as context (the API takes 3). */
const STITCH_DEPTH = 3;

type Stitch = {
  previousText?: string;
  nextText?: string;
  previousRequestIds: string[];
};

async function synthesize(text: string, target: string, stitch: Stitch): Promise<string | null> {
  const { apiKey, voiceId, modelId } = config.elevenLabs;
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is missing. Either set it in .env.cameraman, or drop " +
        "recorded WAV files into voice/ and run again.",
    );
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        previous_text: stitch.previousText,
        next_text: stitch.nextText,
        previous_request_ids: stitch.previousRequestIds.slice(-STITCH_DEPTH),
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.2, speed: 0.97 },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  const mp3 = path.join(path.dirname(target), `${path.basename(target, ".wav")}.mp3`);
  fs.writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
  // Normalised to 48 kHz mono WAV so post-production never resamples.
  await ffmpeg(["-i", mp3, "-ar", "48000", "-ac", "1", target]);
  fs.unlinkSync(mp3);

  // This id is sent with the next clip so the read carries over.
  return response.headers.get("request-id");
}

export async function voice(
  takePath: string,
  scenarioId = "google-calendar",
  outputId = "full",
  singleTakeAudio?: string,
): Promise<VoiceClip[]> {
  await assertToolsAvailable();
  const shots: Shot[] = shotsForOutput(getScenario(scenarioId), outputId);

  // One continuous read (TTS or human) is only split.
  if (singleTakeAudio) {
    const clips = await splitSingleTake(takePath, singleTakeAudio, shots);
    const sum = clips.reduce((total, clip) => total + clip.seconds, 0);
    process.stdout.write(`\n✓ ${clips.length} clips from one take, ${sum.toFixed(1)}s total\n`);
    return clips;
  }

  const dir = path.join(takePath, "voice");
  fs.mkdirSync(dir, { recursive: true });

  const clips: VoiceClip[] = [];
  const requestIds: string[] = [];

  for (const [index, shot] of shots.entries()) {
    const file = path.join(dir, `${String(index + 1).padStart(2, "0")}-${shot.id}.wav`);

    if (fs.existsSync(file)) {
      process.stdout.write(`  = ${path.basename(file)} (exists, measuring only)\n`);
    } else {
      process.stdout.write(`  + ${path.basename(file)}\n`);
      const requestId = await synthesize(shot.narration, file, {
        previousText: shots[index - 1]?.narration,
        nextText: shots[index + 1]?.narration,
        previousRequestIds: requestIds,
      });
      if (requestId) requestIds.push(requestId);
    }

    clips.push({
      id: shot.id,
      file,
      seconds: await durationSec(file),
      source: "per-shot",
      narration: shot.narration,
    });
  }

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(clips, null, 2), "utf8");
  const total = clips.reduce((sum, clip) => sum + clip.seconds, 0);
  process.stdout.write(
    `\n✓ ${clips.length} clips, ${total.toFixed(1)}s of narration (${(total / 60).toFixed(1)} min)\n`,
  );
  return clips;
}
