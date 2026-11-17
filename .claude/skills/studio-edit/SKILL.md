---
name: studio-edit
description: Master runbook for turning a raw talking-head video into a finished, branded, gated edit with this kit: format question, transcript, silence and filler and mistake cuts with user approval, hook-first structure, monogram bumper, outro, captions, lower-third, motion graphics, counter sounds, music, loudness mastering, render, gates, honest verification, and cleanup of local services. Use whenever the user gives a raw video file, says edit/cut/make a video, or asks to resume, continue, or fix a video project. Stateless by design: everything needed is in the repo and the project folder, never in earlier conversation.
---

# Studio edit (the entry point)

You may be a fresh session that knows nothing about earlier work. That is the design. Do not rely on memory or on what a
past conversation decided. Everything needed is in files:

| Need | Where |
|---|---|
| Standing rules, tool routing | `CLAUDE.md` / `AGENTS.md` |
| Brand: colours, fonts, captions, lower-third, bumper/outro, resolved decisions | `brand/BRAND.md`, `brand/brand.json`, `brand/fonts/` |
| How the builder works, `video.json`, `beats.mjs` | `docs/BUILDER.md`, `examples/brand-video-emr/`, `templates/brand-video/` |
| Where a project stands | `node scripts/project-status.mjs <project>` (reads the files) |
| What was decided and checked on a project | `<project>/VERIFY.md`, `video.json`, `assets/approved-cuts.json` |

**Resume, don't restart.** If a project exists, run `node scripts/project-status.mjs` (no argument lists all projects), read the
project's `VERIFY.md`, and continue from the first unchecked stage. Write every decision you get from the user into
`VERIFY.md` as you go, so the next session can resume cold.

## 0. Decide what you must ask (ask only what is not already recorded)

Format, every new video, no assumptions:

```yaml
AskUserQuestion:
  questions:
    - question: "Which platform and format is this video for?"
      header: "Format"
      multiSelect: false
      options:
        - label: "LinkedIn feed 4:5 (Recommended)"
          description: "1080x1350. The brand default (brand/BRAND.md). Cropped from vertical footage when needed."
        - label: "TikTok / Reels / Shorts 9:16"
          description: "1080x1920. Full vertical frame, phone-safe text zones."
        - label: "Both 4:5 and 9:16"
          description: "Two separately checked renders from the same edit."
        - label: "YouTube 16:9"
          description: "1920x1080. Needs its own layout, so confirm scope before building."
```

Sound design (the user liked SFX and music on the first video, but it is their call per video):

```yaml
AskUserQuestion:
  questions:
    - question: "Which sound design do you want?"
      header: "Sound"
      multiSelect: false
      options:
        - label: "Effects + music bed (Recommended)"
          description: "Counter ticks, panel pops, hit/whoosh accents, plus a ducked music bed. The built-in bed is a synthetic placeholder; use your own licensed track for real music."
        - label: "Effects only"
          description: "Counter ticks and accents, no music."
        - label: "Voice only"
          description: "No effects or music. Voice is still mastered to -16 LUFS."
```

Never upload audio or spend money without saying so first (see `docs/TOOLS-AND-API-KEYS.md`): transcription with ElevenLabs sends the
audio to their service. The free local option is `scripts/transcribe-local.mjs`.

## 1. Runbook

1. **Scaffold** (copies the raw file, never moves it): `node scripts/new-project.mjs <slug> --raw <video>`. It prints the next commands.
2. **Transcribe** to word-level JSON at `assets/raw.json`. Default: ElevenLabs Scribe (keeps stutters, best for mistake detection),
   `node scripts/transcribe-elevenlabs.mjs <project>/assets/raw.mp4 --no-diarize`. Free fallback: `scripts/transcribe-local.mjs`
   (it silently cleans stutters, so it cannot find the mistakes it removed). Read the whole transcript yourself.
