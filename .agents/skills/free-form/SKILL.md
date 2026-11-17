---
name: free-form
description: Edit a talking-head video as an editor would, not as a template would. Reads what the speaker says, then gives each line the treatment it calls for (kinetic word captions, punch words, text cards, an acronym unfolded, a split-screen comparison, numbered points, zoom jumps, push/zoom/wipe/flash transitions, sound cues). Use when the user says "/free-form", "free-form edit", "edit this so it suits the video", "make this edit richer", "add more motion and transitions", or wants a short that is more than captions. Starts from the Kinetic Serif Mix look; for copying one reference's style use style-from-reference.
---

# Free-form edit

A template applies one treatment to every line. An editor asks what each line is doing and picks a
treatment that makes that job easier for the viewer. This skill is the second thing. The engine
(`scripts/lib/freeform/freeform.mjs`) can render the treatments; choosing them is your work, and it is
most of the quality.

Read [editorial-intuition.md](references/editorial-intuition.md) before planning and
[treatments.md](references/treatments.md) before writing `beats.mjs`.

## Phase 1: Inputs

Need a raw video or an existing project. Ask the format (AskUserQuestion, as in `studio-edit`) unless
the project's `VERIFY.md` records it. If the user names a brand or reference look, note it; otherwise
the base look is `style-library/03-kinetic-serif`.

## Phase 1.5: Source selection (always ask)

Never assume the whole recording is the edit. A one-minute take is usually the whole video; a five-minute
conversation may only contain a few moments worth editing. Transcribe the raw video first (the same
step `studio-edit` uses, with its upload confirmation), then ask, every time, unless the project's
`VERIFY.md` already records the answer:

```
AskUserQuestion:
  question: "Use the full video, or should I read the transcript and pick the best parts?"
  header: "Source"
  options:
    - label: "Full video"
      description: "Edit the whole recording as given"
    - label: "Pick the best parts"
      description: "I read the transcript and propose a few self-contained moments for you to approve"
```

**Full video:** record "source: full" in `VERIFY.md` and go to Phase 2.

**Pick the best parts:**

1. `node scripts/select-moments.mjs outline <project>/assets/raw.json` prints every sentence with times.
   Read all of it, not a sample. If the user gave a target (for example "3 clips" or "about 45 seconds"),
   fit to it; otherwise choose by merit and say plainly when the footage holds only one or two.
2. Choose self-contained moments: the first line is a hook (claim, contradiction, question, vivid example)
   and the last line closes the thought. Skip fragments that need missing context and passages that
   only connect other ideas. Prefer 8 to 45 s each. Do not pad to hit a count.
3. Write `<project>/selection.json` (`{ "picks": [ { "slug", "from", "to", "reason", "hook" } ] }`, times
   in source seconds copied from the outline) and run
   `node scripts/select-moments.mjs check <project>/selection.json --transcript <project>/assets/raw.json`.
   It snaps the picks onto word boundaries, warns about mid-sentence starts or unfinished endings,
   and writes `SELECTION.md` and `selection.resolved.json`. Fix every ERROR. Fix warnings or justify them.
