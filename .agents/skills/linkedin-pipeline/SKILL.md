---
name: linkedin-pipeline
description: Run the full content pipeline for one raw talking-head video - the main edit (studio-edit), a batch of standalone clips (clip-harvest) plus 1-2 polished reels (short-form-edit), punchline videos (free-form), and draft LinkedIn post copy for every output. Use when the user says "/linkedin-pipeline", "run the pipeline", "full pipeline", "make the main video, clips and punchlines", "one video to many posts", or hands over a raw video and wants everything a shoot can yield. Resumable and gated; never publishes.
---

# LinkedIn pipeline

One raw recording in, a finished main video, standalone clips, reels, punchline videos and draft post copy out.
This skill only orchestrates. Each stage's own skill holds the craft rules and approval gates; load it and follow it.
Treat every request as a cold start: all state lives in `video-projects/<slug>/PIPELINE.md` and the project files.
Never publish or upload. The user posts. End the session with `npm run stop`.

## Start or resume

Run `node scripts/project-status.mjs <slug>`. If `PIPELINE.md` exists, read it and continue at the first unchecked stage.
Otherwise create the project (`node scripts/new-project.mjs <slug> --raw <video>`) and write `PIPELINE.md`:

```
# Pipeline: <slug>
Format: <asked in stage 1>   Brand: brand/BRAND.md
- [ ] 1 main edit (studio-edit)      -> final MP4: <path>
- [ ] 2 clips (clip-harvest)         -> clips.json, <outDir>
- [ ] 2 reels (short-form-edit)      -> <slugs>
- [ ] 3 punchlines picked / built    -> <lines + slugs>
- [ ] 4 post copy drafted            -> POSTS.md
```

Record every user decision and approval in the project's `VERIFY.md` as the stage skills require.

## Stage 1: Main edit

Invoke `studio-edit` on the raw video with **all its gates kept**: format question, filler and mistake cut list,
beat sheet, pre-render review, watch-render check. Do not continue until the user approves the draft and the final is rendered
(`--quality high`). Tick stage 1 only when the final MP4 path and `assets/approved-cuts.json` exist.

## Stage 2: Clips and reels

1. **clip-harvest** on the original recordings (never the edited cut) for the bulk of the standalone clips. Reuse the
   format already answered in stage 1; do not ask again.
2. Ask which 1-2 clips deserve a polished reel, using `AskUserQuestion` with the harvested slugs, hooks and lengths as options.
3. **short-form-edit** on those picks only. The first-3-seconds gate applies to each.
4. Show the clips table from clip-harvest plus the reel drafts. List what is unheard and the joins to audition first.

## Stage 3: Punchlines

1. Read the approved, retimed transcript of the final edit and pick out lines that work alone as attention hooks:
   a bold claim, contradiction, number, vivid image, or reversal; 3-12 words; no missing context.
2. Present 5-8 ranked lines as a table: rank, exact words, timestamp, why it hooks. Then call `AskUserQuestion`
   (multiSelect) so the user picks which become videos. Never auto-pick.
3. For each pick run **free-form** (short, 9:16 unless the format says otherwise), reusing the existing clean cut
   per its Phase 2. Expect treatments to be punchy and brief: the line, one beat of setup if needed, a hard stop.

## Stage 4: Post copy

For each approved output (main video, each reel, each punchline video, and a clips batch note) invoke
`linkedin-skills:linkedin-post-writer`, passing the transcript excerpt and the hook line. Write all drafts to
`video-projects/<slug>/POSTS.md` labelled by output file. Follow `brand/BRAND.md` voice. Drafts only: nothing is posted.

## Finish

Report one table: output, file, length, status, draft copy location. Move approved finals as the memory rules say
(`~/Desktop/videos`, clips in `~/Desktop/videos/clips/`, move not overwrite). Run `npm run stop`.

## Rules
- A stage never starts before the previous stage's gate is ticked in `PIPELINE.md`.
- One shoot, one set of facts: reuse transcripts and approved cuts; no new uploads without asking.
- Confirm before any paid or third-party call (transcription upload, Kie.ai, ElevenLabs).
- If footage is thin, say so and produce fewer clips; do not pad.