3. **Silences**: `cut-silences.mjs ... --apply` (see the `cut-silences` skill). 
4. **Candidates**: `find-cut-candidates.mjs` and `find-fillers.mjs` on the silence transcript (see `cut-mistakes`). Zero candidates does not
   mean zero mistakes: read for false starts and self-corrections yourself. If a transcript has no "um/uh" but the audio gaps carry
   energy, say so; you cannot hear, so do not claim there are no fillers.
5. **Cut approval gate (the user decides)**: show each proposed cut with its context and a reason; ask. Leave at least 80 ms before the
   next word's onset at every cut end (a 20 ms margin clips consonants). Write `assets/approved-cuts.json` (an empty list is valid),
   then `apply-cuts.mjs ... --apply` to produce `assets/clean.mp4` and `assets/raw.mistakes-transcript.json`.
   **Grade (simple, gentle, every video)**: `node scripts/grade-clean.mjs <project> --preview`, then OPEN `review/grade-preview.png`
   (before on top, after below). Footage is often flat with a warm orange cast and a hot red or saturated garment; the default recipe
   (subtle LUT + 5600 K + contrast 1.05 + saturation 0.92) cools the wall and calms the garment. Skin tone must stay natural: if not,
   adjust `--temp/--saturation` or `--no-lut`. Then run it without `--preview`: it writes `assets/clean-graded.mp4` and points
   `video.json` `source.clean` at it (the ungraded `clean.mp4` is kept). Record the recipe in `VERIFY.md`. It keeps the duration, so
   transcript timings stay valid. **Re-run it after ANY change to the cuts**: `apply-cuts` rewrites `clean.mp4`, and a stale
   `clean-graded.mp4` would silently show the old cuts against the new transcript (no gate catches this).
6. **Hook (truthful, the user approves)**: pick the most specific, surprising claim the speaker actually makes. The hook plays first
   (a cold open), then the 2 s bumper, then the body. Never invent or reword a claim; never promise what the video does not deliver.
   **Start the hook on the first word of the claim, not on lead-in words** ("that is only half of the job" starts at "only"), and make the
   hook graphic show its main word within about 0.3 s of the first frame: a blank card or an empty chart for the first second is a defect.
   Look at the speaker's hands in the hook's first second; if a hand or object covers the mouth, tell the user and offer a later start.
7. **Fill `video.json`**: hook words (`after`, `from`, `to`), lower-third words, `nameFixes` (ASR mishears names: get the spelling from
   the user), `emphasis` (numbers). **Lower-third**: `startWord` and `nameWord` should be the SAME word (or adjacent), so the name enters
   with the bar; a later `nameWord` leaves an empty navy bar on screen. If the speaker never says their name, cue it on an early
   content word. **Face framing**: `crop4x5Y` (default 160) decides where the face sits in the 4:5 frame. The caption bar starts at
   y=1010 and the lower-third at y=1190, so the mouth and chin must stay above about y=1000 in every frame, including when the
   speaker leans forward and for two-line captions. A typical seated, centred face needs a larger value (img-9354 needed 320). Set
   it from the review stills, then confirm on the render. **Write `beats.mjs`**: one idea per beat, anchored to spoken words,
   graphics that show the example or consequence rather than restating captions, face clear, brand only. Every count-up goes in
   `counters` (it gets tick sound automatically; preflight blocks a count-up with no counter cue).
8. **Build to review, not to render**: `node scripts/build-video.mjs <project> --format <answer> [--sfx] [--music]`. It builds the
   base, composes, masters the voice to -16 LUFS, then runs the **review** stage and stops: stills of every graphic, the hook,
   lower-third, bumper and outro, plus a frame strip and luma flag at every join of the cleaned cut, in
   `review/prerender/<format>/REVIEW.md`. **Open every image.** Fix overflow, face coverage, half-built states, and any occluded or
   flashed frame at a join (a hand over the lens at a retake is a cut problem: fix the cut, not the graphics). Re-run
   `--stages compose,review` (about 30 s) until clean. The render stage refuses a stale or unread review. Never render to find out.
   When you move or reorder a segment, also check its first and last frames on the cleaned footage before building.
   **Contact-sheet thumbnails hide face problems.** Open at least three review stills at full size (one with a two-line caption, one
   where the speaker leans forward) and confirm no caption bar, panel or lower-third covers the mouth or chin.
