---
name: edit-video
description: Edit a raw talking-head video through transcription, silence trimming, mistake review, visual storytelling, motion graphics, and verified HyperFrames rendering. Use for a complete edit; route a single requested operation directly to its specialist skill.
---

# Edit a video

Default entry for any raw video is the `studio-edit` skill (stateless runbook, brand, builder, gates, session-end cleanup);
this skill is the long-form detail it builds on. End every session with `npm run stop`.

Keep each project in `video-projects/<slug>/`, preserving the source recording.
Read the workspace guide and the project's brief or DESIGN.md. If a direction is
missing, propose a style from `style-library/registry.json` based on the footage.
If `brand/BRAND.md` exists, read it first: its tokens, fonts, caption bar, lower-third, hook-first order, 2 s
monogram bumper after the hook, and outro card apply unless the user says otherwise.

**Before building any new video, ask which platform/format it is for (never assume).** Call the
`AskUserQuestion` tool with exactly this prompt, even when a brand default exists:

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

Build with `node scripts/build-video.mjs <project> --format 4x5|9x16 [--sfx] [--music]` (see docs/BUILDER.md).
It owns base video, hook-first order, bumper, outro, captions, lower-third, counters with sound, audio master,
lint, render, and the gates. Per-video graphics go in `<project>/beats.mjs`; `--format` has no default. A format with no layout entry yet needs one added
and verified on rendered frames, not a silent crop.

1. Inspect duration, streams, and source resolution with ffprobe. Copy the source
   into the project's assets or reference an explicitly provided local path.
2. Read `docs/TOOLS-AND-API-KEYS.md` before service setup. Reuse a matching word
   transcript. Otherwise use the student's chosen provider; Nate defaults to
   `node scripts/transcribe-elevenlabs.mjs <source>`. OpenAI Whisper and local
   Whisper are supported workflow alternatives after transcript normalization.
   Check available credentials or local dependencies. Explain uploads and costs
   before any service call whose authorization is still missing. Free offline
   option: `node scripts/transcribe-local.mjs <source>` (whisper.cpp). It tends to
   silently clean up stutters, so keep Scribe for mistake detection and use local
   Whisper as the fallback or as a cross-check.
3. Read `../cut-silences/SKILL.md`. Produce an EDL and a retimed transcript, and
   render the silence pass when editing is authorized.
4. Read `../cut-mistakes/SKILL.md`. Also run `find-fillers.mjs` for filler words. Inspect candidates in context and preserve
   intentional emphasis. Record the reviewed cuts. If no mistakes need cutting,
   carry forward the silence output. Match every transcript to its actual video.
5. Read `../video-storytelling/SKILL.md` for the visual arc and
   `../hyperframes-video-beats/SKILL.md` for overlays. Write a beat sheet with
   transcript anchors, one visual idea per beat, and deliberate callbacks.
6. Read `MOTION_PHILOSOPHY.md`, `../hyperframes/SKILL.md`, and relevant GSAP
   references before authoring. Use `../style-library/SKILL.md` to select or
   adapt a card. Localize every asset used by the composition.
7. Audio master (never skip): `node scripts/audio-master.mjs <voice.wav> --out
   assets/voice.master.wav` makes stereo, cleans lightly, and normalizes to -16 LUFS /
   -1.5 dBTP. Point the composition's `<audio>` at the master. Sound design is
   optional and opt-in: `node scripts/sound-design.mjs generate|mix|music` builds SFX and a
   ducked bed as extra `<audio data-loudness-exempt>` stems; keep cues sparse, but EVERY count-up number needs a counter cue (rising ticks + landing,
   timed from the tween via `scripts/lib/counter-ticks.mjs`); preflight enforces it.
8. Run preflight and HyperFrames lint from the project, plus the transcript-sync
   validator for anchored sub-compositions. Preflight FAILS when the voice master is
   outside -18..-14 LUFS. Review Studio before the draft.
9. Render a draft, inspect encoded frames and transitions, and listen across cut
   boundaries. Check face framing, text legibility, black frames, and A/V sync.
   Then run `node scripts/audio-check.mjs <render>` (the FINAL mix must pass) and
   `node scripts/audio-joins.mjs <render> --out-dir <project>/review/joins --edl <silence-edl>
   --edl <mistakes-edl> --offset <prepend> --words assets/transcript.json --asr`. It checks
   every cut join for clicks, dead air, and clipped words, and writes short clips. Hand the
   user the flagged clips to audition, and record in VERIFY.md what nobody has heard.
   Resolve failures before the final render. Follow any review approvals already
   provided; do not repeat approval requests for the same authorized action.

Deliver the final MP4 path, edit decisions, retimed transcript, composition,
and `VERIFY.md` describing what was checked and any remaining limitations.
An automated detector proposes edits; editorial judgment remains necessary.
