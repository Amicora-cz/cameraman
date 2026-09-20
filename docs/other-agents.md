# Using cameraman with other agents

Agents without native `SKILL.md` discovery can still run the skill.

## Option 1 — the `skills` CLI (recommended)

```bash
npx skills add https://github.com/Amicora-cz/cameraman --skill cameraman
```

Works for Cursor, Codex, Copilot, Gemini CLI, opencode and others. `-g`
installs globally.

## Option 2 — point custom instructions at the file

Paste the contents of [`skills/cameraman/SKILL.md`](../skills/cameraman/SKILL.md)
into the agent's custom instructions, or give it the path if it can load
instructions from a file. The references under `skills/cameraman/references/`
are read on demand, so the agent needs the repo (or the skill folder) on disk.

## Option 3 — copy the folder

```bash
cp -r skills/cameraman/ ~/.your-agent/skills/cameraman/
```

## Cursor specifically

Cursor reads `.agents/skills/` at the project root, which this repo already
provides as a symlink. Cloning the repo into a workspace is enough. To use it
in *another* project, install with the `skills` CLI above rather than copying —
the engine and the demo need to travel with the skill.

## Regardless of method

The environment still needs Node ≥ 22, ffmpeg on PATH, a pointer utility, and a
real Chrome started with `--remote-debugging-port=9222`. The skill's Step 0
checks all of it before recording anything.