9. **Render once**: `--stages render,check` (lint 0 errors, preflight, loudness). Exit 1 means a gate failed: fix it, do not bypass it.
   A true-peak failure (above -1 dBTP) is usually one loud effect landing on a loud word: find the peak time (ffmpeg `astats` with
   `reset`, per 0.1 s window), lower that one cue's `gain` in `beats.mjs`, then `--stages compose,audio,compose,review` and re-render.
   Drafts render at the default `draft` quality (about a third of the base bitrate); that is intended, so do not "fix" it on drafts.
   **Then watch the render immediately, every time** (see "Rules that never change"): `node scripts/watch-render.mjs <render>`
   writes one-frame-per-second contact sheets; open EVERY sheet and check the full face is clear (no bar, panel or lower-third on the
   mouth or chin, two-line captions included), no blank or half-built card or empty bar lasting more than a beat, no black or white
   flash, and colour and skin tone. For doubtful frames use `--faces --at t1,t2` for full-size crops. Fix what you find before
   reporting, and report what you saw. A passing lint never proves visual quality. One draft per round of user feedback; batch all
   known fixes before re-rendering.
10. **Listening gate**: you cannot hear. Run `node scripts/audio-joins.mjs <render> --out-dir <project>/review/joins --edl <silence-edl>
    --edl <mistakes-edl> --offset <hook + bumper - bodyStart> --joins <hook length> --words <project>/assets/transcript.json --asr`
    and give the user the flagged clips to audition. Say plainly what nobody has heard (counter ticks, effects, music, joins).
11. **Deliver**: send the render(s) to the user, state paths, write `VERIFY.md` (what was checked, what was not, decisions), then final
    render only when the user approves, and render it at FULL quality: `--stages render,check --quality high` (it names the file
    `-final`). Then run `scripts/watch-render.mjs` on it again, confirm its bitrate is close to the base video's (`ffprobe` both; a
    draft is about 2.3 Mbps against a 6.3 Mbps base), and recheck loudness and true peak because a new encode can shift them. Move the
    approved final per the saved preference. The guide also calls for a thumbnail and a LinkedIn caption
    (see `brand/BRAND.md`); they are specified but not automated yet, so say so rather than silently skipping them.
12. **Session end (mandatory)**: run `npm run stop` (stops every local process this repo started: preview servers, headless Chrome,
    ffmpeg, whisper) and confirm it prints nothing left running. Never leave `hyperframes preview`, `npx serve`, or a render running.
    A Claude Code SessionEnd hook also runs it, but do not rely on the hook alone: run it before you finish.

## Rules that never change
- Preserve the raw file; use new output names per stage; never print secrets; private footage, transcripts and renders stay gitignored.
- Never publish, upload, or message anyone; the user owns that. Never commit unless asked.
- Brand rules are guidance: raise a conflict with the user instead of silently breaking or following it. Record the resolution in `brand/BRAND.md`.
- Be honest about what is unverified. Signal checks are not listening, and sampled stills are not playback: say which you did.
- Watch every render (draft and final) with `scripts/watch-render.mjs` before reporting, and fix face-coverage, blank-card and
  colour problems yourself. Do not report a render you have only spot-checked.
- Drafts may be low bitrate; the approved final must render at `--quality high`. Never render the final before approval.
- Face first: nothing (captions, panels, lower-third) may cover the speaker's mouth or chin. Their own hand gestures are not
  fixable by layout: report them and offer a cut or a different hook start.
- Related skills: `cut-silences`, `cut-mistakes`, `video-storytelling`, `hyperframes`, `hyperframes-cli`, `gsap`, `short-form-edit`, `edit-video`.
