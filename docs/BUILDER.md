# The video builder

`scripts/build-video.mjs` turns a cleaned cut into a branded, gated render. Everything that is the same in every
video lives in the core; only the graphics are per-video.

Start a project with `node scripts/new-project.mjs <slug> --raw <video>`; check where it stands any time with
`node scripts/project-status.mjs <project>`. End every session with `npm run stop`.

```sh
node scripts/build-video.mjs video-projects/<slug> --format 4x5|9x16 [--sfx] [--music]          # stops after review
#   inspect review/prerender/<format>/REVIEW.md and every image it lists; fix beats.mjs / the cut;
node scripts/build-video.mjs video-projects/<slug> --format 4x5 [--sfx] [--music] --stages compose,review   # seconds, repeat until clean
node scripts/build-video.mjs video-projects/<slug> --format 4x5 [--sfx] [--music] --stages render,check [--quality draft|standard|high] [--tag v2]
```
**Look before you render.** A render takes minutes; the review stage takes about 30 seconds. Every visual problem that can be
seen on a still (text overflow, a card over the face) or in the cleaned footage (a hand over the lens at a retake, a black
frame at a join) must be found in the review, not in a draft. Aim for one draft per round of user feedback.

`--format` is **required** and has no default: ask the user which platform it is for (see the skills), every time.
Formats live in `scripts/lib/builder/layout.mjs`; a new one needs a layout entry checked on rendered frames.

## Stages (default: all)
| stage | what it does |
|---|---|
| base | cold-open hook + bumper gap + cleaned video + outro slot -> `assets/base.mp4`, `base-4x5.mp4`, `voice.wav`, `base.meta.json` |
| compose | `index.html`, final-timeline `assets/transcript.json`, `assets/sfx-cues.json` (counter ticks included) |
| audio | voice master (stereo, -16 LUFS), SFX stem (`--sfx`), music bed (`--music`) |
| review | stills of every overlay clip (mid + settled), lower-third, bumper, outro and the opening, plus a 1 s frame strip and a luma flag at every join of the cleaned cut (hook in/out, body start, each editorial cut; `assets/clean.joins.txt` overrides the EDL) -> `review/prerender/<format>/REVIEW.md` |
| render | **blocked** unless a review of this exact `index.html` + cleaned cut was written by an earlier run (`--skip-review` bypasses it; record that). Then `hyperframes lint` must be 0 errors, then renders to `renders/<slug>-<format>-<draft|final>[-tag].mp4` |
| check | `preflight` (loudness, counter sound, structure) and `audio-check` on the render |

The default run is `base,compose,audio,compose,review` and stops before rendering. Run a subset with `--stages base,compose`. Exit code 1 when a gate fails. Gates are signal checks: a human still
listens (`scripts/audio-joins.mjs`) and watches.

## What the core owns
Brand tokens and fonts (`brand/brand.json`, `brand/fonts`), captions (navy bar, numbers in amber), lower-third,
slow camera push, count-up tweens, hook-first order, 2 s monogram bumper, outro card, voice master, and the sound cues
for all of those (every count-up number gets rising ticks plus a landing sound).

## `<project>/video.json`
```json
{
  "slug": "my-video",
  "brand": "brand/brand.json",
  "source": { "clean": "assets/clean.mp4", "transcript": "assets/raw.mistakes-transcript.json" },
  "hook": { "after": "other", "from": "thirty-seven", "to": "mistranslated", "pre": 0.1, "post": 0.16 },
  "bodyStart": 0.12,
  "bumper": 2,
  "outro": { "seconds": 2.5, "text": "Follow for the build" },
  "lowerThird": { "startWord": "hi", "nameWord": "olasunkanmi", "endWord": "i've" },
  "nameFixes": { "WrongSpelling": "RightSpelling" },
  "emphasis": ["thirty-seven", "percent"],
  "music": { "synth": true }
}
```
- `hook`: three spoken words in order. The hook is the clip from `from` (minus `pre`) to `to` (plus `post`) on the cleaned timeline,
  played first. Choose a truthful, specific line from the speaker's own words. `bumper: 0` / `outro.seconds: 0` turn those off.
  Start `from` on the first word of the claim, not on lead-in words, and make the hook graphic show its main word within about
  0.3 s so the opening is never a blank card.
