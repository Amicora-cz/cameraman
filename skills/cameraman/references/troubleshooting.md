# Troubleshooting

**Dry run reports missing selectors that are obviously there.**
The run has to click. Without clicking it never reaches the later states, so
everything downstream looks missing. That is what `--dry-run` does now; if you
see this, the flow broke earlier than the reported step.

**The shot opens on a loading skeleton.**
Navigation is inside `steps`. Move it to `setup`, which runs before the camera
rolls. `goto` waits only for `domcontentloaded`.

**The page never leaves the skeleton.**
It has no data — a missing database or API, not a timing problem. No amount of
waiting fixes it. Record against an environment that has data.

**Nothing visibly causes the clicks.**
`--pointer cdp` is set, or the pointer utility is missing. CDP input does not
move the OS cursor.

**A yellow "unsupported command-line flag" bar is in frame.**
`--no-sandbox`. Add `--test-type` to suppress it, or drop `--no-sandbox` — it
is only needed when running as root in a container.

**Subtitles show older wording than the audio.**
Captions come from `voice/manifest.json`, which records what was actually
spoken. A take recorded before a text edit keeps the old wording in
`shots.json`; re-run `voice` and the captions follow the audio.

**The commentary sounds chopped.**
Either it was generated per shot, or padding is being added on top of pauses
the clips already carry. Use `--single-take`.

**The consent screen is not in English.**
Three places have to be: the app's routes, the Google account language, and the
language switch at the bottom left of the consent screen itself.

**The capture is shorter than the run.**
The grabber is not keeping up with the requested fps. Lower the frame rate or
the capture size; per-shot files keep this from corrupting the cut, but the
picture is still choppier than it should be.
