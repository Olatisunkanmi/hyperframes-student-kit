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
6. **Hook (truthful, the user approves)**: pick the most specific, surprising claim the speaker actually makes. The hook plays first
   (a cold open), then the 2 s bumper, then the body. Never invent or reword a claim; never promise what the video does not deliver.
7. **Fill `video.json`**: hook words (`after`, `from`, `to`), lower-third words, `nameFixes` (ASR mishears names: get the spelling from
   the user), `emphasis` (numbers). **Write `beats.mjs`**: one idea per beat, anchored to spoken words, graphics that show the example
   or consequence rather than restating captions, face clear, brand only. Every count-up goes in `counters` (it gets tick sound
   automatically; preflight blocks a count-up with no counter cue).
8. **Build**: `node scripts/build-video.mjs <project> --format <answer> [--sfx] [--music]` (draft). It masters the voice to -16 LUFS,
   renders, lints (0 errors required) and runs preflight plus the loudness gate. Exit 1 means a gate failed: fix it, do not bypass it.
9. **Look at the actual frames** (hero frames of every graphic, hook, bumper, lower-third, outro, cut joins) and fix what is wrong.
   A passing lint never proves visual quality.
10. **Listening gate**: you cannot hear. Run `node scripts/audio-joins.mjs <render> --out-dir <project>/review/joins --edl <silence-edl>
    --edl <mistakes-edl> --offset <hook + bumper - bodyStart> --joins <hook length> --words <project>/assets/transcript.json --asr`
    and give the user the flagged clips to audition. Say plainly what nobody has heard (counter ticks, effects, music, joins).
11. **Deliver**: send the render(s) to the user, state paths, write `VERIFY.md` (what was checked, what was not, decisions), then final
    render only when the user approves (`--quality standard`). The guide also calls for a thumbnail and a LinkedIn caption
    (see `brand/BRAND.md`); they are specified but not automated yet, so say so rather than silently skipping them.
12. **Session end (mandatory)**: run `npm run stop` (stops every local process this repo started: preview servers, headless Chrome,
    ffmpeg, whisper) and confirm it prints nothing left running. Never leave `hyperframes preview`, `npx serve`, or a render running.
    A Claude Code SessionEnd hook also runs it, but do not rely on the hook alone: run it before you finish.

## Rules that never change
- Preserve the raw file; use new output names per stage; never print secrets; private footage, transcripts and renders stay gitignored.
- Never publish, upload, or message anyone; the user owns that. Never commit unless asked.
- Brand rules are guidance: raise a conflict with the user instead of silently breaking or following it. Record the resolution in `brand/BRAND.md`.
- Be honest about what is unverified. Signal checks are not listening.
- Related skills: `cut-silences`, `cut-mistakes`, `video-storytelling`, `hyperframes`, `hyperframes-cli`, `gsap`, `short-form-edit`, `edit-video`.
