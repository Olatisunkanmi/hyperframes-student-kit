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

1. `video.json`: `"captions": false, "lowerThird": false, "camera": false`, plus the user's bumper and
   outro choices. Write `beats.mjs` from the plan (API in [treatments.md](references/treatments.md)).
2. `node scripts/build-video.mjs <project> --format <fmt> --sfx` stops at the pre-render review. Open
   every contact sheet.
3. Run the critique in the intuition guide on the stills: overflow, face cover, dead screens, repeated
   treatments, anything that decorates instead of explains. Fix, then `--stages compose,review` again.

## Phase 6: Render and verify

`--stages render,check`, then extract frame strips across each new kind of transition from the encoded
file and look at them. Record decisions, evidence and what nobody has heard or watched in `VERIFY.md`.
The agent cannot hear: tell the user which sounds and joins need their ears. Run `npm run stop`.

## When a treatment is missing

If the content calls for something the engine cannot do (a chart, a map, a screen recording, B-roll),
say so in the plan rather than forcing the nearest scene type. Add a scene type to the engine only
with a unit test and a still-frame check; `hyperframes-video-beats` covers bespoke overlay panels.

## Example

For a 60 s explainer that opens "What is an EMR?", the plan gave the definition an `expand` scene
(E, M, R unfold as "Electronic, Medical, Record" are spoken), the Hospital A / Hospital B example a
`versus` split, "only half of the job" a `punch` in the hook and an accent `card` when it returns, and
left the connecting sentences as plain caption stacks. A minimal `beats.mjs` is in
[treatments.md](references/treatments.md); finished projects live under `video-projects/`, which is not in the repo.
