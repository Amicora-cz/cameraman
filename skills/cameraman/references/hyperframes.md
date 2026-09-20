# Hyperframes: designed motion around real footage

[Hyperframes](https://hyperframes.heygen.com/) renders HTML compositions to
MP4. Cameraman records a real browser doing real things. They do not overlap,
and the combination is better than either alone:

| | Cameraman | Hyperframes |
|---|---|---|
| Owns | the product actually working, narration, captions | title cards, motion, callouts, an outro |
| Source | a live app driven over CDP | HTML/CSS composition |
| Good at | proof | polish |

A verification screencast should stay almost bare — a reviewer wants evidence,
not a trailer. A product promo is the opposite: the hook and the outro are what
make it watchable.

## The seam

An mp4. Render a composition, hand it to `assemble`:

```bash
npx hyperframes render -o intro.mp4
npx tsx <skill-dir>/engine/cli.ts assemble --take <dir> \
  --intro intro.mp4 --outro outro.mp4 --burn-subs --poster
```

Bookends are re-encoded to match the shots, so the composition's resolution,
frame rate and audio layout do not have to agree in advance — a 720p/25fps
intro concatenates onto 1080p/30fps footage cleanly.

Captions are timed against the shots alone, so an intro would desynchronise all
of them. `assemble` shifts the whole SRT by the intro's length. This is the
part that silently breaks if you concatenate by hand.

## Gates before rendering

Mirror what Hyperframes asks for, and stop at the first failure:

```bash
npx hyperframes doctor                   # Chrome, FFmpeg, Node
npx hyperframes lint ./composition       # zero errors before rendering
npx hyperframes render -o intro.mp4
```

## What belongs in a composition

- **Hook** — the first two seconds, before any UI is shown.
- **Title and section cards** — cheaper and more readable than filming a
  scroll to a heading.
- **Callouts** — an arrow or a label over a still, where pointing the cursor
  would be ambiguous.
- **Outro** — the CTA, the URL, the logo. Never film this; it is a design.

## What does not belong in one

Anything that is supposed to be **evidence**. If a reviewer has to believe the
app does something, it has to be the app on screen doing it — a composition
that animates a fake consent screen is worse than no video at all.

## Without Hyperframes

`--intro` and `--outro` take any mp4. A card exported from Figma, a Keynote
build, or a still held by ffmpeg all work the same way:

```bash
ffmpeg -loop 1 -i title.png -t 3 -pix_fmt yuv420p intro.mp4
```
