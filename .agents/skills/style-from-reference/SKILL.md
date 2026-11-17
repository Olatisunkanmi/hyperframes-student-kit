---
name: style-from-reference
description: Turn a reference short video (a TikTok, Reel, or Short link, or a local file) into a reusable style pack the kit can edit with. Use when the user says "edit it like this video", "copy this TikTok's style", "match this reel", "make a style from this link", or supplies a reference and wants its pacing, captions, layout, transitions, music level, and sound-effect placement measured. Produces a style-library pack plus a reference-profile.json; it copies the style, never the reference's script, footage, music, or branding.
---

# Style from reference

Measure how a reference video is edited, write what was found into a style pack, and edit the user's
own footage with it. The analyzer is a self-contained Python tool in `scripts/`. It runs the same on
this machine and on a Linux server; see [remote.md](references/remote.md).

The agent cannot hear. The analyzer turns sound into numbers and labels, and the user makes the final
listening call (Phase 5). Say what was measured, what was read from frames, and what is a guess.

## Phase 1: Inputs

Need a reference (URL or file path) and a kebab-case slug for the style. If either is missing, ask
with AskUserQuestion. Reuse an existing `tmp/style-ref/<slug>/analysis.json` instead of re-running.

## Phase 2: Install check

Run `bash .agents/skills/style-from-reference/scripts/style-ref doctor`. If it reports "not installed",
tell the user the cost (about 3 GB of disk under `~/.cache/style-from-reference`, a few minutes of
downloads) and ask before running `bash .agents/skills/style-from-reference/scripts/setup.sh`:

```
AskUserQuestion:
  question: "The reference analyzer is not installed. Install it now (about 3 GB of disk)?"
  header: "Install"
  options:
    - label: "Install"
      description: "Run setup.sh: a private Python environment plus the audio models"
    - label: "Picture only"
      description: "Light install (about 50 MB): cuts, frames, and mix loudness, with no other audio data"
```

For "Picture only" run `setup.sh --light`, then add `--skip stems,transcript,rhythm,tags` to the analyze
command and say in the profile that the sound design was not measured.

## Phase 3: Analyze

```bash
bash .agents/skills/style-from-reference/scripts/style-ref analyze "<url-or-file>" --out tmp/style-ref/<slug>
```

`tmp/` is gitignored, so the reference video, frames, stems, and transcript stay private. The run is
resumable: finished stages are skipped, and a failed audio stage is recorded and the rest continues.
If the download is blocked, ask the user to save the video and pass the file path instead.

## Phase 4: Read the result

1. Read `tmp/style-ref/<slug>/REPORT.md` (numbers) and every contact sheet it lists (pictures).
2. For any transition, caption animation, or graphic that needs a closer look:
   `bash .agents/skills/style-from-reference/scripts/style-ref frames tmp/style-ref/<slug> --range <start> <end> --fps 12`
3. Note, with timestamps: hook construction, caption style (position, words per card, case, emphasis,
   animation), layout and framing, B-roll and graphic frequency, transitions, colour, and which visual
   events carry a sound effect. Keep observation separate from interpretation, as in
   `short-form-edit/references/reference-analysis.md`.
4. Check `soft_changes` in `analysis.json` against the sheets: jump cuts and punch-ins hide there.
5. Treat sound effects by how far each number can be trusted. Timing (`tags.effects[].t`) is dependable
   but incomplete: checked against renders with known cue lists it found about 6 in 10 effects with
   almost no false detections, missing quiet effects under speech and soft whooshes. The type `label`
   is weak (about 1 in 3 right). Decide each type from the picture event at that timestamp first, then
   `pitch_hz`, `bass_share`, and `ring_s`, and use the label only as a hint. Where the picture shows an
   event pattern (every caption emphasis, every B-roll cut), assume the unseen effects follow it.

## Phase 5: Listening gate

Give the user the things only ears can judge, then ask with AskUserQuestion whether to accept them:
the sound named on the post, the genre and mood guess, the tempo, and the stem at
`tmp/style-ref/<slug>/work/stems/no_vocals.wav` to audition. Never reuse the reference's music. The user
licenses the track or approves a replacement matched on tempo and mood. Record the answer in the
profile (`audio.music.user_confirmed`).

## Phase 6: Write the style pack

1. Read `style-library/GUIDE.md`. Scaffold with
   `node scripts/style-library/new-style.mjs <NN> <slug> "<Name>"` (next free number).
2. Fill `DESIGN.md`, `tokens.css`, and the identity fields of `style.json` from the frames and palette.
3. Write `style-library/<NN>-<slug>/reference-profile.json` following
   [profile-schema.md](references/profile-schema.md). Numbers only, no reference media.
4. Restyle the two blueprint cards to the new tokens, or remove them from `style.json`. Build further
   cards only when the reference actually uses that kind of graphic.
5. If `brand/BRAND.md` exists and conflicts with the reference (fonts, colours, bumper, outro), ask which
   wins with AskUserQuestion and record it as `brand_policy`. Brand order (hook, bumper, body, outro)
   stays unless the user says otherwise.
6. Run `node scripts/style-library/build-registry.mjs`, then `npm run check`.

## Phase 7: Edit with the pack

Load `short-form-edit` (or `studio-edit` for a raw recording) and treat the pack as the design source:

- `pacing` sets plan targets (shot length, cuts in the first 3 seconds, words per caption card).
- `audio.sfx_rules` becomes the cue list for `scripts/sound-design.mjs mix`; `audio.music.rel_lu` and
  `duck_db` become its `--rel` and `--duck`.
- Transfer mechanisms, not copies: write new copy and scenes from the user's own transcript.
- When the reference's captions are the graphics (words placed around the speaker, text cards), reuse the
  engine in `style-library/03-kinetic-serif/kinetic.mjs` from the project's `beats.mjs`, with
  `"captions": false, "lowerThird": false, "camera": false` in `video.json` (docs/BUILDER.md). Put a new
  engine beside its pack the same way, with unit tests under `tests/`.
- All normal gates still apply (cut approval, pre-render review, loudness, VERIFY.md).

## Phase 8: Clean up

Delete `tmp/style-ref/<slug>/source` and `work` once the pack is approved; keep `REPORT.md` and
`analysis.json` if the user wants the evidence. Run `npm run stop` before ending the session.

## Example

```
$ style-ref analyze "https://www.tiktok.com/@creator/video/123" --out tmp/style-ref/fast-talker
fetch: downloading ...
stems: separating voice from music and effects on cpu (the slowest step)
tmp/style-ref/fast-talker/REPORT.md
```

`REPORT.md` then reads, for example: "Shots: 14 (median 1.6 s) ... Cuts landing on a beat: 0.71 (random
cuts would reach 0.3) ... Likely sound effects: 9 (pop x5, whoosh-up x4)".
