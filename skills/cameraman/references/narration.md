# Narration

## One take, split afterwards

Generate the whole output's commentary in a single request — or have a person
read the whole script once — and let the engine cut it:

```
npx tsx <skill-dir>/engine/cli.ts voice --take <dir> --scenario <id> --single-take narration.mp3
```

Clip per shot sounds chopped: the model knows nothing about the neighbouring
sentences, so each clip starts cold and ends on a falling intonation. Four of
those in a row is not a commentary.

The cut points are not "the N-1 longest pauses" — in a longer read several of
those fall inside one shot. Each boundary gets an expected time from the ratio
of narration lengths, and takes the nearest silence. A drift over 2.5 s is
reported: it means the text no longer matches the scenario.

Clips from one take already carry half a pause at each end, so the assembler
adds no padding to them. Per-shot clips have no pause of their own and do get
padding.

## Writing for delivery

Punctuation carries the performance; tags are a garnish. ElevenLabs is explicit
that tags are the direct way to *force* an effect and land reliably only where
the context already supports them. A `[breathes]` at the top of every paragraph
is audible as exactly that — a voice inhaling on command.

- `…` a short pause inside a thought — **the main tool**
- `,` `.` rhythm and breath, `—` a short beat
- CAPITALS sparingly, on one word
- tags **only where the text gives a reason**: `[pause]` after a rhetorical
  question, `[deliberate]` on the punchline. Two a minute is a ceiling, not a target.

Tag families (v3): `[pause]` `[short pause]` `[long pause]` `[breathes]`
`[continues after a beat]` · `[rushed]` `[slows down]` `[deliberate]`
`[rapid-fire]` · `[stammers]` `[drawn out]` `[timidly]` · `[emphasized]`
`[stress on next word]` `[understated]`.

## Providers

`eleven_v3` is the default, for the inline tags and the phrasing.
`eleven_multilingual_v2` is cheaper and faster; set `ELEVENLABS_MODEL_ID`.

A voice id only ever comes from the account, never from memory. Library voices
may need a paid tier; the premade ones work on any.

**No key, or no TTS at all?** Drop a recorded `.wav` per shot into the take's
`voice/` directory, or hand one continuous file to `--single-take`. The engine
measures what it finds and skips generation. A person reading the script once
is the best version of this path, not a workaround.

## Language

Narration language is the scenario's business. A verification video for Google
must be in **English**, including the consent screen — set the Google account
language and walk the app's English routes. A product promo has no such rule.
