---
name: vlog-edit
description: Edit a B-roll-heavy vlog (travel, lifestyle, day-in-the-life) from a folder of raw clips plus a voiceover. Scans the footage, selects the best moments, maps shots to the narration, then composes, verifies and renders a draft with HyperFrames. Use when the user hands over a clips folder, says "edit my vlog", "cut my travel video", "B-roll video with voiceover", or asks to resume a vlog project. Use studio-edit instead for talking-head footage and motion-showreel for music-only brand reels.
---

# Vlog edit (voiceover + B-roll)

The voiceover is the spine; every shot exists to illustrate the line being spoken. Stateless like `studio-edit`: state lives in
files, never in conversation. Resume with `node scripts/project-status.mjs <project>` and the project's `VERIFY.md`.
End every session with `npm run stop`.

Inputs: a folder of clips, a voiceover file (or a script to record or synthesize; ask), optional music file. Never print secrets;
raw files are preserved, projects stay gitignored, and the user owns publishing.

## Why not the builder

`scripts/build-video.mjs` is built around one cleaned talking-head base video. A vlog has no such base, so compose
`index.html` directly from the shot list (see `hyperframes`, `hyperframes-cli`, `gsap`). Reuse the kit's scripts for audio, preflight, and lint.

## 0. Ask only what is not recorded

Ask the format (same four options as `studio-edit`; vlogs are often 16:9, but never assume), sound design (effects + music bed,
effects only, voice only), and music source (the user's licensed track; record its licence in `VERIFY.md`).
Confirm before uploading any audio to a transcription service. Read `brand/BRAND.md` if it exists before choosing type and colour.

## 1. Runbook

1. **Scaffold**: `node scripts/new-project.mjs <slug> --raw <voiceover>`. Copy clips into `assets/clips/` (copies, never moves).
2. **Voiceover**: transcribe to word-level JSON (`scripts/transcribe-elevenlabs.mjs`, or free `scripts/transcribe-local.mjs`), then
   `cut-silences` and `cut-mistakes` on the voice track with user approval of each cut. Master with `scripts/audio-master.mjs` (-16 LUFS).
3. **Scan the footage** (`references/footage-scan.md`): ffprobe inventory, per-clip scene, freeze, blur and exposure signals, then
   contact sheets that you open and look at. Write `assets/footage-ledger.json`: per clip, usable `in/out` segments, subject
   tags, shot scale (wide, medium, detail), a 1-5 score, and defects. You see stills, not motion: say so, and flag any
   segment whose quality depends on movement for the user to confirm.
4. **Beat the narration**: split the transcript into beats (one idea per phrase). For each beat pick a shot; write `shotlist.json`
   with `beat`, `anchorWords`, `clip`, `in`, `out`, `scale`, `move` (hold, push, speed), `transition`.
5. **Shot list gate (the user decides)**: show the list with a thumbnail per shot, the reason for each pick, and every beat that has
   no good footage. Do not fill a gap with an unrelated clip, a still, or invented material; propose a title card or ask for footage.
6. **Compose**: muted `<video>` clips on separate tracks, a sibling `<audio>` for voice, music, and ambient; one paused GSAP
   timeline in `window.__timelines`. Titles, place names and chapter cards come from `hyperframes-video-beats` and only where they help.
7. **Check before render** (cheap checks first, one draft): `hyperframes lint`, `node scripts/preflight.mjs <project>`, a
   `hyperframes snapshot` at every beat, and a first/last-frame strip at every cut. Fix before rendering.
8. **Render once**, inspect the encoded draft's opening and every join, run `scripts/audio-check.mjs` and `scripts/audio-joins.mjs`.
   You cannot hear: hand the user the flagged join clips and say what is unheard. Batch all feedback before the next draft.
9. **Deliver**: write `VERIFY.md` (checked, unchecked, decisions). When the user approves a final render, move the MP4 to
   `~/Desktop/videos` (never overwrite), with `<name>-transcript.md` and `<name>-captions.md` beside it.

## Editorial rules

- Open with the most specific, striking line or shot the vlog actually delivers. Never promise what the vlog does not show.
- Shot length 1.5-4 s; vary scale across consecutive shots; never cut between two similar angles of one subject.
- Cut on phrase boundaries or up to 0.3 s before the word the shot illustrates (visual leads, voice follows).
- Use each moment once. Hold a signature shot longer for emphasis.
- Beat the music only if the user gives a BPM; the voice always leads and music ducks under it.
- Reject: black or white-flash frames, a hand over the lens, severe blur, mid-pan stops, unstable handheld that distracts.
- Keep ambient audio from key clips low under the voice when it adds place; otherwise drop it.
- Mismatched frame rates or rotation metadata: normalize per clip (cut per segment, never one huge trim/concat graph for 4K).

Related: `studio-edit`, `cut-silences`, `cut-mistakes`, `video-storytelling`, `hyperframes-video-beats`, `short-form-edit`.
