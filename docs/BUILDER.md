# The video builder

`scripts/build-video.mjs` turns a cleaned cut into a branded, gated render. Everything that is the same in every
video lives in the core; only the graphics are per-video.

Start a project with `node scripts/new-project.mjs <slug> --raw <video>`; check where it stands any time with
`node scripts/project-status.mjs <project>`. End every session with `npm run stop`.

```sh
node scripts/build-video.mjs video-projects/<slug> --format 4x5|9x16 [--sfx] [--music] [--quality draft|standard] [--tag v2]
```

`--format` is **required** and has no default: ask the user which platform it is for (see the skills), every time.
Formats live in `scripts/lib/builder/layout.mjs`; a new one needs a layout entry checked on rendered frames.

## Stages (default: all)
| stage | what it does |
|---|---|
| base | cold-open hook + bumper gap + cleaned video + outro slot -> `assets/base.mp4`, `base-4x5.mp4`, `voice.wav`, `base.meta.json` |
| compose | `index.html`, final-timeline `assets/transcript.json`, `assets/sfx-cues.json` (counter ticks included) |
| audio | voice master (stereo, -16 LUFS), SFX stem (`--sfx`), music bed (`--music`) |
| render | `hyperframes lint` must be 0 errors, then renders to `renders/<slug>-<format>-<draft|final>[-tag].mp4` |
| check | `preflight` (loudness, counter sound, structure) and `audio-check` on the render |

Run a subset with `--stages base,compose`. Exit code 1 when a gate fails. Gates are signal checks: a human still
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
- `lowerThird`: spoken words that cue the name bar. Name and title come from the brand file.
- `music`: `{ "file": "assets/track.mp3" }` for real music (record its source and licence in VERIFY.md); the synth pad is a placeholder.

## `<project>/beats.mjs` (the per-video part)
Default export `(ctx) => ({ anchors, html, css, js, counters, cues })`, see the header of
`scripts/lib/builder/compose.mjs` and `video-projects/img-8410/beats.mjs` for a full example.
- anchors: spoken words (`ctx.find("percent", fromSeconds, "body")`); the page reads them as `T("name")` / `T("name", 1)`.
- html: overlay clips, `class="panel clip"`, unique `data-track-index >= 20`.
- counters: **declare every count-up here**. One object drives the tween and the sound; never hand-write a counting tween.
- Graphics should show the example, relationship, or consequence the speaker is describing, not restate captions.
