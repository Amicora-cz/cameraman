# cameraman

**Scenarios as data. One command from click-through to a narrated, subtitled video.**

`cameraman` drives a real Chrome through a scenario you can read in a pull
request, records the screen, narrates it and cuts the result with subtitles.

It exists for the videos you have to shoot **more than once**: Google OAuth
verification, Meta App Review, a product demo that goes stale every time the UI
moves. Clicking through eight shots by hand is cheap the first time and
expensive the fourth.

## Install

```bash
/plugin marketplace add Amicora-cz/cameraman
/plugin install cameraman@cameraman
```

**Any other agent** — Cursor, Codex, Gemini CLI, opencode — one command via the
[`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add https://github.com/Amicora-cz/cameraman --skill cameraman
```

Add `-g` for every project, drop it to scope to this one.

<details>
<summary>No installer? Copy the skill.</summary>

```bash
rsync -a skills/cameraman/ ~/.claude/skills/cameraman/
```

</details>

### Also works with

The skill is exposed at every agent's discovery path via symlinks, so no extra
config is needed.

| Agent | Discovers from |
|---|---|
| **Claude Code** | `.claude-plugin/` marketplace, or `.claude/skills/cameraman/` |
| **Cursor / Codex CLI** | `.agents/skills/cameraman/` |
| **opencode** | `.opencode/skills/cameraman/` |
| **Google Antigravity** | `.agents/skills/cameraman/`, or `~/.gemini/config/skills/` globally |
| **Anything else** | point custom instructions at `skills/cameraman/SKILL.md` — see [docs/other-agents.md](docs/other-agents.md) |

> **Windows:** symlinks need `git config core.symlinks true` and Developer Mode.
> Otherwise copy `skills/cameraman/` into the agent's skill directory.

## Use it

```text
/cameraman --scenario onboarding
/cameraman --scenario google-calendar --output full --burn-subs
/cameraman --scenario demo --dry-run        # does the scenario still match the app?
```

## Requirements

Node ≥ 22 · ffmpeg + ffprobe · a real Chrome started with
`--remote-debugging-port=9222` · a pointer tool (`xdotool`, `cliclick`, or
PowerShell) · OBS ≥ 30.2 only for `--backend obs`.

## Try it without your app

A throwaway two-page app ships with the skill, so the whole chain can be
verified before pointing it at anything real:

```bash
npm install
npm run demo:serve &
npm run cameraman -- record --scenario demo --backend x11grab --pointer os --reset --assemble --burn-subs
```

## Your scenarios live in your project

The plugin ships only its own throwaway demo. A real scenario describes one
specific app — its selectors, its language, its flows — so it belongs in that
app's repository, in `cameraman-scenarios/` (or wherever `CAMERAMAN_SCENARIOS`
points). A renamed button breaks a scenario; the fix then lands in the same
pull request as the rename, which is the whole point.

The format, step by step, is in
[`skills/cameraman/references/scenario-format.md`](skills/cameraman/references/scenario-format.md).

## Designed motion around real footage

A hook and an outro are design, not footage. Render them with
[Hyperframes](https://hyperframes.heygen.com/) — or anything that produces an
mp4 — and hand them over:

```bash
npx hyperframes render -o intro.mp4
npm run cameraman -- assemble --take <dir> --intro intro.mp4 --burn-subs --poster
```

Bookends are re-encoded to match the shots, so a 720p/25fps composition
concatenates onto 1080p/30fps footage cleanly, and the captions are shifted by
the intro's length — the step that silently breaks when you concatenate by hand.

Evidence never goes in a composition. A reviewer has to see the app itself doing
the thing.

## Keeping it honest

```bash
npm run check
```

Verifies that every link in the skill resolves, every flag it documents is one
the CLI actually parses, the agent-discovery symlinks are still symlinks, and
the plugin manifest matches the skill directory. It caught a documented `--lang`
that no longer existed the first time it ran.

## What it refuses to do

Some of this was learned the expensive way; the reasoning is in
[`skills/cameraman/SKILL.md`](skills/cameraman/SKILL.md) under Recording laws.

- **Record localhost for a review video.** A scenario's `forbidHosts` stops it.
- **Launch the browser itself.** The automation bar would be in frame and
  Google blocks sign-in on such a browser.
- **Fake the cursor.** CDP input moves nothing on screen; the engine moves the
  real pointer.
- **Trim footage to fit the narration.** Silence is free, filmed frames are not.
- **Cut one long capture by wall clock.** Video time and real time diverge when
  the grabber drops frames. One file per shot instead.

## License

MIT.