- `lowerThird`: spoken words that cue the name bar. Name and title come from the brand file. Use the SAME word for `startWord` and
  `nameWord` (or adjacent words): the name enters at `nameWord`, so a later one leaves an empty navy bar on screen.
- `crop4x5Y` (default 160): vertical offset of the 4:5 crop of the 1080x1920 base. The caption bar starts at y=1010 and the lower-third at
  y=1190 (`layout.mjs`), so the mouth and chin must stay above about y=1000 in every frame (leaning forward, two-line captions). A typical
  seated face needs more than the default (img-9354 used 320). Check on full-size stills, not contact-sheet thumbnails.
- `source.clean`: point it at `assets/clean-graded.mp4` after `node scripts/grade-clean.mjs <project>` (gentle grade: subtle LUT, cooler
  white balance, contrast 1.05, saturation 0.92). Always open `--preview` first.
- `"captions": false`, `"lowerThird": false`, `"camera": false` switch off the core's brand captions, name bar and slow
  camera push for a style pack that brings its own (example: `style-library/03-kinetic-serif/kinetic.mjs`). Such an
  engine loads its own fonts from its pack; the brand fonts are still copied but unused. Record the brand override in VERIFY.md.
  The `free-form` skill's engine (`scripts/lib/freeform/freeform.mjs`) builds on the same switches.
- `voice`: optional voice-master settings, `{ "lufs": -16.5, "tp": -2, "level": true }`. `lufs` sets the loudness target, `level` evens out volume drift, and `tp` lowers the true-peak ceiling (default -1.5). Set `tp: -2` when the loudness gate fails on a true peak just over -1 dBFS: an SFX cue landing on a voice peak adds up to about 0.5 dB, which the default ceiling leaves no room for.
- `music`: `{ "file": "assets/track.mp3" }` for real music (record its source and licence in VERIFY.md); the synth pad is a placeholder.

## After every render
`node scripts/watch-render.mjs <render.mp4>` samples one frame per second into contact sheets (`review/watch/<name>/sheet-N.png`); open every
sheet. `--faces --at t1,t2` gives full-size crops of the face/caption band (4:5 layout). Check the face is clear, no blank or half-built
cards, no flashes, colour. Drafts render at `--quality draft` (about 2.3 Mbps, a third of the base) on purpose; the approved FINAL renders
with `--quality high` and its bitrate is checked against the base. Any non-draft quality names the file `-final`.

## `<project>/beats.mjs` (the per-video part)
Default export `(ctx) => ({ anchors, html, css, js, counters, cues })`, see the header of
`scripts/lib/builder/compose.mjs` and `video-projects/img-8410/beats.mjs` for a full example.
- anchors: spoken words (`ctx.find("percent", fromSeconds, "body")`); the page reads them as `T("name")` / `T("name", 1)`.
- html: overlay clips, `class="panel clip"`, unique `data-track-index >= 20`.
- counters: **declare every count-up here**. One object drives the tween and the sound; never hand-write a counting tween.
- Graphics should show the example, relationship, or consequence the speaker is describing, not restate captions.

## Relationship to the rest of the kit
The builder is the branded, light-theme path (`brand/`). The style library (`style-library/`, 406 draft cards) and the scene
templates are dark graph-paper and glass styles; they are NOT used by the builder and do not match the brand. Use them only if the
user asks, and re-skin to the brand tokens first. The older skills (`edit-video`, `short-form-edit`, `motion-showreel`) remain for their
own workflows. The builder is inline-composition only, so `validate-beat-sync.mjs` does not apply; beat timing comes from transcript
anchors and is checked on rendered frames. `short-form-edit`'s planning files (`plan.json`, `OPEN-LOOPS.json`, footage ledger) are not
produced by `build-video`: create them only when that skill's gates are explicitly required.
