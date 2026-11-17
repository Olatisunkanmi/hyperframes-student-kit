---
name: clip-harvest
description: Cut as many standalone short clips as possible out of the ORIGINAL recordings of an already-edited video, so one shoot yields many posts. Light treatment (trim to words, tighten pauses, crop, brand captions, -16 LUFS voice master). Use after a video is finished or approved, or when asked for clips, cutdowns, teasers, or "maximize output" from existing footage.
---

# Clip harvest

Run this after every finished video. It reuses the per-clip transcripts already made for the edit, so there is no new upload.
Tool: `node scripts/make-clips.mjs <clips.json> [--only slug,slug]`; `node scripts/make-clips.mjs --list <transcript.json>` prints sentences with times.
End the session with `npm run stop`. Never publish or upload; the user posts.

## Steps
1. **Ask the format** (never assume) with the exact `AskUserQuestion` prompt from `short-form-edit` ("Which platform and format is this video for?"), and the treatment: Light (default: trim, captions, loudness), Raw trim only, or Full brand treatment (then use `build-video` per clip instead).
2. **Find the material.** Use the raw per-clip transcripts (e.g. `video-projects/<set>/takes/IMG_*.json`), not the edited cut. Print sentences with `--list`, and read the word timings for the lines you pick.
3. **Pick clips.** Each clip must stand alone: the first line is a hook (claim, contradiction, question or vivid example), the last line closes a thought. Typical 8-35 s. Harvest every distinct idea, then add variants only where the hook differs (full vs short, different opening line). Skip fragments that need the missing context, and flubs you cannot cut cleanly. Say plainly when the footage is thin; do not pad.
4. **Write `clips.json`** next to the footage (format in the header of `scripts/make-clips.mjs`): `parts` with `src`, `from`, `to` in source seconds, `drop` ranges for flubs ("pa-", "user--"), optional multi-part clips that stitch sentences from different takes.
5. **Run** the tool, then review before showing anything: `<outDir>/<slug>-joins.png` (frames either side of every cut: hand over lens, black frame, jump in position), a caption frame from each clip, and the loudness line (-18..-14 LUFS, true peak <= -1).
6. **Report** a table: slug, length, hook line, joins. State what is unheard (the agent cannot hear: cuts and pause tightening are unaudited) and list the clips with the most joins as the ones to audition first.
7. **After the user approves**, move the approved MP4s and their `-transcript.md` to `~/Desktop/videos/clips/` (move, never overwrite). Write platform captions only if asked.

## Known limits
- Pauses longer than `gapMax` (0.55 s) are cut out; each cut is a hard video cut, so a pose jump is visible on talking-head footage. Raise `gapMax` for fewer cuts.
- Captions group 4 words and can end on a dangling word ("Hi I'm Ola a"). Fix with `captionGroups` settings if it bothers the user.
- 9:16 uses the full vertical frame and the 9x16 layout in `scripts/lib/builder/layout.mjs`; check it on rendered frames before delivering.
- No music, SFX, graphics, bumper or outro in Light treatment.