4. Show `SELECTION.md` (each pick's range, hook, reason and words) and ask for approval. The user can drop
   or adjust picks; re-run `check` after any change. Then ask the output mode:

```
AskUserQuestion:
  question: "How should the approved picks become videos?"
  header: "Output"
  options:
    - label: "One stitched short"
      description: "Join the picks in the listed order into a single edited video"
    - label: "One short per pick"
      description: "Each pick becomes its own separate free-form video"
```

5. Only after both answers: `node scripts/select-moments.mjs approve <project>/selection.resolved.json --mode stitch|separate`,
   then `node scripts/select-moments.mjs apply <project>/selection.resolved.json --video <project>/assets/raw.mp4 --transcript <project>/assets/raw.json --out-dir <project>/assets`.
   `apply` refuses without approval or if the ranges changed since `check`. The raw file is never modified.
6. Record the picks, the plan id and the mode in `VERIFY.md`. In stitch mode, Phase 2 onward runs on
   `assets/selected.mp4` with `assets/selected.json` as its transcript. In separate mode, make one project
   per `selected-<slug>.mp4` (copy its `.json` to that project's `assets/raw.json`) and run Phases 2 to 6
   for each; confirm with the user before starting the next one.

The cuts in Phase 2 are tightening, not selection: they apply to the selected material only.

## Phase 2: Clean cut

Follow `studio-edit` for transcript, silence trims, filler and mistake cuts, and their approvals. When
another project already holds an approved cut of the same recording, reuse its `assets/clean.mp4`,
transcript, EDL and `approved-cuts.json` in a new project folder. Never overwrite an earlier edit.

## Phase 3: Read the video

Before choosing anything, write `<project>/PLAN.md` with three parts, following
[editorial-intuition.md](references/editorial-intuition.md):

1. **The point** in one sentence, and who it is for.
2. **The line map**: every sentence of the cleaned transcript with its job (hook, question, definition,
   claim, contrast, sequence, example, turn, payoff, call to action) and its weight (carry or connect).
3. **The footage**: where the face sits, what the background and wardrobe colours are, gestures or
   moments worth keeping on screen, and anything that should be hidden.

## Phase 4: Plan the treatments

Add a beat sheet to `PLAN.md`: one row per treated moment with the spoken words, the treatment, the
transition, and one sentence of reason tied to the line's job. Then check it against the budget and
variety rules in the intuition guide and revise. Choose the accent colour from the footage or brand.

Show the beat sheet and ask before rendering:

```
AskUserQuestion:
  question: "Here is the plan for this edit (beat sheet above). Build it?"
  header: "Plan"
  options:
    - label: "Build it"
      description: "Render a draft from this plan"
    - label: "Simpler"
      description: "Fewer takeovers and transitions; more time on the speaker"
    - label: "Bolder"
      description: "More takeovers and stronger transitions where the content supports them"
```

## Phase 5: Build and look

Write `beats.mjs` with `roles: "auto"` in the spec so numbers, negations and names are styled by what they
are (see "Caption roles" in treatments.md), and check the stills for wrong name guesses.

1. `video.json`: `"captions": false, "lowerThird": false, "camera": false`, plus the user's bumper and
   outro choices. Write `beats.mjs` from the plan (API in [treatments.md](references/treatments.md)).
2. `node scripts/build-video.mjs <project> --format <fmt> --sfx` stops at the pre-render review. Open
   every contact sheet.
3. Read `review/motion-review.md` (written at compose). Fix every error; fix or justify every warning in
   `PLAN.md`. Errors block the render.
4. Run the critique in the intuition guide on the stills: overflow, face cover, dead screens, repeated
   treatments, anything that decorates instead of explains. Fix, then `--stages compose,review` again.

## Phase 6: Render and verify

`--stages render,check`, then extract frame strips across each new kind of transition from the encoded
file and look at them. Record decisions, evidence and what nobody has heard or watched in `VERIFY.md`.
The agent cannot hear: tell the user which sounds and joins need their ears. Run `npm run stop`.

## When a treatment is missing

If the content calls for something the engine cannot do (a line chart, a map, a screen recording, B-roll),
say so in the plan rather than forcing the nearest scene type. Add a scene type to the engine only
with a unit test and a still-frame check; `hyperframes-video-beats` covers bespoke overlay panels.

## Example

For a 60 s explainer that opens "What is an EMR?", the plan gave the definition an `expand` scene
(E, M, R unfold as "Electronic, Medical, Record" are spoken), the Hospital A / Hospital B example a
`versus` split, "only half of the job" a `punch` in the hook and an accent `card` when it returns, and
left the connecting sentences as plain caption stacks. A minimal `beats.mjs` is in
[treatments.md](references/treatments.md); finished projects live under `video-projects/`, which is not in the repo.
